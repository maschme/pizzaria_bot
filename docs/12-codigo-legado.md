# Código Legado e Pendências

Arquivos e padrões antigos ainda presentes no repositório, com orientação sobre uso e migração.

---

## Arquivos legados

### `BotIcopia.js`

| Aspecto | Detalhe |
|---------|---------|
| **Função original** | Primeira versão do bot WhatsApp |
| **Endpoints** | Apenas `POST /send-message` |
| **IA** | Hardcoded via `ias.js` |
| **Status** | ❌ Não importado pelo projeto principal |
| **Ação recomendada** | Arquivar ou remover após confirmar que não há dependência |

---

### `roteadorMensagens.js`

| Aspecto | Detalhe |
|---------|---------|
| **Função original** | Roteador de mensagens por intenção |
| **Problema** | Referencia `gpts/gpt_pizzaria` — pasta **inexistente** |
| **Status** | ❌ Código morto — não importado em lugar nenhum |
| **Ação recomendada** | Remover |

---

### `ias.js`

| Aspecto | Detalhe |
|---------|---------|
| **Função** | Clientes diretos Qwen (Alibaba) e Claude (OpenRouter) |
| **Status** | ⚠️ Usado como **fallback** quando `provedorIAService` falha |
| **Problema** | API keys hardcoded no arquivo |
| **Ação recomendada** | Manter fallback temporário; migrar keys para `.env`; deprecar gradualmente |

---

### `utils/prompts.js`

| Aspecto | Detalhe |
|---------|---------|
| **Função** | Prompts estáticos em JavaScript |
| **Status** | ⚠️ Fallback quando prompt não existe no banco |
| **Ação recomendada** | Manter até 100% dos prompts estarem no DB; depois remover |

---

### `contexto.js`

| Aspecto | Detalhe |
|---------|---------|
| **Função** | CRUD tabela `conversas_atuais` (contexto + etapa) |
| **Status** | ⚠️ Paralelo ao sistema `historico.js` |
| **Problema** | Dois sistemas de contexto de conversa |
| **Ação recomendada** | Unificar em um único serviço de sessão |

---

## Models com conexão duplicada

Estes models criam **própria instância Sequelize** com `localhost` hardcoded, ignorando `database/connection.js`:

| Model | Tabela | Uso atual |
|-------|--------|-----------|
| `Models/Atendimento.js` | atendimentos | ✅ Usado por `historico.js` |
| `Models/HistoricoAtendimento.js` | historico_atendimento | ✅ Usado por `historico.js` |
| `Models/clienteModel.js` | clientes | ⚠️ Pouco usado |
| `Models/PedidosModel.js` | pedidos | ⚠️ Via `pedidosService` |
| `Models/contextoConversaModel.js` | conversas_atuais | ⚠️ Via `contexto.js` |

### Risco

Em produção com DB remoto (ex.: `vms.cutplay.com.br`), models legados podem tentar conectar em `localhost` enquanto o resto usa `.env`.

### Ação recomendada

Refatorar todos os models para importar `sequelize` de `database/connection.js`.

---

## Serviços parcialmente integrados

### `clienteService.js` + `pedidosService.js`

- Models completos existem (clientes, pedidos)
- `finalizarPedido` registrado como requisição externa
- **Sem UI** de gestão de pedidos no dashboard
- Integração incompleta com fluxo de atendimento IA

### `moverCardNoFunil()` (BotIApizzaria.js)

- Chamada após `group_join` quando `id_negociacao` existe
- Integração CRM externa — implementação mínima/stub

### `POST /webhook/movimento`

- Recebe payload CRM
- Atualmente apenas `console.log` — sem processamento

---

## Seeds com dados sensíveis

`database/setup.js` insere API keys reais nos provedores seed:

```javascript
// qwen-alibaba — apiKey hardcoded
// openrouter-claude — apiKey hardcoded
```

**Ação recomendada:** ler keys de variáveis de ambiente ou deixar vazio no seed.

---

## Sessões em memória

| Dado | Local | Perdido ao reiniciar? |
|------|-------|----------------------|
| Sessões campanha | `sessoesCampanha` Map | ✅ Sim |
| Histórico atendimento (cache) | `historico.js` | Parcial (DB persiste) |
| Fluxos ativos | `fluxoExecutor` Map | ✅ Sim |
| QR code | variável em memória | ✅ Sim |

---

## Dependência whatsapp-web.js

| Aspecto | Detalhe |
|---------|---------|
| **Tipo** | Biblioteca não oficial (scraping WhatsApp Web) |
| **Risco** | Bloqueio de conta, breaking changes do WhatsApp |
| **Alternativa futura** | WhatsApp Business Cloud API (Meta) |
| **Sessão** | `.wwebjs_auth/` — não versionar |

---

## Frontend monolítico

Cada HTML em `public/` contém:
- CSS inline (~200–500 linhas)
- JavaScript inline (~500–1500 linhas)

**Impacto:** difícil manutenção, sem bundler, sem componentes reutilizáveis.

**Ação futura:** extrair para arquivos separados ou framework (Vue/React).

---

## Checklist de limpeza

- [ ] Remover `BotIcopia.js`
- [ ] Remover `roteadorMensagens.js`
- [ ] Unificar conexão Sequelize nos models legados
- [ ] Mover API keys para `.env`
- [ ] Unificar `contexto.js` e `historico.js`
- [ ] Implementar INSERT em `contatos`
- [ ] Persistir sessões campanha
- [ ] Implementar webhook CRM
- [ ] Adicionar auth no dashboard
- [ ] Criar README.md na raiz apontando para `/docs`

---

## Referências

- [Tabela contatos](./CONTATOS_TABELA.md)
- [Roadmap](./10-roadmap.md)
- [Evolução](./11-evolucao-etapas.md)
