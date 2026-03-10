'use strict';

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const { parseVcards } = require('../utils/vcardParser');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

/** Normaliza número para comparação com whatsapp_id (apenas dígitos) */
function normalizarWhatsappId(id) {
  if (!id) return '';
  return String(id).replace(/\D/g, '');
}

/**
 * Registra uma ou mais indicações (contatos enviados por um usuário).
 * Evita duplicatas (mesmo indicador + mesmo indicado).
 * Atualiza contatos.qt_indicados e contatos.cam_indicacoes.
 * @param {string} indicadorWhatsappId - Quem está indicando (ex: 5511999999999@c.us)
 * @param {Array<{ numero: string, nome?: string|null }>} indicados - Lista de { numero, nome }
 * @returns {Promise<{ qtInseridos: number, qtTotal: number, completouMissao: boolean }>}
 */
async function registrarIndicacoes(indicadorWhatsappId, indicados) {
  if (!indicados || indicados.length === 0) {
    const qt = await obterQtIndicados(indicadorWhatsappId);
    return { qtInseridos: 0, qtTotal: qt, completouMissao: qt >= 10 };
  }

  const conn = await mysql.createConnection(mysql2Config);
  try {
    let qtInseridos = 0;
    const indicadorNorm = indicadorWhatsappId || '';

    for (const { numero, nome } of indicados) {
      if (!numero || !numero.replace(/\D/g, '')) continue;
      const numNorm = numero.replace(/\D/g, '');
      try {
        const [result] = await conn.execute(
          `INSERT INTO indicacoes (indicador_whatsapp_id, indicado_numero, indicado_nome)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE indicado_nome = VALUES(indicado_nome)`,
          [indicadorNorm, numNorm, nome || null]
        );
        if (result.affectedRows === 1) qtInseridos++;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }

    const [rows] = await conn.execute(
      'SELECT COUNT(*) as total FROM indicacoes WHERE indicador_whatsapp_id = ?',
      [indicadorNorm]
    );
    const qtTotal = (rows[0] && rows[0].total) ? Number(rows[0].total) : 0;

    const whatsappIdParaContato = normalizarWhatsappId(indicadorWhatsappId);
    try {
      await conn.execute(
        `UPDATE contatos SET qt_indicados = ?, cam_indicacoes = ? WHERE whatsapp_id = ?`,
        [qtTotal, qtTotal >= 10 ? 1 : 0, whatsappIdParaContato]
      );
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
      console.warn('⚠️ Tabela contatos não existe; qt_indicados/cam_indicacoes só em indicacoes.');
    }

    return {
      qtInseridos,
      qtTotal,
      completouMissao: qtTotal >= 10
    };
  } finally {
    await conn.end();
  }
}

/**
 * Retorna quantas pessoas o usuário já indicou.
 * @param {string} indicadorWhatsappId
 * @returns {Promise<number>}
 */
async function obterQtIndicados(indicadorWhatsappId) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      'SELECT COUNT(*) as total FROM indicacoes WHERE indicador_whatsapp_id = ?',
      [indicadorWhatsappId || '']
    );
    return (rows[0] && rows[0].total) ? Number(rows[0].total) : 0;
  } finally {
    await conn.end();
  }
}

/**
 * Verifica se o contato já completou a missão de indicações (cam_indicacoes).
 * @param {string} whatsappId - Número ou id do contato (pode ser com ou sem @c.us)
 * @returns {Promise<boolean>}
 */
async function completouMissaoIndicacoes(whatsappId) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const id = normalizarWhatsappId(whatsappId);
    const [rows] = await conn.execute(
      'SELECT cam_indicacoes FROM contatos WHERE whatsapp_id = ? LIMIT 1',
      [id]
    );
    return rows[0] ? Boolean(rows[0].cam_indicacoes) : false;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  } finally {
    await conn.end();
  }
}

module.exports = {
  registrarIndicacoes,
  obterQtIndicados,
  completouMissaoIndicacoes,
  normalizarWhatsappId,
  parseVcards
};
