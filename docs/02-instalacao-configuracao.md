# Instalação e Configuração

## Pré-requisitos

- Node.js 18+ (recomendado LTS)
- MySQL 5.7+ ou 8.x
- PM2 (opcional, para produção)
- Google Chrome/Chromium (usado pelo Puppeteer via whatsapp-web.js)

## Instalação

### Opção A — Setup completo (primeira instalação)

```bash
npm install
cp .env.example .env
# Edite .env
npm run setup:first
```

O script `run-setup.js` executa:
1. `npm install`
2. Criação do banco (`database/create-database.js`)
3. Sync de tabelas + seeds (`database/setup.js`)
4. Migrações (`indicacoes.js`, `metas.js`)
5. Inicia/reinicia via PM2

### Opção B — Setup manual

```bash
npm install
cp .env.example .env
node database/create-database.js
npm run setup
npm start
```

### Scripts de sistema

| Script | Plataforma | Função |
|--------|------------|--------|
| `setup.ps1` | Windows | Wrapper PowerShell para setup + PM2 |
| `setup.sh` | Linux/macOS | Wrapper bash para setup + PM2 |

## Variáveis de ambiente (`.env`)

```env
PORT=3007
PM2_APP_NAME=pizzaria-bot

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=pizzaria
```

### Multi-instância (várias empresas)

Cada instância usa valores **diferentes** para:

| Variável | Exemplo loja 1 | Exemplo loja 2 |
|----------|----------------|----------------|
| `PORT` | 3007 | 3008 |
| `DB_NAME` | pizzaria_loja1 | pizzaria_loja2 |
| `PM2_APP_NAME` | pizzaria-loja1 | pizzaria-loja2 |

Um processo PM2 = uma sessão WhatsApp = um banco.

## Scripts npm

| Comando | Descrição |
|---------|-----------|
| `npm start` | Inicia `BotIApizzaria.js` |
| `npm run setup` | Sync tabelas + seeds no banco |
| `npm run setup:first` | Setup completo + PM2 |

## Conexão WhatsApp

1. Inicie o bot: `npm start`
2. Escaneie o QR code no terminal ou acesse `/dashboard.html` → view Whats
3. Sessão persistida em `.wwebjs_auth/` (gitignored)

## Configurações do sistema (banco)

Inseridas automaticamente pelo `database/setup.js`:

| Chave | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `atendimento_automatico` | boolean | `false` | Liga/desliga IA |
| `delay_resposta_ms` | number | `10000` | Delay antes de processar |
| `debounce_mensagens_ms` | number | `10000` | Agrupa mensagens rápidas |
| `campanha_ativa` | boolean | `true` | Campanha de desconto |
| `campanha_desconto_missao1/2/3` | number | `10` | % por missão |
| `horario_funcionamento_inicio` | string | `18:00` | Abertura |
| `horario_funcionamento_fim` | string | `23:30` | Fechamento |
| `mensagem_fora_horario` | string | (texto) | Resposta fora do horário |

Editáveis via dashboard (Whats → Configurações) ou API `/api/dashboard/configuracoes/:chave`.

## Provedores IA (seeds)

O setup insere dois provedores padrão:

- **qwen-alibaba** (principal) — Qwen Plus via Alibaba Cloud
- **openrouter-claude** — Claude via OpenRouter

> **Importante:** substitua as API keys dos seeds por chaves próprias em produção.

## Arquivos de dados (cardápio)

Pasta `arquivos/` — JSONs consumidos por requisições externas e fluxos:

- `bairros.json`, `bordas.json`, `bebidas.json`
- `sabores_*.json`, `cupons_desconto.json`
- `grupos_whatsapp.json` (fallback se DB vazio)
- `Cardapio Completo.json`

Editáveis também via `/ia-config.html` → aba Arquivos.

## Utilitários

| Script | Uso |
|--------|-----|
| `teste-webhook.js` | Testa webhook de automação via CLI |
| `scripts/reclassificar-fluxos.js` | Utilitário admin de fluxos |
