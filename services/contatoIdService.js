'use strict';

/**
 * Decide COM QUAL identificador gravar um contato, e como procurá-lo.
 *
 * O [telefoneService](./telefoneService.js) sabe dizer se dois números são o mesmo; aqui entra a
 * parte que depende do banco: quando um contato já existe gravado numa das formas (por exemplo sem
 * o 9º dígito, de antes), continuamos usando aquela forma, em vez de criar um segundo registro.
 *
 * Regra: **grave com `resolverIdGravavel`, procure com `telefone.clausulaIn`.**
 * Assim nada precisa ser migrado: os registros antigos continuam sendo encontrados e os novos
 * nascem no formato canônico.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('./telefoneService');

const config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

/**
 * @param {string} entrada - telefone em qualquer formato, ou chatId
 * @param {Object} [opts]
 * @param {import('mysql2/promise').Connection} [opts.conn] - conexão já aberta, para reaproveitar
 * @returns {Promise<string>} o whatsapp_id a usar (dígitos), ou '' se o número não serve
 */
async function resolverIdGravavel(entrada, opts = {}) {
  // Conta @lid não é telefone: não vira whatsapp_id.
  if (telefone.ehLid(entrada)) return '';

  const variantes = telefone.variantes(entrada);
  if (!variantes.length) return '';
  const canonico = variantes[0];
  if (variantes.length === 1) return canonico;

  const conn = opts.conn || await mysql.createConnection(config);
  try {
    const [rows] = await conn.execute(
      `SELECT whatsapp_id FROM contatos
        WHERE whatsapp_id IN (${variantes.map(() => '?').join(', ')})
        ORDER BY (whatsapp_id = ?) DESC, id ASC LIMIT 1`,
      [...variantes, canonico]
    );
    const cadastrado = rows[0] && String(rows[0].whatsapp_id || '').trim();
    return cadastrado || canonico;
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️ resolverIdGravavel:', e.message);
    }
    return canonico;
  } finally {
    if (!opts.conn) await conn.end().catch(() => {});
  }
}

module.exports = { resolverIdGravavel };
