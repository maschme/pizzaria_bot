# Modelos de fluxo, fluxo do indicado, pós-venda e fechamento da indicação (plano)

Definido com o operador em 22/09/2026 (decisões fechadas — ver §Decisões). **Status: plano — nada implementado.** Quatro frentes que se encaixam: uma **biblioteca de modelos** (para o cliente novo começar de algo pronto), dois fluxos novos que viram modelos (**indicado** e **pós-venda**) e o **fechamento do fluxo de indicação** (missão 3 = avaliação no Google, que depende do [doc 19](./19-conferencia-avaliacoes-google.md)).

Ordem proposta: **A → B → C → D**, porque A é a base para publicar B e C como modelos, e D depende de uma peça externa (fonte de avaliações) que dá para testar em paralelo.

---

## Estado atual que condiciona o plano

| Fato (do código de hoje) | Consequência |
|---|---|
| Um fluxo só começa por **gatilho de mensagem** (`buscarFluxoPorGatilho`: mensagem exata ou palavra-chave). Não existe início por evento (pedido, indicação, tempo) | Fluxo de indicado e pós-venda precisam de **outra porta de entrada** (frentes B/C) |
| A campanha visual termina no nó `end` e faz **handoff para a campanha legada** (`setOnCampanhaFlowEnd` → Missão 2 hardcoded em `BotIApizzaria.js`); a Missão 3 da legada é um placeholder ("em desenvolvimento") | Fechar a indicação = trazer a missão 3 para o fluxo visual e **aposentar o handoff** |
| Ao registrar uma indicação (`indicacaoService.registrarIndicacoes`) o bot **não fala com o indicado** — só grava `indicacoes` e conta para o indicador | O indicado hoje não vive nada; a frente B cria isso |
| Instância nova ganha fluxos por **cópia da empresa-modelo** no provisionamento (`copiar-modelo.js`), sem escolha depois | A biblioteca de modelos (A) substitui isso por escolha na tela, a qualquer momento |
| O **canal** (doc 16) só marca a origem do contato; o fluxo é escolhido por **outra** checagem, o gatilho de texto (`buscarFluxoPorGatilho`). A mensagem do canal precisa, por coincidência, ser igual à frase de gatilho de algum fluxo — acoplamento implícito, sem indicação na tela | Frente A0: o canal passa a **apontar o fluxo** que inicia |
| Já existem: import/export de fluxo (JSON com `schemaVersion`), `duplicarFluxo`, metas (`entrada_grupo`, `10_indicacoes`, `cupom_30_resgatado`), funil por canal (doc 16), cupom único (doc 18) | Modelos = export JSON versionado no repositório; nada de formato novo |

---

## A0. Canal aponta o fluxo que inicia

**Decisão (22/09)**: no cadastro de canais, escolher **qual fluxo** o canal inicia, em vez de depender de a mensagem do canal coincidir com um gatilho.

- Coluna nova `canais.fluxo_id` (NULL = só marca a origem, comportamento de hoje). No formulário de canal, um select "Fluxo que inicia" com os fluxos conversacionais **ativos** (e a opção "nenhum, só rastrear origem").
- No bot, a ordem passa a ser: **canal casou → marca a origem e inicia o fluxo do canal** (se houver e se o número não estiver em fluxo) → senão, gatilho de texto como hoje. Assim a mesma frase de canal pode apontar fluxos diferentes em canais diferentes, e um fluxo pode ser iniciado por vários canais sem precisar de várias frases de gatilho.
- A mensagem do canal continua sendo o **identificador da origem** (é o que o `wa.me` carrega); ela só deixa de ter a obrigação de ser um gatilho.
- Fluxo desativado/apagado: o canal continua marcando a origem e o bot avisa no log; a tela de canais mostra o selo "fluxo inativo".
- Variáveis iniciais: o fluxo iniciado por canal recebe `{{canalSlug}}` e `{{canalNome}}` — permite um mesmo modelo se adaptar ("vi que você veio do panfleto…").
- Tela de canais: coluna "Fluxo" na lista; contagem de contatos por canal continua igual.

**Feito em 22/09/2026**: migração `2026-09-22-canais-fluxo-id.js`, `canalService` (CRUD, cache e atribuição devolvem o fluxo), despacho em `BotIApizzaria.js`, `iniciarFluxo(..., variaveisIniciais)`, select e coluna Fluxo no dashboard. Validado na tela (criar/editar/listar) e por teste do serviço (casa, não casa, fluxo inexistente, fluxo_id vazio → NULL).

Peça pequena (migração + select + 10 linhas no bot), mas é **pré-requisito prático da biblioteca de modelos**: quem instancia um modelo precisa de um jeito claro de ligá-lo a uma porta de entrada — e o jeito é "crie um canal e escolha este fluxo".

## A. Biblioteca de modelos de fluxo

**Objetivo**: o operador (ou um cliente novo do SaaS) abre Fluxos, clica **Modelos**, escolhe um e ganha uma cópia editável.

### A.1 Onde os modelos vivem

Arquivos JSON no repositório, em `fluxos-modelos/`, no **mesmo formato do export** (`schemaVersion`, `nome`, `tipo`, `gatilho`, `nodes`, `edges`, `viewport`) mais um bloco `modelo`:

```json
{
  "modelo": {
    "slug": "campanha-indicacao",
    "titulo": "Campanha de indicação (30% em 3 missões)",
    "descricao": "Grupo → 10 indicações → 3ª missão. Cupom único por cliente.",
    "categoria": "campanha",
    "requer": ["multipedidos_api"],
    "variaveis": [
      { "chave": "LINK_CARDAPIO", "rotulo": "Link do cardápio", "exemplo": "https://…" },
      { "chave": "LINK_AVALIACAO", "rotulo": "Link de avaliação no Google" }
    ]
  },
  "schemaVersion": 1, "nome": "…", "gatilho": {}, "nodes": [], "edges": []
}
```

- **Versionados em git** = todo cliente recebe a mesma versão; correção num modelo é um commit. Sem tabela nova.
- `requer`: integrações que o modelo usa (`multipedidos_api`, `avaliacoes_google`). A tela mostra o modelo, mas avisa o que precisa ativar.
- `variaveis`: textos que mudam por empresa (links, nome da loja). Ao instanciar, a tela pergunta e substitui `{{LINK_CARDAPIO}}` nos textos dos nós. Evita o cliente caçar links dentro de 20 mensagens.
- **Modelo não é fluxo ativo**: instanciar cria um fluxo novo, `ativo = false`, com o nome escolhido. O fluxo criado não guarda vínculo com o modelo (é uma cópia; a versão do modelo fica em `descricao` só como referência).

### A.2 Tela

Em `fluxos.html`, botão **Modelos** na toolbar (ao lado de Importar): modal com cards (título, descrição, categoria, selos de "requer"), botão **Usar modelo** → pergunta o nome do fluxo e as variáveis → cria e abre no editor.

### A.3 Rotas

| Método | Rota | Função |
|---|---|---|
| GET | `/api/fluxos/modelos` | Lista (lê `fluxos-modelos/*.json`, devolve só o bloco `modelo`) |
| POST | `/api/fluxos/modelos/:slug/instanciar` | `{ nome, variaveis }` → cria o fluxo (reaproveita `importarFluxoDeExport`) |

**Feito em 22/09/2026**: `services/fluxoModeloService.js` (lista, obtém, instancia; substitui só as variáveis declaradas em `modelo.variaveis` — as de execução, como `{{cupomCodigo}}`, ficam intactas; variável obrigatória vazia → erro "Preencha: …"; opcional vazia → placeholder preservado para o operador editar), rotas `GET /api/fluxos/modelos` e `POST /api/fluxos/modelos/:slug/instanciar`, botão **Modelos** + modal em `fluxos.html` (cards com selos de `requer` — "desligada" quando a API da Multipedidos está inativa — e formulário de nome + variáveis). Modelos publicados: `campanha-indicacao` (a campanha atual migrada para cupom único, com `LINK_CARDAPIO` obrigatório e `LINK_AVALIACAO` opcional, e o aviso da política do Google) e `teste-cupom-multipedidos`. Validado no navegador: listagem, erro de obrigatório, instância criada inativa com os links substituídos.

**Publicar um modelo** = exportar o fluxo pronto, acrescentar o bloco `modelo`, colocar em `fluxos-modelos/` e commitar. Sem tela de "cadastro de modelo" nesta rodada: é tarefa de quem desenvolve o produto, não do cliente. (Quando o painel central multi-empresa existir, ele pode listar os mesmos arquivos.)

### A.4 Modelos da primeira leva

1. `campanha-indicacao` ✅ — a campanha atual já com cupom único (resultado da migração do doc 18) e, depois da frente D, com a missão 3
2. `fluxo-indicado` — frente B
3. `pos-venda` — frente C
4. `teste-cupom-multipedidos` ✅ — o de `docs/exemplos/` (útil para validar a integração numa instância nova)

(1 e 4 publicados em 22/09/2026.)

---

## B. Fluxo do cliente indicado

**Objetivo**: quem foi indicado recebe uma abordagem própria (hoje não recebe nada) e, se comprar, a compra conta para o indicador.

### B.1 Porta de entrada

Dois modos, ambos válidos, escolhidos por instância:

| Modo | Como funciona | Quando usar |
|---|---|---|
| **Ativo** (bot chama) | Ao registrar a indicação, o bot **inicia o fluxo do indicado** para o número indicado. Precisa de um início de fluxo por evento (não existe hoje — B.3) | Loja quer converter rápido |
| **Passivo** (indicado chama) | O indicador recebe um texto pronto para encaminhar ao amigo, com link `wa.me` cujo texto é o gatilho do fluxo do indicado (mesmo mecanismo dos canais, doc 16) | Menos intrusivo; evita mensagem fria para número que nunca falou com a loja |

**Decisão (22/09): começar pelo ativo.** Ao registrar a indicação, o bot manda **uma** mensagem ao indicado dizendo **quem o escolheu** e perguntando se ele quer receber o cupom de 10% — a pessoa fica à vontade para responder, e entre as opções há **"não quero mais receber mensagens"** (opt-out). Nada de cupom antes do "sim". O passivo (link que o indicador encaminha) fica como alternativa, sem prioridade.

### B.2 O fluxo (modelo `fluxo-indicado`)

```
evento indicacao_registrada (variáveis: {{indicadorNome}}, {{indicadorTelefone}})
→ elegibilidade (no código, antes de iniciar): não está em fluxo · não fez opt-out · não é cliente com pedido recente · não foi abordado como indicado nos últimos N dias
→ mensagem: "Oi! {{indicadorNome}} escolheu você para ganhar 10% na 1ª compra na {{nomeLoja}} 🍕
   Quer receber o cupom?  1 - Sim, quero!  2 - Agora não  3 - Não quero mais receber mensagens"
→ aguardar (timeout 24 h; sem resposta → fim silencioso, sem insistir)
→ IA: classificar a resposta → {{escolha}} = sim | agora_nao | opt_out
→ Verificar variável:
     opt_out   → marcar contatos.opt_out = 1 → "Combinado, não vamos mais te escrever." → fim
     agora_nao → "Sem problema! Se mudar de ideia, é só mandar *quero meu cupom*." → fim   (gatilho de reentrada)
     sim       → Multipedidos: criar cupom único (10%, 7 dias, campanha=indicado)
               → mensagem com {{cupomCodigo}} + link do cardápio
               → marcar_meta: indicado_aceitou
               → (opcional) convite para o grupo do bairro → fim
```

O texto da mensagem, o desconto e a validade são do modelo — **cada cliente edita como quiser** (a mensagem "quem te escolheu" é o padrão porque é honesta sobre a origem do contato).

- Quem indicou: guardado na `indicacoes` (já existe); o evento leva `indicador_whatsapp_id` e o nome vem de `contatos.nome` (ou do vCard).
- **Aviso de abordagem ativa**: mensagem para um número que nunca falou com a loja tem risco de denúncia de spam no WhatsApp. Mitigação no desenho: 1 mensagem só, com quem indicou nomeado, opção de sair na própria mensagem e sem insistência. Fica registrado como risco aceito pelo operador.
- **Fechar o ciclo com o indicador**: quando o webhook da Multipedidos registrar o **uso do cupom do indicado** (doc 18 §5, já implementado), marcar `indicacao_convertida` no indicador. Isso alimenta uma etapa nova do funil ("indicados que compraram") e permite bonificar o indicador (ex.: alterar o cupom dele — nó já existe).

### B.3 Peça nova: início de fluxo por evento

`fluxoExecutor.iniciarFluxoPorEvento(client, numero, slugDoFluxo, variaveisIniciais)` + campo `gatilho.tipo = 'evento'` no fluxo (o editor mostra "Iniciado pelo sistema: <evento>"). Eventos previstos: `indicacao_registrada` (B ativo), `pedido_concluido` (C). Regras: não iniciar se o número já está em fluxo; respeitar horário comercial (configs `horario_funcionamento_*` já existem — fora dele, **enfileira** para o próximo horário); **opt-out** global — coluna `contatos.opt_out` (+ `opt_out_em`), setada pela escolha "não quero mais receber mensagens" em qualquer fluxo ativo e respeitada por **toda** abordagem iniciada pelo sistema (indicado, pós-venda, campanhas futuras). Mensagem que o cliente inicia continua sendo atendida normalmente.

---

## C. Pós-venda: menu de campanhas elegíveis

**Decisão (22/09)**: o pós-venda **não** é uma pesquisa de satisfação. Depois de um pedido, o bot olha o **histórico do cliente no SaaS** (quais campanhas/fluxos já participou ou tem em aberto) e **lista só as opções elegíveis** para ele escolher e entrar. Vale **até 24 h após o pedido**; passado isso, só depois do próximo pedido — assim o cliente não "caça desconto" quando já está prestes a pedir.

### C.1 Disparo e janela

- Evento `pedido_concluido` = webhook `order_status = OVER` (ou `DONE` para retirada/balcão) — já capturado hoje (doc 17 §3).
- Elegibilidade do **contato** (no código, antes de iniciar): telefone válido (pedido de mesa sem cliente não conta) · não está em fluxo · sem opt-out · não recebeu pós-venda **deste pedido** nem de outro nos últimos N dias (config, default 7) · horário comercial (fora dele, enfileira até o limite da janela).
- **Janela de 24 h**: a sessão do pós-venda guarda `pedido_id` e `pedido_em`. Qualquer escolha do cliente **depois de `pedido_em + 24 h` é recusada** com "essa oferta valia até 24 h depois do seu pedido — no próximo pedido a gente te chama de novo 😉". O nó `aguardar` do fluxo usa timeout = o que faltar das 24 h. A regra fica **no código** (não depende de o operador configurar certo no fluxo).
- Atraso após o pedido: config `pos_venda_atraso_min` (default 40 min).

### C.2 Histórico e elegibilidade das campanhas

Fonte já existente: `fluxo_exec_logs` (eventos `fluxo_start` / `fluxo_end` por contato e fluxo) + metas (`contato_metas`) + cupons (`multipedidos_cupons`). Novo serviço `participacaoService.historicoDoContato(whatsappId)` devolve, por fluxo: `nunca` | `em_aberto` (start sem end, ou sessão viva) | `concluido` (end, ou meta final) | `abandonado` (start sem end há mais de X dias).

Cada fluxo que pode ser oferecido ganha, no gatilho, um bloco **`oferta`** (editável no editor, junto do gatilho):

```json
"oferta": { "ativa": true, "titulo": "Ganhe até 30% indicando amigos", "descricao": "3 missões rápidas",
            "elegivel_se": "nunca_participou", "prioridade": 1 }
```

`elegivel_se`: `nunca_participou` (default) | `nao_concluiu` (nunca ou abandonado) | `sempre`. Fluxo com `em_aberto` nunca é ofertado de novo — é **retomado** (opção "continuar de onde parou").

### C.3 O fluxo (modelo `pos-venda`)

```
evento pedido_concluido (variáveis: {{pedidoNumero}}, {{pedidoValor}}, {{primeiroPedido}}, {{nomeCliente}})
→ ação nova: listar_ofertas  → {{ofertas}} (texto numerado), {{ofertasQtd}}, {{ofertaSlug_1..n}}
→ Verificar variável: {{ofertasQtd}} = 0  → fim silencioso (nada elegível: não incomoda)
→ mensagem: "Obrigado pelo pedido #{{pedidoNumero}}, {{nomeCliente}}! 🍕 Você pode participar de:
   {{ofertas}}
   Responda com o número. (0 - não quero receber ofertas)"
→ aguardar (até o fim da janela de 24 h)
→ IA: mapear resposta → {{escolha}} (índice | opt_out | nenhuma)
→ Verificar variável:
     opt_out  → contatos.opt_out = 1 → "Combinado!" → fim
     nenhuma  → "Tudo bem! Se quiser, é só chamar." → fim
     índice   → ação nova: iniciar_fluxo {{ofertaSlug_N}}  (encadeia; se o fluxo estava em_aberto, retoma)
```

- `listar_ofertas` e `iniciar_fluxo` são nós de ação novos, genéricos (servem a qualquer fluxo).
- Sem cupom no pós-venda em si — o desconto vem da campanha escolhida.
- Métrica: meta `pos_venda_ofertado` / `pos_venda_aceitou` por fluxo escolhido → funil por canal ganha a etapa "reengajou no pós-venda".

## D. Fechar o fluxo de indicação (missão 3 = avaliação no Google)

O desenho da conferência está no [doc 19](./19-conferencia-avaliacoes-google.md) (outra frente de trabalho, ainda sem implementação). O que este plano acrescenta é **como a missão 3 entra no fluxo** e **o que precisa ser decidido antes**.

### D.1 Decisão prévia: incentivo × política do Google

O doc 19 §5 alerta: o Google **proíbe recompensa em troca de avaliação**. A campanha hoje promete "+10% ao avaliar" — isso é exatamente o caso proibido. Três saídas, por ordem de risco:

| Opção | Como fica a missão 3 | Risco |
|---|---|---|
| **1. Trocar a missão 3** | Os 30% vêm de outra ação (ex.: 2º pedido no mês, ou compartilhar o link de indicação em 1 grupo). A avaliação no Google é **pedida sem recompensa**, no pós-venda (C), só de quem deu nota ≥ 4 | Nenhum |
| **2. Manter, sem condicionar à nota** | Pede "avalie" (qualquer nota) e libera 30% após conferência | Continua incentivo → viola a política; avaliações podem ser removidas |
| **3. Manter como está** | — | Idem, e hoje nem confere |

**Decisão (22/09): fica a critério de cada cliente.** A mensagem e o cupom são editáveis no fluxo, então cada empresa decide se atrela recompensa à avaliação e assume o risco. Consequências para o produto: (a) o **modelo** `campanha-indicacao` vem com a missão 3 no formato **sem recompensa condicionada** (pede a avaliação e agradece; os 30% liberam por outra ação — o cliente que quiser muda no editor); (b) o modal de Modelos e o nó `avaliacao_google_pedir` mostram um **aviso curto** sobre a política do Google; (c) o material de marketing não promete "avalie e ganhe". A conferência (doc 19) é a mesma nos dois casos.

### D.2 Como entra no fluxo (qualquer opção)

- Novo nó de ação `avaliacao_google_pedir`: registra "link enviado em <hora>" no contato (abre a **janela** do doc 19) e envia o link. Variáveis: `{{linkAvaliacao}}` (config da instância).
- Novo nó `avaliacao_google_verificar` (ou verificação assíncrona): consulta o resultado da conferência → `{{avaliacaoStatus}}` = `confirmada` / `pendente` / `nao_encontrada` / `revisao_manual`.
- Meta `avaliacao_google` marcada na confirmação → etapa no funil por canal.
- No modelo padrão, os 30% liberam por `verificar_meta: segundo_pedido` (meta marcada pelo webhook de pedidos — peça pequena da frente C) e a avaliação é pedida sem condição; cliente que preferir "avalie e ganhe" troca os nós no editor.

### D.3 Aposentar o handoff legado

Com a missão 2 (aguardar contatos) e a 3 dentro do fluxo visual, o callback `setOnCampanhaFlowEnd` e a "campanha legada" (`case 2/3` em `BotIApizzaria.js`) deixam de ser usados. Desligar por config primeiro (`campanha_legada_ativa = false`), remover numa rodada de limpeza depois.

---

## Ordem de execução e dependências

```
A0. Canal aponta o fluxo (canais.fluxo_id + select + ordem no bot)             — ✅ feito em 22/09/2026
A.  Modelos (tela + rotas + 1º modelo: campanha atual migrada)                 — ✅ feito em 22/09/2026
B0. Base de abordagem ativa: início de fluxo por evento, opt-out, horário,
    nós iniciar_fluxo / listar_ofertas, participacaoService                      — base de B e C
B.  Indicado ativo (evento indicacao_registrada + modelo fluxo-indicado)         — depende de A e B0
C.  Pós-venda (evento pedido_concluido, janela 24 h, bloco oferta, modelo)       — depende de B0; webhook já existe
D.  Missão 3 no modelo (meta segundo_pedido + nós de avaliação)                  — depende do doc 19 etapas 1–3
```

Cada frente é uma entrega implantável sozinha, com o mesmo método das anteriores: desenho fechado → implementação → teste local com API/IA simuladas → teste em produção com o seu número → commit por frente.

## Decisões (fechadas em 22/09/2026)

| Tema | Decisão |
|---|---|
| Missão 3 × política do Google | Fica a critério de cada cliente (mensagem e cupom são editáveis). Modelo padrão sem recompensa condicionada + aviso curto na tela |
| Indicado | **Ativo**: 1 mensagem dizendo quem o escolheu e perguntando se quer o cupom de 10%; opção "não quero mais receber mensagens" (opt-out global); cupom só após o "sim" |
| Pós-venda | Não é pesquisa: lista as **campanhas elegíveis** pelo histórico do cliente no SaaS; vale **24 h** após o pedido, depois só no próximo pedido (regra no código); retoma fluxo em aberto |
| Canais × fluxos | O canal escolhe o fluxo que inicia (`canais.fluxo_id`); a mensagem do canal deixa de precisar coincidir com um gatilho |
| Modelos | Primeira leva com os 4 listados; outros modelos mais elaborados virão em projeto próprio, isolado |

Defaults assumidos (ajustáveis por config/no modelo): indicado com 10% por 7 dias; pós-venda 40 min após `OVER`, sem repetir por 7 dias; abordagem ativa só em horário comercial.
