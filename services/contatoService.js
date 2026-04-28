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

/**
 * Lista contatos da tabela contatos com paginação.
 */
async function listarContatos(opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 100));
  const offset = (page - 1) * limit;
  const conn = await mysql.createConnection(config);
  try {
    const [[countRow]] = await conn.execute('SELECT COUNT(*) AS total FROM contatos');
    const [rows] = await conn.execute(
      `SELECT id, whatsapp_id, whatsapp_lid, nome, cam_grupo, id_negociacao, qt_indicados, cam_indicacoes, created_at, updated_at
       FROM contatos ORDER BY updated_at DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const total = Number(countRow?.total || 0);
    return {
      rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return { rows: [], total: 0, page, limit, totalPages: 1 };
    }
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Deleta um contato (e suas metas). Útil para resetar e testar fluxo de novo.
 * Também remove indicações onde ele é o indicador.
 */
async function deletarContato(whatsappId, opts = {}) {
  const wid = normalizarWhatsappId(whatsappId);
  const lid = (opts.whatsappLid && String(opts.whatsappLid).trim()) || '';
  if (!wid && !lid) throw new Error('whatsapp_id inválido');

  const conn = await mysql.createConnection(config);
  try {
    const widParaMetas = wid || normalizarWhatsappId(lid);
    if (widParaMetas) {
      await conn.execute('DELETE FROM contato_metas WHERE whatsapp_id = ?', [widParaMetas]);
      await conn.execute(
        'DELETE FROM indicacoes WHERE indicador_whatsapp_id = ? OR indicador_whatsapp_id = ?',
        [widParaMetas, widParaMetas + '@c.us']
      );
    }
    let affected = 0;
    if (wid && lid) {
      const [r] = await conn.execute(
        'DELETE FROM contatos WHERE whatsapp_id = ? OR whatsapp_lid = ?',
        [wid, lid]
      );
      affected = r.affectedRows;
    } else if (wid) {
      const [r] = await conn.execute('DELETE FROM contatos WHERE whatsapp_id = ?', [wid]);
      affected = r.affectedRows;
    } else {
      const [r] = await conn.execute('DELETE FROM contatos WHERE whatsapp_lid = ?', [lid]);
      affected = r.affectedRows;
    }
    return { deleted: affected > 0, whatsapp_id: wid || null };
  } finally {
    await conn.end();
  }
}

module.exports = {
  listarContatos,
  deletarContato,
  normalizarWhatsappId
};
