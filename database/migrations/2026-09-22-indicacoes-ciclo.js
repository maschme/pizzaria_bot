'use strict';

/**
 * Migração: fecha o ciclo da indicação (docs/20-modelos-e-fluxos-completos.md, frente B).
 * `indicacoes` passa a registrar quando o bot abordou o indicado e quando ele virou cliente
 * (1º pedido usando o cupom de indicado), para medir indicador → conversão. Idempotente.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const COLUNAS = [
  ['abordado_em', 'DATETIME NULL COMMENT \'Quando o bot enfileirou a abordagem ao indicado\''],
  ['convertido_em', 'DATETIME NULL COMMENT \'Quando o indicado usou o cupom num pedido\''],
  ['pedido_id', 'BIGINT NULL COMMENT \'Pedido da conversão (Multipedidos)\''],
  ['pedido_valor', 'DECIMAL(10,2) NULL']
];

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
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'indicacoes'`,
      [dbConfig.database]
    );
    const existentes = cols.map((c) => c.COLUMN_NAME);
    for (const [nome, ddl] of COLUNAS) {
      if (existentes.includes(nome)) {
        console.log(`⏭️ Coluna indicacoes.${nome} já existe.`);
        continue;
      }
      await conn.execute(`ALTER TABLE indicacoes ADD COLUMN ${nome} ${ddl}`);
      console.log(`✅ Coluna indicacoes.${nome} adicionada.`);
    }
    const [idx] = await conn.execute(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'indicacoes' AND INDEX_NAME = 'idx_indicado_numero'`,
      [dbConfig.database]
    );
    if (idx.length === 0) {
      await conn.execute('ALTER TABLE indicacoes ADD INDEX idx_indicado_numero (indicado_numero)');
      console.log('✅ Índice indicacoes(indicado_numero) adicionado.');
    } else console.log('⏭️ Índice idx_indicado_numero já existe.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração indicacoes (ciclo):', e.message); process.exit(1); });
}

module.exports = { migrar };
