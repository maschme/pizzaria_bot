'use strict';

/**
 * Migração: metas usadas pelo fluxo do indicado (docs/20 frente B). Idempotente.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const METAS = [
  ['indicado_aceitou', 'Indicado aceitou receber o cupom'],
  ['indicado_comprou', 'Indicado usou o cupom num pedido']
];

async function migrar() {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });
  try {
    for (const [nome, descricao] of METAS) {
      const [rows] = await conn.execute('SELECT id FROM metas WHERE nome = ? LIMIT 1', [nome]);
      if (rows.length) { console.log(`⏭️ Meta ${nome} já existe.`); continue; }
      await conn.execute('INSERT INTO metas (nome, descricao, ativo) VALUES (?, ?, 1)', [nome, descricao]);
      console.log(`✅ Meta ${nome} criada.`);
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar().then(() => process.exit(0)).catch((e) => { console.error('❌ Migração metas do indicado:', e.message); process.exit(1); });
}

module.exports = { migrar };
