# Resumo do Projeto

## O que é

O **Pizzaria Bot** é uma plataforma de atendimento automatizado via **WhatsApp** para pizzarias, desenvolvida inicialmente para a **Tempero Napolitano**. Combina:

- Atendimento conversacional com **Inteligência Artificial**
- **Campanha gamificada** de desconto (até 30%)
- **Editor visual** de fluxos conversacionais (sem código)
- **Automações HTTP** desacopladas do chat
- **Dashboard web** para operação e configuração

Apesar de estar em `xampp/htdocs`, o projeto **não usa PHP** — é uma aplicação **Node.js + Express** com frontend HTML estático.

## Problema que resolve

| Desafio | Solução |
|---------|---------|
| Alto volume de mensagens no WhatsApp | Bot com IA responde pedidos, cardápio e taxa de entrega |
| Campanhas de indicação difíceis de rastrear | Fluxos visuais + metas + tabela de contatos |
| Regras de negócio mudam com frequência | Prompts, requisições e fluxos editáveis no banco/dashboard |
| Múltiplas lojas/franquias | Multi-instância: um `.env` + banco + processo PM2 por empresa |

## Stack tecnológica

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js |
| HTTP | Express 4.x |
| WhatsApp | whatsapp-web.js 1.34 (Puppeteer headless) |
| Banco | MySQL via mysql2 + Sequelize 6 |
| IA | OpenAI SDK (Qwen/Alibaba, OpenRouter/Claude) |
| Frontend | HTML5 + Bootstrap 5.3 + Chart.js (CDN) |
| Deploy | PM2 |

## Componentes principais

```
BotIApizzaria.js          → Orquestrador (WhatsApp + HTTP + pipeline de mensagens)
services/                 → 17 serviços de negócio
routes/                   → 3 routers REST (dashboard, ia, fluxos)
public/                   → 4 páginas HTML administrativas
Models/                   → Entidades Sequelize
database/                 → Conexão, setup e migrações
arquivos/                 → Cardápio, bairros, cupons (JSON)
```

## Fluxos de negócio

### 1. Atendimento de pedidos
Cliente envia mensagem → debounce → IA interpreta → requisições externas (cardápio, taxa, bordas) → pedido montado passo a passo.

### 2. Campanha de desconto
Gatilho "campanha" → Missão 1 (entrar no grupo por bairro) → Missão 2 (10 indicações via vCard) → Missão 3 (a definir) → cupom progressivo.

### 3. Fluxos visuais
Operador desenha fluxo no browser → salva no banco → `fluxoExecutor` executa nós (mensagem, condição, IA, ação) em tempo real no WhatsApp.

### 4. Automações
Fluxos tipo `automacao` → disparados por webhook HTTP ou execução manual → integrações externas (HTTP, IA, variáveis).

## Público-alvo

- **Operadores da pizzaria**: dashboard, grupos, gatilhos, contatos
- **Administradores**: prompts, provedores IA, fluxos, automações
- **Desenvolvedores**: API REST, schema MySQL, executores

## Versão atual

- **package.json**: `1.0.0`
- **Entry point**: `BotIApizzaria.js` (~1500 linhas)
- **Porta padrão**: `3007`
