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
- **Não encontrado**: formato do payload e **como o `access_token` chega** (header, query ou body) — é o que a captura da seção 2 vai responder. **[inferência, média]** o payload de `order` deve ser o objeto da seção 1.4.

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

_(a preencher com capturas reais)_ Para cada evento: quando dispara, headers relevantes (assinatura? user-agent?), payload de exemplo (dados pessoais anonimizados), campos-chave (id do pedido, status, telefone do cliente, itens, valores, tipo de entrega, pagamento), comportamento de retry.

| Evento / status | Disparo | Observações |
|-----------------|---------|-------------|
| — | — | — |

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
