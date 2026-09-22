'use strict';

/**
 * Migração: base da abordagem ativa (docs/20-modelos-e-fluxos-completos.md, frente B0).
 *  - contatos.opt_out / opt_out_em: contato que pediu para não receber mais mensagens iniciadas pelo bot.
 *  - abordagens_fila: eventos (indicação registrada, pedido concluído…) que devem iniciar um fluxo, com
 *    horário, tentativas e resultado — fica fora do horário comercial aguardando, e sobrevive a restart.
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
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'contatos' AND COLUMN_NAME IN ('opt_out','opt_out_em')`,
      [dbConfig.database]
    );
    const existentes = cols.map((c) => c.COLUMN_NAME);
    if (!existentes.includes('opt_out')) {
      await conn.execute(`ALTER TABLE contatos ADD COLUMN opt_out TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Não recebe abordagem iniciada pelo bot'`);
      console.log('✅ Coluna contatos.opt_out adicionada.');
    } else console.log('⏭️ Coluna contatos.opt_out já existe.');
    if (!existentes.includes('opt_out_em')) {
      await conn.execute(`ALTER TABLE contatos ADD COLUMN opt_out_em DATETIME NULL`);
      console.log('✅ Coluna contatos.opt_out_em adicionada.');
    } else console.log('⏭️ Coluna contatos.opt_out_em já existe.');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS abordagens_fila (
        id INT AUTO_INCREMENT PRIMARY KEY,
        whatsapp_id VARCHAR(32) NOT NULL COMMENT 'Telefone, só dígitos',
        evento VARCHAR(50) NOT NULL COMMENT 'indicacao_registrada, pedido_concluido, …',
        fluxo_id INT NOT NULL,
        variaveis JSON NULL COMMENT 'Variáveis iniciais do fluxo',
        referencia VARCHAR(80) NULL COMMENT 'Chave de dedupe (ex.: pedido:123, indicacao:45)',
        agendado_para DATETIME NOT NULL,
        expira_em DATETIME NULL COMMENT 'Depois disso não vale mais iniciar',
        status ENUM('pendente','iniciado','descartado','erro') NOT NULL DEFAULT 'pendente',
        motivo VARCHAR(255) NULL,
        tentativas INT NOT NULL DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processado_em DATETIME NULL,
        UNIQUE KEY uniq_referencia (evento, referencia),
        KEY idx_status_agendado (status, agendado_para)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela abordagens_fila criada ou já existente.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração abordagem ativa:', e.message); process.exit(1); });
}

module.exports = { migrar };
