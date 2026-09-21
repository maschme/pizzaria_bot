'use strict';

/**
 * Migração: tabela multipedidos_cupons — cupons únicos emitidos pelos fluxos na Multipedidos.
 * É o vínculo contato + campanha → cupom, que permite alterar o cupom dias depois mesmo com
 * restart do bot (sessões de fluxo vivem só em memória). Ver docs/18-cupons-multipedidos.md §4.3.
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
      CREATE TABLE IF NOT EXISTS multipedidos_cupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        whatsapp_id VARCHAR(32) NOT NULL COMMENT 'Telefone do contato, só dígitos',
        campanha VARCHAR(80) NOT NULL COMMENT 'Chave da campanha/fluxo que emitiu',
        fluxo_id INT NULL,
        mp_cupom_id INT NOT NULL COMMENT 'id do cupom na Multipedidos',
        codigo VARCHAR(40) NOT NULL,
        tipo_desconto ENUM('percent','fixed') NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        pedido_minimo DECIMAL(10,2) NULL,
        validade DATETIME NULL,
        validade_dias INT NULL COMMENT 'Duração pedida na emissão; usada para renovar',
        versao INT NOT NULL DEFAULT 1 COMMENT 'currentVersion do cupom na Multipedidos',
        meta_ao_resgatar VARCHAR(80) NULL COMMENT 'Meta marcada quando o cupom for usado',
        status ENUM('ativo','usado','expirado','desativado') NOT NULL DEFAULT 'ativo',
        usado_em DATETIME NULL,
        pedido_id BIGINT NULL,
        pedido_valor DECIMAL(10,2) NULL,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_codigo (codigo),
        KEY idx_contato_campanha (whatsapp_id, campanha),
        KEY idx_status_validade (status, validade)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela multipedidos_cupons criada ou já existente.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração multipedidos_cupons:', e.message); process.exit(1); });
}

module.exports = { migrar };
