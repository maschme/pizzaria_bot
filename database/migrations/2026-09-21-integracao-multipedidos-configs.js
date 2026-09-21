'use strict';

/**
 * Migração: configurações da integração Multipedidos (categoria `integracoes`).
 * Ver docs/18-cupons-multipedidos.md §1. Idempotente (só insere chaves que faltam).
 *
 * `multipedidos_webhook_ativo` nasce `true` quando MULTIPEDIDOS_WEBHOOK_SECRET já está definido,
 * para não desligar a captura de quem já usava o webhook antes desta tela existir.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const webhookJaEmUso = !!(process.env.MULTIPEDIDOS_WEBHOOK_SECRET || '').trim();

const CONFIGS = [
  ['multipedidos_webhook_ativo', String(webhookJaEmUso), 'boolean', 'Multipedidos: receber webhooks de pedidos'],
  ['multipedidos_api_ativa', 'false', 'boolean', 'Multipedidos: usar a API (cupons, cardápio, clientes)'],
  ['multipedidos_cupom_max_percent', '30', 'number', 'Multipedidos: desconto percentual máximo que um fluxo pode emitir'],
  ['multipedidos_cupom_max_valor_fixo', '50', 'number', 'Multipedidos: desconto fixo máximo (R$) que um fluxo pode emitir'],
  ['multipedidos_cupom_max_validade_dias', '60', 'number', 'Multipedidos: validade máxima (dias) de cupom emitido por fluxo'],
  ['multipedidos_cupom_prefixo', 'CUPOM', 'string', 'Multipedidos: prefixo dos códigos de cupom gerados']
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
    for (const [chave, valor, tipo, descricao] of CONFIGS) {
      const [rows] = await conn.execute('SELECT id FROM configuracoes WHERE chave = ? LIMIT 1', [chave]);
      if (rows.length > 0) {
        console.log(`⏭️ Configuração ${chave} já existe.`);
        continue;
      }
      await conn.execute(
        `INSERT INTO configuracoes (chave, valor, tipo, categoria, descricao, createdAt, updatedAt)
         VALUES (?, ?, ?, 'integracoes', ?, NOW(), NOW())`,
        [chave, valor, tipo, descricao]
      );
      console.log(`✅ Configuração ${chave} = ${valor}`);
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração configs Multipedidos:', e.message); process.exit(1); });
}

module.exports = { migrar };
