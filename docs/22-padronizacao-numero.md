# Padronização do número de telefone

Escrito em 22/09/2026, depois de um pós-venda em que o cliente recebeu o menu, respondeu `1` e nada aconteceu.

## O problema

O mesmo cliente chega ao sistema em formatos diferentes, e comparar as strings cruas não funciona.

| De onde vem | Como chega | Exemplo |
|---|---|---|
| Pedido da Multipedidos | 13 dígitos, com o 9º | `5547984509046` |
| Mensagem do WhatsApp | 12 dígitos, sem o 9º | `554784509046` |
| Contato de indicação (vCard) | sem DDI, com máscara | `(47) 98450-9046` |
| Conta nova do WhatsApp | não é telefone | `123456789012345@lid` |
| Formulário, integração externa | qualquer coisa | `+55 47 9 8450-9046` |

O bot abria o fluxo do pós-venda em `5547984509046@c.us`, porque é o que o pedido traz. A resposta do cliente chegava de `554784509046@c.us`. Chaves diferentes, sessão não encontrada, e a escolha caía no atendimento comum.

O 9º dígito foi acrescentado aos celulares brasileiros em 2012. O número real tem o 9, mas o WhatsApp entrega mensagens de parte das contas antigas sem ele.

## A regra

Tudo passa por [`services/telefoneService.js`](../services/telefoneService.js), que são funções puras, sem banco nem rede.

| Para | Use | O que faz |
|---|---|---|
| Gravar | `canonico()` | forma única: celular brasileiro sempre com o 9º dígito |
| Buscar e comparar | `variantes()`, `mesmoNumero()`, `clausulaIn()` | considera todas as formas |
| Enviar | `chatId()` | monta o destinatário a partir do canônico |
| Comparar colunas em SQL | `sqlFormaCurta()` | reduz os dois lados à forma sem o 9º dígito |

Quando a gravação é na tabela `contatos`, ou depende dela, passe antes por `contatoIdService.resolverIdGravavel()`. Ele adota a forma **em que o contato já existe**, e só usa a canônica para contato novo. É o que evita duplicata numa coluna com índice único.

**Nunca escreva `WHERE whatsapp_id = ?` com um número.** Use `clausulaIn`:

```js
const alvo = telefone.clausulaIn('whatsapp_id', numero);
if (!alvo) return null;
const [rows] = await conn.execute(
  `SELECT ... FROM contatos WHERE ${alvo.sql} LIMIT 1`, alvo.params);
```

## Por que não migrar os dados

Gravar canônico e ler por variantes resolve sem tocar no que já está lá. Os registros antigos continuam sendo encontrados e os novos nascem padronizados. Uma migração exigiria fundir registros duplicados, com risco de perder histórico, e não traria nada que as variantes já não dêem.

## Cuidados do módulo

- **Fixo não ganha o 9º dígito.** Celular tem o número local começando em 6, 7, 8 ou 9; fixo começa em 2, 3, 4 ou 5.
- **Número estrangeiro não vira brasileiro.** Um número de 11 dígitos só recebe o DDI 55 quando o local começa com 9, que é o próprio 9º dígito. Sem isso, um telefone dos Estados Unidos com DDD aparente válido viraria brasileiro.
- **DDD é validado** contra a lista dos que existem no Brasil.
- **`@lid` não é telefone.** `resolverIdGravavel` recusa, para não criar contato fantasma com os dígitos do identificador.
- **`sqlFormaCurta` não usa índice.** Vale em consulta de relatório, não em caminho de mensagem.
- **Nem todo telefone é um WhatsApp.** Antes de o bot abrir conversa sozinho, passe por `ehPlausivelParaWhatsapp()`. Pedido de marketplace traz telefone mascarado, um 0800 com o código de rastreio colado no fim (`0800700304030695247`, 19 dígitos), e isso chegou a virar abordagem em produção. A função recusa acima de 15 dígitos, que é o teto do padrão internacional, qualquer número começando com 0, e número brasileiro com código de área inexistente.

## O que foi corrigido

| Onde | Sintoma |
|---|---|
| Sessão de fluxo | cliente abordado pelo bot respondia e nada acontecia |
| Indicação | o ciclo quase nunca fechava: gravava o vCard cru, buscava com o número completo |
| Fila de abordagem | aceitava número sem DDI e montava um destinatário inválido |
| Opt-out | valia só para uma das formas do número |
| Canal | gravava os dígitos de uma conta `@lid` como telefone e duplicava contato |
| Metas e participação | missão concluída "sumia" e o cliente reentrava numa campanha já feita |
| Pós-venda | mesmo cliente podia ser abordado duas vezes |
| Entrada no grupo | não encontrava o contato e não marcava a missão |
| Dashboard | mostrava "sem contato" e "não em fluxo" para quem existe |
| Cliente e pedido legados | busca pelos últimos 8 dígitos podia casar cliente de outro DDD |

## Nome do cliente e conversas duplicadas no chat

Acrescentado em 23/09/2026.

**Nome.** Nada gravava `contatos.nome`, então todo contato aparecia sem nome. Agora o webhook da Multipedidos grava o nome do cadastro do cliente (`client.name`, ou `name` na raiz) a cada evento de pedido, em `contatoService.salvarNomeDoPedidoMultipedidos`:

- procura o contato por **todas** as formas do número; se houver duplicata antiga, as duas linhas recebem o nome
- contato que não existe nasce com `resolverIdGravavel`, então a primeira mensagem dele no WhatsApp já o encontra com nome
- o cadastro prevalece sobre o perfil do WhatsApp: se o nome mudar lá, muda aqui
- pedido de mesa/balcão (sem telefone), telefone mascarado de marketplace e "nome" sem letras são ignorados
- o log não mostra nome nem telefone

Para os pedidos que chegaram antes disso, os nomes saem do que já foi capturado em `webhook_eventos`:

```bash
node scripts/contatos-nomes-multipedidos.js
```

Sem `--aplicar` só conta. Com `--aplicar`, grava (o nome mais recente de cada cliente vence).

**Conversas duplicadas.** O WhatsApp pode manter várias conversas para a mesma pessoa: sem o 9º dígito (como a conta foi registrada), com o 9 (aberta pelo bot a partir do número do pedido) e pela conta `@lid`. O chat do painel mostrava cada uma numa linha, uma pelo nome, outra pelo número, outra pelo id. Agora `chatService` junta as conversas por pessoa:

| Junta quando | Como |
|---|---|
| números iguais a menos do 9º dígito | `telefone.formaCurta()` |
| `@lid` ligado a um telefone | `contatos.whatsapp_lid`, ou o que o motor souber (`getContactLidAndPhone`) |

Nome igual não junta: dois "João" são duas pessoas. O que o motor ensinar sobre um `@lid` é gravado em `contatos.whatsapp_lid` do contato que já existe, para não se perder quando o bot reinicia. No motor Evolution, o vínculo também é aprendido da lista de conversas, quando a Evolution o traz.

Na tela: uma linha por pessoa, com o nome do cadastro primeiro (depois o perfil do WhatsApp, depois o número) e a etiqueta "N conversas" quando houver junção. Ao abrir, as mensagens de todas as conversas aparecem numa linha do tempo só. A resposta do operador vai para a conversa em que o cliente escreveu por último.

Limite: um `@lid` que nem o banco nem o motor conseguem ligar a um telefone continua numa linha separada até o vínculo aparecer (por exemplo, quando o cliente entra num fluxo, que grava o `@lid` no contato).

## Diagnóstico

Quando alguém abordado pelo bot não responder como esperado:

```bash
node scripts/diagnostico-abordagem.js 5547999998888
```

Mostra a identidade conhecida, a trilha de execução do fluxo, a fila de abordagem e se a resposta digitada casaria com algum gatilho de texto.

Para ver o que ficou de duplicado antes desta mudança:

```bash
node scripts/contatos-duplicados.js
```

Só lê, não altera. O sistema já encontra o contato nas duas formas, então conviver com as duplicatas é seguro. Se quiser unificar, comece pelas que o script marca como "sem histórico" e apague sempre por id exato.
