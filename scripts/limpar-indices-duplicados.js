'use strict';

/**
 * Remove índices repetidos criados pelo antigo `sequelize.sync({ alter: true })`.
 *
 * O `alter` não reconhecia o índice único que ele mesmo havia criado e adicionava outro a cada
 * arranque do processo: `chave`, `chave_2`, `chave_3`… Como MySQL e MariaDB aceitam no máximo 64
 * índices por tabela, depois de algumas dezenas de reinícios o setup passava a falhar com
 * "Too many keys specified" e o servidor não subia.
 *
 * O que este script faz: agrupa os índices de cada tabela pelo conjunto exato de colunas, mantém
 * UM de cada grupo e remove os demais. Não toca na PRIMARY KEY, não remove índice que seja o único
 * do seu grupo e não altera dado nenhum.
 *
 * Uso:
 *   node scripts/limpar-indices-duplicados.js              # só mostra o que faria
 *   node scripts/limpar-indices-duplicados.js --aplicar    # executa
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');

const aplicar = process.argv.includes('--aplicar');

/** Qual índice do grupo fica: o de nome mais curto e, empatando, o primeiro em ordem alfabética. */
function escolherMantido(nomes) {
  return [...nomes].sort((a, b) => (a.length - b.length) || a.localeCompare(b))[0];
}

(async () => {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });

  try {
    const [tabelas] = await conn.execute(
      'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = "BASE TABLE" ORDER BY TABLE_NAME',
      [dbConfig.database]
    );

    let totalRemover = 0;
    let totalRemovidos = 0;
    const falhas = [];

    for (const { t } of tabelas) {
      const [idx] = await conn.execute(
        `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [dbConfig.database, t]
      );
      if (!idx.length) continue;

      // Monta a assinatura de cada índice: unicidade + colunas na ordem.
      const porNome = new Map();
      for (const r of idx) {
        if (!porNome.has(r.INDEX_NAME)) porNome.set(r.INDEX_NAME, { unico: r.NON_UNIQUE === 0, cols: [] });
        porNome.get(r.INDEX_NAME).cols.push(r.COLUMN_NAME);
      }

      const grupos = new Map();
      for (const [nome, info] of porNome) {
        if (nome === 'PRIMARY') continue;
        const assinatura = `${info.unico ? 'U' : 'I'}:${info.cols.join(',')}`;
        if (!grupos.has(assinatura)) grupos.set(assinatura, []);
        grupos.get(assinatura).push(nome);
      }

      const totalIndices = porNome.size;
      const repetidos = [...grupos.entries()].filter(([, nomes]) => nomes.length > 1);
      if (!repetidos.length) continue;

      console.log(`\n${t}  (${totalIndices} índices${totalIndices > 50 ? ' — PERTO DO LIMITE DE 64' : ''})`);
      for (const [assinatura, nomes] of repetidos) {
        const manter = escolherMantido(nomes);
        const remover = nomes.filter((n) => n !== manter);
        totalRemover += remover.length;
        console.log(`  ${assinatura}: ${nomes.length} cópias, mantém "${manter}", remove ${remover.length}`);

        if (!aplicar) continue;
        for (const nome of remover) {
          try {
            await conn.query(`ALTER TABLE \`${t}\` DROP INDEX \`${nome}\``);
            totalRemovidos++;
          } catch (e) {
            falhas.push(`${t}.${nome}: ${e.message}`);
          }
        }
      }
    }

    console.log('');
    if (!totalRemover) {
      console.log('Nenhum índice repetido. Nada a fazer.\n');
      return;
    }
    if (aplicar) {
      console.log(`${totalRemovidos} índice(s) removido(s) de ${totalRemover} previsto(s).`);
      if (falhas.length) {
        console.log('\nNão foi possível remover:');
        for (const f of falhas) console.log('  ' + f);
      }
      console.log('');
    } else {
      console.log(`${totalRemover} índice(s) repetido(s) encontrado(s). Nada foi alterado.`);
      console.log('Para executar: node scripts/limpar-indices-duplicados.js --aplicar\n');
    }
  } finally {
    await conn.end();
  }
})().then(() => process.exit(0)).catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
