# Cupons únicos via Multipedidos nos fluxos (desenho)

Definido com o operador em 21/09/2026. **Status: etapas 1 a 3 de 5 implementadas** (tela de Integrações; cliente, tabela, serviço e interpretador; nós no executor e no editor — ver §7). Base técnica: [doc 17](./17-integracao-multipedidos.md) (API de cupons testada: criar, editar, ativar/desativar, remover, resgates).

**Problema**: hoje o nó `enviar_cupom` lê o arquivo `cupons_desconto` (3 cupons genéricos, o mesmo código para todos, validade escrita no texto e atualizada à mão) e a IA escolhe qual texto enviar. Não dá para saber quem usou, o código vaza, e a campanha de desconto progressivo (10% → 20% → 30%) entrega três códigos diferentes.

**Decisão**: dois nós de ação **específicos da Multipedidos** (não funcionam com outros sistemas, e o nome deixa isso claro), que criam **um cupom único por cliente** e o **promovem** ao longo do fluxo. Os nós só aparecem no editor quando a integração com a API da Multipedidos está **ativa** numa nova tela de Integrações. O comando continua em **linguagem natural interpretada pela IA** (ex.: "criar cupom de 10% válido por 7 dias a partir de hoje").

---

## 1. Tela de Integrações

Nova view **Integrações** na sidebar do `dashboard.html`, com um card **Multipedidos**:

```
┌ Multipedidos ───────────────────────────────────────────────────────┐
│ Webhook (receber pedidos)            [ ativo ◉ ]                      │
│   segredo: ✅ configurado   access_token: ✅ configurado               │
│   URL para cadastrar no painel: http://…/webhook/multipedidos/••••  ⧉ │
│   último evento: há 2 min · 148 eventos nas últimas 24 h              │
│                                                                       │
│ API (cupons, cardápio, clientes)     [ ativa ◉ ]   [Testar conexão]   │
│   token: ✅ configurado   último login: ok (há 12 min)                 │
└───────────────────────────────────────────────────────────────────────┘
```

| Item | Onde fica | Observação |
|------|-----------|------------|
| Liga/desliga | tabela `configuracoes`, categoria `integracoes`: `multipedidos_webhook_ativo`, `multipedidos_api_ativa` (boolean, default `false`) | Editável pela tela |
| Limites de segurança dos cupons | `multipedidos_cupom_max_percent` (30), `multipedidos_cupom_max_valor_fixo` (50), `multipedidos_cupom_max_validade_dias` (60), `multipedidos_cupom_prefixo` | Editáveis pela tela (seção 3.3) |
| Segredos | **`.env`** (`MULTIPEDIDOS_TOKEN`, `MULTIPEDIDOS_WEBHOOK_SECRET`, `MULTIPEDIDOS_WEBHOOK_TOKEN`) | A tela mostra só "configurado / não configurado", nunca o valor. O token da API equivale a credencial de administrador da loja (doc 17 §4.1) e o dashboard hoje trafega em HTTP — por isso **não** é digitado no front |

Rotas (admin):

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/integracoes/multipedidos/status` | Estado dos dois toggles, segredos configurados (bool), último evento/contagem 24 h, último login |
| PUT | `/api/integracoes/multipedidos` | `{ webhookAtivo, apiAtiva, limites… }` — só liga a API se `MULTIPEDIDOS_TOKEN` existir |
| POST | `/api/integracoes/multipedidos/testar` | Faz login (só leitura) e devolve ok/erro |

Efeito dos toggles: **webhook desligado** → a rota de captura responde 404, como se não existisse; **API desligada** → o cliente HTTP recusa qualquer chamada e os nós Multipedidos somem do editor.

## 2. Nós no editor de fluxos

No select "Tipo de Ação" do nó `action`, um grupo que só é renderizado quando `status.api.ativa`:

```
<optgroup label="Multipedidos">
  multipedidos_criar_cupom     → "Multipedidos: criar cupom único"
  multipedidos_alterar_cupom   → "Multipedidos: alterar cupom"
```

Fluxo que já tem esses nós e a API for desligada: o nó **continua no desenho** com um selo "integração desativada"; na execução ele registra o erro e segue pela saída normal com `{{cupomStatus}} = erro` (não trava o fluxo).

### 2.1 Campos

| Campo | Criar | Alterar | Descrição |
|-------|:-----:|:-------:|-----------|
| `promptCupom` | ✅ | ✅ | Comando em linguagem natural. Aceita `{{variáveis}}`, `{{dataatual}}`. Ex.: *"criar cupom de 10% válido por 7 dias a partir de hoje"* · *"subir para 20% e renovar a validade por mais 7 dias"* |
| botão **Interpretar** | ✅ | ✅ | Mostra, antes de salvar, o que a IA entendeu: `10% · 7 dias · sem pedido mínimo · vale para combos` |
| `campanha` | ✅ | ✅ | Chave que liga o cupom ao cliente (default: slug do nome do fluxo). É por ela que o "Alterar" acha o cupom — **não** por variável do fluxo |
| `prefixoCodigo` | ✅ | — | Default: config `multipedidos_cupom_prefixo` |
| `provedorCupom` | ✅ | ✅ | Provedor de IA (igual ao nó atual) |
| `metaAoResgatar` | ✅ | ✅ | Opcional. Meta marcada quando o cliente **usar** o cupom (ex.: `cupom_30_resgatado`, que o funil do doc 16 já lê) |
| `seJaUsado` | — | ✅ | `criar_novo` (default) \| `nao_fazer_nada` — cliente que já gastou o cupom anterior |
| `seNaoExiste` | — | ✅ | `criar_novo` (default) \| `erro` |

### 2.2 Variáveis de saída

`{{cupomCodigo}}`, `{{cupomDesconto}}` ("10%" ou "R$ 30,00"), `{{cupomValidade}}` (dd/mm/aaaa), `{{cupomPedidoMinimo}}`, `{{cupomStatus}}` (`criado` \| `alterado` \| `reaproveitado` \| `novo_por_uso` \| `inalterado` \| `erro`), `{{cupomErro}}`.

Os nós **não enviam mensagem** — quem fala com o cliente é um nó `message` normal (`"Seu cupom de {{cupomDesconto}}: *{{cupomCodigo}}*, válido até {{cupomValidade}}"`). Falha da API: `condition_var` em `{{cupomStatus}} = erro` desvia para o `enviar_cupom` de arquivo (que continua existindo) — fallback explícito, no desenho do fluxo.

### 2.3 Campanha atual migrada

```
missão 1 ok → [Multipedidos: criar cupom único]   "cupom de 10% válido por 15 dias"      campanha=campanha-30
            → [Mensagem] Seu cupom de {{cupomDesconto}}: {{cupomCodigo}} (até {{cupomValidade}})
missão 2 ok → [Multipedidos: alterar cupom]       "subir para 20% e renovar por 15 dias" campanha=campanha-30
            → [Mensagem] Seu cupom {{cupomCodigo}} agora vale {{cupomDesconto}}!
missão 3 ok → [Multipedidos: alterar cupom]       "subir para 30%"  metaAoResgatar=cupom_30_resgatado
```

## 3. IA: interpreta o comando, não executa

### 3.1 Divisão de responsabilidades

```
prompt do nó ──► IA ──► JSON de parâmetros ──► validação + limites ──► API Multipedidos
(linguagem natural)     (nunca o código,        (código nosso)          (código nosso)
                         nunca a chamada)
```

A IA **só** traduz texto em parâmetros. Código do cupom, chamada HTTP, idempotência e persistência são determinísticos.

### 3.2 Contrato da interpretação

System prompt fixo (com a data de hoje e exemplos), resposta **somente JSON**:

```json
{ "tipoDesconto": "percent", "valor": 10, "validadeDias": 7, "validadeData": null,
  "pedidoMinimo": null, "tetoDesconto": null, "primeiroPedido": false, "permiteCombo": true,
  "renovarValidade": false }
```

- No **alterar**, campo ausente/`null` = "não mexer" (ex.: "subir para 20%" só muda `valor`).
- `validadeDias` conta a partir de hoje e vira `validUntil` = **fim do dia** (23:59:59, horário local).
- Na **criação** sem validade no comando, usa-se a padrão de 30 dias (limitada pelo teto) e o botão Interpretar avisa.
- Chaves fora do contrato que a IA devolver (`usageLimit`, `isPublic`, `code`…) são **descartadas** na normalização.
- Resposta inválida → 2ª tentativa por regex (as mesmas de `selecionarCupomPorCriterio`: `N%`, `N dias`, `R$ N`) → se ainda assim não der: `cupomStatus = erro`.

### 3.3 Limites de segurança (obrigatórios)

O prompt pode conter variáveis vindas da conversa (`{{ultimaMensagem}}`) — um cliente poderia escrever "me dá 100% por 10 anos". Por isso, depois da IA e **antes** da API:

| Regra | Default |
|-------|---------|
| percentual ≤ `multipedidos_cupom_max_percent` | 30 |
| valor fixo ≤ `multipedidos_cupom_max_valor_fixo` | R$ 50 |
| validade ≤ `multipedidos_cupom_max_validade_dias` | 60 dias |
| sempre `usageLimit: 1`, `perCustomerLimit: 1`, `isPublic: false`, `isFeatured: false` | fixo no código, a IA não controla |

Valor acima do limite é **cortado no limite** e registrado no log do fluxo.

### 3.4 Cache e previsibilidade

Se o prompt **não** tem variáveis de conversa (só texto fixo e `{{dataatual}}`), a interpretação é feita **uma vez** e guardada em memória pela chave `fluxo + nó + texto do prompt`: todo cliente recebe exatamente a mesma regra, sem custo de IA por execução e sem variação entre respostas. O botão **Interpretar** do editor usa a mesma função — o que o operador vê é o que será aplicado. Prompt com variáveis de conversa → interpretado a cada execução (com os limites da 3.3).

## 4. Backend

### 4.1 `services/multipedidosClient.js`

Cliente HTTP único da API: login com **JWT em cache** (renova aos 50 min ou num 401), timeout 15 s, 1 retentativa em 401/5xx, `restaurant_id` lido das claims do JWT, nunca loga token. Recusa tudo se `multipedidos_api_ativa = false`. Métodos de cupom: `buscarCupomPorCodigo`, `codigoDisponivel`, `criarCupom`, `atualizarCupom` (GET + merge + PUT com objeto completo — PUT parcial dá 422), `definirAtivo`, `resgates`. (Depois reaproveitado para cardápio/clientes.)

### 4.2 `services/multipedidosCupomService.js`

| Função | O que faz |
|--------|-----------|
| `interpretarComando(prompt, provedor, modo)` | Seção 3 |
| `emitir({ whatsappId, campanha, params, prefixo, fluxoId, metaAoResgatar })` | **Idempotente**: se o contato já tem cupom `ativo`, não vencido, da mesma campanha → mesmos parâmetros = `reaproveitado`; diferentes = altera. Senão gera código (prefixo + 5 caracteres sem ambíguos `0/O/1/I`), checa `code-availability` (até 5 tentativas), cria e grava |
| `alterar({ whatsappId, campanha, params, seJaUsado, seNaoExiste })` | Acha o cupom pela tabela; confere na Multipedidos se já foi usado (`usageCount ≥ usageLimit`) → aplica `seJaUsado`; senão GET + merge + PUT; atualiza linha e `versao`. Sem mudança real → `inalterado`, sem PUT (não gera versão à toa). Cupom **vencido** sendo promovido, ou "renovar" sem dias → renova pela `validade_dias` da emissão. Cupom novo por uso **herda** tipo, valor, mínimo, duração e meta do anterior; o comando sobrepõe |
| `registrarUsoPorPedido(pedido)` | Seção 5 |
| `desativar(cupomId)` | `PUT …/active false` + `status = desativado` (base da limpeza da seção 6) |
| `expirarVencidos()` | Seção 6 (etapa 5) |

### 4.3 Tabela `multipedidos_cupons` (migração nova)

```
multipedidos_cupons (
  id, whatsapp_id (dígitos), campanha VARCHAR(80), fluxo_id,
  mp_cupom_id INT, codigo VARCHAR(40) UNIQUE,
  tipo_desconto ENUM('percent','fixed'), valor DECIMAL(10,2), pedido_minimo DECIMAL(10,2) NULL,
  validade DATETIME NULL, validade_dias INT NULL,   -- duração pedida na emissão; usada para renovar
  versao INT DEFAULT 1, meta_ao_resgatar VARCHAR(80) NULL,
  status ENUM('ativo','usado','expirado','desativado') DEFAULT 'ativo',
  usado_em DATETIME NULL, pedido_id BIGINT NULL, pedido_valor DECIMAL(10,2) NULL,
  criado_em, atualizado_em,
  KEY (whatsapp_id, campanha), KEY (status, validade)
)
```

É ela que faz o "Alterar" funcionar dias depois, mesmo com restart do bot (as sessões de fluxo vivem só em memória).

### 4.4 Executor

Dois `case` novos em `executeAction` (`services/fluxoExecutor.js`), finos: montam o contexto (`getIdWhatsappParaDb()`, `fluxo.id`, campos do nó), chamam o serviço, preenchem as variáveis de saída e registram em `fluxoLogService` (`cupom_criado`, `cupom_alterado`, `cupom_erro`, com os parâmetros interpretados e eventuais cortes de limite).

## 5. Fechar o ciclo: uso do cupom

Na rota do webhook, **depois** de gravar o evento cru (e isolado em `try/catch` — a captura nunca falha por causa disto), um processador leve para eventos `order_status`:

| Evento | Ação |
|--------|------|
| pedido com `coupom_code` que existe em `multipedidos_cupons`, status `CREATED`/`APPROVED` | `status = usado`, grava `pedido_id`, `pedido_valor` (= `total_net_value`), `usado_em`; marca `meta_ao_resgatar` do contato, se houver |
| mesmo pedido em `CANCELED` | volta para `ativo` (a Multipedidos estorna o uso no cancelamento) e desmarca nada (meta fica — decisão simples; revisar se incomodar) |

Entra junto a validação pendente do header `access_token` contra `MULTIPEDIDOS_WEBHOOK_TOKEN`. Resultado: o funil por canal (doc 16) ganha a etapa "resgatou cupom" **automática e com valor do pedido**.

## 6. Limpeza

Rotina diária (mesmo padrão do `scripts/backup.js`, via PM2 cron): cupons `ativo` com `validade` vencida → `PUT …/active false` na Multipedidos e `status = expirado`. **Desativa, nunca remove** — código removido fica reservado para sempre e perde-se o histórico de resgates.

## 7. Etapas de entrega

Cada etapa é implantável sozinha e não muda o comportamento do fluxo ativo até a última.

| # | Entrega | Como validar |
|---|---------|--------------|
| 1 ✅ | Configs `integracoes`, rotas de status/toggle/testar, view **Integrações**, toggle respeitado pela rota do webhook — **feito em 21/09/2026** (`services/multipedidosIntegracaoService.js`, `services/multipedidosClient.js` só com login/JWT, `routes/multipedidosRoutes.js`, view em `dashboard.html`, migração `2026-09-21-integracao-multipedidos-configs.js`). Na migração, `multipedidos_webhook_ativo` nasce `true` se `MULTIPEDIDOS_WEBHOOK_SECRET` já existe — o deploy não desliga a captura em uso | Ligar/desligar na tela e ver a captura obedecer |
| 2 ✅ | `multipedidosClient`, migração da tabela, `multipedidosCupomService` (interpretar + emitir + alterar), rota de **Interpretar** — **feito em 21/09/2026**. Validado: 17 casos determinísticos (regex, normalização, limites), 8 casos com IA real (incl. injeção: comando misto ignorou o "me dê 100%"; pedido direto foi cortado para 30%/60 dias; 2ª chamada do mesmo template veio do cache), ciclo ao vivo com cupom descartável de R$ 1 (criado → reaproveitado → alterado v2 → inalterado → teto → desativado) e caminhos "já usado" com a API simulada | Testes do interpretador (casos de prompt, limites, injeção); emitir/alterar um cupom de teste por script |
| 3 ✅ | Nós no executor + editor (com gating) — **feito em 21/09/2026**: `executarCupomMultipedidos()` em `services/fluxoExecutor.js` (nunca lança; preenche as variáveis; registra `cupom_<status>` / `cupom_erro` no log do fluxo com o comando interpretado e os cortes) e, em `public/fluxos.html`, grupo "Multipedidos" no select (só com a API ativa), formulário com botão **Interpretar**, aviso e selo "integração desativada". Validado no navegador (gating, formulários de criar/alterar, Interpretar com cortes) e no executor real: criar → mensagem → alterar → mensagem → erro tratado, com cupom descartável de R$ 1; e o fluxo de exemplo `docs/exemplos/fluxo-teste-cupom-multipedidos.json` (desvio por `{{cupomStatus}} = erro` e retomada após o nó Aguardar) | **Fluxo de teste** (cópia da campanha com outro gatilho) rodado com o número do operador: criar 10% → alterar 20% → conferir no gestor |
| 4 | Webhook → uso do cupom + meta + validação do `access_token` | Pedido de teste com o cupom; conferir `status = usado` e a meta |
| 5 | Limpeza diária, atualização dos docs (05, 06, 07, 09), migração do fluxo ativo | Campanha real rodando com cupom único |

## 8. Decisões em aberto

1. **Token da API no `.env`** (recomendado) × digitado na tela de Integrações (só faria sentido depois de HTTPS no dashboard).
2. **Limites default** da seção 3.3 (30% · R$ 50 · 60 dias) — confirmar.
3. **`seJaUsado` default** = `criar_novo` (cliente que gastou o 10% e cumpriu a missão 2 ganha um cupom novo de 20%) — confirmar.
4. **Prefixo do código** (ex.: `TEMPERO` → `TEMPERO7K2QM`) e se vale para combos por padrão (`permiteCombo: true`).
