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
