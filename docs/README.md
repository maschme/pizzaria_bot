# Documentação — Pizzaria Bot

Bot de atendimento WhatsApp com IA para a **Pizzaria Tempero Napolitano**. Este diretório reúne toda a documentação técnica e funcional do projeto.

## Índice

| # | Documento | Conteúdo |
|---|-----------|----------|
| 1 | [Resumo do Projeto](./01-resumo-projeto.md) | Visão geral, objetivos, stack e público-alvo |
| 2 | [Instalação e Configuração](./02-instalacao-configuracao.md) | Setup, variáveis de ambiente, scripts e PM2 |
| 3 | [Arquitetura](./03-arquitetura.md) | Estrutura de pastas, fluxo de dados e diagramas |
| 4 | [Páginas e Interface](./04-paginas-interface.md) | Índice de telas, views, abas e funções |
| 5 | [Features e Módulos](./05-features-modulos.md) | Funcionalidades detalhadas por módulo |
| 6 | [Referência da API](./06-api-referencia.md) | Todos os endpoints HTTP |
| 7 | [Banco de Dados](./07-banco-dados.md) | Schema, tabelas, migrações e seeds |
| 8 | [WhatsApp e Integrações](./08-whatsapp-integracao.md) | Bot, eventos, campanha e CRM |
| 9 | [Fluxos e Automações](./09-fluxos-automacoes.md) | Editores visuais, nós e executores |
| 10 | [Roadmap](./10-roadmap.md) | Próximos passos e melhorias planejadas |
| 11 | [Evolução e Etapas](./11-evolucao-etapas.md) | Histórico de desenvolvimento e marcos |
| 12 | [Código Legado](./12-codigo-legado.md) | Arquivos antigos e pendências de migração |
| 13 | [Plano SaaS Multi-empresa](./13-plano-saas-multiempresa.md) | Estratégia e fases para atender múltiplas empresas |
| 14 | [Análise de APIs WhatsApp](./14-analise-apis-whatsapp.md) | Inventário de funções usadas e comparação de APIs (oficial e alternativas) |
| 15 | [Fase 2 — Painel Central](./15-fase2-painel-central.md) | Escopo do MVP do painel multi-empresa |
| 16 | [Canais e Funil](./16-canais-e-funil.md) | Rastreio de origem dos clientes e funil de conversão por canal |
| 17 | [Integração Multipedidos](./17-integracao-multipedidos.md) | Estudo da API/webhooks da Multipedidos e endpoint de captura |
| — | [Tabela Contatos](./CONTATOS_TABELA.md) | Uso específico da tabela `contatos` |

## Início rápido

```bash
# 1. Instalar dependências
npm install

# 2. Configurar ambiente
cp .env.example .env
# Edite .env com PORT, DB_* e PM2_APP_NAME

# 3. Setup completo (primeira vez)
npm run setup:first

# 4. Iniciar o bot
npm start
```

Acesse o dashboard em: `http://localhost:3007/dashboard.html`

## Páginas web

| URL | Arquivo | Função |
|-----|---------|--------|
| `/dashboard.html` | `public/dashboard.html` | Painel operacional principal |
| `/fluxos.html` | `public/fluxos.html` | Editor de fluxos conversacionais |
| `/automacoes.html` | `public/automacoes.html` | Editor de automações HTTP |
| `/ia-config.html` | `public/ia-config.html` | Configuração de IA, prompts e cardápio |

## Entry point

O arquivo principal é `BotIApizzaria.js` — orquestra WhatsApp, Express, IA e executores de fluxo.
