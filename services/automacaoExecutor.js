'use strict';

/**
 * Executor de automações (fluxos tipo=automacao).
 * Roda grafo de nós sem contexto de chat; contexto = { variables, triggerPayload }.
 * Nós: trigger_webhook, trigger_schedule, condition, set_variable, http_request, ia, merge, log, end, sleep.
 */

const axios = require('axios');
const provedorService = require('./provedorIAService');

function interpolate(str, vars) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v !== undefined && v !== null ? String(v) : '';
  });
}

function getNodeById(nodes, id) {
  return nodes.find(n => n.id === id);
}

function getEdgesFrom(edges, sourceId, sourceHandle = 'output') {
  return edges.filter(e => e.source === sourceId && (e.sourceHandle || 'output') === sourceHandle);
}

function getNextNodeId(edges, sourceId, sourceHandle = 'output') {
  const edge = edges.find(e => e.source === sourceId && (e.sourceHandle || 'output') === sourceHandle);
  return edge ? edge.target : null;
}

/**
 * Executa uma automação.
 * @param {Object} fluxo - { id, nome, nodes, edges }
 * @param {string} triggerType - 'webhook' | 'schedule' | 'manual'
 * @param {Object} triggerPayload - dados do gatilho (body do webhook, etc.)
 * @returns {Promise<{ success: boolean, variables: Object, logs: string[], error?: string }>}
 */
async function executarAutomacao(fluxo, triggerType = 'manual', triggerPayload = {}) {
  const nodes = fluxo.nodes || [];
  const edges = fluxo.edges || [];
  const variables = {
    triggerType,
    triggerPayload: triggerPayload || {},
    ...(triggerPayload && typeof triggerPayload === 'object' ? triggerPayload : {})
  };
  const logs = [];

  // Encontrar nó de início pelo tipo do trigger
  let currentNodeId = null;
  if (triggerType === 'webhook') {
    const webhookNode = nodes.find(n => n.type === 'trigger_webhook');
    currentNodeId = webhookNode ? webhookNode.id : null;
  } else if (triggerType === 'schedule' || triggerType === 'manual') {
    const scheduleNode = nodes.find(n => n.type === 'trigger_schedule');
    currentNodeId = scheduleNode ? scheduleNode.id : null;
  }
  if (!currentNodeId) {
    const anyTrigger = nodes.find(n => n.type && n.type.startsWith('trigger_'));
    currentNodeId = anyTrigger ? anyTrigger.id : null;
  }

  if (!currentNodeId) {
    return { success: false, variables, logs, error: 'Nenhum nó de gatilho encontrado' };
  }

  try {
    while (currentNodeId) {
      const node = getNodeById(nodes, currentNodeId);
      if (!node) break;

      const data = node.data || {};
      let nextHandle = 'output';
      let nextId = null;

      switch (node.type) {
        case 'trigger_webhook':
        case 'trigger_schedule':
          if (data.variavelPayload && triggerPayload) {
            variables[data.variavelPayload] = triggerPayload;
          }
          nextId = getNextNodeId(edges, node.id, 'output');
          break;

        case 'condition': {
          const varName = data.variavelNome || 'valor';
          const operador = data.operador || 'igual';
          const valorComparacao = data.valorComparacao;
          const valor = variables[varName];
          let result = false;
          const vStr = valor !== undefined ? String(valor) : '';
          const compStr = valorComparacao !== undefined ? String(valorComparacao) : '';
          switch (operador) {
            case 'igual': result = vStr === compStr; break;
            case 'diferente': result = vStr !== compStr; break;
            case 'contem': result = vStr.includes(compStr); break;
            case 'maior': result = Number(valor) > Number(valorComparacao); break;
            case 'menor': result = Number(valor) < Number(valorComparacao); break;
            case 'maior_igual': result = Number(valor) >= Number(valorComparacao); break;
            case 'menor_igual': result = Number(valor) <= Number(valorComparacao); break;
            default: result = vStr === compStr;
          }
          nextHandle = result ? 'output-true' : 'output-false';
          nextId = getNextNodeId(edges, node.id, nextHandle);
          break;
        }

        case 'set_variable': {
          const nome = data.nomeVariavel || data.variavel || 'var';
          let valor = data.valor !== undefined ? data.valor : data.valorVariavel;
          if (typeof valor === 'string') valor = interpolate(valor, variables);
          variables[nome] = valor;
          nextId = getNextNodeId(edges, node.id, 'output');
          break;
        }

        case 'http_request': {
          const method = (data.method || 'GET').toUpperCase();
          const url = interpolate(data.url || '', variables);
          const headers = (data.headers && typeof data.headers === 'object') ? data.headers : {};
          let body = data.body;
          if (typeof body === 'string') body = interpolate(body, variables);
          if (body && typeof body === 'object' && !(body instanceof String)) {
            try {
              const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
              body = interpolate(bodyStr, variables);
            } catch (_) {}
          }
          try {
            const res = await axios({
              method,
              url,
              headers: { 'Content-Type': 'application/json', ...headers },
              data: body,
              timeout: (data.timeout || 30) * 1000,
              validateStatus: () => true
            });
            const outVar = data.variavelSaida || 'response';
            variables[outVar] = res.data;
            variables[`${outVar}_status`] = res.status;
          } catch (err) {
            variables[data.variavelSaida || 'response'] = { error: err.message };
            if (data.onError === 'stop') {
              return { success: false, variables, logs, error: `HTTP: ${err.message}` };
            }
          }
          nextId = getNextNodeId(edges, node.id, 'output');
          break;
        }

        case 'ia': {
          const instrucao = interpolate(data.instrucao || '', variables);
          const contexto = data.incluirVariaveis ? JSON.stringify(variables) : '';
          const mensagens = contexto ? [{ role: 'user', content: contexto + '\n\n' + instrucao }] : [{ role: 'user', content: instrucao }];
          try {
            const resposta = await provedorService.enviarParaIA(mensagens, data.provedorId || null);
            const outVar = data.variavelSaida || 'respostaIA';
            variables[outVar] = (resposta && typeof resposta === 'string') ? resposta.trim() : String(resposta);
          } catch (err) {
            variables[data.variavelSaida || 'respostaIA'] = '';
            if (data.onError === 'stop') {
              return { success: false, variables, logs, error: `IA: ${err.message}` };
            }
          }
          nextId = getNextNodeId(edges, node.id, 'output');
          break;
        }

        case 'merge':
          nextId = getNextNodeId(edges, node.id, 'output');
          break;

        case 'log': {
          const msg = interpolate(data.mensagem || 'Log', variables);
          const nivel = data.nivel || 'info';
          logs.push(`[${nivel}] ${msg}`);
          if (data.variavelLog) variables[data.variavelLog] = msg;
          nextId = getNextNodeId(edges, node.id, 'output');
          break;
        }

        case 'sleep': {
          const ms = Math.min(600000, parseInt(data.delayMs || data.segundos || 0, 10) * 1000 || 0);
          if (ms > 0) await new Promise(r => setTimeout(r, ms));
          nextId = getNextNodeId(edges, node.id, 'output');
          break;
        }

        case 'end':
          return { success: true, variables, logs };

        default:
          nextId = getNextNodeId(edges, node.id, 'output');
      }

      if (!nextId) break;
      currentNodeId = nextId;
    }

    return { success: true, variables, logs };
  } catch (err) {
    return { success: false, variables, logs, error: err.message };
  }
}

module.exports = {
  executarAutomacao,
  interpolate
};
