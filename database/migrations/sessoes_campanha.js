'use strict';

/**
 * Migração: tabela sessoes_campanha — persistência das sessões da campanha de desconto
 * (antes só em memória; restart perdia o progresso dos clientes).
 * Executar uma vez (ex.: node database/migrations/sessoes_campanha.js) — ou é criada
 * automaticamente no primeiro carregarDoBanco() do sessaoCampanhaService.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const SQL_CREATE = `
  CREATE TABLE IF NOT EXISTS sessoes_campanha (
    numero VARCHAR(64) NOT NULL PRIMARY KEY COMMENT 'ChatId/numero do cliente (ex: 5547...@c.us)',
    dados JSON NOT NULL COMMENT 'Sessão completa (etapa, missões, bairro, histórico...)',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function migrarSessoesCampanha(connExistente = null) {
  const conn = connExistente || await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port || 3306,
    user: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.database
  });
  try {
    await conn.execute(SQL_CREATE);
    console.log('✅ Tabela sessoes_campanha criada ou já existente.');
  } finally {
    if (!connExistente) await conn.end();
  }
}

if (require.main === module) {
  migrarSessoesCampanha()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração sessoes_campanha:', e.message); process.exit(1); });
}

module.exports = { migrarSessoesCampanha, SQL_CREATE };
