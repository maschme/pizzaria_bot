#!/usr/bin/env bash
# Primeiro acesso: setup do banco + migrações + sobe no PM2 com nome da empresa.
# Uso: preencha o .env (PORT, DB_*, PM2_APP_NAME) e rode: ./setup.sh
# Linux/Mac/Git Bash. No Windows use: powershell -ExecutionPolicy Bypass -File setup.ps1

set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "❌ Arquivo .env não encontrado. Copie .env.example para .env e preencha."
  exit 1
fi

# Nome no PM2 (ex.: pizzaria-loja1). Sem espaços.
PM2_APP_NAME=$(grep -E '^PM2_APP_NAME=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r"' | xargs)
[ -z "$PM2_APP_NAME" ] && PM2_APP_NAME="pizzaria-bot"

echo "📦 Instalando dependências (npm install)..."
npm install --silent

echo ""
echo "🗄️ Criando database (se não existir)..."
node database/create-database.js

echo ""
echo "🗄️ Rodando setup do banco (tabelas + seeds)..."
node database/setup.js

echo ""
echo "📋 Migrações: indicacoes..."
node database/migrations/indicacoes.js

echo ""
echo "📋 Migrações: metas..."
node database/migrations/metas.js

echo ""
echo "🚀 PM2: iniciando/reiniciando app com nome \"$PM2_APP_NAME\"..."
if pm2 describe "$PM2_APP_NAME" &>/dev/null; then
  pm2 restart "$PM2_APP_NAME"
  echo "   Reiniciado."
else
  pm2 start BotIApizzaria.js --name "$PM2_APP_NAME"
  echo "   Iniciado."
fi

pm2 save 2>/dev/null || true
echo ""
echo "✅ Pronto. Dashboard: http://localhost:$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo '3007')/dashboard.html"
echo "   Comandos: pm2 status | pm2 logs $PM2_APP_NAME | pm2 stop $PM2_APP_NAME"
