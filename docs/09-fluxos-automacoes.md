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
| `trigger` | Gatilho | — | 1 | Início; palavra-chave ou mensagem exata |
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
| `multipedidos_alterar_cupom` | **Multipedidos: alterar cupom** — promove/ajusta o cupom que o contato recebeu na mesma campanha (ex.: "subir para 20% e renovar a validade") |

Os dois nós Multipedidos ([doc 18](./18-cupons-multipedidos.md)) **só aparecem no editor com a API da Multipedidos ativa** (Dashboard → Integrações); nó já existente num fluxo continua editável, com o aviso "integração desativada". Eles **não enviam mensagem**: preenchem `{{cupomCodigo}}`, `{{cupomDesconto}}`, `{{cupomValidade}}`, `{{cupomPedidoMinimo}}`, `{{cupomStatus}}` (`criado`, `alterado`, `reaproveitado`, `novo_por_uso`, `inalterado`, `erro`) e `{{cupomErro}}` para os nós seguintes. Nunca travam o fluxo: em falha seguem pela saída normal com `{{cupomStatus}} = erro` — use um **Verificar variável** para desviar (ex.: para o `enviar_cupom` de arquivo). O botão **Interpretar** do formulário mostra o que a IA entendeu do comando, já com os limites de segurança aplicados. Fluxo de exemplo importável: `docs/exemplos/fluxo-teste-cupom-multipedidos.json`.

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
