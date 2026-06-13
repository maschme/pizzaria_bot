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
1. Log de sucesso
2. `grupoService.sincronizarGrupos(client)` — sync grupos no DB
3. `setWhatsappClient(client)` — injeta nas rotas dashboard
4. Injeta listener de labels CRM via Puppeteer

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

Confirma **Missão 1** da campanha:
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
