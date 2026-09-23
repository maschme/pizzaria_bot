# WhatsApp e Integrações

## Biblioteca

**whatsapp-web.js** v1.34 — automação via WhatsApp Web com Puppeteer headless.

```javascript
const { Client, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-ia-pizzaria3' }),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});
```

## Autenticação

| Item | Valor |
|------|-------|
| Estratégia | `LocalAuth` |
| Client ID | `bot-ia-pizzaria3` |
| Sessão | `.wwebjs_auth/` (gitignored) |
| QR | Terminal + API `/whatsapp/qr*` |

Após escanear o QR, a sessão persiste entre reinícios.

---

## Eventos registrados

### `qr`

Gera QR code no terminal (`qrcode-terminal`) e armazena para API:

- `GET /whatsapp/qr` — string
- `GET /whatsapp/qr-image` — PNG base64

### `ready`

Após conexão:
1. Log de sucesso e `setWhatsappClient(client)` — injeta nas rotas dashboard
2. `abordagemService.iniciarScheduler(client)` — primeiro, para nada abaixo impedir o scheduler de ligar
3. `grupoService.sincronizarAoConectar(client)` — sincroniza grupos **em segundo plano** (não bloqueia o `ready`); ver [Sincronização de grupos](#sincronização-de-grupos)
4. Injeta listener de labels CRM via Puppeteer (só no motor wwebjs)

### `message`

Pipeline principal — ver [Arquitetura](./03-arquitetura.md).

**Mensagens ignoradas:**
- Grupos (exceto lógica específica)
- `status@broadcast`
- Mensagens `fromMe`
- Conteúdo vazio

### `typing`

Cancela debounce quando usuário está digitando (evita resposta prematura).

### `group_join`

**Grupo de demonstração** (`tipo = 'demonstracao'`): tratado antes de tudo e encerra ali. A entrada só avança o fluxo de demonstração da pessoa, se ele estiver esperando por isso (`fluxoExecutor.sinalizarEntradaGrupo`) — ver [modelo demo-campanha-30](./20-modelos-e-fluxos-completos.md#a4-modelos-da-primeira-leva).

Nos demais grupos, confirma **Missão 1** da campanha:
1. Identifica participante
2. `UPDATE contatos SET cam_grupo = 1`
3. Busca `id_negociacao` para mover no funil CRM
4. Atualiza sessão campanha em memória

### `label_change`

Log de mudanças de etiquetas CRM (integração com labels WhatsApp Business).

---

## Tipos de mensagem tratados

| Tipo | Tratamento |
|------|------------|
| Texto | Pipeline completo (fluxo/campanha/IA) |
| vCard (contato) | Fluxo `wait_contacts` ou Missão 2 campanha |
| Localização | Via utils (taxa entrega) |
| Mídia | Limitado — foco em texto |

---

## Debounce unificado

Configurável via `debounce_mensagens_ms` (padrão 10000ms):

```
Usuário envia msg 1 ──┐
Usuário envia msg 2 ──┼── aguarda 10s ── processa tudo junto
Usuário envia msg 3 ──┘
```

Cancelado se evento `typing` detectado.

---

## Campanha de desconto

### Fluxo legado (código em BotIApizzaria.js)

```
Gatilho campanha_desconto
  → Etapa 1: pede bairro
  → Busca grupo (DB ou JSON fallback)
  → Envia link convite
  → group_join confirma Missão 1
  → Etapa 2: pede 10 vCards
  → indicacaoService registra
  → Etapa 3: a definir
```

### Fluxo visual (fluxoExecutor)

Fluxos tipo `campanha` com nós visuais. Ao terminar, **handoff** para Missão 2 legada:

```javascript
fluxoExecutor.setOnCampanhaFlowEnd(async (client, chatId, fluxo) => {
  // Passa sessão para etapa 2 (aguardando contatos)
});
```

### Sessões em memória

```javascript
{
  etapa: 1|2|3,
  subEtapa: 'aguardando_bairro' | 'aguardando_confirmacao_grupo' | 'aguardando_contatos',
  missoes: { 1: {...}, 2: {...}, 3: {...} },
  bairro: string,
  descontoTotal: number,
  historico: []
}
```

APIs debug: `/campanha/sessoes`, `/campanha/sessao/:numero`

---

## Grupos por bairro

### Fonte de dados

1. **Primária:** tabela `grupos_whatsapp` (sincronizada do WhatsApp)
2. **Fallback:** `arquivos/grupos_whatsapp.json`

### Busca

`grupoWhatsappService.buscarPorBairro(bairro)` — match fuzzy por nome de bairro.

Se não encontrar → usa grupo marcado `isGrupoGeral = true`.

### Sincronização de grupos

Código: `services/grupoWhatsappService.js` (`sincronizarGrupos`, `sincronizarAoConectar`, `getEstadoSincronizacao`).

A tabela `grupos_whatsapp` é um **espelho dos grupos do número conectado**:

- Grupos que vieram do WhatsApp são criados ou atualizados (nome, participantes, link de convite quando o número é admin; link manual já salvo é preservado).
- Grupos que **não vieram** são **removidos** do banco — ex.: ao trocar o número, somem os grupos do número anterior. A configuração deles (bairro, ativo, geral) vai junto; o resultado lista em `removidosEmUso` os removidos que estavam configurados, e o painel avisa para revisar a campanha.
- Proteção: só remove quando a leitura é **completa e não vazia**. Lista vazia, erro da API ou a lista parcial do fallback `Store.Chat` (wwebjs) não apagam nada.

**Quando roda**

| Gatilho | Comportamento |
|---------|---------------|
| Número conecta (`ready`) | `sincronizarAoConectar`: em segundo plano; se vier 0 grupos, tenta de novo até 4 vezes com 45 s de intervalo (na Evolution os grupos só aparecem depois que a instância termina de baixá-los após o pareamento). No wwebjs, 1 tentativa |
| Botão **Sincronizar** | `POST /api/dashboard/grupos/sincronizar` responde na hora (202) e a sincronização segue em segundo plano, sem cache |

Só roda uma sincronização por vez: um pedido durante outra em andamento reaproveita a mesma.

**Estado exposto ao painel** — `GET /api/dashboard/grupos/sincronizacao` e o campo `sincronizacaoGrupos` de `GET /whatsapp/status`:

```jsonc
{
  "emAndamento": true,
  "origem": "conexao",          // conexao | manual
  "etapa": "Aguardando o WhatsApp baixar os grupos (tentativa 2 de 4)",
  "inicio": "...", "fim": null,
  "resultado": null,            // ao terminar: { total, novos, atualizados, removidos, removidosEmUso, linksObtidos, linksManuais, errosIndividuais }
  "erro": null
}
```

**Motor Evolution** (`services/evolutionClient.js`, `_buscarGrupos`): usa `GET /group/fetchAllGroups?getParticipants=false` (timeout 90 s). A lista fica em cache por 5 min, mas lista vazia **não** é cacheada e os caches são limpos a cada nova conexão. A sincronização manual ignora o cache e, em erro, propaga a mensagem da Evolution em vez de devolver lista vazia.

### Exportação de participantes

`grupoWhatsappService.extrairParticipantesGrupo` + `participantesParaCsv`. Colunas do CSV: `grupo_id, grupo_nome, numero, whatsapp_id, whatsapp_lid, nome, pushname, is_admin, is_super_admin`.

| Coluna | Origem |
|--------|--------|
| `pushname` | Nome de perfil do WhatsApp (o "~Nome" da lista de membros). Na Evolution: o `name` de `/group/participants`; se vazio, o `pushName` de `/chat/findContacts`, procurado pelo @lid e pelo telefone |
| `nome` | Nome cadastrado na nossa tabela `contatos`, procurado pelo @lid e pelas variantes do telefone (9º dígito/DDI) |

Limite: o WhatsApp só entrega o nome de perfil de quem já mandou mensagem vista pela instância. Membros que nunca falaram (em número recém-conectado, a maioria) saem sem `pushname`. Os nomes que aparecem no celular vêm da agenda do aparelho e não chegam pela API.

---

## Indicações (vCard)

Parser: `utils/vcardParser.js`

Serviço: `indicacaoService.registrarIndicacoes()`

1. Extrai número e nome do vCard
2. Insere em `indicacoes` (unique por par indicador+indicado)
3. Conta total e atualiza `contatos.qt_indicados`
4. Marca `cam_indicacoes = 1` ao atingir meta

---

## Identidade WhatsApp (@lid)

WhatsApp pode ocultar número real usando identificador `@lid`.

`whatsappIdentityService.js`:
- Normaliza entre PN (`5511...@c.us`) e LID
- Coluna `contatos.whatsapp_lid` para persistência
- Usado em fluxos, group_join e dashboard

---

## Labels CRM

Funções auxiliares injetadas via Puppeteer:

- `addLabelToChat(chatId, labelId)`
- `removeLabelFromChat(chatId, labelId)`

Acesso a `window.Store` do WhatsApp Web.

---

## Integrações externas

### Envio programático

```http
POST /send-message
Content-Type: application/json

{ "number": "5511999999999", "message": "Pedido confirmado!" }
```

### Webhook CRM

```http
POST /webhook/movimento
```

Recebe movimentos do funil — atualmente apenas log (stub).

### Funil de vendas

`moverCardNoFunil(idNegociacao)` — chamada após group_join quando `id_negociacao` existe em `contatos`.

### Google Maps

`utils/global.js` → `getRetornoApiGoogle()` — calcula distância/taxa de entrega para requisição `taxa_entrega`.

---

## Horário de funcionamento

Verificação antes do atendimento IA:

- Config: `horario_funcionamento_inicio`, `horario_funcionamento_fim`
- Fora do horário → envia `mensagem_fora_horario`
- Campanha e fluxos visuais podem ter regras próprias

---

## Limitações conhecidas

| Limitação | Impacto |
|-----------|---------|
| whatsapp-web.js não oficial | Risco de bloqueio; depende de updates |
| Sessão única por instância | Um número WhatsApp por processo |
| Sessões campanha em memória | Perdidas ao reiniciar bot |
| Sem INSERT em contatos | CRM externo deve criar registros |
| Grupos ignorados no pipeline | Bot não responde em grupos (by design) |
