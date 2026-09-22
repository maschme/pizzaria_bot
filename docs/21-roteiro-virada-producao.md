# Roteiro da virada em produção (cupom único, indicado e pós-venda)

Escrito em 22/09/2026 para a instância **pizzaria-crm** (Tempero Napolitano). Põe em uso o que foi construído nos docs [18](./18-cupons-multipedidos.md) (cupom único) e [20](./20-modelos-e-fluxos-completos.md) (modelos, canal→fluxo, indicado, pós-venda).

**Como usar:** siga as fases na ordem. Cada fase termina num estado estável — dá para parar no fim de qualquer uma e continuar outro dia. A ordem é de **risco crescente**: primeiro o que só responde a quem escreve, depois o que aborda quem já é cliente, por último o que aborda quem nunca falou com a loja.

| Fase | O que entra | Quem é afetado | Risco |
|------|-------------|----------------|-------|
| 0 | Deploy e conferência | ninguém | — |
| 1 | Campanha com cupom único (substitui a atual) | quem manda a frase da campanha | baixo |
| 2 | Canais apontando o fluxo | quem chega por QR/panfleto/link | baixo |
| 3 | Pós-venda | quem acabou de pedir | médio |
| 4 | Fluxo do indicado | quem foi indicado (nunca falou com a loja) | alto |
| 5 | Limpeza diária e acompanhamento | — | — |

Comandos no servidor rodam como `chia`, na pasta `/home/chia/canivetesuico/pizzaria_bot` (só o `pm2` leva `sudo`).

---

## Fase 0 — Deploy e conferência

```bash
cd /home/chia/canivetesuico/pizzaria_bot && git pull && node database/migrate.js && sudo pm2 restart pizzaria-crm
```

O `migrate.js` deve terminar com "✨ N migração(ões) aplicada(s)" ou "✨ Nada a aplicar". Se alguma falhar, **pare aqui** e me mande a mensagem — o `&&` já impede o restart.

Depois confira, no Dashboard → **Integrações**:

- [ ] Webhook **ativo**, com os selos "segredo da URL" e "access_token" verdes
- [ ] **Sem** o aviso amarelo de `access_token` diferente (se aparecer, o valor do `.env` não bate com o do painel da Multipedidos)
- [ ] API **ativa** e "Testar conexão" respondendo ok

E no log:

```bash
sudo pm2 logs pizzaria-crm --lines 50 --nostream | grep -i "scheduler\|pronto"
```

- [ ] Aparece `📣 Scheduler de abordagem ativa ligado (a cada 60 s)`

> **Troca do access_token (recomendada):** o valor atual apareceu no chat durante o estudo. Gere um novo, troque nos três eventos do painel da Multipedidos e em `MULTIPEDIDOS_WEBHOOK_TOKEN` no `.env`, depois `sudo pm2 restart pizzaria-crm --update-env`. Enquanto estiverem diferentes, os eventos são capturados mas **não processados** (cupom usado não é marcado) — e a tela avisa.

---

## Fase 1 — Campanha com cupom único

Substitui a "Campanha 30% Desconto" atual (cupons de arquivo, mesmo código para todos) pela versão com cupom único por cliente.

1. **Fluxos → Modelos → "Campanha de indicação (até 30% em 3 missões)" → Usar modelo.**
   - Nome: `Campanha 30% (cupom único)`
   - Link do cardápio: o link de pedidos da loja
   - Link de avaliação no Google: opcional
2. O fluxo abre no editor, **inativo**. Revise:
   - [ ] Os dois nós **Multipedidos** (criar 10% / alterar 20%) — clique em **Interpretar** em cada um e confira o que a IA entendeu
   - [ ] O texto do gatilho é **o mesmo** da campanha atual (senão os QRs e links já impressos param de funcionar)
   - [ ] Os textos das mensagens
   - [ ] A missão 3 (avaliação): decida se mantém o texto atual — veja o aviso sobre a política do Google no card do modelo
3. **Salve.**
4. **Teste com o seu número, antes de ativar para clientes:**
   - Mude o gatilho para uma frase só sua (ex.: `campanha teste 30`), salve e ative
   - Mande a frase pelo WhatsApp e percorra a missão 1 (entrar no grupo)
   - [ ] Chegou a mensagem com um cupom `CUPOM…` (ou o prefixo que você configurou)
   - [ ] O cupom aparece no gestor da Multipedidos, com uso único e 15 dias
   - Desative o fluxo, volte o gatilho para a frase real e salve
5. **Virada:** desative a campanha antiga → ative a nova.
   - [ ] Só uma das duas está ativa (duas com o mesmo gatilho = a mais antiga ganha)

**Rollback:** desative a nova e reative a antiga. Os cupons já emitidos continuam valendo.

---

## Fase 2 — Canais apontando o fluxo

Hoje os canais só marcam a origem; a mensagem deles precisa coincidir com a frase do gatilho. Agora o canal escolhe o fluxo.

1. **Dashboard → Canais.** Para cada canal (QR da caixa, panfleto, iFood, tráfego pago…):
   - Editar → **Fluxo que inicia** → `Campanha 30% (cupom único)` → Salvar
2. [ ] A coluna **Fluxo** mostra o nome em todos, sem o selo "fluxo inativo"
3. Teste um: abra o link `wa.me` do canal no seu celular e mande a mensagem pré-preenchida
   - [ ] A campanha começou
   - [ ] O contato ficou marcado com aquele canal (Dashboard → Contatos ou aba Funil)

**Rollback:** volte o campo para "Nenhum — só rastrear a origem". O canal passa a depender do gatilho de texto, como antes.

### 2.1 Canais para quem o bot aborda

Quem o bot aborda (indicado, pós-venda) nunca manda a frase do canal — sem isso, essas pessoas ficam sem origem no funil. Crie um canal para cada evento:

1. **Canais → Novo canal**
   - Nome: `Indicação` · Tipo: `Outro` · Como o cliente chega: **Por ação do bot** · Quando: **Cliente foi indicado por alguém**
2. Repita para o pós-venda: nome `Pós-venda`, evento **Cliente acabou de fazer um pedido**
3. [ ] Na lista, os dois aparecem com o selo da origem e "— fluxo do evento" na coluna Fluxo (sem botão de QR, que aqui não faz sentido)

Quem já tinha origem (QR, panfleto) **mantém a original** — o canal de evento só marca quem ainda não tinha.

---

## Fase 3 — Pós-venda

Aborda quem **acabou de pedir**, oferecendo as campanhas que ele ainda pode participar. Vale 24 h após o pedido.

1. **Marque o que pode ser oferecido:** abra `Campanha 30% (cupom único)` → nó **Gatilho** → ligue **"Oferecer este fluxo no pós-venda"**
   - Título: `Ganhe até 30% indicando amigos` · Descrição: `3 missões rápidas` · Elegível: `Só quem nunca participou`
   - Salve (o fluxo pode continuar ativo)
2. **Fluxos → Modelos → "Pós-venda" → Usar modelo** (nome da loja) → revise os textos → **Salve**
3. **Teste com o seu número:**
   - Ative o fluxo de pós-venda
   - Ajuste o atraso para 1 minuto: Dashboard → Whats → Configurações → `pos_venda_atraso_min` = `1`
   - Faça um pedido de teste no cardápio com o **seu** telefone e conclua no gestor (status "Finalizado")
   - [ ] Em ~1 min chegou o menu com a campanha e a opção `0`
   - [ ] Respondendo `1`, a campanha começou
   - [ ] Respondendo `0` (em outro teste), o contato parou de receber ofertas
   - Volte `pos_venda_atraso_min` para `40`
4. [ ] Deixe ativo

**Atenção:** enquanto estiver ativo, **todo** cliente com telefone que concluir pedido recebe uma mensagem ~40 min depois (no máximo 1 a cada 7 dias, e só se houver campanha elegível para ele). Se não houver nada elegível, ninguém é incomodado.

**Rollback:** desative o fluxo de pós-venda. A fila para de ser alimentada na hora; itens já enfileirados expiram sozinhos em até 24 h (para cancelar na hora: `UPDATE abordagens_fila SET status='descartado' WHERE status='pendente'`).

---

## Fase 4 — Fluxo do indicado

**É o de maior risco:** manda mensagem para quem **nunca falou com a loja**. Por isso vem por último, depois que o resto estiver rodando bem.

1. **Fluxos → Modelos → "Cliente indicado" → Usar modelo** (nome da loja + link do cardápio)
2. Revise com cuidado — é a mensagem que um estranho vai receber:
   - [ ] Diz **quem indicou** logo na primeira linha
   - [ ] Tem a opção **3 - Não quero mais receber mensagens**
   - [ ] É curta e não parece disparo em massa
3. **Teste:** ative o fluxo e peça a alguém de confiança (ou use um segundo número seu) para ser indicado por você na campanha
   - [ ] A mensagem chegou ~2 min depois, com o seu nome
   - [ ] Respondendo `1`, o cupom de 10% chegou
   - [ ] Respondendo `3`, o contato parou de receber (confirme tentando de novo)
4. [ ] Deixe ativo

**Acompanhe de perto nos primeiros dias.** Sinais de problema: gente respondendo "quem é você?", "não pedi isso", ou bloqueios. Se aparecer, desative e me chame para ajustarmos o texto.

**Rollback:** desative o fluxo do indicado. Nenhuma indicação nova gera abordagem.

---

## Fase 5 — Limpeza diária e acompanhamento

1. **Agende a limpeza dos cupons vencidos:**

```bash
cd /home/chia/canivetesuico/pizzaria_bot && sudo pm2 start scripts/multipedidos-cupons-limpeza.js --name cupons-limpeza-pizzaria --cron "30 4 * * *" --no-autorestart && sudo pm2 save
```

Para ver o que ela faria, sem alterar nada: `node scripts/multipedidos-cupons-limpeza.js --seco`

2. **O que olhar na primeira semana:**

| Onde | O que |
|------|-------|
| Dashboard → Funil | Conversões por canal |
| Dashboard → Integrações | Eventos do webhook chegando, sem aviso de token |
| Gestor da Multipedidos → Cupons | Cupons `CUPOM…` sendo criados e usados |
| `sudo pm2 logs pizzaria-crm --nostream \| grep -i "cupom\|abordagem\|pós-venda"` | Emissões, abordagens e erros |
| `SELECT status, COUNT(*) FROM abordagens_fila GROUP BY status;` | Fila saudável (pouco `descartado`/`erro`) |

---

## Se algo der errado

| Sintoma | Provável causa | O que fazer |
|---------|----------------|-------------|
| Cliente recebe "não consegui gerar seu cupom" | API da Multipedidos fora ou desligada na tela | Integrações → Testar conexão; o fluxo já caiu no cupom de arquivo, ninguém ficou sem resposta |
| Cupom usado não é marcado | `access_token` divergente | Integrações mostra o aviso; acerte o `.env` e reinicie com `--update-env` |
| Ninguém recebe pós-venda/indicado | Fluxo inativo, fora do horário, opt-out, ou nada elegível | `SELECT status, motivo FROM abordagens_fila ORDER BY id DESC LIMIT 20;` mostra o motivo de cada item |
| Campanha não inicia pelo QR | Canal sem fluxo e frase diferente do gatilho | Canais → aponte o fluxo |
| Cliente escolheu uma opção do menu e nada aconteceu | A resposta não chegou ao fluxo | `node scripts/diagnostico-abordagem.js <telefone>` mostra a trilha, o `@lid` do contato e a fila |
| Quero parar tudo que é abordagem ativa | — | Desative os fluxos de pós-venda e indicado; o resto continua funcionando |

## O que fica pendente

- **Missão 3 (avaliação no Google)**: depende da conferência do [doc 19](./19-conferencia-avaliacoes-google.md), ainda não implementada. Até lá a missão 3 do modelo é o texto atual, sem verificação automática.
- **Expurgo do `webhook_eventos`**: a tabela acumula pedidos reais (nome, telefone, endereço, CPF) desde o estudo. Vale limpar o histórico antigo.
- **Campanha legada** (`case 2/3` em `BotIApizzaria.js`): continua no código como handoff do fluxo visual. Sai numa rodada de limpeza, depois que a campanha nova estiver estável.
