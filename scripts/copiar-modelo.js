'use strict';

/**
 * Copia a CONFIGURAÇÃO de uma empresa-modelo para uma instância recém-provisionada:
 *   - Tabelas de configuração: configuracoes, prompts, provedores_ia,
 *     requisicoes_externas, fluxos, gatilhos (substitui os seeds padrão)
 *   - Pasta arquivos/ (cardápio em JSON)
 * NÃO copia dados operacionais (contatos, indicações, pedidos, grupos, chats, logs).
 *
 * Uso: node scripts/copiar-modelo.js <dir_modelo> <dir_destino>
 * Os dois diretórios precisam ter .env com DB_NAME (mesmo servidor MySQL).
 * Após copiar, reinicie a instância destino (pm2 restart) para recarregar caches.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const TABELAS_CONFIG = [
  'configuracoes',
  'prompts',
  'provedores_ia',
  'requisicoes_externas',
  'fluxos',
  'gatilhos'
];

function lerEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) throw new Error(`.env não encontrado em ${dir}`);
  const out = {};
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function main() {
  const [dirModelo, dirDestino] = process.argv.slice(2).map((d) => d && path.resolve(d));
  if (!dirModelo || !dirDestino) {
    console.error('Uso: node scripts/copiar-modelo.js <dir_modelo> <dir_destino>');
    process.exit(1);
  }
  if (dirModelo === dirDestino) throw new Error('Modelo e destino são a mesma pasta');

  const envModelo = lerEnv(dirModelo);
  const envDestino = lerEnv(dirDestino);
  const dbModelo = envModelo.DB_NAME;
  const dbDestino = envDestino.DB_NAME;
  if (!dbModelo || !dbDestino) throw new Error('DB_NAME ausente em um dos .env');
  if (dbModelo === dbDestino) throw new Error('Modelo e destino usam o MESMO banco — abortando');

  console.log(`📋 Copiando configuração: ${dbModelo} → ${dbDestino}`);

  const conn = await mysql.createConnection({
    host: envDestino.DB_HOST || 'localhost',
    port: parseInt(envDestino.DB_PORT, 10) || 3306,
    user: envDestino.DB_USER,
    password: envDestino.DB_PASSWORD,
    multipleStatements: false
  });

  try {
    for (const tabela of TABELAS_CONFIG) {
      try {
        // Confere se a tabela existe nos dois bancos
        const [existeM] = await conn.query(
          `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
          [dbModelo, tabela]
        );
        const [existeD] = await conn.query(
          `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
          [dbDestino, tabela]
        );
        if (!existeM.length || !existeD.length) {
          console.log(`⏭️  ${tabela}: ausente em um dos bancos — pulando`);
          continue;
        }

        await conn.query(`DELETE FROM \`${dbDestino}\`.\`${tabela}\``);
        const [r] = await conn.query(
          `INSERT INTO \`${dbDestino}\`.\`${tabela}\` SELECT * FROM \`${dbModelo}\`.\`${tabela}\``
        );
        console.log(`✅ ${tabela}: ${r.affectedRows} registro(s) copiado(s)`);
      } catch (e) {
        console.warn(`⚠️  ${tabela}: ${e.message}`);
      }
    }
  } finally {
    await conn.end();
  }

  // arquivos/ (cardápio)
  const arqModelo = path.join(dirModelo, 'arquivos');
  const arqDestino = path.join(dirDestino, 'arquivos');
  if (fs.existsSync(arqModelo)) {
    fs.cpSync(arqModelo, arqDestino, { recursive: true, force: true });
    const qtd = fs.readdirSync(arqModelo).length;
    console.log(`✅ arquivos/: ${qtd} item(ns) copiado(s)`);
  }

  console.log('✨ Modelo aplicado. Reinicie a instância destino para recarregar (pm2 restart).');
}

main().catch((e) => {
  console.error('❌ copiar-modelo:', e.message);
  process.exit(1);
});
