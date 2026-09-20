# Referência da API

**Base URL:** `http://localhost:3007` (variável `PORT`)

**Formato de resposta padrão:**

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "mensagem" }
```

---

## Rotas raiz (`BotIApizzaria.js`)

### WhatsApp

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/whatsapp/status` | Status da conexão |
| GET | `/whatsapp/qr` | QR code (texto) |
| GET | `/whatsapp/qr-image` | QR code (PNG base64) |

### Mensagens

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| POST | `/send-message` | `{ number, message }` | Envia mensagem WhatsApp |

### Configuração runtime

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/config` | Config em memória |
| GET | `/config/status` | Status atendimento automático |
| POST | `/config/atendimento-automatico` | `{ ativo: boolean }` |

### Campanha (debug)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/campanha/sessoes` | Lista sessões em memória |
| GET | `/campanha/sessao/:numero` | Detalhe de uma sessão |
| DELETE | `/campanha/sessao/:numero` | Remove sessão (teste) |
| DELETE | `/campanha/sessoes` | Limpa todas |

### Webhook CRM

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/webhook/movimento` | Recebe movimentos CRM (stub/log) |

### Integração Multipedidos (estudo — [doc 17](./17-integracao-multipedidos.md))

| Método | Rota | Descrição |
|--------|------|-----------|
| ANY | `/webhook/multipedidos/:secret` | Público (segredo `MULTIPEDIDOS_WEBHOOK_SECRET` na URL). Grava a requisição crua em `webhook_eventos` e responde 200 |
| GET | `/api/integracoes/multipedidos/eventos` | Admin. Lista capturas (`?limite=`, `?corpo=1` inclui headers e corpo) |
| GET | `/api/integracoes/multipedidos/eventos/:id` | Admin. Captura completa |

---

## `/api/dashboard/*`

Router: `routes/dashboardRoutes.js`

### Status

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/dashboard/status` | Visão geral (atendimento, campanha, grupos, gatilhos, WhatsApp) |

### Configurações

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/dashboard/configuracoes` | Lista todas |
| GET | `/api/dashboard/configuracoes/categorias` | Categorias |
| GET | `/api/dashboard/configuracoes/categoria/:categoria` | Por categoria |
| GET | `/api/dashboard/configuracoes/:chave` | Por chave |
| PUT | `/api/dashboard/configuracoes/:chave` | Atualiza `{ valor }` |
| POST | `/api/dashboard/configuracoes` | Cria nova |

### Grupos WhatsApp

| Método | Rota | Query/Body | Descrição |
|--------|------|------------|-----------|
| GET | `/api/dashboard/grupos` | `?ativo&tipo&bairro` | Lista grupos |
| GET | `/api/dashboard/grupos/estatisticas` | — | Estatísticas |
| GET | `/api/dashboard/grupos/debug` | — | Debug grupos ativos |
| GET | `/api/dashboard/grupos/buscar/:bairro` | — | Busca por bairro |
| POST | `/api/dashboard/grupos/sincronizar` | — | Sync com WhatsApp |
| POST | `/api/dashboard/grupos/:grupoId/link` | `{ linkConvite }` | Define link |
| PUT | `/api/dashboard/grupos/:grupoId` | body parcial | Atualiza |
| POST | `/api/dashboard/grupos/:grupoId/ativar` | — | Ativa |
| POST | `/api/dashboard/grupos/:grupoId/desativar` | — | Desativa |
| POST | `/api/dashboard/grupos/:grupoId/definir-geral` | — | Marca como geral |

### Gatilhos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/dashboard/gatilhos` | Lista |
| POST | `/api/dashboard/gatilhos` | Cria |
| PUT | `/api/dashboard/gatilhos/:id` | Atualiza |
| POST | `/api/dashboard/gatilhos/:id/ativar` | Ativa |
| POST | `/api/dashboard/gatilhos/:id/desativar` | Desativa |
| DELETE | `/api/dashboard/gatilhos/:id` | Remove |

### Contatos

| Método | Rota | Query | Descrição |
|--------|------|-------|-----------|
| GET | `/api/dashboard/contatos` | `?page&limit&search` | Lista paginada |
| DELETE | `/api/dashboard/contatos/:whatsappId` | — | Remove + encerra fluxo |
| GET | `/api/dashboard/contatos/:whatsappId/logs` | `?limit` | Logs de fluxo |

---

## `/api/ia/*`

Router: `routes/iaRoutes.js`

### Prompts

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/ia/prompts` | Lista (`?tipo&ativo`) |
| GET | `/api/ia/prompts/:id` | Por ID |
| POST | `/api/ia/prompts` | Cria |
| PUT | `/api/ia/prompts/:id` | Atualiza |
| DELETE | `/api/ia/prompts/:id` | Remove |
| POST | `/api/ia/prompts/:id/duplicar` | `{ novoNome }` |

### Provedores IA

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/ia/provedores` | Lista |
| GET | `/api/ia/provedores/:id` | Por ID |
| POST | `/api/ia/provedores` | Cria |
| PUT | `/api/ia/provedores/:id` | Atualiza |
| DELETE | `/api/ia/provedores/:id` | Remove |
| POST | `/api/ia/provedores/:id/principal` | Define como principal |
| POST | `/api/ia/provedores/:id/testar` | Testa conexão |

### Requisições externas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/ia/requisicoes` | Lista |
| GET | `/api/ia/requisicoes/:id` | Por ID |
| POST | `/api/ia/requisicoes` | Cria |
| PUT | `/api/ia/requisicoes/:id` | Atualiza |
| DELETE | `/api/ia/requisicoes/:id` | Remove |
| POST | `/api/ia/requisicoes/executar` | `{ tipo, parametros }` |

### Arquivos JSON

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/ia/arquivos` | Lista arquivos |
| GET | `/api/ia/arquivos/:nome` | Conteúdo |
| POST | `/api/ia/arquivos` | Cria |
| PUT | `/api/ia/arquivos/:nome` | Atualiza conteúdo |
| PUT | `/api/ia/arquivos/:nome/meta` | Atualiza `_meta.json` |
| DELETE | `/api/ia/arquivos/:nome` | Remove |

### Teste

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| POST | `/api/ia/testar` | `{ mensagem, promptId?, provedorId? }` | Teste de IA |

---

## `/api/fluxos/*`

Router: `routes/fluxoRoutes.js`

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/fluxos` | Lista (`?tipo&ativo`) |
| GET | `/api/fluxos/:id` | Por ID |
| POST | `/api/fluxos` | Cria |
| PUT | `/api/fluxos/:id` | Atualiza |
| DELETE | `/api/fluxos/:id` | Remove |
| GET | `/api/fluxos/export/:id` | Download JSON |
| POST | `/api/fluxos/import` | Importa JSON |
| POST | `/api/fluxos/:id/duplicar` | Duplica |
| POST | `/api/fluxos/:id/ativar` | Ativa |
| POST | `/api/fluxos/:id/desativar` | Desativa (+ encerra sessões) |
| POST | `/api/fluxos/:id/webhook` | Executa automação (webhook) |
| POST | `/api/fluxos/:id/run` | Executa automação (manual) |

### Exemplo — webhook de automação

```bash
curl -X POST http://localhost:3007/api/fluxos/1/webhook \
  -H "Content-Type: application/json" \
  -d '{"pedido_id": 123, "status": "pronto"}'
```

Resposta:

```json
{
  "success": true,
  "data": {
    "variables": { "payload": { ... }, "response": "..." },
    "logs": [ { "nivel": "info", "mensagem": "..." } ]
  }
}
```

---

## Arquivos estáticos

Qualquer arquivo em `public/` é servido em `/`:

- `/dashboard.html`
- `/fluxos.html`
- `/automacoes.html`
- `/ia-config.html`
