#!/usr/bin/env bash
#
# Provisiona uma nova empresa (instância completa do bot) — Fase 1 do plano SaaS.
# Cria: pasta com o código (git clone), .env, banco de dados, tabelas/seeds e processo PM2.
#
# Uso (no servidor):
#   ./scripts/provisionar-empresa.sh <slug> <porta> [dir_base]
#   ex.: ./scripts/provisionar-empresa.sh hamburgueria-x 3090
#
# Requisitos: git, node/npm, pm2 e acesso ao MySQL do .env atual.
# O banco usa as credenciais DB_HOST/DB_USER/DB_PASSWORD do .env DESTA instalação;
# o database novo será pizzaria_<slug> (criado pelo run-setup).
#
set -euo pipefail

SLUG="${1:-}"
PORTA="${2:-}"
DIR_BASE="${3:-$(cd "$(dirname "$0")/../.." && pwd)}"

if [[ -z "$SLUG" || -z "$PORTA" ]]; then
  echo "Uso: $0 <slug> <porta> [dir_base]"
  echo "ex.: $0 hamburgueria-x 3090"
  exit 1
fi

if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]]; then
  echo "❌ slug inválido: use minúsculas, números e hífen (ex.: pizzaria-centro)"
  exit 1
fi

if ! [[ "$PORTA" =~ ^[0-9]{4,5}$ ]]; then
  echo "❌ porta inválida: $PORTA"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="$DIR_BASE/bot-$SLUG"
PM2_NAME="bot-$SLUG"
DB_NAME="pizzaria_$(echo "$SLUG" | tr '-' '_')"

# Porta já em uso?
if command -v ss >/dev/null && ss -tln | grep -q ":$PORTA "; then
  echo "❌ Porta $PORTA já está em uso neste servidor."
  exit 1
fi

if [[ -e "$DESTINO" ]]; then
  echo "❌ Pasta já existe: $DESTINO"
  exit 1
fi

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  echo "❌ Processo PM2 '$PM2_NAME' já existe."
  exit 1
fi

# Credenciais de banco vêm do .env da instalação atual
ENV_ATUAL="$REPO_DIR/.env"
if [[ ! -f "$ENV_ATUAL" ]]; then
  echo "❌ .env não encontrado em $REPO_DIR (necessário para credenciais de banco)"
  exit 1
fi
getenv() { grep -m1 -oP "^$1=\K.*" "$ENV_ATUAL" | tr -d '\r' || true; }
DB_HOST="$(getenv DB_HOST)"; DB_HOST="${DB_HOST:-localhost}"
DB_PORT="$(getenv DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
DB_USER="$(getenv DB_USER)"
DB_PASSWORD="$(getenv DB_PASSWORD)"

if [[ -z "$DB_USER" ]]; then
  echo "❌ DB_USER ausente no .env atual"
  exit 1
fi

ADMIN_TOKEN_NOVO="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"

echo "🏗️  Provisionando empresa '$SLUG'"
echo "    Pasta:    $DESTINO"
echo "    Porta:    $PORTA"
echo "    Banco:    $DB_NAME @ $DB_HOST"
echo "    PM2:      $PM2_NAME"
echo

# 1. Código (clone local — mesmo commit da instalação atual)
git clone --quiet "$REPO_DIR" "$DESTINO"
echo "✅ Código clonado"

# 2. .env da nova instância
cat > "$DESTINO/.env" <<EOF
# Instância: $SLUG — gerada por provisionar-empresa.sh em $(date '+%Y-%m-%d %H:%M')
PORT=$PORTA
PM2_APP_NAME=$PM2_NAME

DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME

ADMIN_TOKEN=$ADMIN_TOKEN_NOVO

QWEN_API_KEY=$(getenv QWEN_API_KEY)
OPENROUTER_API_KEY=$(getenv OPENROUTER_API_KEY)

WA_SESSION_ID=empresa-$SLUG
EOF

# Motor WhatsApp: se a instalação base usa Evolution, a nova empresa nasce nela também
EVO_URL="$(getenv EVOLUTION_URL)"
EVO_APIKEY="$(getenv EVOLUTION_APIKEY)"
EVO_PUBLIC_BASE="$(getenv EVOLUTION_PUBLIC_URL)"
if [[ -n "$EVO_URL" && -n "$EVO_APIKEY" ]]; then
  EVO_INSTANCIA="empresa-$SLUG"
  WEBHOOK_SECRET="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  PUBLIC_HOST="$(echo "$EVO_PUBLIC_BASE" | sed -E 's#^(https?://[^:/]+).*#\1#')"
  [[ -z "$PUBLIC_HOST" ]] && PUBLIC_HOST="http://localhost"

  cat >> "$DESTINO/.env" <<EOF

WA_ENGINE=evolution
EVOLUTION_URL=$EVO_URL
EVOLUTION_APIKEY=$EVO_APIKEY
EVOLUTION_INSTANCE=$EVO_INSTANCIA
EVOLUTION_WEBHOOK_SECRET=$WEBHOOK_SECRET
EVOLUTION_PUBLIC_URL=$PUBLIC_HOST:$PORTA
EOF

  # Cria a instância na Evolution (se já existir, segue em frente)
  HTTP_CODE=$(curl -s -o /tmp/evo-create-$SLUG.json -w "%{http_code}" -X POST "$EVO_URL/instance/create" \
    -H "apikey: $EVO_APIKEY" -H "Content-Type: application/json" \
    -d "{\"instanceName\":\"$EVO_INSTANCIA\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}")
  if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
    echo "✅ Instância Evolution criada: $EVO_INSTANCIA"
  elif grep -q "already in use\|already exists" /tmp/evo-create-$SLUG.json 2>/dev/null; then
    echo "⏭️ Instância Evolution já existia: $EVO_INSTANCIA"
  else
    echo "⚠️ Evolution instance/create HTTP $HTTP_CODE — verifique depois: $(head -c 200 /tmp/evo-create-$SLUG.json)"
  fi
  echo "EVOLUTION_INSTANCE: $EVO_INSTANCIA"
else
  echo "⚠️ Base sem EVOLUTION_URL/APIKEY — nova empresa usará motor wwebjs"
fi

echo "✅ .env criado (ADMIN_TOKEN gerado automaticamente)"

# 3. Dependências + banco + migrações + PM2 (run-setup faz tudo lendo o .env novo)
echo "📦 Rodando setup completo (npm install + banco + migrações + PM2)..."
(cd "$DESTINO" && node run-setup.js)
echo "✅ Instância '$PM2_NAME' instalada e no PM2"

# 4. Empresa-modelo (opcional): copia prompts, fluxos, requisições e cardápio
if [[ -n "${MODELO_DIR:-}" ]]; then
  echo "🎨 Aplicando empresa-modelo: $MODELO_DIR"
  node "$DESTINO/scripts/copiar-modelo.js" "$MODELO_DIR" "$DESTINO"
  pm2 restart "$PM2_NAME" >/dev/null 2>&1 || true
  echo "✅ Modelo aplicado e instância reiniciada"
fi

echo
echo "🎉 Empresa '$SLUG' provisionada!"
echo "─────────────────────────────────────────────"
echo "Dashboard:   http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORTA/dashboard.html"
echo "ADMIN_TOKEN: $ADMIN_TOKEN_NOVO"
echo "Health:      http://localhost:$PORTA/health"
echo "─────────────────────────────────────────────"
echo "Próximos passos:"
echo "  1. Abra o dashboard, entre com o token acima"
echo "  2. Aba Whats → escaneie o QR com o número DA EMPRESA"
echo "  3. Configure prompts/cardápio em ia-config.html"
echo "  4. (Opcional) monitor: cd $DESTINO && pm2 start scripts/monitor-health.js --name monitor-$SLUG"
