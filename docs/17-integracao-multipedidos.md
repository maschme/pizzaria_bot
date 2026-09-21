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
- Pizza avulsa (fora de combo, `type: "pizza"`) ainda não capturada.

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

_(a preencher)_ URL base, header de autenticação, endpoints testados e respostas. O token fica em `MULTIPEDIDOS_TOKEN` no `.env` — **nunca** em código, doc ou chat.

| Método | Endpoint | Retorno | Observações |
|--------|----------|---------|-------------|
| — | — | — | — |

## 5. Para onde isso vai (depois do estudo)

- **Funil por canal** (doc 16): pedido confirmado na Multipedidos = conversão real; casar pelo telefone do contato → `contatos.canal_id`.
- **Automações por evento**: status do pedido dispara mensagem no WhatsApp (nó `trigger_webhook` já existe).
- **IA**: cardápio/preços/horários vindos da API em vez de texto fixo no prompt.
- **Multi-empresa**: segredo do webhook e token da API por instância (`.env` de cada empresa, via provisionamento).
