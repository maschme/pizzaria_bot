# Canais de Aquisição e Funil (escopo)

Definido com o operador em 20/09/2026. Problema: o fluxo de indicação (cerne do produto) será divulgado por vários canais — QR para clientes iFood, pós-venda, QR impresso em caixas, panfletos, tráfego pago — e é preciso saber **de onde veio cada cliente** para um dashboard com funil de conversão por canal.

**Decisão**: fluxo permanece **único**; a origem é rastreada na **porta de entrada** (Opção B — canais como entidade). Duplicar fluxos por canal foi descartado (manutenção multiplicada).

**Atualização (22/09/2026, [doc 20](./20-modelos-e-fluxos-completos.md) A0)**: o canal passou a poder **apontar o fluxo que inicia** (`canais.fluxo_id`). Quando a 1ª mensagem casa com um canal que aponta um fluxo ativo, o bot marca a origem **e inicia esse fluxo** (com `{{canalSlug}}` e `{{canalNome}}` nas variáveis), com prioridade sobre o gatilho de texto. Canal sem fluxo (ou com fluxo inativo/apagado) continua só marcando a origem e a mensagem cai no gatilho como antes. A mensagem do canal segue sendo o identificador da origem, mas deixou de precisar coincidir com uma frase de gatilho.

**Canal por evento (22/09/2026)**: até aqui a origem só era atribuída quando o cliente mandava a mensagem do canal — quem o **bot** aborda (indicado, pós-venda) nunca manda essa frase e ficava fora do funil. Agora um canal pode ser de **evento**: no cadastro, "Como o cliente chega" → *Por ação do bot*, e escolhe-se o evento (`indicacao_registrada`, `pedido_concluido`). Quando a abordagem ativa (doc 20 B0) inicia o fluxo daquele evento, o contato é marcado com esse canal e o fluxo recebe `{{canalNome}}`/`{{canalSlug}}`.

| Regra | Comportamento |
|-------|---------------|
| Canal de evento não tem frase nem QR | `mensagem_entrada` e `fluxo_id` ficam nulos (o fluxo é o do evento); a tela esconde esses campos e o botão de QR |
| Um evento, um canal | `UNIQUE` em `canais.evento` — um segundo canal para o mesmo evento é recusado |
| Nunca sobrescreve | Quem já veio por QR/panfleto mantém a origem original |
| Canal inativo | Não atribui |
| Sem canal para o evento | A abordagem acontece normalmente, só sem origem no funil |

---

## 1. Como funciona

Todo canal desemboca numa mensagem de WhatsApp. Cada canal cadastrado gera um link `wa.me/<numero>?text=<mensagem única do canal>` e o QR correspondente. Quando a primeira mensagem do cliente casa com o texto de um canal, o contato é marcado com aquele canal — uma única vez, permanente. Sem correspondência → canal "orgânico". Canais em que o bot inicia a conversa (pós-venda) marcam o contato no envio.

```
QR caixa ──┐
Panfleto ──┤   wa.me?text=<msg do canal>   ┌─ contatos.canal_id (1º contato)
iFood ─────┼──────────► BOT (1 fluxo) ─────┤
Tráfego ───┤                               └─ funil por canal (dados já existentes:
Pós-venda ─┘ (marcado no envio)                sessões, metas, indicações, grupo)
```

## 2. Modelo de dados (banco de cada instância)

```
canais   (id, nome, slug UNIQUE, tipo ENUM[qr_caixa, panfleto, ifood, pos_venda,
          trafego_pago, outro], mensagem_entrada UNIQUE, fluxo_id NULL, ativo, criado_em)
          -- fluxo_id (22/09/2026, doc 20 A0): fluxo iniciado quando o canal casa; NULL = só rastreia a origem
          -- evento  (22/09/2026): canal atribuído quando o BOT aborda por esse evento; então
          --                       mensagem_entrada e fluxo_id ficam NULL (UNIQUE por evento)
contatos + canal_id INT NULL (FK lógica), canal_atribuido_em TIMESTAMP NULL
```

Regras de atribuição:
- Marca **apenas no primeiro contato** (contato novo ou `canal_id IS NULL` sem histórico); nunca sobrescreve
- Matching: mensagem recebida normalizada (trim/minúsculas) igual ou começando com `mensagem_entrada` do canal ativo
- Cliente que apaga o texto pré-preenchido → "orgânico" (aceitável; texto curto e atrativo minimiza)

## 3. Funil (etapas por canal)

| Etapa | Fonte do dado (já existe) |
|---|---|
| 1. Chegou | `contatos` criados (por canal) |
| 2. Iniciou campanha | sessão de campanha criada / meta iniciada |
| 3. Missão 1 — entrou no grupo | `contatos.cam_grupo` / meta `entrada_grupo` |
| 4. Missão 2 — 10 indicações | `contatos.cam_indicacoes` / meta `10_indicacoes` |
| 5. Converteu | meta `cupom_30` / pedido registrado |

A única dimensão nova necessária é `canal_id` — as etapas já são registradas hoje.

## 4. Entregas

### Etapa 1 — Atribuição + gestão de canais ✅ (20/09/2026)
- Migração `2026-09-20-canais.js` (tabela `canais` + `contatos.canal_id`/`canal_atribuido_em`)
- `services/canalService.js`: CRUD, atribuição no pipeline (1º contato, nunca sobrescreve, cache 60s), link `wa.me` e QR PNG
- Aba **Canais** no dashboard: CRUD, contagem de contatos por canal, modal com QR (download PNG) e link copiável
- Canal "orgânico" implícito. Testado contra banco real: criação, matching normalizado, não-sobrescrita, mensagem orgânica, QR

### Etapa 2 — Dashboard de funil ✅ (20/09/2026)
- Aba **Funil** no dashboard: gráfico de barras (Chart.js) das 5 etapas, filtro por canal e período (7d/30d/tudo/datas livres), tooltip com % sobre chegadas
- Tabela comparativa por canal com % por etapa e linha de total
- Coluna **Canal** na aba Contatos (JOIN com fallback para instâncias sem a migração)
- API: `GET /api/dashboard/funil?inicio=&fim=` (`canalService.obterFunil`, com fallback para instâncias sem tabelas de sessão/metas)
- Pendente desta etapa: card de resumo na visão geral (baixa prioridade — a aba Funil cobre)

### Etapa 3 — Canais ativos (pós-venda) ✅ (20/09/2026)
- `canalService.marcarCanal(numero, idOuSlug)`: marcação ativa com a mesma regra (nunca sobrescreve; canal precisa estar ativo); slugs agora sem acentos
- Pontos de envio que aceitam `canal` opcional no body:
  - `POST /send-message` (integrações externas — ex.: automação pós-venda da Multipedidos, doc 17)
  - `POST /api/dashboard/chats/:chatId/iniciar-fluxo` (com seletor "Canal de origem" no gerenciador de chats)
  - `POST /api/dashboard/indicacoes/:id/mensagem`
- (Futuro) relatório de reengajamento por canal

## 5. Fora de escopo por ora
- Custo por canal / ROI (exigiria lançar gastos por canal — candidata a 2ª rodada)
- Rastreio de cliques no link antes do WhatsApp (encurtador próprio) — só se a perda por texto apagado se mostrar relevante
