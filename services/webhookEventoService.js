'use strict';

/**
 * Captura crua de webhooks de sistemas externos (tabela webhook_eventos).
 * Usado para estudar/documentar payloads antes de interpretar — ver docs/17-integracao-multipedidos.md.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

function tentarJson(texto) {
  try {
    return { ok: true, valor: JSON.parse(texto) };
  } catch (_) {
    return { ok: false, valor: null };
  }
}

async function registrar({ origem, metodo, caminho, queryString, contentType, headers, body, ip }) {
  const corpo = body == null ? '' : String(body);
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [r] = await conn.execute(
      `INSERT INTO webhook_eventos
        (origem, metodo, caminho, query_string, content_type, headers, body, body_json_valido, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        origem,
        metodo,
        caminho || null,
        queryString || null,
        contentType || null,
        JSON.stringify(headers || {}),
        corpo,
        corpo && tentarJson(corpo).ok ? 1 : 0,
        ip || null
      ]
    );
    return r.insertId;
  } finally {
    await conn.end();
  }
}

function formatar(row, comCorpo) {
  const evento = {
    id: row.id,
    origem: row.origem,
    metodo: row.metodo,
    caminho: row.caminho,
    query_string: row.query_string,
    content_type: row.content_type,
    body_json_valido: !!row.body_json_valido,
    tamanho_body: row.tamanho_body != null ? Number(row.tamanho_body) : undefined,
    ip: row.ip,
    recebido_em: row.recebido_em
  };
  if (comCorpo) {
    evento.headers = tentarJson(row.headers || '{}').valor || {};
    const json = row.body_json_valido ? tentarJson(row.body) : { ok: false };
    evento.body = json.ok ? json.valor : row.body;
  }
  return evento;
}

async function listar({ origem, limite = 50, comCorpo = false }) {
  const lim = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 500);
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.query(
      `SELECT ${comCorpo ? '*' : 'id, origem, metodo, caminho, query_string, content_type, body_json_valido, ip, recebido_em'},
              CHAR_LENGTH(body) AS tamanho_body
         FROM webhook_eventos
        WHERE origem = ?
        ORDER BY id DESC
        LIMIT ${lim}`,
      [origem]
    );
    return rows.map((r) => formatar(r, comCorpo));
  } finally {
    await conn.end();
  }
}

async function obter(origem, id) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      'SELECT *, CHAR_LENGTH(body) AS tamanho_body FROM webhook_eventos WHERE origem = ? AND id = ?',
      [origem, id]
    );
    return rows[0] ? formatar(rows[0], true) : null;
  } finally {
    await conn.end();
  }
}

module.exports = { registrar, listar, obter };
