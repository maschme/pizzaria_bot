'use strict';

/**
 * Migração: configs e metas do pós-venda (docs/20 frente C). Idempotente.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const CONFIGS = [
  ['pos_venda_atraso_min', '40', 'number', 'Pós-venda: minutos após o pedido concluído para abordar o cliente'],
  ['pos_venda_repetir_dias', '7', 'number', 'Pós-venda: dias mínimos entre duas abordagens ao mesmo contato']
];
const METAS = [
  ['pos_venda_ofertado', 'Recebeu o menu de campanhas no pós-venda'],
  ['pos_venda_aceitou', 'Escolheu uma campanha no pós-venda']
];

async function migrar() {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });
  try {
    for (const [chave, valor, tipo, descricao] of CONFIGS) {
      const [r] = await conn.execute('SELECT id FROM configuracoes WHERE chave = ? LIMIT 1', [chave]);
      if (r.length) { console.log(`⏭️ Config ${chave} já existe.`); continue; }
      await conn.execute(
        `INSERT INTO configuracoes (chave, valor, tipo, categoria, descricao, createdAt, updatedAt)
         VALUES (?, ?, ?, 'campanha', ?, NOW(), NOW())`,
        [chave, valor, tipo, descricao]
      );
      console.log(`✅ Config ${chave} = ${valor}`);
    }
    for (const [nome, descricao] of METAS) {
      const [r] = await conn.execute('SELECT id FROM metas WHERE nome = ? LIMIT 1', [nome]);
      if (r.length) { console.log(`⏭️ Meta ${nome} já existe.`); continue; }
      await conn.execute('INSERT INTO metas (nome, descricao, ativo) VALUES (?, ?, 1)', [nome, descricao]);
      console.log(`✅ Meta ${nome} criada.`);
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar().then(() => process.exit(0)).catch((e) => { console.error('❌ Migração pós-venda:', e.message); process.exit(1); });
}

module.exports = { migrar };
