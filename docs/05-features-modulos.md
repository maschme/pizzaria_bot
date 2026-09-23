# Features e Módulos

## Mapa de funcionalidades

| Feature | Módulo principal | Status |
|---------|------------------|--------|
| Atendimento IA de pedidos | `BotIApizzaria.js` + `historico.js` | ✅ Ativo |
| Campanha 30% desconto | `BotIApizzaria.js` + `indicacaoService` | ✅ Ativo |
| Editor visual de fluxos | `fluxos.html` + `fluxoExecutor` | ✅ Ativo |
| Automações HTTP | `automacoes.html` + `automacaoExecutor` | ✅ Ativo |
| Dashboard operacional | `dashboard.html` + `dashboardRoutes` | ✅ Ativo |
| Gestão de grupos WhatsApp | `grupoWhatsappService` | ✅ Ativo |
| Prompts dinâmicos | `promptService` | ✅ Ativo |
| Provedores IA múltiplos | `provedorIAService` | ✅ Ativo |
| Requisições externas | `requisicaoExternaService` | ✅ Ativo |
| Cardápio JSON editável | `arquivoService` + `arquivos/` | ✅ Ativo |
| CRM contatos (parcial) | `contatoService` + tabela `contatos` | ⚠️ Parcial |
| Pedidos completos | `pedidosService` + `PedidosModel` | ⚠️ Legado |
| Integração funil CRM | `moverCardNoFunil()` | ⚠️ Stub |
| Missão 3 campanha | — | ❌ A definir |

---

## 1. Atendimento automático com IA

### Como funciona

1. Cliente envia mensagem no WhatsApp privado
2. Sistema verifica horário de funcionamento
3. Debounce agrupa mensagens rápidas (padrão 10s)
4. IA recebe histórico da sessão + prompt `atendimento_inicial`
5. IA pode disparar **requisições externas** conforme intenção detectada
6. Resposta enviada ao cliente

### Requisições externas disponíveis

| Tipo | Handler | Função |
|------|---------|--------|
| `sabores_salgados` | ia | Consulta cardápio salgado |
| `sabores_doces` | json | Lista sabores doces |
| `bordas` | json | Lista bordas |
| `taxa_entrega` | ia + Google Maps | Calcula taxa por endereço |
| `gruposdewhats` | funcao | Busca grupo por bairro |
| `finalizar_pedido` | funcao | Registra pedido |
| `atendimento_humano` | funcao | Transfere para humano |

### Sessões de atendimento

- Tabela `atendimentos` + `historico_atendimento`
- Cache em memória via `historico.js`
- Finalização automática ou manual

---

## 2. Campanha de desconto (até 30%)

Gamificação em 3 missões com desconto progressivo (+10% cada).

### Missão 1 — Entrar no grupo

1. Cliente aciona gatilho "campanha"
2. Informa bairro (IA extrai via prompt `extrair_bairro`)
3. Sistema busca grupo WhatsApp do bairro
4. Cliente entra no grupo → evento `group_join` confirma
5. `contatos.cam_grupo = 1`

**Alternativa:** fluxo visual de campanha com handoff para Missão 2.

### Missão 2 — 10 indicações

1. Cliente envia vCards (contatos da agenda)
2. `indicacaoService` registra em `indicacoes`
3. Atualiza `contatos.qt_indicados` e `cam_indicacoes`
4. Meta: 10 indicações únicas

### Missão 3

Ainda **não implementada** — placeholder no código e prompts.

### Sessões em memória

```javascript
// BotIApizzaria.js
sessoesCampanha = Map<numero, { etapa, missoes, bairro, ... }>
```

APIs de debug: `/campanha/sessoes`, `/campanha/sessao/:numero`

---

## 3. Fluxos conversacionais visuais

Motor: `services/fluxoExecutor.js`

### Capacidades

- Execução stateful por chat (variáveis por sessão)
- Suporte a múltiplos fluxos ativos simultaneamente
- Logs detalhados em `fluxo_exec_logs`
- Handoff campanha → legado (Missão 2)
- Ações: requisição externa, salvar variável, marcar meta, ler contato, webhook, cupom

### Gatilhos

Indexados em `fluxoService.buscarFluxoPorGatilho()`:
- Mensagem exata
- Palavra-chave (contém)

Prioridade: fluxo visual > gatilho DB > atendimento IA.

---

## 4. Automações HTTP

Motor: `services/automacaoExecutor.js`

Fluxos com `tipo = 'automacao'` executados **fora** do WhatsApp:

- Integração com sistemas externos via HTTP
- Processamento IA em batch
- Variáveis de contexto entre nós
- Logs de execução retornados na resposta

---

## 5. Dashboard administrativo

### Grupos WhatsApp

- Sincronização com o número conectado: automática ao conectar (com novas tentativas) e manual; espelha os grupos, removendo os que o número não tem mais
- Entrada em grupo detectada por `group_join`
- Mapeamento bairro → grupo
- Grupo geral como fallback
- Link de convite editável

### Gatilhos

- CRUD completo
- Tipos: campanha, atendimento, custom
- Prioridade numérica

### Configurações

- Chave-valor tipado (boolean, number, string, json)
- Agrupado por categoria
- Alteração em tempo real (recarrega config em memória)

### Contatos

- Listagem paginada
- Visualização de logs de fluxo
- Exclusão para testes (encerra fluxo ativo)

---

## 6. Gestão de IA

### Prompts

Armazenados no banco com variáveis substituíveis (`{{NOME}}`).

Prompts seed:
- `atendimento_inicial`
- `analise_cardapio`
- `campanha_desconto`
- `extrair_bairro`

Fallback: `utils/prompts.js`

### Provedores

- Múltiplos provedores configuráveis
- Um marcado como `isPrincipal`
- Teste de conexão via API

Tipos suportados: `alibaba`, `openrouter`, `openai` (compatível)

---

## 7. Cardápio e dados JSON

Pasta `arquivos/`:

| Arquivo | Conteúdo |
|---------|----------|
| `bairros.json` | Bairros atendidos |
| `bordas.json` | Tipos de borda e preços |
| `bebidas.json` | Bebidas |
| `sabores_tradicionais.json` | Sabores tradicionais |
| `sabores_especiais.json` | Sabores especiais |
| `sabores_doces.json` | Sabores doces |
| `sabores_doces_especiais.json` | Doces especiais |
| `sabores_tamanhos.json` | Tamanhos e preços |
| `cupons_desconto.json` | Cupons da campanha |
| `grupos_whatsapp.json` | Fallback de grupos |
| `Cardapio Completo.json` | Cardápio consolidado |
| `_meta.json` | Metadados de processamento IA |

Editáveis via dashboard IA ou diretamente no filesystem.

---

## 8. Metas e indicações

Tabelas: `metas`, `contato_metas`, `indicacoes`

Metas seed:
- `entrada_grupo`
- `10_indicacoes`
- `cupom_30_resgatado`

Usadas por nós de ação nos fluxos (`marcar_meta`, `verificar_meta`).

---

## 9. Identidade WhatsApp

`whatsappIdentityService.js` — normaliza IDs entre formatos:
- `5511999999999@c.us` (PN)
- `@lid` (privacidade WhatsApp)

Coluna `contatos.whatsapp_lid` para casos de privacidade.

---

## 10. Integração Multipedidos

Detalhes: [doc 17](./17-integracao-multipedidos.md) (estudo da API/webhooks) e [doc 18](./18-cupons-multipedidos.md) (cupons).

| Recurso | O que faz |
|---------|-----------|
| Tela **Integrações** | Liga/desliga webhook e API, mostra se os segredos do `.env` estão configurados, testa a conexão, define os limites de segurança dos cupons |
| Captura de webhooks | `/webhook/multipedidos/<segredo>` grava todo evento cru em `webhook_eventos` |
| **Cupom único por cliente** | Nós de fluxo "Multipedidos: criar cupom único" e "alterar cupom": comando em linguagem natural interpretado pela IA (com teto de segurança), um código por contato/campanha, promovido ao longo do fluxo (10% → 20% → …) |
| Uso do cupom | O webhook de pedido marca o cupom como usado (valor pago e desconto), conclui a meta configurada no nó e estorna em cancelamento — alimenta a etapa "converteu" do funil por canal |
| Limpeza diária | `scripts/multipedidos-cupons-limpeza.js` desativa na loja os cupons vencidos e não usados |
| Migração de fluxo | `scripts/migrar-fluxo-cupons-multipedidos.js` converte os nós `enviar_cupom` de um fluxo exportado, mantendo o cupom de arquivo como fallback |

Só funciona com lojas que usam a Multipedidos; instâncias sem a integração continuam com o `enviar_cupom` de arquivo.

---

## 11. Envio programático

`POST /send-message`

```json
{
  "number": "5511999999999",
  "message": "Sua pizza saiu para entrega!"
}
```

Usado por sistemas externos (ERP, cozinha, etc.).
