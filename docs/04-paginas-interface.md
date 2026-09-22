# Páginas e Interface

Todas as páginas ficam em `public/` e são servidas estaticamente pelo Express na raiz (`/`). Estilos e scripts estão **inline** nos HTML — não há arquivos `.css` ou `.js` separados.

**URL base:** `http://localhost:3007` (configurável via `PORT`)

---

## Índice de páginas

| Página | URL | Arquivo | Propósito |
|--------|-----|---------|-----------|
| Dashboard | `/dashboard.html` | `public/dashboard.html` | Painel operacional principal |
| Editor de Fluxos | `/fluxos.html` | `public/fluxos.html` | Fluxos conversacionais WhatsApp |
| Automações | `/automacoes.html` | `public/automacoes.html` | Automações HTTP desacopladas |
| Configuração IA | `/ia-config.html` | `public/ia-config.html` | Prompts, provedores, cardápio |

---

## 1. Dashboard (`dashboard.html`)

Layout com **sidebar fixa** + área de conteúdo. Navegação interna via atributo `data-view` (SPA-like, sem recarregar página).

### Sidebar — links principais

| Item | `data-view` | Seção |
|------|-------------|-------|
| Dashboard | `dashboard` | KPIs e gráficos |
| Whats | `whats` | Conexão WhatsApp + operação |
| Contatos | `contatos` | CRM parcial + logs |
| Integrações | `integracoes` | Liga/desliga e estado das integrações externas (Multipedidos) |

### Links externos (topbar/sidebar)

- **Fluxos** → `/fluxos.html`
- **Automações** → `/automacoes.html`
- **IA Config** → `/ia-config.html`

---

### View: Dashboard (`viewDashboard`)

**Função:** visão geral do sistema em tempo real.

| Elemento | Descrição |
|----------|-----------|
| Cards de status | Atendimento automático, campanha, WhatsApp conectado |
| Gráfico "Grupos por status" | Chart.js — grupos ativos/inativos |
| Resumo do sistema | Estatísticas de gatilhos e grupos |

**APIs consumidas:** `GET /api/dashboard/status`, `GET /whatsapp/status`

---

### View: Whats (`viewWhats`)

**Função:** gerenciar conexão WhatsApp, grupos, gatilhos e configurações.

#### Painel de conexão

| Estado | Exibição |
|--------|----------|
| Desconectado | QR code (via `/whatsapp/qr-image`) |
| Conectado | Nome do bot + ícone de sucesso |

#### Aba: Grupos (`#tabGrupos`)

| Ação | Função |
|------|--------|
| Sincronizar | Busca grupos do WhatsApp client → salva no DB |
| Ativar/Desativar | Controla se grupo participa da campanha |
| Definir Geral | Marca grupo fallback quando bairro não encontrado |
| Editar link | Define link de convite por grupo |

**Colunas da tabela:** Nome, Bairro, Participantes, Tipo, Status, Ações

#### Aba: Gatilhos (`#tabGatilhos`)

| Ação | Função |
|------|--------|
| Novo Gatilho | Modal de criação |
| Ativar/Desativar | Toggle por gatilho |
| Editar/Excluir | CRUD completo |

Gatilhos definem palavras-chave ou mensagem exata que disparam fluxos ou campanha.

#### Aba: Configurações (`#tabConfigs`)

Formulário agrupado por **categoria** (atendimento, campanha, horário, mensagens). Cada config tem chave, valor, tipo e descrição.

---

### View: Contatos (`viewContatos`)

**Função:** listar contatos CRM e auditar execução de fluxos.

| Coluna | Descrição |
|--------|-----------|
| WhatsApp ID | Número normalizado (só dígitos) |
| Nome | Nome do contato |
| Grupo (cam_grupo) | Missão 1 concluída |
| Indicações | Quantidade e status campanha |
| Ações | Ver logs / Deletar contato |

**Modal de logs:** histórico de `fluxo_exec_logs` por contato.

### View: Canais (`viewCanais`)

CRUD de canais de aquisição ([doc 16](./16-canais-e-funil.md)): nome, tipo, mensagem de entrada (texto do link/QR), **fluxo que inicia** (select com os fluxos ativos; "nenhum" = só rastrear origem — [doc 20](./20-modelos-e-fluxos-completos.md) A0), ativo. Lista com a coluna **Fluxo** (selo "fluxo inativo" quando o apontado foi desativado), contagem de contatos, link/QR para impressão.

### View: Integrações (`viewIntegracoes`)

**Função:** ligar/desligar integrações com sistemas externos e ver o estado delas. Hoje: **Multipedidos** ([doc 18](./18-cupons-multipedidos.md) §1).

| Bloco | Conteúdo |
|-------|----------|
| Webhook | Interruptor; selos "segredo da URL" / "access_token" (configurados no `.env`?); último evento, total 24 h; botão **Copiar URL** (busca a URL completa, com o segredo, só no clique) |
| API | Interruptor; selo "token de integração"; **Testar conexão** (login só-leitura); último login e nº do restaurante |
| Limites de segurança dos cupons | Desconto máx. (%), desconto fixo máx. (R$), validade máx. (dias), prefixo do código |

Segredos nunca aparecem na tela (ficam no `.env`). Interruptor que não pode ser ligado (segredo/token ausente) volta para desligado com o motivo no aviso.

---

## 2. Editor de Fluxos (`fluxos.html`)

**Função:** criar e editar fluxos conversacionais executados no WhatsApp.

### Toolbar

| Botão | Função |
|-------|--------|
| Novo fluxo | Cria fluxo vazio |
| Criar exemplo | Fluxo de demonstração |
| Exportar | Download JSON |
| Importar | Upload JSON |
| Salvar | Persiste no banco |
| Ativar/Desativar | Toggle execução |

### Paleta de componentes (nós)

| Nó | Tipo | Função |
|----|------|--------|
| Gatilho | `trigger` | Palavra-chave ou mensagem exata |
| Mensagem | `message` | Envia texto WhatsApp |
| Aguardar | `wait` | Espera resposta do usuário |
| Aguardar contatos | `wait_contacts` | Espera vCards (indicações) |
| Condição | `condition` | Branch sobre resposta |
| Verificar variável | `condition_var` | Branch sobre variável |
| IA | `ia` | Chamada IA com prompt |
| Ação | `action` | Requisição, variável, meta, webhook, cupom |
| Fim | `end` | Encerra fluxo |

### Painel lateral

- **Meus Fluxos** — lista fluxos salvos (filtro por tipo)
- **Propriedades** — edita nó selecionado
- **Zoom** — controles de zoom e centralização

### Tipos de fluxo (`tipo`)

`atendimento` | `campanha` | `automacao` | `suporte`

> Fluxos conversacionais usam tipos `atendimento`, `campanha` ou `suporte`. Tipo `automacao` vai para o editor de automações.

---

## 3. Automações (`automacoes.html`)

**Função:** fluxos HTTP independentes do chat WhatsApp.

### Toolbar

| Botão | Função |
|-------|--------|
| Criar exemplo | Automação webhook de demonstração |
| Exportar/Importar | JSON |
| Executar | `POST /api/fluxos/:id/run` |
| Salvar / Ativar | Persistência |

### Paleta de nós

| Nó | Tipo | Função |
|----|------|--------|
| Webhook | `trigger_webhook` | Entrada HTTP POST |
| Agendamento | `trigger_schedule` | Entrada por cron (estrutura) |
| Condição | `condition` | Branch lógico |
| Definir variável | `set_variable` | Atribui valor |
| HTTP | `http_request` | Requisição externa |
| IA | `ia` | Processamento IA |
| Merge | `merge` | Junta ramos |
| Log | `log` | Registro de execução |
| Atraso | `sleep` | Pausa em segundos |
| Fim | `end` | Encerra |

### Disparo

- **Webhook:** `POST /api/fluxos/:id/webhook` (body = payload)
- **Manual:** botão Executar ou `POST /api/fluxos/:id/run`

---

## 4. Configuração IA (`ia-config.html`)

**Função:** central de inteligência artificial e dados de cardápio.

### Abas

| Aba | Função |
|-----|--------|
| **Prompts** | CRUD de prompts de sistema e atendimento |
| **Provedores** | CRUD de APIs de IA (Qwen, OpenRouter, etc.) |
| **Requisições** | Handlers externos (IA, JSON, API, função) |
| **Arquivos** | Editor de JSONs do cardápio |
| **Teste IA** | Envia mensagem de teste ao provedor principal |

### Prompts — campos

- Nome (unique), descrição, tipo, conteúdo, variáveis, versão, ativo

### Provedores — campos

- Nome, baseUrl, apiKey, modeloPadrao, modelos[], isPrincipal

### Requisições — tipos de handler

| Handler | Uso |
|---------|-----|
| `ia` | IA analisa e responde (cardápio, taxa) |
| `json` | Lê arquivo de `arquivos/` |
| `api` | HTTP externo |
| `funcao` | Função JS registrada (ex.: `finalizarPedido`) |

---

## Navegação entre páginas

```
dashboard.html ──┬── fluxos.html
                 ├── automacoes.html
                 └── ia-config.html
```

Todas as páginas compartilham estilo visual (tema escuro, Bootstrap 5, Bootstrap Icons).

## Dependências CDN (frontend)

- Bootstrap 5.3 CSS/JS
- Bootstrap Icons
- Chart.js (apenas dashboard)
