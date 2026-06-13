# Roadmap

Plano de evolução do Pizzaria Bot com base no estado atual do código e lacunas identificadas.

---

## Curto prazo (1–2 meses)

### Prioridade alta

| Item | Descrição | Motivação |
|------|-----------|-----------|
| **Missão 3 da campanha** | Definir e implementar terceira missão (+10% desconto) | Campanha incompleta — placeholder no código |
| **INSERT em contatos** | Criar contato automaticamente no primeiro contato WhatsApp | Hoje só UPDATE; fluxos "ler contato" falham sem CRM externo |
| **README na raiz** | Link para `/docs` | Facilitar onboarding |
| **Remover API keys dos seeds** | Mover chaves para `.env` | Segurança — keys hardcoded em `setup.js` |
| **Unificar conexão Sequelize** | Migrar models legados para `database/connection.js` | Evitar duplicidade localhost hardcoded |

### Prioridade média

| Item | Descrição |
|------|-----------|
| **Persistir sessões campanha** | Salvar em Redis ou MySQL (hoje só memória) |
| **Autenticação no dashboard** | Login/senha ou token para APIs administrativas |
| **Testes automatizados** | Unit tests para fluxoExecutor e serviços críticos |
| **Webhook CRM funcional** | Implementar `POST /webhook/movimento` de fato |
| **Schedule real** | Cron para nó `trigger_schedule` em automações |

---

## Médio prazo (3–6 meses)

### Produto

| Item | Descrição |
|------|-----------|
| **Painel de pedidos** | UI para listar/filtrar pedidos da tabela `pedidos` |
| **Relatórios** | Dashboard com métricas de conversão campanha, pedidos/dia |
| **Multi-atendentes** | Fila de atendimento humano com transferência da IA |
| **Templates de fluxo** | Biblioteca de fluxos prontos (campanha, pós-venda, NPS) |
| **Notificações push** | Alertas no dashboard (WhatsApp desconectado, erro IA) |

### Técnico

| Item | Descrição |
|------|-----------|
| **API WhatsApp Business oficial** | Migrar de whatsapp-web.js para API Meta (Cloud API) |
| **Frontend modular** | Extrair JS/CSS dos HTMLs para arquivos separados |
| **TypeScript** | Migração gradual dos services |
| **Docker** | Containerização para deploy padronizado |
| **CI/CD** | Pipeline de testes e deploy automático |

---

## Longo prazo (6–12 meses)

| Item | Descrição |
|------|-----------|
| **SaaS multi-tenant** | Uma instalação, múltiplas pizzarias com isolamento |
| **Marketplace de integrações** | iFood, Rappi, ERPs, gateways de pagamento |
| **IA com RAG** | Embeddings do cardápio para respostas mais precisas |
| **App mobile operador** | Notificações e gestão rápida de pedidos |
| **Analytics avançado** | Funil de conversão, cohort de campanha, LTV |
| **White-label** | Customização de marca por cliente |

---

## Backlog técnico (dívida)

| Item | Arquivo/Área | Risco |
|------|--------------|-------|
| Remover `BotIcopia.js` | Raiz | Confusão |
| Remover `roteadorMensagens.js` | Raiz | Código morto (referencia pasta inexistente) |
| Consolidar `ias.js` + `provedorIAService` | utils + services | Duplicidade |
| Consolidar `contexto.js` vs `historico.js` | Raiz | Dois sistemas de contexto |
| Models legados sem uso ativo | Models/ | Manutenção desnecessária |
| Validar `@lid` em todos os fluxos | whatsappIdentityService | Edge cases privacidade |

---

## Métricas de sucesso sugeridas

| Métrica | Meta |
|---------|------|
| Taxa resposta automática | > 85% das mensagens |
| Tempo médio primeira resposta | < 15 segundos |
| Conversão campanha (Missão 1) | > 40% dos que iniciam |
| Conversão campanha (Missão 2) | > 20% dos que completam M1 |
| Uptime WhatsApp | > 99% (exceto manutenção) |
| Pedidos finalizados via bot | Crescimento mês a mês |

---

## Como contribuir com o roadmap

1. Priorize itens de **Prioridade alta** antes de novas features
2. Documente breaking changes em `/docs`
3. Mantenha retrocompatibilidade de APIs REST
4. Teste fluxos visuais após mudanças no `fluxoExecutor`
