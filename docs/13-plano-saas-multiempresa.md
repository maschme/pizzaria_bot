# Plano SaaS Multi-empresa

Plano de evolução do Pizzaria Bot de instalação única para plataforma SaaS que atende múltiplas empresas. Escrito em 19/09/2026.

---

## 1. Diagnóstico do estado atual

### O que já existe a favor

| Item | Situação |
|------|----------|
| Multi-instância ("Opção 1") | Suportado: um `.env` + um banco + um processo PM2 por empresa (`PORT`, `DB_NAME`, `PM2_APP_NAME`) |
| Setup automatizado | `run-setup.js` / `setup.sh` / `setup.ps1` criam banco e tabelas |
| Configuração no banco | Prompts, provedores IA, fluxos, gatilhos e requisições editáveis por dashboard, sem deploy |
| Sessão WhatsApp parametrizada | `WA_SESSION_ID`, `WA_AUTH_DIR` e `PUPPETEER_EXECUTABLE_PATH` no `.env` (adicionado em 19/09/2026) |

### Lacunas para virar SaaS

| Lacuna | Impacto |
|--------|---------|
| Dashboard sem autenticação | Qualquer pessoa com a URL administra o bot — bloqueador |
| Sessões de campanha só em memória | Restart perde o progresso dos clientes na campanha |
| API keys de IA nos seeds (`setup.js`) | Segredo vazado em repositório |
| Conexão Sequelize duplicada em models legados | `localhost` hardcoded quebra em outros ambientes |
| Provisionamento manual | Criar empresa nova exige SSH, clone, .env e PM2 na mão |
| Sem monitoramento | Desconexão do WhatsApp só é percebida quando cliente reclama |
| Código legado (`BotIcopia.js`, `roteadorMensagens.js`, `ias.js`) | Confusão e risco em manutenção |

### Nota sobre o incidente de sessão (19/09/2026)

Após `git pull` + `pm2 restart pizzaria-crm`, a sessão WhatsApp pediu QR novamente. Investigado: **nenhum commit alterou configuração de sessão** — o `clientId` era o mesmo desde o commit inicial e `.wwebjs_auth/` é ignorada pelo git. É limitação conhecida do whatsapp-web.js: a restauração de sessão após restart falha ocasionalmente (mudança de versão do WhatsApp Web, cache inválido). Mitigação: página de QR acessível no dashboard (já existe, aba Whats) + alerta automático de desconexão (Fase 1).

---

## 2. Decisão arquitetural: multi-instância vs multi-tenant

**Recomendação: manter 1 processo por empresa no SaaS v1** (multi-instância orquestrada), e só considerar multi-tenant real se/quando migrar para a API oficial da Meta.

Justificativa:

1. **O custo por empresa é inevitável com whatsapp-web.js**: cada número WhatsApp exige um Chromium + sessão próprios (~100–300 MB RAM). Juntar empresas num único processo Node não elimina esse custo — só concentra o risco.
2. **Isolamento de falha**: um crash de Puppeteer de uma empresa não derruba as demais.
3. **Isolamento de dados natural**: um banco por empresa dispensa reescrever todas as queries com `empresa_id` agora.
4. **O código atual já suporta**: a "Opção 1" existente vira o motor do SaaS; o que falta é orquestração, não rearquitetura.

Multi-tenant real (app único, `empresa_id` nas tabelas) fica condicionado à **Fase 4** (WhatsApp Cloud API), onde não existe mais um navegador por número.

---

## 3. Fases

### Fase 0 — Higiene e segurança (1–2 semanas) — pré-requisito

| Item | Detalhe |
|------|---------|
| ✅ Sessão via `.env` | `WA_SESSION_ID`, `WA_AUTH_DIR`, `PUPPETEER_EXECUTABLE_PATH` (feito 19/09/2026) |
| Autenticação no dashboard | Token/senha única por instância no `.env` (`ADMIN_TOKEN`), middleware nas rotas `/api/*` e páginas |
| Remover API keys dos seeds | Chaves de IA passam para `.env` ou cadastro via dashboard |
| Unificar conexão Sequelize | Models legados usam `database/connection.js` |
| Remover código morto | `BotIcopia.js`, `roteadorMensagens.js`; consolidar `ias.js` no `provedorIAService` |
| Persistir sessões de campanha | Tabela `sessoes_campanha` em MySQL (hoje `Map` em memória) |

### Fase 1 — Instância provisionável e monitorada (2–4 semanas)

| Item | Detalhe |
|------|---------|
| Script `provisionar-empresa` | Um comando cria: banco, `.env`, pasta de sessão, processo PM2 e registra no inventário |
| `ecosystem.config.js` | Todas as instâncias declaradas num arquivo PM2 versionado (fora do repo do bot ou gerado) |
| Endpoint `/health` | Status de WhatsApp, banco e uptime em JSON, para monitoramento externo |
| Alerta de desconexão | Watcher (cron/uptime-kuma/n8n) chama `/health` e avisa no WhatsApp/Telegram do operador com link do QR |
| Backup automatizado | Dump diário por banco + backup da pasta de sessões |
| Migrações versionadas | Padronizar `database/migrations/` com controle de versão aplicada (tabela `schema_migrations`) para atualizar N bancos com segurança |

### Fase 2 — Control plane (painel central) (1–2 meses)

Aplicação separada (pode reaproveitar o stack Node + MySQL) que gerencia as instâncias:

| Item | Detalhe |
|------|---------|
| Cadastro de empresas | Nome, plano, domínio/porta, status |
| Provisionamento pela UI | Botão "nova empresa" executa o script da Fase 1 |
| Visão consolidada | Status de todas as instâncias (via `/health`), QRs pendentes, uso |
| Usuários e papéis | Admin da plataforma vs operador da empresa (login por empresa) |
| Proxy reverso | Nginx/Caddy: `empresa.seudominio.com.br` → porta da instância, com HTTPS (encerra o acesso por porta exposta) |
| Atualização orquestrada | Deploy em ondas: `git pull` + restart instância a instância, com janela e rollback |

### Fase 3 — Comercial (paralelo à Fase 2)

| Item | Detalhe |
|------|---------|
| Planos e billing | Assinatura mensal (gateway: Stripe/Asaas/Mercado Pago), suspensão automática por inadimplência |
| Onboarding self-service | Empresa cadastra, paga, escaneia QR e configura cardápio guiada |
| Templates por segmento | Fluxos e prompts prontos (pizzaria, hamburgueria, etc.) aplicados no provisionamento |
| Termos e LGPD | Contrato, política de dados, exclusão de dados por empresa |

### Fase 4 — Escala (6+ meses, condicional)

| Item | Detalhe |
|------|---------|
| WhatsApp Cloud API (oficial) | Elimina Puppeteer/QR; habilita multi-tenant real num app único |
| Multi-tenant com `empresa_id` | Reescrita das queries/services; um banco único ou schema por empresa |
| White-label | Marca própria por revendedor |

---

## 4. Modelo de dados do control plane (Fase 2)

```
empresas          (id, nome, slug, dominio, status, plano_id, criado_em)
instancias        (id, empresa_id, host, porta, pm2_name, db_name, wa_session_id,
                   versao_git, status_whats, ultimo_health, criado_em)
planos            (id, nome, preco_mensal, limites_json)
assinaturas       (id, empresa_id, plano_id, gateway, gateway_id, status,
                   proxima_cobranca, criado_em)
usuarios          (id, empresa_id NULL=admin plataforma, nome, email, senha_hash,
                   papel, criado_em)
eventos_instancia (id, instancia_id, tipo [desconexao|deploy|erro], detalhe, criado_em)
```

O banco de cada empresa continua com o schema atual do bot, intocado.

---

## 5. Referência de variáveis de ambiente (por instância)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PORT` | Sim | Porta HTTP da instância (ex.: 3087) |
| `PM2_APP_NAME` | Sim | Nome do processo no PM2 (ex.: pizzaria-crm) |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Sim | Banco da empresa |
| `WA_SESSION_ID` | Recomendada | Id da sessão WhatsApp; define `.wwebjs_auth/session-<id>`. Default: `bot-ia-pizzaria3` (compatibilidade). **Trocar exige novo QR** |
| `WA_AUTH_DIR` | Não | Diretório base das sessões (default: `./.wwebjs_auth`) |
| `PUPPETEER_EXECUTABLE_PATH` | Não | Chrome/Chromium do sistema, se não usar o do Puppeteer |
| `ADMIN_TOKEN` | Fase 0 | Token de acesso ao dashboard/APIs (a implementar) |

Convenção sugerida para novas empresas: `WA_SESSION_ID=empresa-<slug>`, `DB_NAME=pizzaria_<slug>`, `PM2_APP_NAME=bot-<slug>`.

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| whatsapp-web.js é não-oficial (risco de banimento e de breaking changes do WhatsApp Web) | Avisar clientes no contrato; limitar disparos em massa; planejar Cloud API (Fase 4) |
| Sessão cai após restart e exige QR | Página de QR no dashboard + alerta automático (Fase 1); janelas de deploy combinadas |
| Dashboards hoje expostos sem senha | Fase 0 é pré-requisito antes de qualquer cliente novo |
| Muitas instâncias = muita RAM (Chromium por empresa) | Dimensionar ~300 MB/empresa; escalar horizontal por VPS; consolidar na Cloud API |
| Atualização de N instâncias | Migrações versionadas + deploy em ondas (Fases 1–2) |

---

## 7. Próximos passos imediatos

1. **Fase 0**: implementar `ADMIN_TOKEN` (autenticação simples) — maior risco atual
2. Persistir sessões de campanha em MySQL
3. Escrever `provisionar-empresa.sh` usando a estrutura `.env` já existente
4. Definir a segunda empresa piloto para validar o provisionamento de ponta a ponta
