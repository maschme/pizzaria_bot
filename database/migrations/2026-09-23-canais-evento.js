'use strict';

/**
 * Migração: canal por evento (docs/16-canais-e-funil.md).
 * Até aqui um canal só era atribuído quando a 1ª mensagem do cliente casava com `mensagem_entrada`
 * — quem o bot aborda (indicado, pós-venda) nunca manda essa frase e ficava sem origem no funil.
 * Agora o canal pode ser de **evento**: `canais.evento` preenchido e `mensagem_entrada` nula.
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
      `SELECT COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'canais' AND COLUMN_NAME IN ('evento','mensagem_entrada')`,
      [dbConfig.database]
    );
    const porNome = Object.fromEntries(cols.map((c) => [c.COLUMN_NAME, c]));

    if (!porNome.evento) {
      await conn.execute(
        `ALTER TABLE canais ADD COLUMN evento VARCHAR(50) NULL
         COMMENT 'Evento do sistema que atribui este canal (indicacao_registrada, pedido_concluido). NULL = canal por link/QR'
         AFTER mensagem_entrada`
      );
      console.log('✅ Coluna canais.evento adicionada.');
    } else console.log('⏭️ Coluna canais.evento já existe.');

    // mensagem_entrada passa a aceitar NULL (canal de evento não tem frase de entrada).
    // O índice UNIQUE continua valendo: no MySQL, NULLs não colidem entre si.
    if (porNome.mensagem_entrada && porNome.mensagem_entrada.IS_NULLABLE === 'NO') {
      await conn.execute(
        `ALTER TABLE canais MODIFY COLUMN mensagem_entrada VARCHAR(255) NULL
         COMMENT 'Texto pré-preenchido do wa.me; identifica o canal na 1ª mensagem (NULL em canal de evento)'`
      );
      console.log('✅ canais.mensagem_entrada agora aceita NULL.');
    } else console.log('⏭️ canais.mensagem_entrada já aceita NULL.');

    const [idx] = await conn.execute(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'canais' AND INDEX_NAME = 'uniq_evento'`,
      [dbConfig.database]
    );
    if (idx.length === 0) {
      // Um evento tem no máximo um canal (senão não dá para saber qual origem atribuir).
      await conn.execute('ALTER TABLE canais ADD UNIQUE KEY uniq_evento (evento)');
      console.log('✅ Índice único canais(evento) adicionado.');
    } else console.log('⏭️ Índice uniq_evento já existe.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ Migração canais.evento:', e.message); process.exit(1); });
}

module.exports = { migrar };
