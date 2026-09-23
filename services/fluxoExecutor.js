const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const fluxoService = require('./fluxoService');
const promptService = require('./promptService');
const provedorService = require('./provedorIAService');
const requisicaoService = require('./requisicaoExternaService');
const indicacaoService = require('./indicacaoService');
const arquivoService = require('./arquivoService');
const metaService = require('./metaService');
const fluxoLogService = require('./fluxoLogService');
const whatsappIdentityService = require('./whatsappIdentityService');
const telefone = require('./telefoneService');
const multipedidosCupomService = require('./multipedidosCupomService');
const abordagemService = require('./abordagemService');
const participacaoService = require('./participacaoService');
const posVendaService = require('./posVendaService');

/**
 * Ações que entregam o cupom ao cliente. Um fluxo que tem alguma delas conduz a campanha do começo
 * ao fim sozinho, e por isso nunca entrega o contato ao bot legado.
 */
const ACOES_QUE_ENVIAM_CUPOM = new Set([
  'enviar_cupom',
  'multipedidos_criar_cupom',
  'multipedidos_alterar_cupom'
]);

const CAMPOS_CONTATO_PERMITIDOS = ['cam_grupo', 'qt_indicados', 'cam_indicacoes', 'nome', 'id_negociacao'];

/** Parse dd/mm/yyyy para Date (meia-noite). Retorna null se inválido. */
function parseDataBR(str) {
  if (!str || typeof str !== 'string') return null;
  const [d, m, y] = str.trim().split(/[/-]/).map(Number);
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Extrai do prompt os critérios mencionados (qualquer % e N dias) e busca no arquivo
 * um cupom que atenda. Tudo vem do prompt e do arquivo; o fluxo não precisa mudar.
 * Retorna apenas o campo texto de um item que EXISTE no arquivo; nunca inventa dados.
 */
function selecionarCupomPorCriterio(listaCupons, instrucao) {
  if (!Array.isArray(listaCupons) || listaCupons.length === 0) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const inst = (instrucao || '').toLowerCase();

  // Qual percentual o prompt pede? (ex.: "30%", "10%") – qualquer número seguido de %
  const matchPct = inst.match(/(\d+)\s*%/);
  const pctPedido = matchPct ? matchPct[1] + '%' : null;

  // Quantos dias de validade? (ex.: "10 dias", "validade para 5 dias")
  const matchDias = inst.match(/(\d+)\s*dias?/i);
  const diasValidade = matchDias ? parseInt(matchDias[1], 10) : null;
  const dataLimite = diasValidade != null ? (() => {
    const d = new Date(hoje);
    d.setDate(d.getDate() + diasValidade);
    return d;
  })() : null;

  const textoOuDescricao = (item) => `${item.descricao || ''} ${item.texto || ''} ${item.mensagem || ''}`.toLowerCase();
  const contemPercentual = (item, pct) => textoOuDescricao(item).includes(pct.toLowerCase());

  const validadeDentroDoPeriodo = (item) => {
    if (!item.validade || dataLimite == null) return true;
    const dataVal = parseDataBR(item.validade);
    if (!dataVal) return true;
    dataVal.setHours(0, 0, 0, 0);
    return dataVal >= hoje && dataVal <= dataLimite;
  };

  const candidatos = listaCupons.filter(item => {
    if (!item || !(item.texto || item.mensagem)) return false;
    if (pctPedido && !contemPercentual(item, pctPedido)) return false;
    return validadeDentroDoPeriodo(item);
  });

  // Ordenar por validade (mais próxima primeiro) para priorizar cupons “vencendo”
  if (candidatos.some(c => c.validade)) {
    candidatos.sort((a, b) => {
      const da = parseDataBR(a.validade);
      const db = parseDataBR(b.validade);
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });
  }
  const escolhido = candidatos[0];
  return escolhido ? (escolhido.texto || escolhido.mensagem) : null;
}

// Sessões ativas de fluxos
const sessoesFluxo = new Map();

function removerSessaoFluxoPorExecutor(executor) {
  if (!executor) return;
  const keys = executor._sessionKeys && executor._sessionKeys.length
    ? executor._sessionKeys
    : [executor.chatId];
  for (const k of keys) sessoesFluxo.delete(k);
}

/**
 * Registra a sessão sob TODOS os identificadores conhecidos do contato.
 *
 * Importa quando o bot inicia a conversa (abordagem ativa: pós-venda, indicado): ali o fluxo começa
 * por `<telefone>@c.us`, mas a resposta do cliente pode chegar por `@lid` em contas que usam esse
 * formato. Sem a chave do @lid, `processarMensagemFluxo` não acha a sessão e a resposta cai no
 * atendimento comum — o cliente escolhe uma opção e nada acontece.
 */
function registrarSessaoFluxo(executor) {
  const ident = executor.resolvedIdentity || {};
  const keys = [];
  const juntar = (valor) => {
    const k = valor ? String(valor).trim() : '';
    if (k && !keys.includes(k)) keys.push(k);
  };

  juntar(executor.chatId);
  juntar(ident.chatIdCanonicoCUs);
  juntar(ident.whatsappLid);

  // 9º dígito: o pedido traz o telefone com 13 dígitos e o WhatsApp entrega as mensagens do mesmo
  // contato com 12 (ou o contrário). Sem as duas chaves, a resposta não acha a sessão.
  for (const base of [executor.chatId, ident.chatIdCanonicoCUs]) {
    if (!base || !String(base).endsWith('@c.us')) continue;
    for (const digitos of telefone.variantes(base)) juntar(`${digitos}@c.us`);
  }

  executor._sessionKeys = keys;
  for (const k of keys) sessoesFluxo.set(k, executor);
}

/**
 * Alinha a identidade com o que já está gravado em `contatos`, antes de o fluxo começar.
 *
 * Faz duas coisas, ambas importantes quando é o BOT que abre a conversa (pós-venda, indicado):
 *  - adota o telefone na forma já cadastrada. O pedido traz 13 dígitos e o contato pode estar
 *    gravado com 12 (9º dígito); sem isso, histórico, metas e participação iriam para um segundo
 *    registro e o cliente poderia receber de novo uma campanha que já fez.
 *  - completa o @lid, que a biblioteca só devolve com confiança quando a conversa chega por ele.
 */
async function alinharIdentidadeComBanco(ident) {
  if (!ident) return ident;
  const wid = ident.widDigitosTelefone || String(ident.chatIdOriginal || '').replace(/\D/g, '');
  if (!wid || wid.length < 10) return ident;
  const variantes = telefone.variantes(wid);
  if (variantes.length < 1) return ident;
  let conn;
  try {
    conn = await mysql.createConnection({
      host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
      password: dbConfig.password, database: dbConfig.database
    });
    const [rows] = await conn.execute(
      `SELECT whatsapp_id, whatsapp_lid FROM contatos
        WHERE whatsapp_id IN (${variantes.map(() => '?').join(',')})
        ORDER BY (whatsapp_lid IS NOT NULL) DESC, id ASC LIMIT 1`,
      variantes
    );
    const achado = rows[0];
    if (achado) {
      const cadastrado = String(achado.whatsapp_id || '').trim();
      if (cadastrado && cadastrado !== ident.widDigitosTelefone) {
        console.log(`🔎 Contato já cadastrado como ${cadastrado} (recebido ${ident.widDigitosTelefone || wid}) — usando o cadastrado.`);
        ident.widDigitosTelefone = cadastrado;
      }
      const lid = String(achado.whatsapp_lid || '').trim();
      if (lid && !ident.whatsappLid) ident.whatsappLid = lid;
    }

    // Segunda fonte para o @lid: o histórico de execução. `contatos.whatsapp_lid` só é preenchido
    // desde que passamos a gravá-lo, mas quem conversou por @lid antes disso deixou o rastro em
    // `fluxo_exec_logs.chat_id`. Sem isso, a sessão não responderia por esse identificador e a
    // resposta do cliente se perderia — exatamente o problema que originou esta função.
    if (!ident.whatsappLid) {
      const [antigos] = await conn.execute(
        `SELECT chat_id FROM fluxo_exec_logs
          WHERE whatsapp_id IN (${variantes.map(() => '?').join(',')})
            AND chat_id LIKE '%@lid'
          ORDER BY id DESC LIMIT 1`,
        variantes
      );
      const lidAntigo = antigos[0] && String(antigos[0].chat_id || '').trim();
      if (lidAntigo) {
        ident.whatsappLid = lidAntigo;
        console.log(`🔎 @lid recuperado do histórico para ${ident.widDigitosTelefone || wid}: ${lidAntigo}`);
      }
    }
  } catch (e) {
    if (e.code !== 'ER_BAD_FIELD_ERROR' && e.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️ Não foi possível alinhar a identidade pelo banco:', e.message);
    }
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
  return ident;
}

// Callback opcional: quando um fluxo de campanha termina (ex.: após entrada no grupo), o bot pode passar o usuário para a campanha legada (Missão 2)
let onCampanhaFlowEnd = null;
function setOnCampanhaFlowEnd(fn) {
  onCampanhaFlowEnd = fn;
}

class FluxoExecutor {
  constructor(client, chatId, fluxo) {
    this.client = client;
    this.chatId = chatId;
    this.fluxo = fluxo;
    this.nodes = fluxo.nodes || [];
    this.edges = fluxo.edges || [];
    this.currentNodeId = null;
    this.variaveis = {};
    this.historico = [];
    this.aguardandoResposta = false;
    this.aguardandoContatos = false;
    this.waitContactsMeta = 10;
    this.fluxoCompletouCampanha = false;
    this.resolvedIdentity = null;
  }

  /** Telefone só dígitos para CRM / contatos / metas (não usar LID como número). */
  getIdWhatsappParaDb() {
    if (this.resolvedIdentity && this.resolvedIdentity.widDigitosTelefone) {
      return this.resolvedIdentity.widDigitosTelefone;
    }
    return metaService.normalizarWhatsappId(this.chatId);
  }

  async logExec(evento, mensagem, node = null, detalhes = null) {
    try {
      await fluxoLogService.registrarLog({
        whatsappId: this.getIdWhatsappParaDb(),
        chatId: this.chatId,
        fluxoId: this.fluxo?.id,
        fluxoNome: this.fluxo?.nome,
        nodeId: node?.id || null,
        nodeType: node?.type || null,
        evento,
        mensagem,
        detalhes
      });
    } catch (_) {}
  }

  // Encontra o nó inicial (trigger)
  findStartNode() {
    return this.nodes.find(n => n.type === 'trigger');
  }

  // Encontra próximo nó baseado nas conexões
  findNextNode(currentId, handleType = 'output') {
    const edge = this.edges.find(e => e.source === currentId && e.sourceHandle === handleType);
    if (!edge) return null;
    return this.nodes.find(n => n.id === edge.target);
  }

  // Encontra nó por ID
  getNode(nodeId) {
    return this.nodes.find(n => n.id === nodeId);
  }

  // Inicia execução do fluxo
  async start() {
    const startNode = this.findStartNode();
    if (!startNode) {
      console.log(`❌ Fluxo ${this.fluxo.id} não tem nó de gatilho`);
      return false;
    }

    console.log(`🔀 Iniciando fluxo "${this.fluxo.nome}" para ${this.chatId}`);
    await this.logExec('fluxo_start', `Iniciando fluxo "${this.fluxo.nome}"`);
    // Garante registro mínimo do contato para testes e leituras posteriores no fluxo.
    try {
      const wid = this.getIdWhatsappParaDb();
      const lid = this.resolvedIdentity && this.resolvedIdentity.whatsappLid
        ? String(this.resolvedIdentity.whatsappLid).trim()
        : null;
      if (wid && wid.length >= 10) {
        const conn = await mysql.createConnection({
          host: dbConfig.host,
          port: dbConfig.port || 3306,
          user: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database
        });
        await conn.execute(
          `INSERT INTO contatos (whatsapp_id, whatsapp_lid)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE
             whatsapp_lid = COALESCE(VALUES(whatsapp_lid), whatsapp_lid),
             updated_at = NOW()`,
          [wid, lid]
        );
        await conn.end();
      } else if (this.chatId) {
        console.warn(
          '⚠️ Não foi possível obter o telefone (PN) do WhatsApp para gravar em contatos; conversa em @lid sem resolução. Aguarde nova versão do cliente ou atualize whatsapp-web.js.'
        );
      }
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') {
        console.warn('⚠️ Falha ao garantir contato no início do fluxo:', e.message);
      }
    }
    
    // Pula o trigger e vai para o próximo nó
    const nextNode = this.findNextNode(startNode.id);
    if (nextNode) {
      await this.executeNode(nextNode);
    }
    
    return true;
  }

  // Executa um nó específico
  async executeNode(node) {
    if (!node) {
      console.log(`✅ Fluxo "${this.fluxo.nome}" finalizado para ${this.chatId}`);
      await this.logExec('fluxo_end', `Fluxo "${this.fluxo.nome}" finalizado`);
      removerSessaoFluxoPorExecutor(this);
      return;
    }

    this.currentNodeId = node.id;
    this.historico.push({ nodeId: node.id, timestamp: Date.now() });

    console.log(`▶️ Executando nó ${node.type}: ${node.id}`);
    await this.logExec('node_execute', `Executando nó ${node.type}`, node);

    switch (node.type) {
      case 'message':
        await this.executeMessage(node);
        break;
      case 'wait':
        await this.executeWait(node);
        break;
      case 'condition':
        await this.executeCondition(node);
        break;
      case 'ia':
        await this.executeIA(node);
        break;
      case 'action':
        await this.executeAction(node);
        break;
      case 'wait_contacts':
        await this.executeWaitContacts(node);
        break;
      case 'condition_var':
        await this.executeConditionVar(node);
        break;
      case 'end':
        await this.executeEnd(node);
        return;
      default:
        const next = this.findNextNode(node.id);
        await this.executeNode(next);
    }
  }

  // Executa nó de mensagem
  async executeMessage(node) {
    let texto = node.data.texto || '';
    
    // Substitui variáveis
    texto = this.substituirVariaveis(texto);
    
    // Delay se configurado
    if (node.data.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, node.data.delay));
    }
    
    // Envia mensagem
    if (texto) {
      await this.client.sendMessage(this.chatId, texto);
    }
    
    // Continua para próximo nó
    const nextNode = this.findNextNode(node.id);
    await this.executeNode(nextNode);
  }

  // Executa nó de aguardar resposta
  async executeWait(node) {
    console.log(`⏳ Aguardando resposta do cliente (variável: ${node.data.variavelResposta || 'resposta'})`);
    this.aguardandoResposta = true;
    this.currentNodeId = node.id;
    this.waitVariableName = node.data.variavelResposta || 'resposta';
    await this.logExec('wait_start', `Aguardando resposta em {{${this.waitVariableName}}}`, node);
  }

  // Executa nó de aguardar contatos (indicações) – texto editável no nó
  async executeWaitContacts(node) {
    const meta = node.data.meta || 10;
    this.aguardandoContatos = true;
    this.aguardandoResposta = false;
    this.currentNodeId = node.id;
    this.waitContactsMeta = meta;
    this.variaveis.qtIndicados = 0;
    this.variaveis.metaIndicados = meta;
    // Modo simulação (fluxos de demonstração): conta os contatos só nesta conversa,
    // sem gravar indicações nem enfileirar mensagem para os indicados.
    this.contatosSimulados = node.data.simulacao ? new Set() : null;

    const mensagemConvite = (node.data.mensagemConvite || '').trim();
    if (mensagemConvite) {
      const texto = this.substituirVariaveis(mensagemConvite);
      await this.client.sendMessage(this.chatId, texto);
    }
    console.log(`📇 Aguardando ${meta} contatos (indicações) para ${this.chatId}`);
    await this.logExec('wait_contacts_start', `Aguardando ${meta} contatos`, node, { meta });
  }

  // Executa nó de verificação por variável (sem IA): segue dois caminhos conforme comparação
  async executeConditionVar(node) {
    const nomeVar = (node.data.variavelNome || '').trim() || 'resposta';
    const operador = (node.data.operador || 'igual').toLowerCase();
    const valorComparacao = node.data.valorComparacao != null ? String(node.data.valorComparacao).trim() : '';
    const valorAtual = this.variaveis[nomeVar] != null ? String(this.variaveis[nomeVar]).trim() : '';

    let resultado = false;
    switch (operador) {
      case 'igual':
      case '==':
        resultado = valorAtual === valorComparacao;
        break;
      case 'diferente':
      case '!=':
        resultado = valorAtual !== valorComparacao;
        break;
      case 'contem':
        resultado = valorAtual.toLowerCase().includes(valorComparacao.toLowerCase());
        break;
      case 'maior':
        resultado = Number(valorAtual) > Number(valorComparacao);
        break;
      case 'menor':
        resultado = Number(valorAtual) < Number(valorComparacao);
        break;
      case 'maior_igual':
        resultado = Number(valorAtual) >= Number(valorComparacao);
        break;
      case 'menor_igual':
        resultado = Number(valorAtual) <= Number(valorComparacao);
        break;
      default:
        resultado = valorAtual === valorComparacao;
    }
    console.log(`🔀 [Variável] {{${nomeVar}}} (${operador}) "${valorComparacao}" → ${resultado ? 'SIM' : 'NÃO'}`);
    await this.logExec('condition_var_result', `Condição variável: ${resultado ? 'SIM' : 'NÃO'}`, node, {
      variavel: nomeVar,
      operador,
      valorComparacao,
      valorAtual,
      resultado
    });
    const handleType = resultado ? 'output-true' : 'output-false';
    const nextNode = this.findNextNode(node.id, handleType);
    await this.executeNode(nextNode);
  }

  // Executa nó de condição
  async executeCondition(node, userMessage = null) {
    // Pega a última mensagem do cliente (pode vir do wait anterior)
    const mensagem = userMessage || this.variaveis.ultimaMensagem || '';
    
    const pergunta = this.substituirVariaveis(node.data.pergunta || '');
    
    // Usa IA para avaliar condição
    const prompt = `Analise a mensagem do usuário e responda APENAS "SIM" ou "NAO".

Pergunta a avaliar: ${pergunta}

Mensagem do usuário: "${mensagem}"

Responda apenas SIM ou NAO (sem pontuação ou explicação):`;

    try {
      console.log(`🔀 Avaliando condição: "${pergunta.substring(0, 50)}..."`);
      const resposta = await provedorService.enviarParaIA([
        { role: 'user', content: prompt }
      ]);
      
      const resultado = resposta.toLowerCase().trim().startsWith('sim');
      console.log(`🔀 Resultado: ${resultado ? 'SIM ✅' : 'NÃO ❌'}`);
      await this.logExec('condition_result', `Condição IA: ${resultado ? 'SIM' : 'NÃO'}`, node, { pergunta, mensagem });
      
      // Salva resultado
      this.variaveis[`${node.id}_resultado`] = resultado;
      this.variaveis.ultimaCondicao = resultado;
      
      // Segue para o caminho correto
      const handleType = resultado ? 'output-true' : 'output-false';
      const nextNode = this.findNextNode(node.id, handleType);
      this.aguardandoResposta = false;
      await this.executeNode(nextNode);
    } catch (error) {
      console.error('Erro ao avaliar condição:', error);
      await this.logExec('node_error', `Erro ao avaliar condição: ${error.message}`, node);
      const nextNode = this.findNextNode(node.id, 'output-false');
      await this.executeNode(nextNode);
    }
  }

  // Executa nó de IA
  async executeIA(node, userMessage = null) {
    // Pega a última mensagem do cliente
    const mensagem = userMessage || this.variaveis.ultimaMensagem || '';
    
    try {
      // Monta a instrução (pode usar variáveis)
      let instrucao = this.substituirVariaveis(node.data.instrucao || '');
      
      // Se tem um prompt do banco
      if (node.data.promptId) {
        const promptObj = await promptService.getPromptPorNome(node.data.promptId);
        if (promptObj) {
          instrucao = this.substituirVariaveis(promptObj.conteudo);
        }
      }
      
      const mensagens = [];
      if (instrucao) {
        mensagens.push({ role: 'system', content: instrucao });
      }
      if (mensagem) {
        mensagens.push({ role: 'user', content: mensagem });
      }
      
      console.log(`🤖 Executando IA: "${instrucao.substring(0, 50)}..."`);
      const resposta = await provedorService.enviarParaIA(mensagens, node.data.provedorId);
      
      // Salva resposta na variável configurada
      const varName = node.data.variavelSaida || 'respostaIA';
      this.variaveis[varName] = resposta.trim();
      this.variaveis.ultimaRespostaIA = resposta.trim();
      
      console.log(`📝 IA respondeu, salvo em {{${varName}}}: "${resposta.trim().substring(0, 50)}..."`);
      await this.logExec('ia_result', `IA respondeu e salvou em {{${varName}}}`, node, { variavelSaida: varName });
      
      this.aguardandoResposta = false;
      const nextNode = this.findNextNode(node.id);
      await this.executeNode(nextNode);
    } catch (error) {
      console.error('Erro ao executar IA:', error);
      await this.logExec('node_error', `Erro ao executar IA: ${error.message}`, node);
      this.aguardandoResposta = false;
      const nextNode = this.findNextNode(node.id);
      await this.executeNode(nextNode);
    }
  }

  // Executa nó de ação
  async executeAction(node) {
    try {
      switch (node.data.tipo) {
        case 'requisicao':
          if (node.data.requisicaoTipo) {
            console.log(`⚙️ Executando requisição: ${node.data.requisicaoTipo}`);
            
            // Caso especial apenas para gruposdewhats: usa banco (grupos sincronizados do WhatsApp)
            const tipoReq = String(node.data.requisicaoTipo).trim().toLowerCase();
            if (tipoReq === 'gruposdewhats') {
              const grupoWhatsappService = require('./grupoWhatsappService');
              const bairro = (this.variaveis.bairro || this.variaveis.respostaIA || '').trim();
              console.log(`🔍 Buscando grupo (DB) para bairro: "${bairro}"`);
              const grupo = await grupoWhatsappService.getGrupoPorBairro(bairro);
              if (grupo && grupo.link) {
                this.variaveis.linkGrupo = grupo.link;
                this.variaveis.nomeGrupo = grupo.nome || grupo.bairro || 'Grupo';
                console.log(`✅ Grupo encontrado: ${this.variaveis.nomeGrupo}`);
              } else {
                const grupoGeral = await grupoWhatsappService.getGrupoPorBairro('geral');
                this.variaveis.linkGrupo = grupoGeral?.link || 'https://chat.whatsapp.com/LINK_NAO_ENCONTRADO';
                this.variaveis.nomeGrupo = grupoGeral?.nome || 'Grupo Geral';
                console.log(`⚠️ Usando grupo geral`);
              }
            } else {
              // Requisições configuradas na dash (JSON + IA, API, etc.): ex. BuscarGruporPorBairro → arquivo grupos_whatsapp
              const resposta = await requisicaoService.executarRequisicao(
                node.data.requisicaoTipo,
                this.variaveis.ultimaMensagem || '',
                this.variaveis
              );
              console.log('🔀 [Fluxo] Resposta da requisição:', JSON.stringify({ erro: resposta.erro, temResultado: resposta.resultado !== undefined, tipoResultado: typeof resposta.resultado }));
              if (resposta.erro) {
                console.error(`❌ Requisição ${node.data.requisicaoTipo}:`, resposta.erro);
                this.variaveis[`${node.id}_erro`] = resposta.erro;
              } else if (resposta.resultado !== undefined) {
                this.variaveis[`${node.id}_resultado`] = resposta.resultado;
                const res = resposta.resultado;
                if (typeof res === 'object' && res !== null) {
                  Object.assign(this.variaveis, res);
                  if (res.link && !this.variaveis.linkGrupo) this.variaveis.linkGrupo = res.link;
                  if (res.linkGrupo) this.variaveis.linkGrupo = res.linkGrupo;
                  if (res.nome && !this.variaveis.nomeGrupo) this.variaveis.nomeGrupo = res.nome;
                  console.log('🔀 [Fluxo] Variáveis após ação (linkGrupo, bairro):', this.variaveis.linkGrupo, this.variaveis.bairro);
                } else if (typeof res === 'string' && res.includes('chat.whatsapp.com')) {
                  const urlMatch = res.match(/https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/);
                  if (urlMatch) {
                    this.variaveis.linkGrupo = urlMatch[0];
                    console.log('🔀 [Fluxo] linkGrupo definido a partir do texto:', urlMatch[0]);
                  }
                }
              }
            }
          }
          break;
          
        case 'salvar_variavel':
          if (node.data.nomeVariavel) {
            const valor = this.substituirVariaveis(node.data.valorVariavel || '');
            this.variaveis[node.data.nomeVariavel] = valor;
            console.log(`📝 Variável salva: {{${node.data.nomeVariavel}}} = "${valor}"`);
          }
          break;

        case 'marcar_meta': {
          const metaNome = (node.data.metaNome || '').trim();
          if (metaNome) {
            const res = await metaService.marcarConcluido(this.getIdWhatsappParaDb(), metaNome);
            this.variaveis['meta_' + metaNome] = 'concluido';
            if (res.ok) console.log(`✅ Meta "${metaNome}" marcada como concluída para ${this.chatId}`);
            else console.warn(`⚠️ Marcar meta "${metaNome}":`, res.erro);
          }
          break;
        }

        case 'verificar_meta': {
          const metaNome = (node.data.metaNome || '').trim();
          const variavelSaida = (node.data.variavelSaidaMeta || 'meta_' + metaNome).trim();
          if (metaNome) {
            const concluido = await metaService.verificarConcluido(this.getIdWhatsappParaDb(), metaNome);
            this.variaveis[variavelSaida] = concluido ? 'concluido' : 'pendente';
            console.log(`🔍 Meta "${metaNome}" para ${this.chatId}: ${concluido ? 'concluído' : 'pendente'} → {{${variavelSaida}}}`);
          }
          break;
        }

        case 'ler_contato': {
          const campo = (node.data.campoContato || 'cam_grupo').trim().toLowerCase();
          const variavelSaida = (node.data.variavelSaidaContato || campo).trim() || 'cam_grupo';
          if (!CAMPOS_CONTATO_PERMITIDOS.includes(campo)) {
            console.warn(`⚠️ Ler contato: campo "${campo}" não permitido. Use: ${CAMPOS_CONTATO_PERMITIDOS.join(', ')}`);
            break;
          }
          const wid = this.getIdWhatsappParaDb();
          const lid = this.resolvedIdentity && this.resolvedIdentity.whatsappLid
            ? String(this.resolvedIdentity.whatsappLid).trim()
            : null;
          if (!wid && !lid) {
            this.variaveis[variavelSaida] = '';
            console.log(`📋 Ler contato {{${variavelSaida}}}: chatId inválido`);
            break;
          }
          try {
            const conn = await mysql.createConnection({
              host: dbConfig.host,
              port: dbConfig.port || 3306,
              user: dbConfig.username,
              password: dbConfig.password,
              database: dbConfig.database
            });
            let rows = [];
            if (wid && wid.length >= 10) {
              const [rows1] = await conn.execute(
                `SELECT \`${campo}\` FROM contatos WHERE whatsapp_id = ? LIMIT 1`,
                [wid]
              );
              rows = rows1;
            }
            if (rows.length === 0 && lid) {
              const [rowsL] = await conn.execute(
                `SELECT \`${campo}\` FROM contatos WHERE whatsapp_lid = ? LIMIT 1`,
                [lid]
              );
              rows = rowsL;
            }
            if (rows.length === 0 && wid && wid.length >= 10) {
              try {
                await conn.execute(
                  `INSERT INTO contatos (whatsapp_id, whatsapp_lid) VALUES (?, ?)
                   ON DUPLICATE KEY UPDATE whatsapp_lid = COALESCE(VALUES(whatsapp_lid), whatsapp_lid), updated_at = NOW()`,
                  [wid, lid]
                );
                const [rowsNovo] = await conn.execute(
                  `SELECT \`${campo}\` FROM contatos WHERE whatsapp_id = ? LIMIT 1`,
                  [wid]
                );
                rows = rowsNovo;
              } catch (ins) {
                if (ins.code !== 'ER_NO_SUCH_TABLE') console.warn('⚠️ Ler contato (criar linha):', ins.message);
              }
            }
            await conn.end();
            const valor = rows.length > 0 ? (rows[0][campo] != null ? String(rows[0][campo]) : '') : '';
            this.variaveis[variavelSaida] = valor;
            if (valor === '') {
              console.log(`📋 Ler contato {{${variavelSaida}}} = ${campo} → (vazio: nenhum registro em contatos para esse número)`);
            } else {
              console.log(`📋 Ler contato {{${variavelSaida}}} = ${campo} → "${valor}"`);
            }
          } catch (e) {
            if (e.code === 'ER_NO_SUCH_TABLE') {
              this.variaveis[variavelSaida] = '';
              console.warn('⚠️ Ler contato: tabela contatos não existe');
            } else {
              this.variaveis[variavelSaida] = '';
              console.warn('⚠️ Ler contato:', e.message);
            }
          }
          break;
        }
          
        case 'webhook':
          if (node.data.webhookUrl) {
            const url = this.substituirVariaveis(node.data.webhookUrl);
            console.log(`🌐 Enviando webhook para: ${url}`);
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.variaveis)
            });
          }
          break;

        case 'enviar_cupom': {
          const nomeArquivo = (node.data.arquivoCupons || 'cupons_desconto').trim();
          const promptCupom = (node.data.promptCupom || '').trim();
          this.variaveis.dataatual = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          this.variaveis.dataHoraAtual = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

          const conteudo = arquivoService.getConteudo(nomeArquivo);
          const listaCupons = Array.isArray(conteudo) ? conteudo : (conteudo && typeof conteudo === 'object' ? [conteudo] : []);
          const textosValidos = listaCupons.map(c => (c && (c.texto || c.mensagem)) ? (c.texto || c.mensagem) : null).filter(Boolean);

          let mensagemCupom = '';
          if (promptCupom && textosValidos.length > 0) {
            const instrucao = this.substituirVariaveis(promptCupom);
            const regra = `REGRAS OBRIGATÓRIAS: Sua resposta deve ser EXATAMENTE uma das mensagens do campo "texto" da lista abaixo, copiada inteira sem alterar NADA. É PROIBIDO inventar códigos, criar textos ou modificar o conteúdo. Se nenhum cupom da lista atender ao critério pedido, responda apenas: NAO_ENCONTRADO`;
            const conteudoParaIA = JSON.stringify(listaCupons, null, 2);
            const mensagens = [
              { role: 'system', content: `${instrucao}\n\n${regra}` },
              { role: 'user', content: 'Lista de cupons (use apenas um dos campos "texto" exatamente como está):\n' + conteudoParaIA }
            ];
            try {
              console.log(`🎟️ Buscando cupom com IA (prompt do nó): "${instrucao.substring(0, 50)}..."`);
              const respostaIA = (await provedorService.enviarParaIA(mensagens, node.data.provedorCupom)).trim();
              if (respostaIA.toUpperCase() === 'NAO_ENCONTRADO') {
                mensagemCupom = selecionarCupomPorCriterio(listaCupons, instrucao);
              } else if (textosValidos.some(t => t === respostaIA || t.trim() === respostaIA.trim())) {
                mensagemCupom = respostaIA;
              } else {
                mensagemCupom = selecionarCupomPorCriterio(listaCupons, instrucao);
                if (!mensagemCupom) mensagemCupom = textosValidos[0];
                console.warn('⚠️ IA retornou texto que não está no arquivo; usado cupom do arquivo.');
              }
            } catch (err) {
              console.error('❌ Erro IA ao processar cupom:', err.message);
              mensagemCupom = selecionarCupomPorCriterio(listaCupons, promptCupom) || textosValidos[0];
            }
          }
          if (!mensagemCupom) {
            if (textosValidos.length > 0) mensagemCupom = textosValidos[0];
            else if (listaCupons.length > 0 && listaCupons[0]) {
              const c = listaCupons[0];
              mensagemCupom = c.texto || c.mensagem || (c.codigo ? `Cupom: ${c.codigo}` : '');
            }
          }
          if (mensagemCupom) {
            mensagemCupom = this.substituirVariaveis(mensagemCupom);
            await this.client.sendMessage(this.chatId, mensagemCupom);
            console.log(`🎟️ Cupom enviado para ${this.chatId} (arquivo: ${nomeArquivo})`);
          } else {
            console.warn(`⚠️ Nenhum cupom em "${nomeArquivo}"`);
          }
          this.fluxoCompletouCampanha = true;
          break;
        }

        // Cupom único por cliente na Multipedidos (docs/18-cupons-multipedidos.md). Não envia mensagem:
        // preenche {{cupomCodigo}}, {{cupomDesconto}}, {{cupomValidade}}, {{cupomPedidoMinimo}},
        // {{cupomStatus}} e {{cupomErro}} para os próximos nós usarem.
        case 'multipedidos_criar_cupom':
        case 'multipedidos_alterar_cupom': {
          await this.executarCupomMultipedidos(node, node.data.tipo === 'multipedidos_alterar_cupom' ? 'alterar' : 'criar');
          this.fluxoCompletouCampanha = true;
          break;
        }

        // Abordagem ativa (docs/20 B0): o contato pediu para não receber mais mensagens iniciadas pelo bot.
        case 'opt_out': {
          const ok = await abordagemService.marcarOptOut(this.getIdWhatsappParaDb(), true);
          this.variaveis.optOut = ok ? 'sim' : 'erro';
          console.log(`🔕 Opt-out ${ok ? 'registrado' : 'NÃO registrado'} para ${this.chatId}`);
          await this.logExec('opt_out', ok ? 'Contato pediu para não receber mais mensagens' : 'Falha ao registrar opt-out', node);
          break;
        }

        // Lista os fluxos com bloco "oferta" que o contato pode entrar, pelo histórico dele (docs/20 §C.2).
        // Saída: {{ofertas}} (texto numerado), {{ofertasQtd}}, {{ofertaId_1..n}}, {{ofertaNome_1..n}}
        case 'listar_ofertas': {
          // Janela do pós-venda (docs/20 §C.1): fora dela não se oferece nada.
          if (!posVendaService.dentroDaJanela(this.variaveis.posVendaAte)) {
            this.variaveis.ofertasQtd = '0';
            this.variaveis.ofertas = '';
            this.variaveis.janelaExpirada = 'sim';
            console.log(`⏰ Pós-venda fora da janela de 24 h para ${this.chatId} — nenhuma oferta listada`);
            await this.logExec('ofertas_janela_expirada', 'Fora da janela de 24 h do pedido', node);
            break;
          }
          const ofertas = await this.listarOfertasElegiveis();
          this.variaveis.ofertasQtd = String(ofertas.length);
          this.variaveis.ofertas = ofertas.map((o, i) => `${i + 1} - ${o.titulo}${o.descricao ? ' — ' + o.descricao : ''}`).join('\n');
          ofertas.forEach((o, i) => { this.variaveis[`ofertaId_${i + 1}`] = String(o.fluxoId); this.variaveis[`ofertaNome_${i + 1}`] = o.titulo; });
          console.log(`🎯 ${ofertas.length} oferta(s) elegível(is) para ${this.chatId}`);
          await this.logExec('ofertas_listadas', `${ofertas.length} oferta(s) elegível(is)`, node, { ofertas: ofertas.map((o) => o.fluxoId) });
          break;
        }

        // Encadeia outro fluxo: encerra este e inicia o alvo (por id fixo ou por variável, ex.: {{ofertaId_2}}).
        case 'iniciar_fluxo': {
          if (!posVendaService.dentroDaJanela(this.variaveis.posVendaAte)) {
            this.variaveis.iniciarFluxoStatus = 'janela_expirada';
            this.variaveis.janelaExpirada = 'sim';
            console.log(`⏰ Escolha fora da janela de 24 h para ${this.chatId} — não encadeia`);
            await this.logExec('iniciar_fluxo_janela', 'Escolha fora da janela de 24 h do pedido', node);
            break;
          }
          const alvoRaw = this.substituirVariaveis(String(node.data.fluxoAlvo || '')).trim();
          const alvoId = parseInt(alvoRaw, 10);
          const alvo = Number.isInteger(alvoId) ? await fluxoService.getFluxoPorId(alvoId) : null;
          if (!alvo || !alvo.ativo) {
            this.variaveis.iniciarFluxoStatus = 'erro';
            console.warn(`⚠️ iniciar_fluxo: fluxo "${alvoRaw}" não existe ou está inativo`);
            await this.logExec('iniciar_fluxo_erro', `Fluxo alvo "${alvoRaw}" inexistente/inativo`, node);
            break;
          }
          await this.logExec('fluxo_end', `Encadeado para "${alvo.nome}"`, node);
          removerSessaoFluxoPorExecutor(this);
          const herdadas = Object.fromEntries(Object.entries(this.variaveis).filter(([k]) => !/^(oferta|ofertas)/.test(k)));
          await iniciarFluxo(this.client, this.chatId, alvo, { ...herdadas, fluxoAnterior: this.fluxo.nome });
          return; // o fluxo atual termina aqui; não segue para o próximo nó
        }
      }
    } catch (error) {
      console.error('Erro ao executar ação:', error);
      await this.logExec('node_error', `Erro ao executar ação: ${error.message}`, node);
    }
    
    const nextNode = this.findNextNode(node.id);
    await this.executeNode(nextNode);
  }

  /** Fluxos ativos com bloco gatilho.oferta.ativa, filtrados pela situação do contato (docs/20 §C.2). */
  async listarOfertasElegiveis() {
    const fluxos = await fluxoService.listarFluxos({ ativo: true });
    const historico = await participacaoService.historicoDoContato(this.getIdWhatsappParaDb(), { fluxoIdEmAberto: this.fluxo.id });
    return fluxos
      .filter((f) => f.tipo !== 'automacao' && f.id !== this.fluxo.id && f.gatilho && f.gatilho.oferta && f.gatilho.oferta.ativa)
      .map((f) => ({ fluxoId: f.id, titulo: f.gatilho.oferta.titulo || f.nome, descricao: f.gatilho.oferta.descricao || '',
        prioridade: Number(f.gatilho.oferta.prioridade || 99), situacao: participacaoService.situacaoDe(historico, f.id), regra: f.gatilho.oferta.elegivel_se }))
      .filter((o) => participacaoService.elegivel(o.situacao, o.regra))
      .sort((a, b) => a.prioridade - b.prioridade);
  }

  // Nós "Multipedidos: criar cupom único" / "Multipedidos: alterar cupom".
  // Nunca lança: em qualquer falha o fluxo segue com {{cupomStatus}} = erro, para um condition_var desviar
  // (ex.: para o enviar_cupom de arquivo).
  async executarCupomMultipedidos(node, modo) {
    const limpar = () => {
      for (const v of ['cupomCodigo', 'cupomDesconto', 'cupomValidade', 'cupomPedidoMinimo', 'cupomErro']) this.variaveis[v] = '';
    };
    this.variaveis.dataatual = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    this.variaveis.dataHoraAtual = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    try {
      const promptTemplate = (node.data.promptCupom || '').trim();
      if (!promptTemplate) throw new Error('Nó sem comando do cupom');

      const interpretacao = await multipedidosCupomService.interpretarComando({
        promptTemplate,
        promptFinal: this.substituirVariaveis(promptTemplate),
        modo,
        provedor: node.data.provedorCupom || null
      });

      const contexto = {
        whatsappId: this.getIdWhatsappParaDb(),
        campanha: (node.data.campanha || '').trim() || this.fluxo.nome || `fluxo-${this.fluxo.id}`,
        fluxoId: this.fluxo.id || null,
        params: interpretacao.params,
        prefixo: (node.data.prefixoCodigo || '').trim() || null,
        metaAoResgatar: (node.data.metaAoResgatar || '').trim() || null
      };
      const r = modo === 'alterar'
        ? await multipedidosCupomService.alterar({ ...contexto, seJaUsado: node.data.seJaUsado || 'criar_novo', seNaoExiste: node.data.seNaoExiste || 'criar_novo' })
        : await multipedidosCupomService.emitir(contexto);

      this.variaveis.cupomCodigo = r.codigo;
      this.variaveis.cupomDesconto = r.desconto;
      this.variaveis.cupomValidade = r.validade;
      this.variaveis.cupomPedidoMinimo = r.pedidoMinimo;
      this.variaveis.cupomStatus = r.status;
      this.variaveis.cupomErro = '';

      const cortes = [...(interpretacao.cortes || []), ...(r.cortes || [])];
      console.log(`🎟️ Cupom Multipedidos (${modo}) para ${this.chatId}: ${r.status} ${r.codigo} ${r.desconto} até ${r.validade}${cortes.length ? ' | cortes: ' + cortes.join('; ') : ''}`);
      await this.logExec(`cupom_${r.status}`, `Cupom ${r.codigo}: ${r.desconto}, válido até ${r.validade}`, node, {
        modo, interpretado: interpretacao.descricao, origem: interpretacao.origem, cortes, campanha: contexto.campanha
      });
    } catch (error) {
      limpar();
      this.variaveis.cupomStatus = 'erro';
      this.variaveis.cupomErro = error.message;
      console.error(`❌ Cupom Multipedidos (${modo}) para ${this.chatId}:`, error.message);
      await this.logExec('cupom_erro', `Falha no cupom Multipedidos (${modo}): ${error.message}`, node);
    }
  }

  // Executa nó de fim
  async executeEnd(node) {
    if (node.data.mensagemFinal) {
      const texto = this.substituirVariaveis(node.data.mensagemFinal);
      await this.client.sendMessage(this.chatId, texto);
    }

    const ehFluxoCampanha = this.fluxo.tipo === 'campanha' ||
      (this.fluxo.nome && String(this.fluxo.nome).toLowerCase().includes('campanha'));

    // O handoff entrega o contato à campanha legada na Missão 2 ("mande 10 contatos"). Isso só faz
    // sentido para quem ENTROU na campanha mandando a frase de gatilho. Fluxo que o BOT inicia
    // (pós-venda, indicado) não pode cair aqui: todos os modelos são tipo "campanha", e o
    // pós-venda ainda por cima tem "campanhas" no nome. Sem esta guarda, um cliente que só fez um
    // pedido recebia "MISSÃO 1 CONCLUÍDA" do nada e ficava preso esperando indicações — foi o que
    // aconteceu em 22/09/2026, quando o pós-venda encerrava em silêncio por não ter oferta.
    const iniciadoPeloSistema = !!this.variaveis.eventoOrigem
      || !!(this.fluxo.gatilho && this.fluxo.gatilho.tipo === 'evento');

    // O fluxo conduz a campanha inteira? Se ele TEM um nó de cupom em qualquer ramo, as Missões 2
    // e 3 estão dentro dele e o bot legado não tem o que assumir.
    //
    // Olhar só `fluxoCompletouCampanha` (se passou pelo cupom NESTA execução) não bastava: no ramo
    // de falha — "não consegui confirmar sua entrada no grupo" — o cliente chegava ao fim sem
    // cupom e recebia "MISSÃO 1 CONCLUÍDA, você liberou +10%" logo em seguida, contradizendo a
    // mensagem anterior e mandando-o juntar indicações que ele não tinha conquistado.
    const fluxoConduzCampanhaInteira = (this.nodes || []).some((n) =>
      n && n.type === 'action' && ACOES_QUE_ENVIAM_CUPOM.has((n.data || {}).tipo));

    // Fluxo de demonstração (nó de contatos em modo simulação): não tem cupom real, mas também não
    // pode cair no bot legado — ele mandaria "MISSÃO 1 CONCLUÍDA" e passaria a esperar indicações
    // de verdade de quem só estava vendo a demo.
    const fluxoEhSimulacao = (this.nodes || []).some((n) =>
      n && n.type === 'wait_contacts' && (n.data || {}).simulacao);

    const deveFazerHandoff = ehFluxoCampanha
      && typeof onCampanhaFlowEnd === 'function'
      && !this.fluxoCompletouCampanha
      && !iniciadoPeloSistema
      && !fluxoConduzCampanhaInteira
      && !fluxoEhSimulacao;

    if (deveFazerHandoff) {
      try {
        await onCampanhaFlowEnd(this.client, this.chatId, this.fluxo);
      } catch (err) {
        console.error('❌ Erro no handoff campanha (após fim do fluxo):', err.message);
      }
    } else if (ehFluxoCampanha && iniciadoPeloSistema && !this.fluxoCompletouCampanha) {
      await this.logExec('handoff_ignorado',
        'Fluxo iniciado pelo sistema: não entrega à campanha legada', node);
    }
    
    console.log(`✅ Fluxo "${this.fluxo.nome}" finalizado para ${this.chatId}`);
    await this.logExec('fluxo_end', `Fluxo "${this.fluxo.nome}" finalizado`, node);
    removerSessaoFluxoPorExecutor(this);
  }

  // Processa contatos (vCard) quando o nó atual é wait_contacts
  async processarContatos(msg) {
    if (!this.aguardandoContatos) return false;
    const currentNode = this.getNode(this.currentNodeId);
    if (!currentNode || currentNode.type !== 'wait_contacts') return false;

    const vCards = msg.vCards && msg.vCards.length ? msg.vCards : (msg.body ? [msg.body] : []);
    if (vCards.length === 0) return false;

    const indicados = indicacaoService.parseVcards(vCards);
    if (indicados.length === 0) {
      if (msg.reply) await msg.reply('Nenhum número válido nesses contatos. Envie usando *Compartilhar contato*.');
      return true;
    }

    try {
      let qtInseridos, qtTotal, completouMissao;
      if (currentNode.data.simulacao) {
        if (!this.contatosSimulados) this.contatosSimulados = new Set();
        const antes = this.contatosSimulados.size;
        for (const i of indicados) this.contatosSimulados.add(i.numero);
        qtTotal = this.contatosSimulados.size;
        qtInseridos = qtTotal - antes;
        completouMissao = qtTotal >= this.waitContactsMeta;
        this.variaveis.nomesIndicados = indicados.map((i) => i.nome).filter(Boolean).join(', ');
        console.log(`🎭 [Simulação] ${qtTotal}/${this.waitContactsMeta} contatos (nada gravado) para ${this.chatId}`);
      } else {
        ({ qtInseridos, qtTotal, completouMissao } = await indicacaoService.registrarIndicacoes(
          this.chatId,
          indicados,
          this.getIdWhatsappParaDb()
        ));
      }
      this.variaveis.qtIndicados = qtTotal;
      this.variaveis.metaIndicados = this.waitContactsMeta;

      const node = currentNode;
      const mensagemProgresso = (node.data.mensagemProgresso || '').trim();

      if (completouMissao) {
        await this.logExec('wait_contacts_complete', `Meta de contatos concluída (${qtTotal}/${this.waitContactsMeta})`, node, {
          qtInseridos, qtTotal
        });
        this.aguardandoContatos = false;
        if (mensagemProgresso) {
          const texto = this.substituirVariaveis(mensagemProgresso);
          await this.client.sendMessage(this.chatId, texto);
        }
        const nextNode = this.findNextNode(node.id);
        await this.executeNode(nextNode);
      } else {
        await this.logExec('wait_contacts_progress', `Progresso contatos (${qtTotal}/${this.waitContactsMeta})`, node, {
          qtInseridos, qtTotal
        });
        if (qtInseridos > 0 && mensagemProgresso) {
          const texto = this.substituirVariaveis(mensagemProgresso);
          await this.client.sendMessage(this.chatId, texto);
        } else if (qtInseridos > 0 && msg.reply) {
          await msg.reply(`✅ ${qtInseridos} contato(s) recebido(s)! Total: *${qtTotal}/${this.waitContactsMeta}* indicações.`);
        } else if (qtInseridos === 0 && msg.reply) {
          await msg.reply(`Esses contatos já foram contados. Total: *${qtTotal}/${this.waitContactsMeta}*.`);
        }
      }
      return true;
    } catch (err) {
      console.error('❌ Erro ao processar indicações no fluxo:', err);
      await this.logExec('node_error', `Erro ao processar contatos: ${err.message}`, currentNode);
      if (msg.reply) await msg.reply('Ocorreu um erro ao salvar os contatos. Tente de novo.');
      return true;
    }
  }

  // Processa mensagem do usuário
  async processMessage(message) {
    this.variaveis.ultimaMensagem = message;
    
    if (!this.aguardandoResposta) return false;
    
    const currentNode = this.getNode(this.currentNodeId);
    if (!currentNode) return false;
    
    switch (currentNode.type) {
      case 'wait':
        // Salva resposta na variável configurada
        const varName = this.waitVariableName || 'resposta';
        this.variaveis[varName] = message;
        console.log(`📝 Resposta salva em {{${varName}}}: "${message}"`);
        await this.logExec('wait_response', `Resposta recebida e salva em {{${varName}}}`, currentNode, {
          variavel: varName,
          mensagem: String(message).slice(0, 500)
        });
        
        this.aguardandoResposta = false;
        const nextNode = this.findNextNode(currentNode.id);
        await this.executeNode(nextNode);
        return true;
        
      case 'condition':
        await this.executeCondition(currentNode, message);
        return true;
        
      case 'ia':
        await this.executeIA(currentNode, message);
        return true;
        
      default:
        return false;
    }
  }

  /**
   * A pessoa entrou num grupo de demonstração. Só tem efeito se o fluxo está parado num nó
   * "Aguardar" com `avancarAoEntrarNoGrupo`: grava {{entradaGrupoDetectada}} = "sim" e segue como
   * se ela tivesse respondido — o fluxo decide o que dizer (ex.: "percebi que você entrou").
   */
  async sinalizarEntradaGrupo(grupoId) {
    const node = this.getNode(this.currentNodeId);
    if (!this.aguardandoResposta || !node || node.type !== 'wait' || !node.data.avancarAoEntrarNoGrupo) {
      return false;
    }
    this.variaveis.entradaGrupoDetectada = 'sim';
    this.variaveis.grupoEntradaId = grupoId;
    await this.logExec('grupo_entrada_detectada', `Entrada no grupo ${grupoId} detectada`, node, { grupoId });
    return this.processMessage('(entrou no grupo — detectado automaticamente)');
  }

  // Substitui variáveis no texto
  substituirVariaveis(texto) {
    return texto.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return this.variaveis[key] !== undefined ? this.variaveis[key] : match;
    });
  }
}

// Funções exportadas
/**
 * @param {Object} [variaveisIniciais] - entram em executor.variaveis antes do 1º nó (ex.: canalSlug/canalNome
 *   quando o fluxo é iniciado por um canal de aquisição — docs/20 A0).
 */
async function iniciarFluxo(client, chatId, fluxo, variaveisIniciais = null) {
  const executor = new FluxoExecutor(client, chatId, fluxo);
  if (variaveisIniciais && typeof variaveisIniciais === 'object') Object.assign(executor.variaveis, variaveisIniciais);
  executor.resolvedIdentity = await alinharIdentidadeComBanco(
    await whatsappIdentityService.resolverIdentidadeCliente(client, chatId)
  );
  registrarSessaoFluxo(executor);
  await executor.start();
  return executor;
}

async function processarMensagemFluxo(chatId, message) {
  const executor = sessoesFluxo.get(chatId);
  if (!executor) return false;

  // Se o fluxo foi desativado, encerra a sessão e não processa
  const fluxoAtual = await fluxoService.getFluxoPorId(executor.fluxo.id);
  if (!fluxoAtual || !fluxoAtual.ativo) {
    removerSessaoFluxoPorExecutor(executor);
    return false;
  }

  return await executor.processMessage(message);
}

async function processarContatosFluxo(chatId, msg) {
  const executor = sessoesFluxo.get(chatId);
  if (!executor) return false;
  const fluxoAtual = await fluxoService.getFluxoPorId(executor.fluxo.id);
  if (!fluxoAtual || !fluxoAtual.ativo) {
    removerSessaoFluxoPorExecutor(executor);
    return false;
  }
  return await executor.processarContatos(msg);
}

function estaAguardandoContatos(chatId) {
  const executor = sessoesFluxo.get(chatId);
  return executor ? executor.aguardandoContatos === true : false;
}

function temFluxoAtivo(chatId) {
  return sessoesFluxo.has(chatId);
}

function encerrarFluxo(chatId) {
  const ex = sessoesFluxo.get(chatId);
  if (ex) removerSessaoFluxoPorExecutor(ex);
}

function encerrarSessoesPorFluxoId(fluxoId) {
  const alvo = Number(fluxoId);
  let total = 0;
  const ja = new Set();
  for (const executor of sessoesFluxo.values()) {
    if (Number(executor?.fluxo?.id) !== alvo) continue;
    if (ja.has(executor)) continue;
    ja.add(executor);
    removerSessaoFluxoPorExecutor(executor);
    total++;
  }
  return total;
}

/**
 * Entrada de `membroId` no grupo `grupoId` (só para grupos de demonstração — ver group_join no
 * BotIApizzaria). Acha a sessão pelo id recebido, pelas variantes do telefone (9º dígito) ou, se
 * vier @lid, pelo telefone que o WhatsApp devolver para ele.
 */
async function sinalizarEntradaGrupo(client, membroId, grupoId) {
  const candidatos = new Set([String(membroId || '').trim()]);
  let base = String(membroId || '');
  if (base.endsWith('@lid') && client) {
    try {
      const contato = await client.getContactById(base);
      if (contato?.number) base = `${contato.number}@c.us`;
    } catch (_) { /* segue só com o @lid */ }
  }
  if (base.endsWith('@c.us')) {
    candidatos.add(base);
    for (const d of telefone.variantes(base)) candidatos.add(`${d}@c.us`);
  }
  for (const k of candidatos) {
    const executor = k && sessoesFluxo.get(k);
    if (executor) return executor.sinalizarEntradaGrupo(grupoId);
  }
  return false;
}

function getSessaoFluxo(chatId) {
  return sessoesFluxo.get(chatId);
}

/** Retorna lista de chatIds que estão com sessão de fluxo ativa (para exibir "em fluxo" na dashboard). */
function getChatIdsEmFluxo() {
  const ids = [];
  const visto = new Set();
  for (const ex of sessoesFluxo.values()) {
    if (!ex || visto.has(ex)) continue;
    visto.add(ex);
    // _sessionKeys já traz todos os identificadores sob os quais a sessão responde
    // (id original, canônico, @lid e as formas com/sem 9º dígito).
    for (const k of (ex._sessionKeys && ex._sessionKeys.length ? ex._sessionKeys : [ex.chatId])) {
      if (k && !ids.includes(k)) ids.push(k);
    }
  }
  return ids;
}

module.exports = {
  FluxoExecutor,
  iniciarFluxo,
  processarMensagemFluxo,
  processarContatosFluxo,
  estaAguardandoContatos,
  sinalizarEntradaGrupo,
  temFluxoAtivo,
  encerrarFluxo,
  encerrarSessoesPorFluxoId,
  getSessaoFluxo,
  getChatIdsEmFluxo,
  setOnCampanhaFlowEnd
};
