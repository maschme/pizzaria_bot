'use strict';

/**
 * Migração: canais.fluxo_id — fluxo que o canal inicia quando a 1ª mensagem casa com ele
 * (docs/20-modelos-e-fluxos-completos.md, frente A0). NULL = o canal só marca a origem. Idempotente.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

async function migrar() {
  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port || 3306,
    user: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.database
  });

  try {
    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'canais' AND COLUMN_NAME = 'fluxo_id'`,
      [dbConfig.database]
    );
    if (cols.length > 0) {
      console.log('⏭️ Coluna canais.fluxo_id já existe.');
      return;
    }
    await conn.execute(
      `ALTER TABLE canais ADD COLUMN fluxo_id INT NULL COMMENT 'Fluxo iniciado quando o canal casa (NULL = só rastreia origem)' AFTER mensagem_entrada`
    );
    console.log('✅ Coluna canais.fluxo_id adicionada.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração canais.fluxo_id:', e.message); process.exit(1); });
}

module.exports = { migrar };
