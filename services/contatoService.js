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
 * Lista todos os contatos da tabela contatos.
 */
async function listarContatos() {
  const conn = await mysql.createConnection(config);
  try {
    const [rows] = await conn.execute(
      `SELECT id, whatsapp_id, nome, cam_grupo, id_negociacao, qt_indicados, cam_indicacoes, created_at, updated_at
       FROM contatos ORDER BY updated_at DESC, created_at DESC`
    );
    return rows;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Deleta um contato (e suas metas). Útil para resetar e testar fluxo de novo.
 * Também remove indicações onde ele é o indicador.
 */
async function deletarContato(whatsappId) {
  const wid = normalizarWhatsappId(whatsappId);
  if (!wid) throw new Error('whatsapp_id inválido');

  const conn = await mysql.createConnection(config);
  try {
    await conn.execute('DELETE FROM contato_metas WHERE whatsapp_id = ?', [wid]);
    await conn.execute('DELETE FROM indicacoes WHERE indicador_whatsapp_id = ? OR indicador_whatsapp_id = ?', [wid, wid + '@c.us']);
    const [result] = await conn.execute('DELETE FROM contatos WHERE whatsapp_id = ?', [wid]);
    return { deleted: result.affectedRows > 0, whatsapp_id: wid };
  } finally {
    await conn.end();
  }
}

module.exports = {
  listarContatos,
  deletarContato,
  normalizarWhatsappId
};
