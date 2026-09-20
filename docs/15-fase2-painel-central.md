# Fase 2 — Painel Central (escopo)

Escopo definido com o operador em 20/09/2026. Decisões de alinhamento:

| Decisão | Escolha |
|---|---|
| Cobrança | **Registro manual** no MVP (plano, valor, status preenchidos à mão); gateway automático fica para a 2.1 |
| Domínio/HTTPS por empresa | **Fora do MVP** — acesso continua por porta; proxy reverso na 2.1 |
| Acesso ao painel | **Só super-admin** no MVP; donos de empresa seguem no dashboard da própria instância |
| Código | **Mesmo repositório**, pasta `painel/`, processo PM2 e porta próprios |

---

## 1. Objetivo do MVP

Operar N empresas de um lugar só: ver a saúde de todas, provisionar empresa nova pela interface, escanear QR remotamente e agir (restart/backup) sem SSH. O painel é **camada de operação** — não toca a lógica dos bots.

## 2. Arquitetura

```
painel/  (mesmo repo, processo PM2 "painel-central", porta 3100)
├── server.js          Express + rotas API + estático
├── public/index.html  UI (mesmo padrão visual dos dashboards)
├── services/          inventário, saúde, ações
└── .env               PORT, DB_*, PAINEL_TOKEN
```

- Banco central: `painel_central` (mesmo MySQL)
- O painel conversa com as instâncias por HTTP: `/health` (público) e endpoints administrativos usando o `ADMIN_TOKEN` **de cada instância** (armazenado no inventário)
- Ações de processo (provisionar, restart, backup) via `pm2`/scripts no próprio servidor (o painel roda na mesma máquina)

## 3. Modelo de dados (`painel_central`)

```
empresas   (id, nome, slug UNIQUE, telefone_contato, plano, valor_mensal,
            status ENUM[ativa, inadimplente, suspensa, encerrada],
            observacoes, criado_em, atualizado_em)
instancias (id, empresa_id FK, porta, pm2_name, db_name, dir_path,
            admin_token, evolution_instance, criado_em)
eventos    (id, instancia_id FK, tipo [provisionada|restart|backup|queda|recuperacao|nota],
            detalhe, criado_em)
```

Uma empresa → uma instância no MVP (o schema já permite N no futuro).

## 4. Funcionalidades do MVP

### 4.1 Login
- Tela única com `PAINEL_TOKEN` (mesmo padrão do `auth.js` das instâncias)

### 4.2 Visão consolidada (tela principal)
- Card por empresa: nome, status de cobrança (manual), porta, e **saúde ao vivo** via `/health`: 🟢 conectado / 🔴 degradado / QR pendente / sem resposta
- Totais no topo: empresas, conectadas, com problema
- Auto-refresh (15s)

### 4.3 Cadastro de empresas
- CRUD: nome, slug, contato, plano, valor, status, observações
- Vincular instância existente (caso das atuais: pizzaria-crm e bot-teste1 são **importadas** no primeiro uso, não recriadas)

### 4.4 Provisionar pela interface
- Botão "Nova empresa": formulário (nome, slug, porta sugerida automaticamente) → executa `scripts/provisionar-empresa.sh` → captura o `ADMIN_TOKEN` gerado → grava empresa+instância+evento
- Log da execução visível na tela (sucesso/erro)

### 4.5 QR remoto
- Na empresa com QR pendente: botão "Conectar WhatsApp" mostra o QR da instância (proxy: painel chama `GET :porta/whatsapp/qr-image` com o admin_token da instância), com auto-refresh

### 4.6 Ações por instância
- **Restart** (`pm2 restart <name>`) com confirmação
- **Backup agora** (`node scripts/backup.js` no diretório da instância)
- **Abrir dashboard** (link direto com a porta)
- Tudo registrado em `eventos`

### 4.7 Linha do tempo
- Aba de eventos por empresa (provisionamento, restarts, backups, notas manuais)

## 5. Fora do MVP (backlog 2.1+)

| Item | Nota |
|---|---|
| Gateway de cobrança (Asaas/Mercado Pago) | Suspensão automática por inadimplência |
| Proxy reverso + subdomínio + HTTPS | `empresa.dominio.com.br`; encerra acesso por porta |
| Login por empresa no painel | Multiusuário com permissões |
| ~~Templates de fluxo por segmento~~ | ✅ **Entregue em 20/09/2026 como "empresa-modelo"**: no provisionar, escolhe-se uma empresa existente como modelo e prompts, fluxos, requisições, configurações e cardápio (`arquivos/`) são copiados (`scripts/copiar-modelo.js`); dados operacionais não. Segmento novo = configurar uma empresa modelo, sem programar. Seeds padrão foram neutralizados (sem marca de pizzaria) |
| Deploy em ondas pelo painel | `git pull` + migrate + restart instância a instância |
| Alertas centralizados | Hoje cada instância tem seu monitor; consolidar no painel |

## 6. Ordem de entrega

1. Esqueleto (`painel/` + banco central + login) e **importação das 2 instâncias existentes**
2. Visão consolidada com saúde ao vivo
3. Cadastro/edição de empresas (cobrança manual)
4. Ações: restart, backup, link dashboard + eventos
5. QR remoto
6. Provisionamento pela interface (por último — é o que executa coisas mais pesadas)

Critério de pronto do MVP: operar pizzaria + bot-teste1 + **uma empresa nova provisionada 100% pelo painel**, sem SSH.

---

## 7. Status de implementação

**20/09/2026 — MVP implantado em produção** (`painel/`, porta 3100, PM2 `painel-central`): as 6 entregas do plano foram implementadas e o painel está no ar com as duas instâncias vinculadas (pizzaria-crm e bot-teste1, ambas verdes).

**20/09/2026 — ✅ Critério de pronto atingido**: empresa `demonstracao` provisionada pela interface (porta 3096, banco e instância Evolution `empresa-demonstracao` criados automaticamente, motor evolution, health ok em `qr_ready`). O teste revelou e corrigiu um bug real de primeira execução: variáveis de ambiente do painel (PORT) vazavam para as instâncias filhas e venciam o `.env` delas — corrigido com spawn de ambiente limpo no painel e `dotenv override` no bot. Backlog 2.1 permanece como listado na seção 5.
