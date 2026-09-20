# Canais de Aquisição e Funil (escopo)

Definido com o operador em 20/09/2026. Problema: o fluxo de indicação (cerne do produto) será divulgado por vários canais — QR para clientes iFood, pós-venda, QR impresso em caixas, panfletos, tráfego pago — e é preciso saber **de onde veio cada cliente** para um dashboard com funil de conversão por canal.

**Decisão**: fluxo permanece **único**; a origem é rastreada na **porta de entrada** (Opção B — canais como entidade). Duplicar fluxos por canal foi descartado (manutenção multiplicada).

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
          trafego_pago, outro], mensagem_entrada UNIQUE, ativo, criado_em)
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

### Etapa 1 — Atribuição + gestão de canais
- Migração `canais` + colunas em `contatos`
- Atribuição no pipeline de mensagens (primeiro contato)
- Aba **Canais** no dashboard: CRUD + geração automática de link `wa.me` e **QR em PNG** (lib `qrcode` já no projeto) para download/impressão
- Canal "orgânico" implícito (sem cadastro)

### Etapa 2 — Dashboard de funil
- Gráfico funil (Chart.js) com filtro por canal e período
- Tabela comparativa entre canais: chegadas, % por etapa, conversão final
- Card de resumo na visão geral

### Etapa 3 — Canais ativos (pós-venda)
- Automações/envios em massa aceitam canal de origem e marcam contatos no envio
- (Futuro) relatório de reengajamento por canal

## 5. Fora de escopo por ora
- Custo por canal / ROI (exigiria lançar gastos por canal — candidata a 2ª rodada)
- Rastreio de cliques no link antes do WhatsApp (encurtador próprio) — só se a perda por texto apagado se mostrar relevante
