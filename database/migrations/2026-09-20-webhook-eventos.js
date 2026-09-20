'use strict';

/**
 * Migração: tabela webhook_eventos — captura crua de webhooks de sistemas externos
 * (ex.: Multipedidos) para estudo/documentação dos payloads. Ver docs/17-integracao-multipedidos.md.
 * Idempotente.
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
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS webhook_eventos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        origem VARCHAR(40) NOT NULL COMMENT 'Sistema que enviou (ex.: multipedidos)',
        metodo VARCHAR(10) NOT NULL,
        caminho VARCHAR(255) NULL COMMENT 'Sub-caminho após o segredo, se houver',
        query_string TEXT NULL,
        content_type VARCHAR(120) NULL,
        headers LONGTEXT NULL COMMENT 'JSON dos headers recebidos',
        body LONGTEXT NULL COMMENT 'Corpo cru, exatamente como recebido',
        body_json_valido TINYINT(1) NOT NULL DEFAULT 0,
        ip VARCHAR(64) NULL,
        recebido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_origem_recebido (origem, recebido_em)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela webhook_eventos criada ou já existente.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração webhook_eventos:', e.message); process.exit(1); });
}

module.exports = { migrar };
