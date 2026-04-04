# Tabela `contatos` – como é usada no código

## Estrutura (migração)

- **Tabela:** `contatos`
- **Campos:** `id`, `whatsapp_id` (UNIQUE), `nome`, `cam_grupo`, `id_negociacao`, `qt_indicados`, `cam_indicacoes`, `created_at`, `updated_at`

## Onde é escrito (só UPDATE – não há INSERT no projeto)

| Onde | O que faz | Formato do `whatsapp_id` |
|------|------------|---------------------------|
| **BotIApizzaria.js** (evento `group_join`) | `UPDATE contatos SET cam_grupo = 1 WHERE whatsapp_id = ?` | `numeroReal` = `contact.number` (retorno da API WhatsApp – em geral **só dígitos**, ex.: `5511999999999`) |
| **indicacaoService.js** (`registrarIndicacoes`) | `UPDATE contatos SET qt_indicados = ?, cam_indicacoes = ? WHERE whatsapp_id = ?` | `normalizarWhatsappId(indicadorWhatsappId)` = **só dígitos** (ex.: `5511999999999@c.us` → `5511999999999`) |

Conclusão: em todo o código que grava em `contatos`, o `whatsapp_id` é usado **só com dígitos** (sem `@c.us`).

## Onde é lido

- **fluxoExecutor.js** (ação “Ler campo do contato”): `SELECT campo FROM contatos WHERE whatsapp_id = ?` com `metaService.normalizarWhatsappId(this.chatId)` → também **só dígitos**.
- **BotIApizzaria.js** (group_join): `SELECT id_negociacao FROM contatos WHERE whatsapp_id = ?` com `numeroReal`.
- **indicacaoService.js**: `SELECT cam_indicacoes FROM contatos WHERE whatsapp_id = ?` com id normalizado.

## Problema: quando não existe linha

- **Não existe INSERT em `contatos`** neste projeto. As linhas são só **atualizadas**.
- Se a linha não foi criada por outro sistema (CRM, script, etc.), o UPDATE não afeta ninguém e o SELECT não acha nada → “Ler contato” devolve vazio.

## Como buscar o contato

- Use sempre **`whatsapp_id` em formato só dígitos** (ex.: `5511999999999`).
- No fluxo, `this.chatId` pode vir como `5511999999999@c.us`; por isso usamos `normalizarWhatsappId(chatId)` antes de consultar.
