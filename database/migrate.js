'use strict';

/**
 * Runner de migrações versionadas.
 * Aplica, em ordem alfabética de arquivo, cada script de database/migrations/
 * que ainda não consta na tabela schema_migrations — e registra os aplicados.
 *
 * Uso:  node database/migrate.js          (aplica pendentes)
 *       node database/migrate.js --status (só lista o estado)
 *
 * Regras para novas migrações:
 *  - Nome com prefixo de data para ordenar: 2026-09-20-minha-mudanca.js
 *    Atenção: a ordem é a do nome INTEIRO, e "-" vem antes de "." — "x-cupons-desconto.js" roda ANTES de
 *    "x-cupons.js". Migração que depende de outra do mesmo dia deve levar data (ou sufixo numérico) maior.
 *  - Idempotentes (CREATE TABLE IF NOT EXISTS / checar coluna antes de ADD),
 *    pois instalações antigas podem já ter o schema aplicado manualmente.
 *  - Executáveis standalone: process.exit(0) no sucesso, !=0 no erro.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const { dbConfig } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function main() {
  const somenteStatus = process.argv.includes('--status');

  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port || 3306,
    user: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.database
  });

  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(255) NOT NULL UNIQUE,
        aplicado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [rows] = await conn.execute('SELECT nome FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nome));

    const arquivos = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.js'))
      .sort();

    const pendentes = arquivos.filter((f) => !aplicadas.has(f));

    console.log(`📋 Migrações: ${arquivos.length} no diretório | ${aplicadas.size} aplicadas | ${pendentes.length} pendentes`);
    for (const f of arquivos) {
      console.log(`   ${aplicadas.has(f) ? '✅' : '⏳'} ${f}`);
    }

    if (somenteStatus || pendentes.length === 0) {
      if (!somenteStatus) console.log('✨ Nada a aplicar.');
      return;
    }

    for (const arquivo of pendentes) {
      console.log(`\n▶️  Aplicando ${arquivo}...`);
      const r = spawnSync(process.execPath, [path.join(MIGRATIONS_DIR, arquivo)], {
        stdio: 'inherit',
        env: process.env
      });
      if (r.status !== 0) {
        throw new Error(`Migração ${arquivo} falhou (exit ${r.status}). Interrompendo — nada após ela foi aplicado.`);
      }
      await conn.execute('INSERT INTO schema_migrations (nome) VALUES (?)', [arquivo]);
      console.log(`✅ ${arquivo} registrada.`);
    }

    console.log(`\n✨ ${pendentes.length} migração(ões) aplicada(s) com sucesso.`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('❌ migrate:', e.message);
  process.exit(1);
});
