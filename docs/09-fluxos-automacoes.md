# Fluxos e Automações

O projeto possui **dois motores de execução** distintos, ambos alimentados pelo mesmo modelo de dados (`fluxos` no banco), mas com editores e nós diferentes.

| Motor | Editor | Tipo no DB | Canal |
|-------|--------|------------|-------|
| `fluxoExecutor.js` | `fluxos.html` | atendimento, campanha, suporte | WhatsApp |
| `automacaoExecutor.js` | `automacoes.html` | automacao | HTTP |

---

## Modelo de dados de fluxo

```json
{
  "id": 1,
  "nome": "Campanha Bairro",
  "tipo": "campanha",
  "gatilho": {
    "tipo": "palavra_chave",
    "valor": ["campanha", "desconto"]
  },
  "nodes": [ { "id": "n1", "type": "trigger", "data": {...}, "position": {...} } ],
  "edges": [ { "id": "e1", "source": "n1", "target": "n2" } ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "ativo": true,
  "versao": 1
}
```

---

## Fluxos conversacionais (WhatsApp)

### Editor: `fluxos.html`

Interface drag-and-drop com canvas, zoom, import/export JSON.

### Nós disponíveis

| Tipo | Nome UI | Entrada | Saída | Função |
|------|---------|---------|-------|--------|
| `trigger` | Gatilho | — | 1 | Início; palavra-chave, mensagem exata ou **evento do sistema** (ver abaixo) |
| `message` | Mensagem | 1 | 1 | Envia texto WhatsApp |
| `wait` | Aguardar | 1 | 1 | Pausa até resposta do usuário |
| `wait_contacts` | Aguardar contatos | 1 | 1 | Pausa até receber vCards |
| `condition` | Condição | 1 | 2 (sim/não) | Branch sobre resposta |
| `condition_var` | Verificar variável | 1 | 2 (sim/não) | Branch sobre variável de sessão |
| `ia` | IA | 1 | 1 | Chamada IA com prompt configurável |
| `action` | Ação | 1 | 1 | Executa ação (ver abaixo) |
| `end` | Fim | 1 | — | Encerra fluxo |

### Tipos de ação (`action`)

| Ação | Descrição |
|------|-----------|
| `requisicao` | Executa requisição externa (cardápio, taxa, etc.) |
| `salvar_variavel` | Grava variável na sessão do fluxo |
| `marcar_meta` | Marca meta em `contato_metas` |
| `verificar_meta` | Verifica se meta foi concluída |
| `ler_contato` | Lê campo da tabela `contatos` |
| `webhook` | Dispara HTTP externo |
| `enviar_cupom` | Envia cupom de desconto (texto escolhido pela IA num arquivo de cupons genéricos) |
| `multipedidos_criar_cupom` | **Multipedidos: criar cupom único** — cria na Multipedidos um cupom de uso único só daquele contato, a partir de um comando em linguagem natural (ex.: "criar cupom de 10% válido por 7 dias"). Idempotente por contato + campanha |
| `listar_ofertas` | **Listar ofertas elegíveis** — monta a lista dos fluxos marcados como "oferecer no pós-venda" que o contato pode entrar (pelo histórico dele) → `{{ofertas}}`, `{{ofertasQtd}}`, `{{ofertaId_N}}` |
| `iniciar_fluxo` | **Iniciar outro fluxo** — encerra o atual e inicia o alvo (id fixo ou variável, ex.: `{{ofertaId_1}}`), levando as variáveis + `{{fluxoAnterior}}` |
| `opt_out` | **Registrar opt-out** — o contato não recebe mais nenhuma mensagem iniciada pelo bot (`contatos.opt_out`); mensagens que ele mandar continuam sendo atendidas |
| `multipedidos_alterar_cupom` | **Multipedidos: alterar cupom** — promove/ajusta o cupom que o contato recebeu na mesma campanha (ex.: "subir para 20% e renovar a validade") |

Os dois nós Multipedidos ([doc 18](./18-cupons-multipedidos.md)) **só aparecem no editor com a API da Multipedidos ativa** (Dashboard → Integrações) — na seção "Multipedidos" da paleta e no select "Tipo de Ação"; com a integração configurada mas a API desligada, a paleta mostra um aviso de onde ativar; nó já existente num fluxo continua editável, com o aviso "integração desativada". Eles **não enviam mensagem**: preenchem `{{cupomCodigo}}`, `{{cupomDesconto}}`, `{{cupomValidade}}`, `{{cupomPedidoMinimo}}`, `{{cupomStatus}}` (`criado`, `alterado`, `reaproveitado`, `novo_por_uso`, `inalterado`, `erro`) e `{{cupomErro}}` para os nós seguintes. Nunca travam o fluxo: em falha seguem pela saída normal com `{{cupomStatus}} = erro` — use um **Verificar variável** para desviar (ex.: para o `enviar_cupom` de arquivo). O botão **Interpretar** do formulário mostra o que a IA entendeu do comando, já com os limites de segurança aplicados. Fluxo de exemplo importável: `docs/exemplos/fluxo-teste-cupom-multipedidos.json`.

### Gatilho por evento e abordagem ativa

Além de mensagem exata / palavra-chave, o gatilho pode ser **"Iniciado pelo sistema (evento)"** ([doc 20](./20-modelos-e-fluxos-completos.md) B0): o fluxo não responde a texto — quem o inicia é o bot, quando o evento acontece (`indicacao_registrada`, `pedido_concluido`) ou quando outro fluxo o encadeia (`manual`).

```
evento → abordagemService.enfileirar()  →  abordagens_fila  →  scheduler (60 s)  →  iniciarFluxo()
```

O scheduler só inicia dentro do horário comercial (configs `horario_funcionamento_*`), para contato sem `opt_out`, que não esteja em outro fluxo, com o fluxo ativo e o item não expirado. A fila deduplica por `(evento, referencia)` — o mesmo pedido não gera duas abordagens.

O gatilho também carrega o bloco **`oferta`** (checkbox "Oferecer este fluxo no pós-venda"): título, descrição, `elegivel_se` (`nunca_participou` | `nao_concluiu` | `sempre`) e prioridade. É isso que o nó **Listar ofertas elegíveis** lê.

### Ciclo de execução

```
1. Mensagem recebida
2. buscarFluxoPorGatilho() → encontra fluxo ativo
3. iniciarFluxo(client, chatId, fluxo)
4. Executa nós sequencialmente até wait/end
5. processarMensagemFluxo() continua após resposta
6. Logs gravados em fluxo_exec_logs
```

### Variáveis de sessão

Cada chat em fluxo mantém um `Map` de variáveis:

```javascript
{
  resposta: "última mensagem do usuário",
  bairro: "Centro",
  contatos_recebidos: 3,
  respostaIA: "..."
}
```

Acessíveis em condições, mensagens (`{{variavel}}`) e ações.

### Handoff campanha

Quando fluxo visual de campanha termina (nó `end`), callback registrado em `BotIApizzaria.js` passa usuário para **Missão 2 legada** (10 contatos).

---

## Automações (HTTP)

### Editor: `automacoes.html`

Mesma base visual, paleta de nós diferente.

### Nós disponíveis

| Tipo | Nome UI | Função |
|------|---------|--------|
| `trigger_webhook` | Webhook | Entrada via POST HTTP |
| `trigger_schedule` | Agendamento | Entrada por cron (estrutura) |
| `condition` | Condição | Branch lógico sobre variável |
| `set_variable` | Definir variável | Atribui valor |
| `http_request` | HTTP | GET/POST/PUT/DELETE externo |
| `ia` | IA | Processamento com instrução |
| `merge` | Merge | Junta múltiplos ramos |
| `log` | Log | Registra mensagem |
| `sleep` | Atraso | Pausa N segundos |
| `end` | Fim | Encerra automação |

### Disparo

**Webhook:**
```http
POST /api/fluxos/:id/webhook
Content-Type: application/json

{ "evento": "pedido_pronto", "pedido_id": 456 }
```

**Manual:**
```http
POST /api/fluxos/:id/run
```

### Resposta

```json
{
  "success": true,
  "data": {
    "variables": { "payload": {...}, "response": "..." },
    "logs": [
      { "nivel": "info", "mensagem": "HTTP 200 OK" }
    ]
  }
}
```

### Casos de uso

- Notificar ERP quando pedido muda de status
- Processar webhook de pagamento
- Enriquecer dados via API externa + IA
- Agendar tarefas de manutenção (sync grupos, relatórios)

---

## Gestão de fluxos (API comum)

| Operação | Endpoint |
|----------|----------|
| Listar | `GET /api/fluxos?tipo=campanha&ativo=true` |
| Criar | `POST /api/fluxos` |
| Atualizar | `PUT /api/fluxos/:id` |
| Ativar | `POST /api/fluxos/:id/ativar` |
| Desativar | `POST /api/fluxos/:id/desativar` |
| Duplicar | `POST /api/fluxos/:id/duplicar` |
| Exportar | `GET /api/fluxos/export/:id` |
| Importar | `POST /api/fluxos/import` |
| Deletar | `DELETE /api/fluxos/:id` |

Desativar fluxo conversacional **encerra sessões ativas** desse fluxo.

---

## Logs de execução

Tabela `fluxo_exec_logs` — consultável via:

- Dashboard → Contatos → Ver logs
- `GET /api/dashboard/contatos/:whatsappId/logs`

Campos registrados: fluxo, nó, tipo, evento, mensagem, detalhes JSON.

Serviço: `fluxoLogService.js`

---

## Modelos de fluxo

Biblioteca de fluxos prontos ([doc 20](./20-modelos-e-fluxos-completos.md) frente A): botão **Modelos** no editor abre os cards; "Usar modelo" pede o nome e as variáveis da empresa (ex.: link do cardápio) e cria uma cópia **inativa** para revisar e ativar. Os modelos são JSONs em `fluxos-modelos/` no formato do export mais um bloco `modelo`:

```json
{ "modelo": { "slug": "campanha-indicacao", "titulo": "…", "descricao": "…", "categoria": "campanha",
              "requer": ["multipedidos_api"], "aviso": "…",
              "variaveis": [ { "chave": "LINK_CARDAPIO", "rotulo": "Link do cardápio", "exemplo": "https://…", "obrigatoria": true } ] },
  "schemaVersion": 1, "nome": "…", "tipo": "campanha", "gatilho": {}, "nodes": [], "edges": [], "viewport": {} }
```

- `variaveis`: `{{CHAVE}}` é substituído nos textos ao instanciar; só as chaves declaradas são tocadas (variáveis de execução como `{{cupomCodigo}}` ficam). Obrigatória vazia → erro; opcional vazia → fica o placeholder para editar.
- `requer`: integrações que o modelo usa; o modal mostra "(desligada)" quando a API da Multipedidos está inativa.
- Publicar um modelo: exportar o fluxo, acrescentar o bloco `modelo`, salvar em `fluxos-modelos/` e commitar — versionado em git, sem tabela.
- Rotas: `GET /api/fluxos/modelos` (lista) e `POST /api/fluxos/modelos/:slug/instanciar` (`{ nome, variaveis }`).

Modelos publicados: `campanha-indicacao`, `teste-cupom-multipedidos`.

---

## Import / Export

Formato JSON exportável entre ambientes:

```bash
# Exportar
curl http://localhost:3007/api/fluxos/export/1 -o fluxo-campanha.json

# Importar
curl -X POST http://localhost:3007/api/fluxos/import \
  -H "Content-Type: application/json" \
  -d @fluxo-campanha.json
```

Útil para versionar fluxos em Git ou replicar entre instâncias.

---

## Utilitário admin

`scripts/reclassificar-fluxos.js` — script para reclassificar tipos de fluxos em lote.

---

## Teste de webhook

```bash
node teste-webhook.js
```

Script CLI que dispara webhook de automação de exemplo.
