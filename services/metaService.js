'use strict';

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

function normalizarWhatsappId(id) {
  if (!id) return '';
  return String(id).replace(/\D/g, '');
}

/**
 * Lista todas as metas ativas (para dropdown no fluxo, etc.)
 */
async function listarMetas(apenasAtivas = true) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const where = apenasAtivas ? 'WHERE ativo = 1' : '';
    const [rows] = await conn.execute(`SELECT id, nome, descricao, ativo FROM metas ${where} ORDER BY nome`);
    return rows;
  } finally {
    await conn.end();
  }
}

/**
 * Busca meta por nome ou id
 */
async function getMetaPorNomeOuId(nomeOuId) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const isId = /^\d+$/.test(String(nomeOuId));
    const [rows] = isId
      ? await conn.execute('SELECT id, nome, descricao FROM metas WHERE id = ?', [parseInt(nomeOuId, 10)])
      : await conn.execute('SELECT id, nome, descricao FROM metas WHERE nome = ?', [String(nomeOuId).trim()]);
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

/**
 * Marca uma meta como concluída para o contato (whatsapp_id).
 * whatsapp_id pode vir com @c.us; é normalizado para só dígitos.
 */
async function marcarConcluido(whatsappId, metaNomeOuId) {
  const meta = await getMetaPorNomeOuId(metaNomeOuId);
  if (!meta) return { ok: false, erro: 'Meta não encontrada' };
  const wid = normalizarWhatsappId(whatsappId);
  if (!wid) return { ok: false, erro: 'whatsapp_id inválido' };

  const conn = await mysql.createConnection(mysql2Config);
  try {
    await conn.execute(
      `INSERT INTO contato_metas (whatsapp_id, meta_id, concluido) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE concluido = 1, concluido_em = CURRENT_TIMESTAMP`
    , [wid, meta.id]);
    return { ok: true, meta: meta.nome };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { ok: false, erro: 'Tabelas metas/contato_metas não existem' };
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Verifica se o contato já concluiu a meta.
 * Retorna true/false.
 */
async function verificarConcluido(whatsappId, metaNomeOuId) {
  const meta = await getMetaPorNomeOuId(metaNomeOuId);
  if (!meta) return false;
  const wid = normalizarWhatsappId(whatsappId);
  if (!wid) return false;

  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      'SELECT 1 FROM contato_metas WHERE whatsapp_id = ? AND meta_id = ? AND concluido = 1 LIMIT 1',
      [wid, meta.id]
    );
    return rows.length > 0;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Lista nomes das metas que o contato já concluiu (para pós-venda, etc.)
 */
async function listarMetasConcluidasPorContato(whatsappId) {
  const wid = normalizarWhatsappId(whatsappId);
  if (!wid) return [];

  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      `SELECT m.nome, m.descricao, cm.concluido_em
       FROM contato_metas cm
       JOIN metas m ON m.id = cm.meta_id
       WHERE cm.whatsapp_id = ? AND cm.concluido = 1
       ORDER BY cm.concluido_em DESC`,
      [wid]
    );
    return rows;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  } finally {
    await conn.end();
  }
}

module.exports = {
  listarMetas,
  getMetaPorNomeOuId,
  marcarConcluido,
  verificarConcluido,
  listarMetasConcluidasPorContato,
  normalizarWhatsappId
};
