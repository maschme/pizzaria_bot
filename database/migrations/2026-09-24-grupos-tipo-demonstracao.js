'use strict';

/**
 * Migração: tipo de grupo "demonstracao" (docs/20-modelos-e-fluxos-completos.md, modelo demo-campanha-30).
 * Grupo marcado assim nunca conta como grupo de campanha; quando alguém entra nele, o bot só avisa o
 * fluxo de demonstração em andamento daquela pessoa (que avança sozinho: "percebi que você entrou").
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
    const [cols] = await conn.execute(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'grupos_whatsapp' AND COLUMN_NAME = 'tipo'`,
      [dbConfig.database]
    );
    if (!cols.length) {
      console.log('⏭️ Tabela grupos_whatsapp sem coluna tipo — nada a fazer.');
      return;
    }
    if (String(cols[0].COLUMN_TYPE).includes("'demonstracao'")) {
      console.log('⏭️ grupos_whatsapp.tipo já aceita "demonstracao".');
      return;
    }
    await conn.execute(
      `ALTER TABLE grupos_whatsapp MODIFY COLUMN tipo
         ENUM('campanha','promocao','suporte','outro','demonstracao') DEFAULT 'outro'`
    );
    console.log('✅ grupos_whatsapp.tipo aceita "demonstracao".');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração grupos tipo demonstracao:', e.message); process.exit(1); });
}

module.exports = { migrar };
