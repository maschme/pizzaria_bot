#!/usr/bin/env node
'use strict';
/**
 * Primeiro acesso: setup do banco + migrações + sobe no PM2.
 * Uso: preencha o .env (PORT, DB_*, PM2_APP_NAME) e rode: node run-setup.js
 * Ou: npm run setup:first
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname);

if (!fs.existsSync(path.join(root, '.env'))) {
  console.error('❌ Arquivo .env não encontrado. Copie .env.example para .env e preencha.');
  process.exit(1);
}

const pm2Name = process.env.PM2_APP_NAME || 'pizzaria-bot';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: true, ...opts });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('📦 Instalando dependências (npm install)...');
run('npm', ['install', '--silent']);

console.log('\n🗄️ Criando database (se não existir)...');
run('node', ['database/create-database.js']);

console.log('\n🗄️ Rodando setup do banco (tabelas + seeds)...');
run('node', ['database/setup.js']);

console.log('\n📋 Migrações: indicacoes...');
run('node', ['database/migrations/indicacoes.js']);

console.log('\n📋 Migrações: metas...');
run('node', ['database/migrations/metas.js']);

console.log('\n🚀 PM2: iniciando/reiniciando app com nome "' + pm2Name + '"...');
const hasPm2 = spawnSync('pm2', ['describe', pm2Name], { cwd: root, shell: true }).status === 0;
if (hasPm2) {
  spawnSync('pm2', ['restart', pm2Name], { stdio: 'inherit', cwd: root, shell: true });
  console.log('   Reiniciado.');
} else {
  spawnSync('pm2', ['start', 'BotIApizzaria.js', '--name', pm2Name], { stdio: 'inherit', cwd: root, shell: true });
  console.log('   Iniciado.');
}
spawnSync('pm2', ['save'], { cwd: root, shell: true });

const port = process.env.PORT || process.env.APP_PORT || '3007';
console.log('\n✅ Pronto. Dashboard: http://localhost:' + port + '/dashboard.html');
console.log('   Comandos: pm2 status | pm2 logs ' + pm2Name + ' | pm2 stop ' + pm2Name);
