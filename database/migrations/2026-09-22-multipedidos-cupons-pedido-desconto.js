'use strict';

/**
 * Migração: coluna multipedidos_cupons.pedido_desconto — desconto efetivamente aplicado no pedido que
 * usou o cupom (discount_value do webhook), para medir o custo da campanha. Ver docs/18 §5. Idempotente.
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
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'multipedidos_cupons' AND COLUMN_NAME = 'pedido_desconto'`,
      [dbConfig.database]
    );
    if (cols.length > 0) {
      console.log('⏭️ Coluna multipedidos_cupons.pedido_desconto já existe.');
      return;
    }
    await conn.execute(
      `ALTER TABLE multipedidos_cupons ADD COLUMN pedido_desconto DECIMAL(10,2) NULL COMMENT 'Desconto aplicado no pedido que usou o cupom' AFTER pedido_valor`
    );
    console.log('✅ Coluna multipedidos_cupons.pedido_desconto adicionada.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração pedido_desconto:', e.message); process.exit(1); });
}

module.exports = { migrar };
