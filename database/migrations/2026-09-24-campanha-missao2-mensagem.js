'use strict';

/**
 * Migração: a mensagem que entrega o cliente à Missão 2 da campanha vira configuração editável.
 *
 * O texto estava fixo no código, repetido em três pontos de `BotIApizzaria.js` (handoff do fluxo
 * visual, confirmação manual de entrada no grupo e detecção automática). Quem cuida do conteúdo não
 * conseguia mudar uma vírgula sem mexer no código, e mudar um ponto e esquecer os outros deixava o
 * cliente vendo textos diferentes para o mesmo momento.
 *
 * Variáveis do texto:
 *   {{desconto}}  desconto acumulado, em número (ex.: 10)
 *   {{contexto}}  frase curta de contexto, quando houver (ex.: "Vi que você entrou no grupo! ")
 *
 * Idempotente.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const CHAVE = 'campanha_missao2_mensagem';

const PADRAO = `🎉 *MISSÃO 1 CONCLUÍDA!* {{contexto}}🔥

✅ Você liberou *+10% de desconto*! (Total: *{{desconto}}%*)

🔥 *Quer chegar a 30%?* Envie *10 contatos* da sua agenda! Cada indicado ganha *10% de desconto* na 1ª compra.

*Como:* contato → ⋮ → Compartilhar contato → envie aqui. Pode enviar um por um ou vários. Meta: *10 indicações* 📇`;

async function migrar() {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });
  try {
    const [r] = await conn.execute('SELECT id FROM configuracoes WHERE chave = ? LIMIT 1', [CHAVE]);
    if (r.length) {
      console.log(`⏭️ Config ${CHAVE} já existe.`);
      return;
    }
    await conn.execute(
      `INSERT INTO configuracoes (chave, valor, tipo, categoria, descricao, createdAt, updatedAt)
       VALUES (?, ?, 'string', 'campanha', ?, NOW(), NOW())`,
      [CHAVE, PADRAO,
        'Campanha: mensagem que entrega o cliente à Missão 2 (indicações). Variáveis: {{desconto}}, {{contexto}}']
    );
    console.log(`✅ Config ${CHAVE} criada.`);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrar().then(() => process.exit(0)).catch((e) => {
    console.error('❌ Migração mensagem da Missão 2:', e.message);
    process.exit(1);
  });
}

module.exports = { migrar, CHAVE, PADRAO };
