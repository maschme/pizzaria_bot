# Análise de APIs WhatsApp

**Alinhamento (19/09/2026):** a API oficial da Meta (Cloud API) **não faz parte do projeto** neste momento. Qualquer troca de API — oficial ou alternativa — só será decidida após esta análise: levantar tudo que usamos da API atual e comparar, função por função, se a candidata entrega o mesmo resultado. A motivação principal para avaliar alternativas é a **frequência de desconexões** do whatsapp-web.js.

---

## 1. Inventário: o que usamos do whatsapp-web.js hoje

Levantamento feito por varredura do código em 19/09/2026 (`BotIApizzaria.js`, `services/`, `routes/`, `utils/`).

### Eventos consumidos

| Evento | Uso no projeto |
|--------|----------------|
| `qr` | Gerar QR no terminal e servir em `/whatsapp/qr` e `/whatsapp/qr-image` |
| `ready` | Injetar client nas rotas, marcar conectado |
| `message` | Pipeline inteiro: gatilhos, fluxos, campanha, IA, debounce |
| `group_join` | **Missão 1 da campanha**: detectar cliente entrando no grupo do bairro |
| `label_change` | Sincronização de etiquetas |
| `typing` | Presença do cliente digitando |

### Métodos do client

| Método | Uso |
|--------|-----|
| `sendMessage` (11 usos) | Envio de todas as respostas, fluxos e mensagens do dashboard |
| `getChats` / `getChatById` | Gerenciador de chats do dashboard, sincronização de grupos |
| `getContactById` | Dados do contato |
| `getNumberId` | Validar/resolver número antes de enviar (ex.: mensagem a indicados) |
| `getContactLidAndPhone` | **Resolução LID ↔ telefone** (privacidade do WhatsApp; crítico para casar contato com banco) |

### Métodos de chat/mensagem

| Método | Uso |
|--------|-----|
| `msg.reply` (22 usos) | Resposta contextual em toda a conversação |
| `chat.getLabels` / `chat.changeLabels` | **Etiquetas do WhatsApp Business** (classificação de conversas) |
| `chat.sendSeen` | Marcar como lida ao abrir no dashboard |
| `chat.fetchMessages` | Histórico de mensagens no gerenciador de chats |

### Recursos estruturais

| Recurso | Uso |
|---------|-----|
| **vCard** (26 refs) | **Missão 2 da campanha**: cliente envia contatos como indicação; parser em `utils/vcardParser.js` |
| **Grupos** (participants, groupMetadata, inviteCode) | Grupos por bairro, links de convite, exportação de participantes p/ CSV |
| **`client.pupPage` + `window.Store`** (10 refs) | Acesso direto ao Store interno do WhatsApp Web para extrair participantes de grupos (workaround quando a API pública falha) |
| `MessageMedia` | Envio de áudio |
| `msg.author`, `msg.type` | Identificar autor em grupo e tipo da mensagem |

---

## 2. Matriz comparativa

Legenda: ✅ suporta | ⚠️ parcial/com ressalvas | ❌ não suporta | ❓ validar na prática

| Funcionalidade que usamos | whatsapp-web.js (atual) | **Cloud API (oficial Meta)** | **Baileys** (lib WebSocket) | **Evolution API** (servidor REST sobre Baileys) |
|---|---|---|---|---|
| Receber/enviar texto | ✅ | ✅ | ✅ | ✅ |
| `reply` (citar mensagem) | ✅ | ✅ (context) | ✅ | ✅ |
| Enviar áudio/mídia | ✅ | ✅ | ✅ | ✅ |
| **Receber vCard (indicações)** | ✅ | ⚠️ recebe `contacts` estruturado (formato diferente, refazer parser) | ✅ (contactMessage) | ✅ **validado 19/09**: `contactMessage.vcard` idêntico ao formato atual (incl. `waid=`); parser atual serve sem alteração |
| **Grupos: eventos de entrada (`group_join`)** | ✅ | ❌ **Cloud API não opera grupos** | ✅ | ✅ |
| **Grupos: participantes, links de convite** | ✅ (+ Store hack) | ❌ | ✅ | ✅ |
| **Etiquetas (labels) Business** | ✅ | ❌ | ⚠️ leitura/aplicação disponível ❓ | ⚠️ ❓ |
| Validar número (`getNumberId`) | ✅ | ⚠️ só descobre ao enviar | ✅ (onWhatsApp) | ✅ (endpoint check) |
| Resolução LID ↔ telefone | ✅ | n/a (usa só telefone) | ⚠️ ❓ suporte a LID em evolução | ⚠️ ❓ |
| Histórico (`fetchMessages`) | ✅ | ❌ (só webhooks do momento) | ⚠️ (store próprio, precisa persistir) | ✅ (persiste em banco próprio) |
| Presença/typing | ✅ | ⚠️ limitado | ✅ | ✅ |
| **Enviar msg para número frio (indicados)** | ✅ | ❌ fora da janela de 24h só template pago aprovado | ✅ | ✅ |
| **Botões interativos** | ❌ deprecado (Meta removeu do protocolo Web) | ✅ garantido | ⚠️ ❓ contorno "native flow": funciona em muitos aparelhos, instável entre versões/iOS | ⚠️ ❓ (`sendButtons`, mesma base Baileys) |
| **Listas (menu de opções)** | ❌ deprecado | ✅ garantido | ⚠️ ❓ idem botões | ⚠️ ❓ (`sendList`) |
| **Enquetes (Poll)** — alternativa estável a botões | ✅ (não usamos ainda) | ❌ | ✅ | ✅ (`sendPoll` + evento de voto) |
| Custo por mensagem | R$ 0 | 💰 por conversa iniciada | R$ 0 | R$ 0 |
| Sem QR / sem sessão | ❌ QR + sessão | ✅ token permanente | ❌ QR + sessão | ❌ QR + sessão (gerenciada pela API) |
| Estabilidade de conexão | ❌ **problema atual** | ✅ | ⚠️ melhor (WebSocket direto, sem Chromium) ❓ | ⚠️ reconexão automática embutida ❓ |
| Consumo de RAM por número | ~200–300 MB (Chromium) | zero (nuvem Meta) | ~30–80 MB | ~50–100 MB/instância |
| Multi-instância (SaaS) | manual (1 processo/empresa) | ✅ por número registrado | manual | ✅ **nativo** (N instâncias num servidor, API REST p/ criar) |
| Risco de banimento | ⚠️ não-oficial | ✅ zero | ⚠️ não-oficial | ⚠️ não-oficial |
| Esforço de migração do nosso código | — | 🔴 alto (reescrever pipeline + perder funções) | 🟡 médio (mesma linguagem, trocar a camada client) | 🟡 médio (bot vira consumidor REST/webhook) |

---

## 3. Conclusões da análise

### Cloud API oficial: incompatível com o produto atual

Três bloqueadores objetivos, independentes de preferência:

1. **Não opera grupos** — mata a Missão 1 da campanha (grupos por bairro), a sincronização de grupos e a exportação de participantes.
2. **Janela de 24 horas + templates pagos** — mensagem para indicado (número que nunca falou conosco) só via template aprovado pela Meta e cobrado por conversa. O modelo da campanha de indicações fica inviável ou caro.
3. **Sem etiquetas e sem histórico** — o gerenciador de chats do dashboard perderia funções.

Conclusão: **descartada para o escopo atual**. Só voltaria à mesa se o produto mudar (ex.: abandonar grupos e campanha de indicação).

### Alternativas não-oficiais: onde está o ganho real

O problema das desconexões do whatsapp-web.js vem em grande parte da arquitetura: ele **controla um Chromium** rodando o WhatsApp Web — qualquer atualização do site da Meta, cache inválido ou queda do navegador derruba a sessão. As alternativas baseadas em **Baileys** falam o protocolo por WebSocket **sem navegador**:

- **Baileys (lib)**: substituição direta da camada `client` no nosso código Node; mais leve e estável, porém mais baixa-nível (teríamos que reimplementar conveniências como `msg.reply`, store de chats).
- **Evolution API (recomendada para piloto)**: servidor pronto (Docker) que embute Baileys e expõe **REST + webhooks**, com **multi-instância nativa** — cria/gerencia N sessões por API, o que casa direto com o plano SaaS (doc 13). Comunidade brasileira grande. O bot passaria a consumir HTTP em vez de ter a lib embutida, o que também desacopla o bot do WhatsApp (bônus de arquitetura).

**Ressalva**: ambas continuam não-oficiais (mesmo risco de banimento do atual — não piora, não melhora). Os itens marcados ❓ na matriz (labels, LID, estabilidade real) **precisam de validação prática** — versões dessas ferramentas mudam rápido.

---

## 3.1 Resultados do piloto (em andamento)

Piloto no ar desde 19/09/2026 — Evolution API v2.3.7 (Docker, porta 8033) + webhook listener (porta 3099).

| Teste | Resultado | Data |
|-------|-----------|------|
| Receber texto (webhook `messages.upsert`) | ✅ Passou | 19/09/2026 |
| Receber vCard (`contactMessage`) | ✅ Passou — vCard cru idêntico ao formato do wwebjs (incl. `waid=`); `utils/vcardParser.js` funciona sem alteração | 19/09/2026 |
| Vários contatos de uma vez (`contactsArrayMessage`) | Pendente | |
| Entrada em grupo (`group-participants.update`) | ✅ Passou — payload traz id do grupo, `action: "add"` e participante com **LID e telefone já resolvidos** (melhor que o wwebjs, que exige `getContactLidAndPhone`) | 19/09/2026 |
| Participantes de grupo específico (`/group/participants`) | ✅ Passou — LID + telefone + admin por participante; **substitui o hack `window.Store`** do wwebjs | 19/09/2026 |
| Link de convite (`/group/inviteCode`) | ✅ Passou — retorna `inviteUrl` e `inviteCode` | 19/09/2026 |
| Listar todos os grupos (`/group/fetchAllGroups`) | ⚠️ Timeout em conta grande (1.749 chats), mesmo sem participantes. Contornável: consultar por grupo específico (nosso caso de uso real). Revalidar em número limpo | 19/09/2026 |
| Botões / listas (Android e iOS) | ❌ Botões enviados via `sendButtons` **não chegaram** ao destinatário — confirma a instabilidade do contorno "native flow" no Baileys. Não contar com botões/listas em nenhuma API não-oficial | 19/09/2026 |
| Enquete + voto | ✅ **Passou de ponta a ponta** — enquete entregue e voto retornou via webhook. **Substituto recomendado para menus** (sabores, tamanhos, confirmações) | 19/09/2026 |
| Etiquetas | Pendente | |
| Número frio + validação | Pendente | |
| LID ↔ telefone | ✅ Passou — resolvido nativamente nos eventos de grupo e na listagem de participantes | 19/09/2026 |
| Estabilidade 2–4 semanas | Em observação | |

Nota: o piloto está rodando com um número real por decisão do operador (19/09); testes de envio (botões/enquetes/número frio) devem preferencialmente ser repetidos em chip de teste.

## 3.2 Migração de motor (19/09/2026)

Decisão do operador: migrar a produção para Evolution **sem esperar o período de observação**, porque o pareamento do wwebjs quebrou em produção (QR escaneado não conectava) — o teste de estabilidade passa a acontecer na própria produção.

Implementação: `services/evolutionClient.js` — adaptador que expõe a interface do whatsapp-web.js (eventos `message`/`group_join`/`qr`/`ready`, `sendMessage`, `msg.reply`, `getChats`, participantes, invite code, cache LID↔telefone) sobre REST + webhook da Evolution. Seleção por `.env`: `WA_ENGINE=evolution` liga o novo motor; `WA_ENGINE=wwebjs` é o **rollback imediato** (basta trocar e reiniciar).

Limitações conhecidas do motor evolution: etiquetas (getLabels/changeLabels) viram no-op; `sendSeen` não limpa não-lidas; gerenciador de chats do dashboard em modo best-effort (endpoints findChats/findMessages). Validado por teste estrutural com os payloads reais capturados no piloto (texto, vCard, multi-vCard, group_join, LID).

## 4. Próximo passo proposto: piloto de validação

Antes de qualquer decisão de migração:

1. Subir **Evolution API** em Docker no servidor com **um número de teste** (nunca o de produção).
2. Validar na prática cada linha ❓/⚠️ da matriz, na ordem de criticidade:
   - vCard recebido via webhook (formato do payload → adaptar `vcardParser`)
   - Evento de entrada em grupo + listagem de participantes + link de convite
   - Etiquetas Business (ler e aplicar)
   - Resolução LID ↔ telefone
   - Envio para número frio e validação de número
   - **Botões (`sendButtons`) e listas (`sendList`)**: testar em Android E iOS — hoje não temos isso no wwebjs (deprecado pela Meta no protocolo Web); no Baileys é contorno instável, validar aparelho a aparelho
   - **Enquetes (`sendPoll` + evento de voto)**: alternativa estável a botões/listas para menus (sabores, tamanhos, confirmação)
3. Medir **estabilidade por 2–4 semanas**: quedas de sessão, reconexões automáticas bem-sucedidas, RAM.
4. Só então decidir: migrar, manter, ou usar híbrido (Evolution para novos clientes do SaaS, wwebjs onde já roda).

Enquanto isso, mitigar as desconexões no atual: alerta automático de queda + página de QR (Fase 1 do doc 13) e manter `.wwebjs_cache` limpo nos restarts planejados.
