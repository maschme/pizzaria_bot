'use strict';

/**
 * Migração: tabela indicacoes + colunas qt_indicados e cam_indicacoes na tabela contatos.
 * Executar uma vez no servidor (ex.: node database/migrations/indicacoes.js ou no startup).
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

async function run() {
  const conn = await mysql.createConnection(mysql2Config);

  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS indicacoes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        indicador_whatsapp_id VARCHAR(50) NOT NULL COMMENT 'Quem indicou (ex: 5511999999999@c.us ou número)',
        indicado_numero VARCHAR(30) NOT NULL COMMENT 'Número do indicado',
        indicado_nome VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_indicador_indicado (indicador_whatsapp_id, indicado_numero)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela indicacoes criada ou já existente.');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS contatos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        whatsapp_id VARCHAR(50) NOT NULL COMMENT 'Número WhatsApp (apenas dígitos)',
        nome VARCHAR(255) NULL,
        cam_grupo TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = entrou no grupo de promoções',
        id_negociacao INT NULL COMMENT 'ID no CRM/funil de vendas',
        qt_indicados INT NOT NULL DEFAULT 0 COMMENT 'Quantidade de pessoas que este contato já indicou',
        cam_indicacoes TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = missão de 10 indicações concluída',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_whatsapp_id (whatsapp_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela contatos criada ou já existente.');

    const [tables] = await conn.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'contatos'`,
      [mysql2Config.database]
    );
    if (tables.length === 0) {
      console.log('⚠️ Tabela contatos não existe neste banco. Crie a tabela e rode a migração de novo para adicionar qt_indicados e cam_indicacoes.');
    } else {
      const [cols] = await conn.execute(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'contatos' AND COLUMN_NAME IN ('qt_indicados','cam_indicacoes')
      `, [mysql2Config.database]);
      const existing = cols.map(r => r.COLUMN_NAME);

      if (!existing.includes('qt_indicados')) {
        await conn.execute(`ALTER TABLE contatos ADD COLUMN qt_indicados INT NOT NULL DEFAULT 0 COMMENT 'Quantidade de pessoas que este contato já indicou';`);
        console.log('✅ Coluna contatos.qt_indicados adicionada.');
      } else {
        console.log('⏭️ Coluna contatos.qt_indicados já existe.');
      }

      if (!existing.includes('cam_indicacoes')) {
        await conn.execute(`ALTER TABLE contatos ADD COLUMN cam_indicacoes TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Missão de indicações concluída (10 contatos)';`);
        console.log('✅ Coluna contatos.cam_indicacoes adicionada.');
      } else {
        console.log('⏭️ Coluna contatos.cam_indicacoes já existe.');
      }
    }
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('❌ Erro na migração:', err.message);
  process.exit(1);
});
