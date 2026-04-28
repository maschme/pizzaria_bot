'use strict';

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');

const config = {
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

async function registrarLog(payload = {}) {
  const conn = await mysql.createConnection(config);
  try {
    const whatsappId = normalizarWhatsappId(payload.whatsappId || payload.chatId);
    await conn.execute(
      `INSERT INTO fluxo_exec_logs
      (whatsapp_id, chat_id, fluxo_id, fluxo_nome, node_id, node_type, evento, mensagem, detalhes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        whatsappId || null,
        payload.chatId || null,
        payload.fluxoId || null,
        payload.fluxoNome || null,
        payload.nodeId || null,
        payload.nodeType || null,
        payload.evento || 'info',
        payload.mensagem || '',
        payload.detalhes ? JSON.stringify(payload.detalhes) : null
      ]
    );
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️ FluxoLog registrarLog:', e.message);
    }
  } finally {
    await conn.end();
  }
}

async function listarLogsPorContato(whatsappId, limit = 200, opts = {}) {
  const wid = normalizarWhatsappId(whatsappId || '');
  const lidRaw = (opts.whatsappLid && String(opts.whatsappLid).trim()) || '';
  const lidD = lidRaw.includes('@lid') ? normalizarWhatsappId(lidRaw) : '';
  if (!wid && !lidD && !lidRaw) return [];
  const conn = await mysql.createConnection(config);
  try {
    const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
    const params = [];
    const partes = [];
    if (wid) {
      partes.push('whatsapp_id = ?');
      params.push(wid);
    }
    if (lidD && lidD !== wid) {
      partes.push('whatsapp_id = ?');
      params.push(lidD);
    }
    if (lidRaw) {
      partes.push('chat_id = ?');
      params.push(lidRaw);
    }
    if (partes.length === 0) return [];
    const where = partes.join(' OR ');
    const [rows] = await conn.execute(
      `SELECT id, whatsapp_id, chat_id, fluxo_id, fluxo_nome, node_id, node_type, evento, mensagem, detalhes_json, created_at
       FROM fluxo_exec_logs
       WHERE ${where}
       ORDER BY id DESC
       LIMIT ${lim}`,
      params
    );
    return rows.map((r) => ({
      ...r,
      detalhes: r.detalhes_json ? (() => {
        try { return JSON.parse(r.detalhes_json); } catch (_) { return null; }
      })() : null
    }));
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  } finally {
    await conn.end();
  }
}

module.exports = {
  registrarLog,
  listarLogsPorContato,
  normalizarWhatsappId
};

