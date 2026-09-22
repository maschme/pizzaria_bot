'use strict';

/**
 * Abordagem ativa: início de fluxo por EVENTO do sistema (docs/20-modelos-e-fluxos-completos.md, B0).
 *
 * Quem tem um evento (indicação registrada, pedido concluído…) chama `enfileirar()`. Um scheduler
 * (`iniciarScheduler(client)`, chamado no boot) processa a fila a cada minuto e inicia o fluxo quando:
 *   - está dentro do horário comercial (configs horario_funcionamento_inicio/fim); fora dele, espera;
 *   - o contato não fez opt-out;
 *   - o contato não está em outro fluxo (aí espera até o item expirar);
 *   - o fluxo apontado existe e está ativo;
 *   - o item ainda não expirou (expira_em).
 * Fila em banco (abordagens_fila): sobrevive a restart e deduplica por (evento, referencia).
 *
 * Opt-out: `marcarOptOut()` é chamado pelo nó de ação `opt_out` (ou por qualquer fluxo) e vale para
 * TODA abordagem iniciada pelo sistema; mensagem que o cliente inicia continua sendo atendida.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('./telefoneService');
const contatoIdService = require('./contatoIdService');
const configService = require('./configuracaoService');
const fluxoService = require('./fluxoService');
const canalService = require('./canalService');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

const INTERVALO_MS = 60 * 1000;
const MAX_TENTATIVAS = 30; // ~30 min esperando "em fluxo"/erro transitório, além do horário
let timer = null;
let clientWhats = null;
let processando = false;

function apenasDigitos(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

function formatarDataHora(d) {
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}:${doisDigitos(d.getSeconds())}`;
}

async function comConexao(fn) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

// ============================================================
// Horário comercial
// ============================================================

function minutosDe(hhmm, padrao) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return padrao;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Dentro do horário de funcionamento? Usa as configs já existentes (categoria `horario`).
 * Faixa que cruza a meia-noite (ex.: 18:00–01:00) é tratada.
 */
async function dentroDoHorario(agora = new Date()) {
  const ini = minutosDe(await configService.getConfiguracao('horario_funcionamento_inicio'), 0);
  const fim = minutosDe(await configService.getConfiguracao('horario_funcionamento_fim'), 24 * 60);
  const atual = agora.getHours() * 60 + agora.getMinutes();
  if (ini === fim) return true;
  return ini < fim ? (atual >= ini && atual < fim) : (atual >= ini || atual < fim);
}

// ============================================================
// Opt-out
// ============================================================

async function marcarOptOut(whatsappId, valor = true) {
  const bruto = apenasDigitos(whatsappId);
  if (bruto.length < 8) return false;
  const wid = (await contatoIdService.resolverIdGravavel(bruto)) || bruto;
  await comConexao((conn) => conn.execute(
    `INSERT INTO contatos (whatsapp_id, opt_out, opt_out_em) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE opt_out = VALUES(opt_out), opt_out_em = VALUES(opt_out_em)`,
    [wid, valor ? 1 : 0, valor ? formatarDataHora(new Date()) : null]
  ));
  if (valor) {
    // Quem pediu para não receber mais não pode continuar na fila por causa do formato do número.
    const alvo = telefone.clausulaIn('whatsapp_id', bruto);
    if (alvo) {
      await comConexao((conn) => conn.execute(
        `UPDATE abordagens_fila SET status = 'descartado', motivo = 'opt-out', processado_em = NOW()
          WHERE ${alvo.sql} AND status = 'pendente'`,
        alvo.params
      ));
    }
  }
  return true;
}

async function temOptOut(whatsappId) {
  const wid = apenasDigitos(whatsappId);
  if (wid.length < 8) return false;
  try {
    return await comConexao(async (conn) => {
      const alvo = telefone.clausulaIn('whatsapp_id', wid);
      if (!alvo) return false;
      const [rows] = await conn.execute(
        `SELECT opt_out FROM contatos WHERE ${alvo.sql} AND opt_out = 1 LIMIT 1`, alvo.params);
      return !!(rows[0] && rows[0].opt_out);
    });
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE') return false; // migração ainda não rodou
    throw e;
  }
}

// ============================================================
// Fila
// ============================================================

/**
 * @param {Object} p
 * @param {string} p.whatsappId       telefone (dígitos ou chatId)
 * @param {string} p.evento           'indicacao_registrada' | 'pedido_concluido' | …
 * @param {number} p.fluxoId          fluxo a iniciar
 * @param {Object} [p.variaveis]      variáveis iniciais do fluxo
 * @param {string} [p.referencia]     chave de dedupe (ex.: 'pedido:123'); repetir = ignorado
 * @param {number} [p.atrasoMin]      minutos até poder iniciar (default 0)
 * @param {number} [p.validadeHoras]  depois disso o item é descartado (default 24)
 * @returns {{ enfileirado: boolean, id?: number, motivo?: string }}
 */
async function enfileirar({ whatsappId, evento, fluxoId, variaveis = null, referencia = null, atrasoMin = 0, validadeHoras = 24 }) {
  // Canônico na entrada da fila: o vCard de uma indicação chega sem DDI e sem o 9º dígito, e mais
  // adiante o destinatário é montado a partir daqui. Número torto vira mensagem que nunca chega.
  const wid = telefone.canonico(whatsappId);
  if (!wid || wid.length < 12) return { enfileirado: false, motivo: 'telefone inválido' };
  if (!evento || !fluxoId) return { enfileirado: false, motivo: 'evento/fluxo ausente' };
  if (await temOptOut(wid)) return { enfileirado: false, motivo: 'opt-out' };

  const agendado = new Date(Date.now() + Math.max(0, atrasoMin) * 60000);
  const expira = validadeHoras ? new Date(Date.now() + validadeHoras * 3600000) : null;
  try {
    const id = await comConexao(async (conn) => {
      const [r] = await conn.execute(
        `INSERT INTO abordagens_fila (whatsapp_id, evento, fluxo_id, variaveis, referencia, agendado_para, expira_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [wid, evento, Number(fluxoId), variaveis ? JSON.stringify(variaveis) : null, referencia || null,
          formatarDataHora(agendado), expira ? formatarDataHora(expira) : null]
      );
      return r.insertId;
    });
    return { enfileirado: true, id };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return { enfileirado: false, motivo: 'já enfileirado (referência repetida)' };
    throw e;
  }
}

async function marcar(id, status, motivo, tentativas) {
  await comConexao((conn) => conn.execute(
    `UPDATE abordagens_fila SET status = ?, motivo = ?, tentativas = ?, processado_em = IF(? = 'pendente', processado_em, NOW()) WHERE id = ?`,
    [status, motivo || null, tentativas, status, id]
  ));
}

/**
 * Processa os itens pendentes cuja hora chegou. Devolve resumo. Exposto para teste (o scheduler chama).
 * @param {Object} client - cliente WhatsApp (precisa de sendMessage)
 */
async function processarFila(client, agora = new Date()) {
  const fluxoExecutor = require('./fluxoExecutor'); // lazy: evita ciclo de require
  const resumo = { iniciados: 0, adiados: 0, descartados: 0, erros: 0 };
  if (!client) return resumo;

  const pendentes = await comConexao(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT * FROM abordagens_fila WHERE status = 'pendente' AND agendado_para <= ? ORDER BY agendado_para LIMIT 50`,
      [formatarDataHora(agora)]
    );
    return rows;
  });
  if (!pendentes.length) return resumo;

  const noHorario = await dentroDoHorario(agora);

  for (const item of pendentes) {
    const tentativas = item.tentativas + 1;
    try {
      if (item.expira_em && new Date(item.expira_em).getTime() < agora.getTime()) {
        await marcar(item.id, 'descartado', 'expirou antes de iniciar', tentativas); resumo.descartados++; continue;
      }
      if (!noHorario) { resumo.adiados++; continue; } // espera o próximo ciclo dentro do horário, sem gastar tentativa
      if (await temOptOut(item.whatsapp_id)) {
        await marcar(item.id, 'descartado', 'opt-out', tentativas); resumo.descartados++; continue;
      }
      const chatId = telefone.chatId(item.whatsapp_id);
      if (fluxoExecutor.temFluxoAtivo(chatId)) {
        if (tentativas >= MAX_TENTATIVAS) { await marcar(item.id, 'descartado', 'contato ficou em outro fluxo', tentativas); resumo.descartados++; }
        else { await marcar(item.id, 'pendente', 'contato em outro fluxo — aguardando', tentativas); resumo.adiados++; }
        continue;
      }
      const fluxo = await fluxoService.getFluxoPorId(item.fluxo_id);
      if (!fluxo || !fluxo.ativo) {
        await marcar(item.id, 'descartado', 'fluxo inexistente ou inativo', tentativas); resumo.descartados++; continue;
      }
      let variaveis = null;
      try { variaveis = item.variaveis ? (typeof item.variaveis === 'string' ? JSON.parse(item.variaveis) : item.variaveis) : null; } catch (_) { variaveis = null; }
      // Origem no funil: quem o bot aborda não manda a frase do canal, então o canal vem do evento.
      let canal = null;
      try {
        canal = await canalService.atribuirCanalPorEvento(chatId, item.evento);
      } catch (e) {
        console.warn('⚠️ Canal por evento:', e.message);
      }
      await fluxoExecutor.iniciarFluxo(client, chatId, fluxo, {
        ...(variaveis || {}),
        eventoOrigem: item.evento,
        ...(canal ? { canalSlug: canal.slug, canalNome: canal.nome } : {})
      });
      await marcar(item.id, 'iniciado', null, tentativas);
      resumo.iniciados++;
      console.log(`📣 Abordagem ativa: fluxo "${fluxo.nome}" iniciado para ${item.whatsapp_id} (evento ${item.evento})`);
    } catch (e) {
      resumo.erros++;
      console.error(`❌ Abordagem ativa #${item.id}:`, e.message);
      await marcar(item.id, tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', e.message.slice(0, 250), tentativas).catch(() => {});
    }
  }
  return resumo;
}

/**
 * Sinal de vida do scheduler, gravado a cada ciclo.
 *
 * Sem isto, um scheduler que não ligou é invisível: a fila enche, nada sai, e o bot continua
 * respondendo normalmente a quem escreve. O diagnóstico lê esta marca e diz há quanto tempo foi o
 * último ciclo.
 */
async function registrarCiclo() {
  try {
    await comConexao((conn) => conn.execute(
      `INSERT INTO configuracoes (chave, valor, tipo, categoria, descricao, createdAt, updatedAt)
       VALUES ('abordagem_ultimo_ciclo', ?, 'string', 'sistema',
               'Abordagem ativa: quando o scheduler rodou pela última vez (automático)', NOW(), NOW())
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), updatedAt = NOW()`,
      [formatarDataHora(new Date())]
    ));
  } catch (_) {
    // Marca de diagnóstico: nunca atrapalha o ciclo.
  }
}

function iniciarScheduler(client) {
  clientWhats = client;
  if (timer) return;
  timer = setInterval(async () => {
    if (processando) return;
    processando = true;
    try {
      await processarFila(clientWhats);
      await registrarCiclo();
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') console.error('❌ Scheduler de abordagem ativa:', e.message);
    } finally {
      processando = false;
    }
  }, INTERVALO_MS);
  if (timer.unref) timer.unref();
  registrarCiclo();
  console.log('📣 Scheduler de abordagem ativa ligado (a cada 60 s).');
}

function pararScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function listarFila({ status = null, limite = 100 } = {}) {
  return comConexao(async (conn) => {
    const [rows] = await conn.query(
      `SELECT f.*, x.nome AS fluxo_nome FROM abordagens_fila f LEFT JOIN fluxos x ON x.id = f.fluxo_id
        ${status ? 'WHERE f.status = ?' : ''} ORDER BY f.id DESC LIMIT ${Math.min(Math.max(parseInt(limite, 10) || 100, 1), 500)}`,
      status ? [status] : []
    );
    return rows;
  });
}

module.exports = {
  enfileirar, processarFila, iniciarScheduler, pararScheduler, listarFila,
  marcarOptOut, temOptOut, dentroDoHorario,
  _formatarDataHora: formatarDataHora
};
