# Primeiro acesso: setup do banco + migrações + sobe no PM2 com nome da empresa.
# Uso: preencha o .env (PORT, DB_*, PM2_APP_NAME) e rode: .\setup.ps1
# Se der erro de política: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .env)) {
  Write-Host "Arquivo .env nao encontrado. Copie .env.example para .env e preencha." -ForegroundColor Red
  exit 1
}

$envLines = Get-Content .env -Raw
$pm2Name = ($envLines -split "`n" | Where-Object { $_ -match '^\s*PM2_APP_NAME\s*=' } | ForEach-Object { ($_ -split '=', 2)[1].Trim().Trim('"').Trim() })
if (-not $pm2Name) { $pm2Name = "pizzaria-bot" }

Write-Host "Instalando dependencias (npm install)..."
npm install --silent

Write-Host ""
Write-Host "Criando database (se nao existir)..."
node database/create-database.js

Write-Host ""
Write-Host "Rodando setup do banco (tabelas + seeds)..."
node database/setup.js

Write-Host ""
Write-Host "Migracoes: indicacoes..."
node database/migrations/indicacoes.js

Write-Host ""
Write-Host "Migracoes: metas..."
node database/migrations/metas.js

Write-Host ""
Write-Host "PM2: iniciando/reiniciando app com nome '$pm2Name'..."
$describe = pm2 describe $pm2Name 2>&1
if ($LASTEXITCODE -eq 0) {
  pm2 restart $pm2Name
  Write-Host "   Reiniciado."
} else {
  pm2 start BotIApizzaria.js --name $pm2Name
  Write-Host "   Iniciado."
}

pm2 save 2>$null
$portLine = Get-Content .env | Where-Object { $_ -match '^\s*PORT\s*=' }
$port = if ($portLine) { ($portLine -split '=', 2)[1].Trim() } else { "3007" }
Write-Host ""
Write-Host "Pronto. Dashboard: http://localhost:$port/dashboard.html" -ForegroundColor Green
Write-Host "   Comandos: pm2 status | pm2 logs $pm2Name | pm2 stop $pm2Name"
