'use strict';

/**
 * Sessões da campanha de desconto.
 * O Map em memória continua sendo a fonte de leitura (rápida e síncrona, como antes);
 * o MySQL (tabela sessoes_campanha) é a cópia durável: restart do bot não perde progresso.
 * Persistência: ao criar, ao salvar() explícito, ao deletar, e flush periódico de segurança.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const { SQL_CREATE } = require('../database/migrations/sessoes_campanha');

const sessoesCampanha = new Map();

const FLUSH_INTERVAL_MS = 60 * 1000;   // flush de segurança (pega mutações sem salvar())
const RETENCAO_DIAS = 30;              // sessões paradas há mais que isso são descartadas no boot

let pool = null;
let persistenciaOk = false;
let flushTimer = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port || 3306,
      user: dbConfig.username,
      password: dbConfig.password,
      database: dbConfig.database,
      connectionLimit: 3
    });
  }
  return pool;
}

function serializar(sessao) {
  return JSON.stringify(sessao);
}

function desserializar(dados) {
  const sessao = typeof dados === 'string' ? JSON.parse(dados) : dados;
  if (sessao && sessao.iniciadoEm) sessao.iniciadoEm = new Date(sessao.iniciadoEm);
  return sessao;
}

/**
 * Carrega as sessões persistidas para a memória. Chamar uma vez no boot do bot.
 * Cria a tabela se não existir e descarta sessões mais antigas que RETENCAO_DIAS.
 */
async function carregarDoBanco() {
  try {
    const p = getPool();
    await p.execute(SQL_CREATE);
    await p.execute(
      `DELETE FROM sessoes_campanha WHERE atualizado_em < NOW() - INTERVAL ${RETENCAO_DIAS} DAY`
    );
    const [rows] = await p.execute('SELECT numero, dados FROM sessoes_campanha');
    for (const row of rows) {
      try {
        sessoesCampanha.set(row.numero, desserializar(row.dados));
      } catch (e) {
        console.warn(`⚠️ Sessão campanha corrompida ignorada (${row.numero}):`, e.message);
      }
    }
    persistenciaOk = true;
    console.log(`🎁 Sessões de campanha restauradas do banco: ${rows.length}`);

    if (!flushTimer) {
      flushTimer = setInterval(() => { salvarTudo().catch(() => {}); }, FLUSH_INTERVAL_MS);
      if (flushTimer.unref) flushTimer.unref();
    }
  } catch (e) {
    persistenciaOk = false;
    console.error('❌ Persistência de sessões de campanha indisponível (seguindo só em memória):', e.message);
  }
}

/** Salva uma sessão no banco (fire-and-forget; erros só logam). */
function salvar(numero) {
  if (!persistenciaOk) return;
  const sessao = sessoesCampanha.get(numero);
  if (!sessao) return;
  getPool()
    .execute(
      `INSERT INTO sessoes_campanha (numero, dados) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE dados = VALUES(dados)`,
      [numero, serializar(sessao)]
    )
    .catch((e) => console.warn('⚠️ Falha ao salvar sessão campanha:', e.message));
}

async function salvarTudo() {
  if (!persistenciaOk || sessoesCampanha.size === 0) return;
  const p = getPool();
  for (const [numero, sessao] of sessoesCampanha.entries()) {
    try {
      await p.execute(
        `INSERT INTO sessoes_campanha (numero, dados) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE dados = VALUES(dados)`,
        [numero, serializar(sessao)]
      );
    } catch (e) {
      console.warn('⚠️ Flush sessão campanha:', e.message);
      break;
    }
  }
}

function removerDoBanco(numeros) {
  if (!persistenciaOk || !numeros.length) return;
  const placeholders = numeros.map(() => '?').join(',');
  getPool()
    .execute(`DELETE FROM sessoes_campanha WHERE numero IN (${placeholders})`, numeros)
    .catch((e) => console.warn('⚠️ Falha ao remover sessão campanha do banco:', e.message));
}

function criarSessaoVazia() {
  return {
    etapa: 1,
    subEtapa: 'aguardando_bairro',
    missoes: {
      1: { concluida: false, desconto: 10, descricao: 'Entrar no grupo WhatsApp' },
      2: { concluida: false, desconto: 10, descricao: 'A definir' },
      3: { concluida: false, desconto: 10, descricao: 'A definir' }
    },
    bairro: null,
    descontoTotal: 0,
    historico: [],
    iniciadoEm: new Date()
  };
}

function getOuCriarSessaoCampanha(numero) {
  if (!sessoesCampanha.has(numero)) {
    sessoesCampanha.set(numero, criarSessaoVazia());
    salvar(numero);
  }
  return sessoesCampanha.get(numero);
}

function has(numero) {
  return sessoesCampanha.has(numero);
}

function get(numero) {
  return sessoesCampanha.get(numero);
}

function deleteSessao(numero) {
  const existia = sessoesCampanha.delete(numero);
  if (existia) removerDoBanco([numero]);
  return existia;
}

function clearAll() {
  const numeros = Array.from(sessoesCampanha.keys());
  sessoesCampanha.clear();
  removerDoBanco(numeros);
}

function forEach(fn) {
  sessoesCampanha.forEach(fn);
}

function listarSessoes() {
  const list = [];
  sessoesCampanha.forEach((sessao, numero) => {
    list.push({
      chatId: numero,
      etapa: sessao.etapa,
      subEtapa: sessao.subEtapa,
      bairro: sessao.bairro,
      descontoTotal: sessao.descontoTotal,
      missoes: sessao.missoes,
      iniciadoEm: sessao.iniciadoEm
    });
  });
  return list;
}

function apenasDigitos(s) {
  if (s == null) return '';
  return String(s).replace(/\D/g, '');
}

function getSessaoPorChatId(chatId) {
  if (!chatId) return null;
  const raw = String(chatId).trim();
  if (sessoesCampanha.has(raw)) return { chatId: raw, sessao: sessoesCampanha.get(raw) };
  const comCus = raw.includes('@') ? raw : `${apenasDigitos(raw)}@c.us`;
  if (sessoesCampanha.has(comCus)) return { chatId: comCus, sessao: sessoesCampanha.get(comCus) };
  const digs = apenasDigitos(raw);
  for (const [num, sessao] of sessoesCampanha.entries()) {
    if (apenasDigitos(num) === digs && digs.length >= 8) {
      return { chatId: num, sessao };
    }
  }
  return null;
}

module.exports = {
  getOuCriarSessaoCampanha,
  has,
  get,
  delete: deleteSessao,
  clearAll,
  get size() { return sessoesCampanha.size; },
  forEach,
  listarSessoes,
  getSessaoPorChatId,
  carregarDoBanco,
  salvar,
  salvarTudo
};
