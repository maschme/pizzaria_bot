# Integração Multipedidos (estudo)

Iniciado em 20/09/2026. Objetivo: integrar o bot à **Multipedidos** (sistema de pedidos/delivery do cliente) em dois sentidos — **receber webhooks** (eventos de pedido) e **consultar a API** com o token gerado no painel deles.

**Situação**: não temos documentação oficial. Este documento é o caderno de estudo: registra o que foi pesquisado, como capturar os webhooks reais e — conforme chegarem — o formato observado de cada evento e endpoint. Só depois de documentado o formato é que a integração "de verdade" (funil, automações, IA) será implementada.

---

## 1. Pesquisa de documentação

Pesquisa feita em 20/09/2026, sem usar token (só fontes públicas). **Não existe documentação pública oficial** — nem subdomínio de docs, nem Swagger/Postman, nem artigo na central de ajuda (`ajuda.multipedidos.com.br`, módulo Integrações só cobre iFood/TOTVS/TEF). Não segue o padrão Open Delivery (modelo de pedido proprietário). Duas fontes indiretas revelam quase todo o contrato. Legenda: **[fato]** lido na fonte · **[inferência]** dedução nossa, a confirmar.

### 1.1 Fontes

| Fonte | O que é |
|-------|---------|
| `https://app.multipedidos.com.br/js/app.js` | Bundle público do painel (AngularJS) — telas de Token de Integração e Webhook, rotas que o painel chama |
| `https://github.com/henriquefelipe/marketplace` → `MarketPlace/MultiPedido/` | Cliente C# open-source (jul–nov/2023) de um integrador de PDV: URLs, headers, modelo de pedido, enums |
| `https://help.foodydelivery.com/knowledge-base/multipedidos/` | Foody recebe um evento por pedido Delivery criado; a URL é cadastrada pelo suporte da Multipedidos. Sem payload |

### 1.2 API — base e autenticação

- **[fato]** Base de produção: `https://api.multipedidos.com.br/` (existe também `green.` — blue/green). Backend PHP atrás de CloudFront; rota inexistente → 404 `{"message": ""}`.
- **[fato]** No painel, card **Token de Integração** (Integrações): mostra **ID do restaurante** e o token; "Gerar token" exige código 2FA enviado ao e-mail do admin (`POST /generic-token/polling/integration/{restaurantId}`). iComanda e Agilizone usam a mesma tela; Repediu tem card próprio.
- **[inferência, média-alta]** Esse é o token que temos, e ele serve ao fluxo de **polling** abaixo (o nome da rota é "polling").

Fluxo do cliente C# (estilo iFood: poll → acknowledge → status):

| Passo | Chamada | Autenticação |
|-------|---------|--------------|
| Login | `POST /integration/auth/login` | header `x-integration-token: <token>` → `{ "token": "<jwt>" }` |
| Buscar pedidos | `GET https://2bhghu4v3iluwl77hwcmwkbije0rroef.lambda-url.us-east-1.on.aws/poll` | header `Authorization: <token de integração>` (sem "Bearer") → array de pedidos |
| Confirmar recebimento | `GET <mesma base>/acknowledge?orderID=<id>` | idem |
| Mudar status | `POST /restaurant/{restaurantId}/order/{orderId}/status` body `{"status":"..."}` | `Authorization: Bearer <jwt>` |

- **[fato]** Verificado sem token em 20/09/2026: `/integration/auth/login` responde **401** (rota viva); a URL Lambda responde 502 sem header; a rota de status é a mesma que o painel usa hoje (o painel envia ainda `cancellationReason`, `currentUserID`, `refundPayment`).
- **[inferência]** A URL Lambda veio de código de terceiro de 2023 — pode ter mudado ou variar por parceiro. **Cuidado**: `acknowledge` e mudança de status têm efeito colateral (o pedido some do poll / muda de status na loja); na exploração, só login e `poll`.
- Não encontrado: endpoints de cardápio, clientes ou histórico de pedidos para integradores. O painel usa rotas `restaurant/{id}/...` com JWT de usuário — a testar se o JWT de integração as acessa.

### 1.3 Webhook — configuração no painel

- **[fato]** Card **Webhook** em Integrações (CRUD em `/restaurant/{id}/webhook-integration`). Três eventos, até 10 destinos cada:

| Tipo | Descrição na tela |
|------|-------------------|
| `order` | Recebe um POST a cada novo pedido |
| `order_status` | POST a cada mudança de status |
| `nfce` | POST a cada NFC-e emitida |

- **[fato]** Campos de cada destino: nome, **URL**, **Token de autenticação (access_token)** — obrigatório, escolhido por nós, guardado como `verification_token` — e ativo/inativo. Há histórico com **reenvio** (`/integrated-order-history`, `/resend/{orderID}`). Destinos têm `origin` = `panel`, `portal` ("portal do desenvolvedor" — URL pública não encontrada) ou suporte.
- Formato do payload e como o `access_token` chega não constam em nenhuma fonte pública — **respondido pelas capturas, ver seção 3** (chega como header `access_token`). **[inferência, média]** o payload de `order` deve ser o objeto da seção 1.4.

### 1.4 Modelo de pedido (do cliente C#, 2023)

Enums — **[fato]**, os mesmos valores aparecem no bundle do painel:

| Enum | Valores |
|------|---------|
| `order_status` | `CREATED`, `APPROVED`, `DONE`, `SENT`, `OVER`, `CANCELED`, `SCHEDULED` |
| `delivery_type` | `delivery`, `balcony`, `table` |
| item `type` | `general`, `combo`, `pizza` |
| `payment_method` | `money`, `creditCard`, `voucher` |
| `payment_method_operation` | `increase`, `discount` |
| `delivery_fee_discount_type` | `percent`, `fixed` |

Campos de `order`:

- **Identificação**: `id`, `uuid`, `order_no`, `restaurant_id`, `client_id`, `source`, `external_source`, `created_at`, `updated_at`
- **Status e tipo**: `order_status`, `delivery_type`, `is_table`, `table`, `car_takeout`, `car_plate`, `car_model_color`
- **Valores**: `total`, `total_net_value`, `delivery_fee`, `delivery_fee_net_value`, `delivery_fee_discount_type`, `delivery_fee_discount_value`, `service_fee`, `points_earned`
- **Pagamento**: `payment_method`, `card_payment_method`, `card_type`, `payment_status`, `online_payment_reference`, `payment_method_operation`, `payment_method_operation_value`, `need_change`, `change`
- **Outros**: `notes`, `name`, `phone`, `cashier_id`, `transmission_list_uuid`
- **`client`**: `id`, `uuid`, `name`, `phone`, `email`, `cpf`, `street`, `street_number`, `complemento`, `bairro`, `city`, `postal_code`, `referral`, `last_order_date`…
- **`items[]`**: `id`, `menu_item_id`, `menu_name`, `menu_price`, `quantity`, `type`, `notes`, `external_id`, `item_sub_total`, `ncm`, `is_weight_product`, `pizza_price`, `pizza_price_behavior`, `number_of_flavors` + `crust{}`, `flavors[]` (com `additionalToppings[]`), `extras[]`, `sizes[]` (com `dough[]`)
- **`history[]`**: `event`, `source`, `created_at`, `cancellation_reason_id`, `cancellation_notes`, `pos_user_id`

Para o nosso funil, os campos que importam: `client.phone`/`phone` (casar com `contatos`), `order_status`, `total`, `source`, `created_at`.

### 1.5 Pedir a documentação oficial

Suporte Multipedidos: WhatsApp +55 47 99548-215 (9h–23h30) ou chat dentro do gestor. Pedir: (1) documentação da integração por **Token de Integração (polling)**; (2) **payload dos webhooks** `order` / `order_status` / `nfce`; (3) acesso ao **portal do desenvolvedor**.

## 2. Captura de webhooks (implementado)

Endpoint que grava **a requisição crua** (método, headers, query, corpo exatamente como veio) e responde `200 {"ok":true}` na hora. Não interpreta nada — serve para descobrir o formato.

```
https://<host-público-da-instância>/webhook/multipedidos/<MULTIPEDIDOS_WEBHOOK_SECRET>
```

- Público, autenticado pelo **segredo na URL** (mesmo padrão de `/webhook/evolution/:secret`). Segredo errado → 401; variável não definida → 404 (endpoint desligado).
- Aceita **qualquer método** (alguns sistemas validam a URL com GET antes de ativar) e qualquer sub-caminho após o segredo (`/<secret>/qualquer/coisa` — fica registrado em `caminho`).
- Aceita qualquer `Content-Type` (JSON, form, XML, JSON malformado). É montado **antes** do `bodyParser.json` global justamente para isso — e para preservar o corpo byte a byte caso a Multipedidos assine o payload (HMAC).
- Se o banco falhar, headers e corpo vão para o log do processo (PM2) — o payload não se perde e a Multipedidos recebe 200 do mesmo jeito.
- Precisa de URL pública: usar a instância de **produção**, não o XAMPP local.

### Ativar

1. No `.env` da instância: `MULTIPEDIDOS_WEBHOOK_SECRET=<segredo forte>` (ex.: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
2. `node database/migrate.js` (cria `webhook_eventos`) e reiniciar o processo PM2.
3. No painel da Multipedidos → Integrações → **Webhook**: cadastrar a URL acima nos **três eventos** (`order`, `order_status`, `nfce`). No campo obrigatório "Token de autenticação (access_token)" usar um valor **diferente** do segredo da URL e fácil de reconhecer (ex.: `mp-token-<aleatório>`) — assim a captura mostra por onde ele chega (header, query ou body). Anotar esse valor em `MULTIPEDIDOS_WEBHOOK_TOKEN` no `.env` para validarmos depois.
4. Fazer pedidos de teste passando por todos os status (novo, aceito, em preparo, saiu para entrega, concluído, cancelado; retirada × entrega; pagamento online × na entrega).

### Consultar o que chegou (admin)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/integracoes/multipedidos/eventos?limite=50` | Lista resumida (mais recentes primeiro; máx. 500) |
| GET | `/api/integracoes/multipedidos/eventos?corpo=1` | Lista com headers e corpo |
| GET | `/api/integracoes/multipedidos/eventos/:id` | Evento completo |

Exigem `ADMIN_TOKEN` (header `x-admin-token`, `Authorization: Bearer` ou `?token=`).

### Tabela `webhook_eventos`

```
webhook_eventos (id, origem ['multipedidos'], metodo, caminho, query_string, content_type,
                 headers LONGTEXT(JSON), body LONGTEXT (cru), body_json_valido, ip, recebido_em)
```

Genérica por `origem` — serve para estudar outros sistemas no futuro.

Código: `routes/multipedidosRoutes.js`, `services/webhookEventoService.js`, migração `database/migrations/2026-09-20-webhook-eventos.js`.

## 3. Webhooks observados

Capturas reais de 20/09/2026 — 20 eventos de 6 pedidos: PDV (mesa, balcão, delivery com combo de pizza) e cardápio digital (`source: web`, delivery e balcão), passando por `CREATED`, `APPROVED`, `DONE`, `SENT`, `OVER` e `CANCELED`. **[fato]** = visto nas capturas.

### 3.0 Transporte e autenticação

- **[fato]** A Multipedidos **entrega em `http://` e porta fora do padrão** (`:3087`) — não exige HTTPS. (As primeiras tentativas falharam por URL cadastrada errada no painel, não por protocolo.)
- **[fato]** `POST`, `Content-Type: application/json`, `User-Agent: axios/<versão>`, sem header de assinatura (HMAC) e sem id de entrega. Origem: IPs variados da AWS us-east-1 (um diferente por requisição) → **não dá para filtrar por IP**.
- **[fato]** O "Token de autenticação (access_token)" cadastrado no painel chega como **header HTTP `access_token: <valor>`** (nome com underscore, valor puro, sem "Bearer"). Não vem em query nem body.
  - ⚠️ Nginx descarta headers com underscore por padrão (`underscores_in_headers off`). Se um dia houver proxy reverso na frente, habilitar essa opção — senão o token some.
  - Validação ainda **não implementada** (pendente para a fase de integração): comparar o header com `MULTIPEDIDOS_WEBHOOK_TOKEN`.
- **[fato]** Latência ~1 s entre o evento no PDV e a chegada do POST. Comportamento de retry: ainda não observado (sempre respondemos 200).
- **[fato]** Datas do payload (`created_at`, `updated_at`) em **horário local (BRT), formato `YYYY-MM-DD HH:mm:ss`, sem fuso**.

### 3.1 Como identificar o evento

O body **não tem campo de tipo de evento** — a distinção está na **query string** que a Multipedidos acrescenta à URL cadastrada:

| Evento (painel) | Query string | User-Agent | Body |
|-----------------|--------------|------------|------|
| `order` (novo pedido) — **[inferência, alta]** | `identificadorCliente=<restaurant_id>&referenciaPedido=<order.id>&status=CREATED` | `axios/1.6.8` | formato **enxuto** (3.3) |
| `order_status` | `status=<STATUS>&order_id=<order.id>&restaurant_id=<restaurant_id>` | `axios/1.3.3` | `CREATED`: formato **enxuto**; demais status: formato **completo** (3.4) |
| `nfce` | _não capturado ainda_ | — | — |

- **[fato]** Um pedido novo gera **dois POSTs no mesmo segundo**: o `order` e um `order_status` com `status=CREATED` — **em qualquer ordem** (já chegou um antes do outro nos dois sentidos). Quem consumir precisa **deduplicar** por `id` + `order_status`.
- **[fato]** O `order` carrega os itens no **formato legado de integração** (o mesmo do cliente C# de 2023 — `items[].sizes[]`, `crust`, `dough`, `additionalToppings`, `pizza_price`); o `order_status` carrega o **modelo persistido** (`items[].combo_items[]`, `crusts`, `doughs`, `additional_toppings`). Ver 3.4.1. **Recomendação: consumir só `order_status`** (cobre a criação e todas as transições, com um único formato de itens) e ignorar o evento `order`.
- **[fato]** `order_status` dispara para qualquer pedido da loja, inclusive os criados antes do cadastro do webhook.
- Como a Multipedidos acrescenta `?…` à URL, a URL cadastrada não deve ter query string própria.

### 3.2 Status observados

| `order_status` | Capturado? | Significado (a confirmar os não capturados) |
|----------------|-----------|---------------------------------------------|
| `CREATED` | ✅ | Pedido criado |
| `APPROVED` | ✅ | Aceito / em produção |
| `DONE` | ✅ | Pronto |
| `SENT` | ✅ | Saiu para entrega |
| `OVER` | ✅ | Finalizado (mesa encerrada / pedido concluído). Em pedido `web` veio com `ask_review: 1` |
| `CANCELED` | ✅ | Cancelado. Motivo em `history[]` (entrada `event: CANCELED`): `cancellation_reason_id` (numérico), `cancellation_notes` (texto livre do operador), `cancellation_notes_to_client`. O body ganha ainda `deferred_payment` na raiz |
| `SCHEDULED` | ⏳ | Agendado (`schedule_to`, `scheduled_order_no`) |

Não há ordem obrigatória entre status: vimos `CREATED → APPROVED → SENT`, `CREATED → APPROVED → DONE`, `… → DONE → OVER` e `CREATED → APPROVED → CANCELED`. O status atual vem em `order_status` e o histórico completo em `history[]` (entrada mais recente primeiro, as demais em ordem cronológica).

### 3.3 Body enxuto (`order` e `order_status=CREATED`)

É o objeto recém-criado, antes de ser relido do banco — booleanos como `true/false`, `restaurant_id` como **string**, `ncm` numérico. Exemplo (pedido de mesa sem cliente; dados neutros):

```json
{
  "id": 227000000, "uuid": "<hex64>", "order_no": 40000, "restaurant_id": "0000",
  "order_status": "CREATED", "source": "pos", "external_source": null, "integration_origin": null,
  "delivery_type": "table", "is_table": true, "table": "12", "car_takeout": 0, "quick_sale": false,
  "client_id": 70000000, "name": "", "phone": "0", "street_number": "",
  "total": 4, "total_net_value": 4, "service_fee": 0,
  "discount": 0, "discount_type": "fixedDis", "addition": 0, "addition_type": "fixedAdd", "cashback_spent": 0,
  "payment_method": "pix", "card_type": "", "card_payment_method": "", "need_change": false, "change": 0,
  "payment_method_operation": null, "payment_method_operation_value": null,
  "online_payment_reference": null, "is_deferred_payment": false, "payments": [],
  "notes": null, "cashier_id": 3400000, "open_pos_by_whatsapp": false, "was_offline": 0,
  "transmission_list_uuid": null,
  "created_at": "2026-09-20 21:45:25", "updated_at": "2026-09-20 21:45:25",
  "client": { "id": 70000000, "uuid": "<hex10>", "name": "", "phone": "", "cpf": "", "email": "",
              "street": "", "street_number": "", "complemento": "", "bairro": "", "city": "", "country": "Brasil",
              "referral": "", "source": "multipedidos", "birthday": null, "last_order_date": "…" },
  "items": [ { "id": 425000000, "menu_item_id": 132000, "menu_name": "Agua sem gás - 500ml", "menu_price": 4,
               "quantity": 1, "type": "general", "notes": "", "external_id": null, "item_sub_total": 4,
               "ncm": 30345, "extras": [] } ],
  "history": [ { "id": 712000000, "event": "CREATED", "source": "pos", "pos_user_id": 9000, "created_at": "…" } ]
}
```

Diferença entre os dois POSTs de criação: no `order`, `items[].id` repete o `menu_item_id` (o item ainda não tem id próprio) e vêm `featured`, `is_weight_product`, `car_plate`, `car_model_color`; no `order_status=CREATED`, `items[].id` já é o id real do item e vêm `order_id`, `cashier_id`, `guest_check_pad_id`.

### 3.4 Body completo (`order_status` ≠ `CREATED`)

É o pedido relido do banco (~6 KB para 1 item): tudo do formato enxuto **mais** os grupos abaixo. Tipos mudam: booleanos viram `0/1`, `restaurant_id` vira **número**, `ncm` vira **string** → normalizar antes de comparar.

| Grupo | Campos |
|-------|--------|
| Endereço/entrega | `address`, `address_ref`, `bairro`, `complemento`, `city`, `delivery_state`, `coordinates`, `delivery_fee`, `delivery_fee_net_value`, `delivery_fee_discount_type/value`, `motoboy_id`, `motoboy`, `motoboy_remuneration`, `bee_delivery_id` |
| Pagamento | `payment_status`, `payments[]`, `pix_payment`, `pix_asaas_payment_id`, `tuna_payment`, `tef_payment`, `tef_payment_id`, `integration_payment`, `mp_fee_id` |
| Desconto/fidelidade | `discount_value`, `coupom_code`, `coupom_type`, `coupom_free_product`, `points_earned`, `cashback_earned`, `cashback_spent` |
| Marketplaces | `ifood_*` (order_id, short_reference, order_status, delivery_by, localizer, merchant_id, sponsor…), `keeta_order_id`, `keeta_merchant_id`, `integration_order_id`, `integration_store_id`, `merchant_sponsor_value` |
| Origem/atribuição | `source` (**`pos`** = lançado no PDV/gestor, **`web`** = cardápio digital; outros valores ainda não vistos), `external_source`, `integration_origin`, `link_uuid`, `transmission_list_uuid`, `is_cart_recovery`, `journey_id`, `journey_order_id`, `open_pos_by_whatsapp`, `client.source` — todos `null`/0 nas capturas. ⚠️ `client.referral` **não é atribuição**: é o ponto de referência do endereço (igual a `address_ref`) |
| Agendamento/outros | `schedule_to`, `scheduled_order_no`, `ask_review`, `rating`, `invoice_id`, `isPrinted`, `is_updated`, `kds_priority`, `feature_flag{}`, `deleted_at` |
| `client{}` completo | + `orders_count`, `points`, `pending_points`, `ticket_average`, `first_order_date`, `last_valid_order_date`, `postal_code`, `gender`, `is_blocked`, `wabot_opted_out`, `bot_status`, `phone_verified_at`, `psid`, `facebook_id`, `google_id`… |
| `items[]` completo | + `is_combo`, `combo_id`, `combo_items[]`, `flavors[]`, `crusts`, `doughs`, `number_of_flavors`, `pizza_price_behavior`, `points_spent`, `quantity_double`, `guest_check_pad{}` (comanda: `table`, `items_total`, `is_closed`, `client_phone`, `client_name`…) |
| `history[]` completo | todos os eventos do pedido (não estritamente ordenado) + `cancellation_reason_id`, `cancellation_notes`, `cancellation_notes_to_client` + **`user{}`** do operador |

⚠️ **Dados pessoais**: `history[].user` traz nome, e-mail, celular e papel do usuário do PDV que fez a ação (ações do cliente no cardápio vêm com `user: null`); `client{}` traz nome, telefone, e-mail, **CPF**, endereço completo e coordenadas do cliente. Tudo fica gravado cru em `webhook_eventos` → tabela é dado sensível (LGPD): não replicar para logs/relatórios e **expurgar ao fim do estudo**.

#### 3.4.1 Itens: simples, combo e pizza

Item simples: `type: "general"`, com `extras[]` (`extra_name`, `extra_price`, `quantity`, `menu_item_id`). Combo de pizza no **modelo persistido** (`order_status`):

```json
{
  "id": 425000000, "menu_item_id": 5000, "menu_name": "Combo Pizza Grande + Refri", "type": "combo",
  "menu_price": 85.99, "quantity": 1, "item_sub_total": 93.99, "notes": "obs. do item",
  "extras": [ { "extra_name": "Refrigerante 1,5 L", "extra_price": 0, "quantity": 1, "menu_item_id": 160000 } ],
  "combo_items": [
    { "id": 425000001, "combo_id": 425000000, "is_combo": 1, "type": "combo_pizza_item",
      "menu_name": "Grande", "menu_price": 75.99, "item_sub_total": 93.99,
      "number_of_flavors": "3", "pizza_price_behavior": "incremental", "combo_pizza_assoc_id": 20000,
      "crusts": { "name": "Sem borda", "price": 0, "menu_item_id": 36000 },
      "doughs": null,
      "flavors": [ { "name": "Marguerita", "price": 0, "quantity": 1, "notes": "obs. do sabor",
                     "menu_item_id": 94000, "additional_toppings": [] } ] }
  ]
}
```

- `crusts` é **um objeto** (apesar do plural), não array. `pizza_price_behavior: "incremental"` = sabores/borda com `price` > 0 somam ao preço base (`item_sub_total` do tamanho = `menu_price` + acréscimos).
- `number_of_flavors` é string no body completo e número no enxuto.
- No evento `order` (formato legado) o mesmo combo vem como `items[].sizes[]` com `crust{}`, `dough[]`, `flavors[].additionalToppings[]`, `pizza_price`, e os `id` são os do cardápio (`menu_item_id`), não os do pedido.
- Pizza avulsa (fora de combo, `type: "pizza"`): vista só no formato legado, via poll — ver 4.2.

### 3.5 Pontos de atenção para a integração

- **Telefone**: `phone` (raiz) e `client.phone` vêm como **DDD + número, 11 dígitos, só dígitos, sem DDI** (ex.: `47900000000`). Para casar com `contatos`:
  - prefixar `55`;
  - ⚠️ **nono dígito**: a Multipedidos manda o celular com o 9; o WhatsApp identifica muitos números (DDD ≥ 31, caso de Joinville/47) **sem** o 9 — no log de produção o mesmo cliente aparece como `*Telefone:* 4799648XXXX` no pedido e `55479648XXXX@c.us` no chat. Comparar por **DDD + últimos 8 dígitos**, não por igualdade. O projeto ainda não tem essa normalização (`whatsappIdentityService` só extrai dígitos).
- **Pedido sem cliente identificado** (mesa/balcão no PDV): `phone` = `"0"` na raiz e `client.phone` = `""`, `name` vazio — mas um `client_id` novo é criado mesmo assim. Tratar `"0"`/vazio como "sem telefone" e ignorar no funil.
- **Valores**: `total` = soma dos itens **sem** taxa de entrega; **`total_net_value` = `total` + `delivery_fee`** = valor pago (ex.: 93,99 + 7,00 = 100,99). Apesar do nome, o "net" é o maior. Usar `total_net_value` como valor do pedido e `total` como valor de produtos.
- **Cliente novo × recorrente**: `client.orders_count` (já conta o pedido atual no body completo; no enxuto vem o valor anterior), `client.first_order_date` (`null` no 1º pedido), `client.ticket_average`, `client.last_valid_order_date`, `client.created_at`. Cliente criado no ato tem `client.source: "multipedidos"`; clientes antigos, `null`.
- **Pagamento**: `payment_method` (`pix`, `creditCard`; `money`/`voucher` do modelo 2023 não vistos), `card_type` (bandeira), `card_payment_method` (`credit`). Em todos os pedidos capturados o pagamento era na entrega/balcão → `payments: []`, `payment_status: null`.
- **Tipos inconsistentes** — variam por formato (enxuto × completo) **e por origem** (`pos` × `web`): booleanos ora `true/false`, ora `0/1` (`car_takeout`, `quick_sale`, `is_table`, `need_change`); `restaurant_id` e `number_of_flavors` ora string, ora número; `ncm` idem; `coordinates.latitude/longitude` string no enxuto e número no completo; em pedidos `web`, `discount`/`discount_type`/`addition`/`addition_type` vêm `null` (no `pos`, `0`/`"fixedDis"`/`"fixedAdd"`). Normalizar tudo na entrada.
- **Conversão para o funil** (doc 16): `order_status=CREATED` com telefone válido = "fez pedido" (valor: `total_net_value`; origem: `source`); `OVER` = concluído; `CANCELED` = desfazer a conversão.
- **Comparado ao modelo de 2023** (seção 1.4): a estrutura base confere e o evento `order` ainda usa exatamente aquele formato de itens; o `order_status` tem bem mais campos (cashback, iFood/Keeta, TEF/Pix, comanda, jornada, agendamento).

### 3.6 Falta capturar

| Cenário | Para descobrir |
|---------|----------------|
| Evento `nfce` | query string e payload (nenhum chegou ainda — confirmar se está cadastrado/ativo e emitir uma NFC-e) |
| Pagamento **online** (Pix/cartão pelo cardápio) | `payments[]`, `payment_status`, `pix_payment`, `online_payment_reference` |
| Pedido com **cupom/desconto/cashback** | `coupom_*`, `discount_value`, `cashback_*`, `points_earned` |
| Pedido **agendado** | status `SCHEDULED`, `schedule_to`, `scheduled_order_no` |
| Pizza avulsa (fora de combo), massa, adicionais de sabor | `type: "pizza"`, `doughs`, `additional_toppings[]` |
| Pedido iFood integrado / outros canais | campos `ifood_*`, outros valores de `source` e `external_source` |
| Pedido vindo de link/campanha/recuperação de carrinho | `link_uuid`, `transmission_list_uuid`, `is_cart_recovery`, `journey_id` (potencial atribuição de canal) |
| Entrega com motoboy atribuído | `motoboy{}`, `motoboy_id`, `motoboy_remuneration` |
| Responder ≠ 200 de propósito (uma vez) | política de retry e o histórico/reenvio do painel |

### 3.7 Fonte alternativa já disponível: mensagens de pedido no WhatsApp

Observado no log de produção em 20/09/2026: **os pedidos da Multipedidos já passam pelo bot como mensagens de WhatsApp**, independentemente do webhook. Para cada pedido feito no cardápio digital (`pedir.delivery/app/<loja>`):

| Mensagem | Sentido | Conteúdo |
|----------|---------|----------|
| `✅ *NOVO PEDIDO*` … `▶ *RESUMO DO PEDIDO*` | cliente → loja (enviada pelo cliente ao finalizar) | nº do pedido, itens, total, desconto, entrega × retirada, endereço, telefone, pagamento, link `…/track?token=…` |
| `Muito obrigado por realizar seu pedido conosco, *<nome>*!` … | loja → cliente (chatbot da Multipedidos, `fromMe`) | mesmo resumo + tempo estimado |
| `🛵 Seu pedido acabou de sair para entrega, <nome>!` | loja → cliente | mudança de status |

Formato (dados fictícios):

```
✅ *NOVO PEDIDO*
▶ *RESUMO DO PEDIDO*
 Pedido #40000
▶ *TOTAL* = *R$ 56,99*
 Link para acompanhar status do pedido:
 https://pedir.delivery/app/<loja>/track?token=<hex>
*1x* _Média_ *(R$ 64,99)*
 -Sem Borda
 -<sabor>
▶ *Dados para entrega*        (ou *Dados para Retirada*)
*Nome:* Fulano
*Endereço:* Rua X, nº: 0 · *Bairro:* Y
*Telefone:* 47900000000
*Taxa de Entrega:* R$ 5,00
▶ *Desconto* = *R$ 13,00*
▶ *TOTAL* = *R$ 56,99*
▶ *PAGAMENTO*
Pagamento com Pix
```

Implicação: a etapa **"fez pedido"** do funil (doc 16) pode ser detectada só com regex nessas mensagens (`Pedido #(\d+)`, `*TOTAL* = *R$ …*`) — o chat já identifica o contato, sem depender de webhook nem de API. Limitações: só pedidos do cardápio digital que passam pelo WhatsApp (não cobre balcão/PDV/iFood), texto pode mudar sem aviso, e não traz cancelamento. O webhook continua sendo a fonte preferida; esta é o plano B (ou complemento imediato).

## 4. API com token

Explorada em 20/09/2026 com o **Token de Integração** (`MULTIPEDIDOS_TOKEN` no `.env` — **nunca** em código, doc ou chat), **somente leitura**: login, `poll` e `GET`. Nenhum `acknowledge`, mudança de status ou `POST` de escrita foi chamado. Ferramenta: `scripts/multipedidos-explorar.js` (`login` | `poll` | `get <caminho>`; respostas em `capturas/`, fora do git). **[fato]** = resposta real da API.

### 4.1 Autenticação

- **[fato]** `POST https://api.multipedidos.com.br/integration/auth/login`, header `x-integration-token: <token>`, body vazio → `200 { "token": "<jwt>" }`. O contrato de 2023 (seção 1.2) **continua valendo**.
- **[fato]** JWT HS256, emissor `lumen-jwt` (backend Lumen/Laravel), **validade de 1 hora** (`exp - iat = 3600`), claims `domain: "Integration_as_Restaurant"` e `restaurant_id`. Renovar = logar de novo. Uso: `Authorization: Bearer <jwt>`.
- ⚠️ **O token é muito mais poderoso do que "integração de pedidos" sugere**: o JWT age *como o restaurante* — lê a base inteira de clientes (4.4) e o cadastro dos webhooks com seus tokens, e as rotas de escrita existem (4.5). Tratar `MULTIPEDIDOS_TOKEN` como credencial de administrador: só no `.env`, nunca em log, e regerar no painel se vazar.

### 4.2 Fila de pedidos novos (polling)

- **[fato]** `GET https://2bhghu4v3iluwl77hwcmwkbije0rroef.lambda-url.us-east-1.on.aws/poll`, header `Authorization: <token de integração>` (o token cru, **sem** "Bearer" e sem JWT) → `200`, array JSON. A URL Lambda de 2023 segue válida.
- **[fato]** Devolve uma **fila de pedidos novos ainda não confirmados**: 19 pedidos (tudo o que entrou na loja nas ~2h30 anteriores, `web` e `pos`, delivery/balcão/mesa), **todos como snapshot `order_status: "CREATED"`** mesmo já tendo avançado de status. Ou seja: o poll entrega *criação de pedido*, não mudança de status.
- **[fato]** O payload é **idêntico ao do webhook `order`** (formato legado: `items[].sizes[]`, `crust`, `dough`, `flavors[].additionalToppings`, `featured`, `is_weight_product`) — 63 chaves na raiz, com `client{}` e `history[]`. Webhook `order` e poll são a mesma esteira.
- **[inferência]** O pedido sai da fila com `GET …/acknowledge?orderID=<id>` (não testado — tem efeito colateral). Sem acknowledge a fila só cresce; tempo de expiração desconhecido.
- Pizza avulsa (`type: "pizza"`), que faltava nas capturas de webhook, aparece aqui: `menu_name` = tamanho, `menu_price`, `number_of_flavors`, `pizza_price_behavior`, `pizza_price`, `crust{}`, `dough[]`, `flavors[]` (`name`, `price`, `quantity`, `notes`, `additionalToppings[]`), `extras[]`.
- **Para nós**: o webhook `order_status` já cobre criação + transições em tempo real; o poll só interessa como **rede de segurança** (recuperar pedidos perdidos se o bot ficar fora do ar) — e, como ninguém dá acknowledge hoje, funciona como um "últimas horas de pedidos".

### 4.3 Rotas GET acessíveis com o JWT

Base `https://api.multipedidos.com.br`, `{id}` = `restaurant_id`. Rotas candidatas extraídas do bundle público do painel; sondadas registrando só status, tamanho e formato (chaves/tipos).

| Rota | Resultado | Conteúdo |
|------|-----------|----------|
| `/restaurant/{id}/menu` | ✅ 200 (~270 KB) | Cardápio publicado: `general[]` (categorias com produtos), `combos[]`, `extras[]`, `pizzas{ sizes[], flavorCategories[], extras }`, `hoursTemplates[]`, `stocks[]` |
| `/restaurant/{id}/nep` | ✅ 200 (~345 KB) | Cardápio no modelo do editor: `pizzas{ sizes[], flavors[], fractions[] }`, `combos[]`, `crustCategories[]`, `additionalToppingsCategories[]`, `doughCategories[]`, `general[]`, `extras[]`, `itemsAssocs{}` (borda/adicional × tamanho), `hoursTemplate[]`, `ncms[]` |
| `/restaurant/{id}/generic-category` | ✅ 200 | Categorias com `products[]` (36 campos por produto: nome, descrição, preço, disponibilidade…) |
| `/restaurant/{id}/pizza/flavor-category` | ✅ 200 | Categorias de sabor com `flavors[]` (74 sabores na maior) |
| `/restaurant/{id}/pizza/crust-category` | ✅ 200 | Bordas (`options[]`) |
| `/restaurant/{id}/extra-category` | ✅ 200 | Complementos (`options[]`, `qtyMin`, `qtyMax`, `required`) |
| `/restaurant/{id}/nep/combo` | ✅ 200 | Combos: `name`, `price`, `oldPrice`, `description`, `available`, `delivery`, `balcony`, `pizzaSizes[]`, `pizzaAssociations[]` |
| `/restaurant/{id}/hours-template` | ✅ 200 | Horários: `hours{}` (7 dias), `orderScheduling{}`, `indicatesRestaurantOperation` |
| `/restaurant/{id}/discount-coupons` | ✅ 200 | Cupons paginados: `{ data[] (28 campos), meta{ total, currentPage, lastPage, perPage } }` |
| `/restaurant/{id}/cashback/settings` | ✅ 200 | `enabled`, `cashbackPercent`, `maxCashbackValue`, `minOrderValueForCashback`, `daysToExpire` |
| `/restaurant/{id}/order/{orderId}` | ✅ 200 | **Pedido por id**, em **camelCase** (3º formato! `orderNo`, `status`, `totalNetValue`, `deliveryType`, `paymentMethod`, `createdAt`…) |
| `/restaurant/{id}/client/{clientId}` | ✅ 200 | Cliente completo (mesmo objeto `client{}` do webhook: nome, telefone, e-mail, CPF, endereço, `orders_count`, `ticket_average`…). `/client/{clientId}/search` devolve o mesmo |
| `/restaurant/{id}/client/all-clients` | ✅ 200 (~3 MB) | **Base inteira de clientes** numa chamada (milhares de registros): `id`, `name`, `uuid`, `phone`, `points`, `bairro_ci`, `is_blocked`, `wabot_opted_out`, `orders_count`, `ticket_average`, `first_order_date`, `last_order_date`, `last_valid_order_date`, `coupon_usage_percent` |
| `/restaurant/{id}/reports/wabot-today` | ✅ 200 | `{ total_orders, revenue, ticket }` do dia |
| `/restaurant/{id}/motoboy` | ✅ 200 | Entregadores (`id`, `name`) |
| `/restaurant/{id}/webhook-integration` | ✅ 200 | Webhooks cadastrados: `type`, `url`, `enable`, `method`, `origin`, **`verification_token`** (expõe o access_token e a nossa URL com segredo) |
| `/restaurant/{id}/ncms` | ✅ 200 | Configuração fiscal |
| `/restaurant/{id}/cuisine`, `/deliveryfees/area`, `/journeys` | ✅ 200 | Listas vazias nesta loja |
| `/restaurant/{id}`, `/restaurant/{id}/order`, `/saleChannels`, `/order/{id}/status` | 405 | Rota existe, mas não para GET (ver 4.5) |
| `/restaurant/{id}/orders`, `/kds/orders`, `/schedule`, `/reports/total`, `/integrated-order-history` | 404 | — |
| `/restaurant/{id}/client`, `/coupom`, `/transmission-list` | 500 | Erro do servidor (provavelmente faltam parâmetros) |
| `/restaurant/{id}/reports/last-seven-days-sales` | timeout 30 s | — |

Não há listagem de pedidos por `GET`, mas **há por `POST {order}/query`** (consulta só-leitura usada pelo painel — ver 4.5). Histórico de vendas por cliente só agregado (`orders_count`, `ticket_average`, datas) em `all-clients`.

### 4.4 O que isso destrava

| Dado | Rota | Uso no produto |
|------|------|----------------|
| Cardápio, preços, combos, sabores, bordas, disponibilidade | `/menu` (ou `/nep`) | Contexto da **IA de atendimento** sempre atualizado, em vez de texto fixo no prompt — cachear e atualizar algumas vezes ao dia |
| Horário de funcionamento | `/hours-template` | IA responder "estão abertos?" corretamente |
| Cupons e cashback vigentes | `/discount-coupons`, `/cashback/settings` | IA/fluxos citarem promoções reais |
| Base de clientes com recência, frequência e ticket | `/client/all-clients` | Casar com `contatos` pelo telefone → **funil** (quem já é cliente × quem é novo), segmentos (inativos há N dias, alto ticket) para campanhas; respeitar `wabot_opted_out` e `is_blocked` |
| Pedido por id | `/order/{orderId}` | Consultar status atual sob demanda ("cadê meu pedido?") a partir do nº capturado no webhook |
| Faturamento do dia | `/reports/wabot-today` | Resumo diário para o operador |

### 4.5 Rotas de escrita e edição de pedidos (mapeadas — **escrita não testada**)

Mapeadas por análise estática do bundle do painel (`orderFactory` e `posFactory`) em 20/09/2026. `{order}` = `/restaurant/{id}/order`, `{pos}` = `/restaurant/{id}/pos`.

**Consultas que usam POST mas só leem** — **[fato]**, testadas com o JWT de integração:

| Rota | Body | Resultado |
|------|------|-----------|
| `POST {order}/query/first` | `{"columnsTerms":{"id":<orderId>,"status":""}}` | ✅ 200 — pedido completo em camelCase (igual a `GET {order}/{orderId}`) |
| `POST {order}/query` | `{"columnsTerms":{…},"sortSettings":{…},"limit":N}` — filtros no formato `{"0":["id",">",123],"status":""}` ou `["id","IN",[…]]` | **listagem/histórico de pedidos** (não testada com filtros amplos; mesma rota do `query/first`) |
| `POST {order}/query/paginate/{offset}/{limit}`, `{order}/count-orders`, `{order}/total-revenue` | `columnsTerms`, `sortSettings` | paginação, contagem e faturamento (não testadas) |
| `GET {order}/history/{orderId}` | — | ✅ 200 — histórico de status com o usuário de cada ação |
| `GET {order}/{orderId}/payments` | — | ✅ 200 |
| `GET {pos}/cashier` | — | ✅ 200 — caixa atual (`open`, `value`…): **o JWT de integração alcança o domínio do PDV** |

> Correção do que constava antes: **existe** listagem de pedidos — não por `GET`, mas por `POST {order}/query`.

**Escrita** — nenhuma chamada foi feita:

| Ação | Rota | Payload (como o painel/PDV monta) |
|------|------|-----------------------------------|
| Mudar status | `POST {order}/{orderId}/status` | `{ status, cancellationReason, currentUserID, refundPayment }` |
| **Criar pedido** | `PUT {pos}` (ou `PUT {pos}/create-return-cache-key`) | `{ user: {name, phone, cpf, email, address, street_number…}, details: {deliveryType, payments, deliveryFeeID, coordinates, currentUser…}, orders: [itens] }` — exige caixa aberto |
| **Editar pedido (incluir/remover/alterar itens)** | `POST {pos}/return-cache-key` | o **pedido inteiro** de volta: `{ user, details (com o id do pedido e `currentUser`), orders: [todos os itens], removedItems: [ids] }`. Itens existentes inalterados seguem como estão; item alterado vai com `id = menu_item_id` e o id antigo entra em `removedItems`; item novo vai sem id de pedido. Resposta: `{ order, cacheKey }` |
| Pagamentos | `POST {order}/{orderId}/payments`, `POST {order}/{orderId}/paymentStatus` | lista de pagamentos / `{ status, userID, paymentMethod }` |
| Motoboy | `PUT {order}/{orderId}/motoboy` | `{ motoboyID }` |
| Taxa de serviço | `POST {order}/{orderId}/add-service-fee` · `remove-service-fee` | `{}` |
| Nº do pedido | `POST {order}/{orderId}/number` | pedido |
| Comandas (mesa) | `PUT {order}/table/{orderId}/guest-check-pads/{padId}/close`, `PUT {order}/{orderId}/items/update-guest-check-pads-assoc` | — |
| Poll | `GET <lambda>/acknowledge?orderID=<id>` | tira o pedido da fila |

- **Não existe "adicionar item" isolado**: editar = reenviar o pedido completo pela rota do PDV, no formato interno do PDV (`user`/`details`/`orders`), que **não é** nenhum dos três formatos que recebemos (webhook/poll/GET). Montar esse payload do zero exige reproduzir o que o PDV faz (itens de pizza normalizados, `deliveryFeeID`, `payments`, `currentUser`).
- **[inferência]** Como o JWT lê `{pos}/cashier`, é provável que também possa escrever em `{pos}` — só um teste confirma. A edição dispara o evento Pusher `UpdateOrder` (reimpressão no gestor) e o pedido passa a ter `isUpdated = 1`.
- **Risco**: payload errado pode apagar itens de um pedido real (a rota recebe a lista final de itens) ou duplicar impressão na cozinha. Testar **somente** em pedido de teste criado para isso (ex.: mesa "teste" com 1 água), fora do horário de movimento, acompanhando no gestor, com autorização explícita — e capturar antes o payload real do PDV (aba Network do navegador ao editar um pedido) em vez de adivinhar.

### 4.6 Cuidados

- **LGPD**: `all-clients` e `client/{id}` trazem dados pessoais de milhares de clientes (e CPF, quando informado). Importar só o necessário (telefone, nome, métricas), nunca logar o payload, e não versionar `capturas/`.
- **Carga**: `/menu`, `/nep` e `all-clients` são respostas grandes (centenas de KB a MB) — cachear; não chamar por mensagem recebida. Limite de requisições não informado (sem headers `x-ratelimit-*`).
- **Três formatos de pedido** convivem: legado (`order`/poll, `sizes[]`), persistido snake_case (`order_status`, `combo_items[]`) e camelCase (`GET /order/{id}`). Centralizar a normalização num único módulo.

### 4.7 Cupons de desconto

**[fato]** testado em 21/09/2026 com o JWT de integração (só leitura). Base: `/restaurant/{id}/discount-coupons`.

| Rota | Resultado |
|------|-----------|
| `GET /discount-coupons` | ✅ Lista paginada: `{ data[], meta{ total, currentPage, lastPage, perPage } }` — `perPage` fixo em 20 (`?page=N` para as próximas; `itemsPerPage` é ignorado) |
| `GET /discount-coupons/{couponId}/redemptions` | ✅ **Quem usou o cupom**: `{ data[], meta{ total, totalDiscount, currentPage, perPage, lastPage } }` — 20 por página |
| `GET /discount-coupons/{couponId}/versions` | ✅ Histórico de versões da regra: `id`, `version`, `current`, `effectiveFrom`, `effectiveTo`, `redemptions` |
| `GET /discount-coupons/{couponId}` | 405 (o detalhe já vem completo na lista) |

Campos do cupom:

| Grupo | Campos |
|-------|--------|
| Identificação | `id`, `code`, `displayCode`, `active`, `currentVersion`, `createdAt`, `updatedAt` |
| Desconto | `discountType` (`percent` \| `fixed`), `discountValue`, `maxDiscountValue` (teto, p/ percentual), `minOrderValue` |
| Limites | `usageLimit` (total), `perCustomerLimit`, `firstOrderOnly`, `validUntil` (`YYYY-MM-DD HH:mm:ss` ou `null` = sem validade) |
| Uso | `usageCount`, `validUsageCount`, `currentVersionUsageCount` |
| Restrições | `allowPizzaCombo`, `allowFeaturedItems`, `products[]`, `paymentMethods[]`, `orderTypes[]`, `availabilities[]` (`weekday` 0–6, `startTime`, `endTime`) — listas vazias = sem restrição |
| Vitrine | `isPublic`, `publicMessage`, `isFeatured` |

Campos do resgate (`redemptions.data[]`): `id`, `orderId`, `orderNo`, `clientName`, `customerPhone`, `discountApplied`, `orderTotal`, `couponVersion`, `couponVersionId`, `createdAt` (+ `couponCode`/`couponDisplayCode`, que vieram `null`). Contém dado pessoal (nome e telefone).

Observações:
- `active: true` **não significa vigente**: há cupom ativo com `validUntil` no passado. Para saber se vale hoje: `active` **e** (`validUntil` nulo ou futuro) **e** (`usageLimit` nulo ou `usageCount < usageLimit`) **e** dentro de `availabilities` (dia/horário).
- **Uso no produto**: (1) a IA/fluxos só citarem cupons realmente vigentes; (2) **atribuição de canal por cupom** — cupons por origem (ex.: um para Instagram, outro para Facebook, outro de boas-vindas) + `redemptions` (telefone + pedido + valor) dão conversão por canal mesmo quando o cliente não entrou pelo link `wa.me` do canal (complementa o doc 16); (3) no webhook o cupom usado aparece em `coupom_code` / `discount_value` do pedido.
- **Outras consultas** (✅ testadas): `GET /discount-coupons/code-availability?code=X` → `{ data: { available, code, reason? } }` (consulta, não reserva); `GET /discount-coupons/redemptions?from=&to=&page=` → resgates de **todos** os cupons no período; `GET /discount-coupons/analytics?from=&to=` → `totalRedemptions`, `totalDiscount`, `uniqueCustomers`, `totalOrders`, `ordersWithCoupon`, `usageRate`, `revenueWithCoupons`, `avgTicket`, `byChannel[]`, `byType[]`, `byCoupon[]`. A lista aceita `page`, `perPage`, `search`, `availability` (csv), `sort`, `order`.

**Escrita** — mapeada no `discountCouponFactory` do painel ("Cupom v2": cliente HTTP fino, todas as regras e validações ficam no servidor) e **[fato] testada em 21/09/2026** com o JWT de integração, com autorização do dono da loja: ciclo completo criar → listar → desativar → remover de um cupom descartável de R$ 1 (a loja voltou ao estado original):

| Ação | Rota | Body |
|------|------|------|
| Criar | `POST /discount-coupons` → ✅ **201** `{ data: <cupom com id>, replacedFeatured }` | payload abaixo |
| Editar | `PUT /discount-coupons/{couponId}` (não testada) | cupom completo (gera nova **versão**; o uso fica separado por versão) |
| Ativar/desativar | `PUT /discount-coupons/{couponId}/active` → ✅ **200** `{ data: { id, active } }` | `{ "active": true }` ou `{ "active": false }` |
| Remover | `DELETE /discount-coupons/{couponId}` → ✅ **204** | — ⚠️ **confirmado**: o código de cupom removido fica reservado — `code-availability` passa a responder `{ available: false, reason: "deleted", deletedCoupon: { id, code, usageCount, deletedAt } }`; só volta via `POST /{couponId}/restore` |

Payload de criação que funcionou (cupom de uso único):

```json
{
  "code": "PREFIXO7K2Q9", "displayCode": "PREFIXO7K2Q9", "active": true,
  "discountType": "fixed", "discountValue": 1, "maxDiscountValue": null, "minOrderValue": null,
  "usageLimit": 1, "perCustomerLimit": 1, "firstOrderOnly": false,
  "allowPizzaCombo": true, "allowFeaturedItems": false,
  "isPublic": false, "publicMessage": null, "isFeatured": false,
  "validUntil": "2026-09-22 23:59:59",
  "products": [], "paymentMethods": [], "orderTypes": [], "availabilities": []
}
```

- O servidor devolve o cupom gravado com `id`, `currentVersion: 1` e contadores zerados; o `displayCode` enviado voltou `null`. Quais campos são de fato obrigatórios ainda não foi testado (enviamos todos).
- Fluxo recomendado: `code-availability` → `POST` → guardar `id` + `code` + contato do nosso lado. O cupom criado aparece na hora na busca (`GET ?search=<code>`) e some dela após o `DELETE`.
- Para "aposentar" um cupom emitido pelo bot, preferir **desativar** (`active: false`) a remover — mantém o histórico de resgates consultável e evita queimar códigos à toa.

**Cupom de uso único por cliente** (caso de uso: indicação, reativação, pedido de desculpas): não há campo que prenda o cupom a um telefone/cliente. O equivalente é **código aleatório exclusivo + `usageLimit: 1` + `perCustomerLimit: 1` + `validUntil` curto + `isPublic: false`**, enviado só para aquele contato — a loja já faz isso à mão (há cupons com `usageLimit: 1`). Guardar do nosso lado `código → contato` permite fechar o ciclo: o resgate aparece em `redemptions` (telefone, pedido, valor) e no webhook (`coupom_code`). Cuidados: códigos não se reciclam (cada cupom removido "queima" o código) → usar prefixo + sufixo aleatório; e prever limpeza (desativar vencidos) para não poluir a tela de cupons do gestor.

## 5. Para onde isso vai (depois do estudo)

- **Funil por canal** (doc 16): pedido confirmado na Multipedidos = conversão real; casar pelo telefone do contato → `contatos.canal_id`.
- **Automações por evento**: status do pedido dispara mensagem no WhatsApp (nó `trigger_webhook` já existe).
- **IA**: cardápio/preços/horários vindos da API em vez de texto fixo no prompt.
- **Multi-empresa**: segredo do webhook e token da API por instância (`.env` de cada empresa, via provisionamento).
