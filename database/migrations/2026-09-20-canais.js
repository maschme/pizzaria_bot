'use strict';

/**
 * Migração: tabela canais (origens de aquisição) + colunas de atribuição em contatos.
 * Ver docs/16-canais-e-funil.md. Idempotente.
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
      CREATE TABLE IF NOT EXISTS canais (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(120) NOT NULL,
        slug VARCHAR(60) NOT NULL UNIQUE,
        tipo ENUM('qr_caixa','panfleto','ifood','pos_venda','trafego_pago','outro') NOT NULL DEFAULT 'outro',
        mensagem_entrada VARCHAR(255) NOT NULL COMMENT 'Texto pré-preenchido do wa.me; identifica o canal na 1ª mensagem',
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_mensagem (mensagem_entrada)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela canais criada ou já existente.');

    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'contatos' AND COLUMN_NAME IN ('canal_id','canal_atribuido_em')`,
      [dbConfig.database]
    );
    const existentes = cols.map((c) => c.COLUMN_NAME);

    if (!existentes.includes('canal_id')) {
      await conn.execute(`ALTER TABLE contatos ADD COLUMN canal_id INT NULL COMMENT 'Canal de aquisição (1º contato)'`);
      console.log('✅ Coluna contatos.canal_id adicionada.');
    } else {
      console.log('⏭️ Coluna contatos.canal_id já existe.');
    }

    if (!existentes.includes('canal_atribuido_em')) {
      await conn.execute(`ALTER TABLE contatos ADD COLUMN canal_atribuido_em TIMESTAMP NULL`);
      console.log('✅ Coluna contatos.canal_atribuido_em adicionada.');
    } else {
      console.log('⏭️ Coluna contatos.canal_atribuido_em já existe.');
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração canais:', e.message); process.exit(1); });
}

module.exports = { migrar };
