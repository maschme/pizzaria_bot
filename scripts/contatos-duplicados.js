'use strict';

/**
 * Encontra contatos que são a MESMA pessoa gravada em formatos diferentes do número
 * (com e sem o 9º dígito). Ver docs/22-padronizacao-numero.md.
 *
 * A partir de 22/09/2026 o sistema grava no formato em que o contato já existe, então duplicatas
 * novas não aparecem. Este script serve para ver o que ficou de antes.
 *
 * Uso:
 *   node scripts/contatos-duplicados.js
 *
 * SOMENTE LEITURA: não altera nem apaga nada. A fusão, se você quiser fazer, é manual e decidida
 * caso a caso — cada lado pode ter histórico, metas e origem de canal diferentes.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('../services/telefoneService');

(async () => {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });

  try {
    const [contatos] = await conn.execute(
      'SELECT id, whatsapp_id, nome, canal_id, opt_out, created_at FROM contatos ORDER BY id');

    // Agrupa pela forma curta: as duas variantes do mesmo número caem no mesmo balde.
    const baldes = new Map();
    for (const c of contatos) {
      const vars = telefone.variantes(c.whatsapp_id);
      if (!vars.length) continue;
      const chave = vars[vars.length - 1]; // a mais curta das variantes
      if (!baldes.has(chave)) baldes.set(chave, []);
      baldes.get(chave).push(c);
    }

    const duplicados = [...baldes.values()].filter((g) => g.length > 1);
    console.log(`\n${contatos.length} contatos no total.`);
    if (!duplicados.length) {
      console.log('Nenhuma duplicata por formato do número.\n');
      return;
    }

    console.log(`${duplicados.length} número(s) gravado(s) em mais de um formato:\n`);
    for (const grupo of duplicados) {
      console.log('  ---');
      for (const c of grupo) {
        const marcas = [];
        if (c.canal_id) marcas.push(`canal #${c.canal_id}`);
        if (c.opt_out) marcas.push('opt-out');
        const [[m]] = await conn.execute(
          'SELECT COUNT(*) AS n FROM contato_metas WHERE whatsapp_id = ? AND concluido = 1', [c.whatsapp_id]);
        if (m.n) marcas.push(`${m.n} meta(s)`);
        const [[l]] = await conn.execute(
          'SELECT COUNT(*) AS n FROM fluxo_exec_logs WHERE whatsapp_id = ?', [c.whatsapp_id]);
        if (l.n) marcas.push(`${l.n} registro(s) de fluxo`);
        console.log(`  id=${c.id}  ${c.whatsapp_id}  ${c.nome || '(sem nome)'}`
          + `  criado ${new Date(c.created_at).toLocaleDateString('pt-BR')}`
          + (marcas.length ? `  [${marcas.join(', ')}]` : '  [sem histórico]'));
      }
    }

    console.log('\nO sistema já encontra o contato nas duas formas, então isto não quebra nada.');
    console.log('Se quiser unificar, comece pelos que aparecem como "sem histórico": são os seguros de apagar.');
    console.log('Apague sempre por id exato.\n');
  } finally {
    await conn.end();
  }
})().then(() => process.exit(0)).catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
