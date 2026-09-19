# Piloto Evolution API

Valida na prática os itens ❓/⚠️ da matriz do [doc 14](../docs/14-analise-apis-whatsapp.md) antes de qualquer decisão de migração.

> ⚠️ **Use um número de teste (chip separado). NUNCA o número de produção da pizzaria.**
> A porta 8081 evita conflito com os bots existentes (3007/3087).

## 1. Subir o ambiente (no servidor, com Docker)

```bash
cd piloto-evolution
cp .env.example .env        # edite AUTHENTICATION_API_KEY e SERVER_URL
docker compose up -d
docker compose logs -f evolution-api   # aguarde "HTTP - ON: 8080"
```

Manager web (opcional): `http://SEU_HOST:8081/manager` (login com a API key).

## 2. Criar a instância de teste e conectar

```bash
# Defina a chave para os comandos seguintes
export APIKEY="sua-chave-do-.env"
export EVO="http://localhost:8081"

# Criar instância
curl -X POST "$EVO/instance/create" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"instanceName":"piloto","integration":"WHATSAPP-BAILEYS","qrcode":true}'

# Obter QR (base64) — ou veja no manager web
curl "$EVO/instance/connect/piloto" -H "apikey: $APIKEY"
```

Escaneie com o **número de teste**. Status: `curl "$EVO/instance/connectionState/piloto" -H "apikey: $APIKEY"`

## 3. Ligar o receptor de webhooks

Em outro terminal (usa o node/express já instalados no projeto):

```bash
node piloto-evolution/webhook-listener.js
```

Registrar o webhook na instância (ajuste o host se a Evolution estiver em Docker e o listener no host — use o IP da máquina, não localhost):

```bash
curl -X POST "$EVO/webhook/set/piloto" -H "apikey: $APIKEY" -H "Content-Type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"http://172.17.0.1:3099/webhook","byEvents":false,"base64":false,"events":["MESSAGES_UPSERT","GROUP_PARTICIPANTS_UPDATE","GROUPS_UPSERT","CONNECTION_UPDATE","LABELS_ASSOCIATION","LABELS_EDIT"]}}'
```

## 4. Roteiro de testes (preencher a coluna Resultado)

Envie de outro celular para o número de teste, ou use os curls abaixo. Tudo que chegar aparece no listener e em `evolution-events.log`.

| # | Teste | Como | Resultado |
|---|-------|------|-----------|
| 1 | Texto simples (envio) | `curl -X POST "$EVO/message/sendText/piloto" -H "apikey: $APIKEY" -H "Content-Type: application/json" -d '{"number":"5547XXXXXXXXX","text":"teste piloto"}'` | |
| 2 | **vCard recebido** (crítico — Missão 2) | Do outro celular, envie um contato ao número de teste; conferir payload `contactMessage` no log e comparar com o parser atual | |
| 3 | **Entrada em grupo** (crítico — Missão 1) | Crie um grupo com o número de teste; entre com o outro número; conferir `GROUP_PARTICIPANTS_UPDATE` | |
| 4 | Participantes do grupo | `curl "$EVO/group/participants/piloto?groupJid=XXXX@g.us" -H "apikey: $APIKEY"` | |
| 5 | Link de convite do grupo | `curl "$EVO/group/inviteCode/piloto?groupJid=XXXX@g.us" -H "apikey: $APIKEY"` | |
| 6 | **Botões** (hoje não temos!) | `curl -X POST "$EVO/message/sendButtons/piloto" -H "apikey: $APIKEY" -H "Content-Type: application/json" -d '{"number":"5547XXXXXXXXX","title":"Cardápio","description":"Escolha","buttons":[{"type":"reply","displayText":"Pizza","id":"1"},{"type":"reply","displayText":"Bebida","id":"2"}]}'` — **testar recebimento em Android E iOS** | |
| 7 | **Lista** (hoje não temos!) | `curl -X POST "$EVO/message/sendList/piloto" ...` (ver doc oficial p/ payload) — Android E iOS | |
| 8 | **Enquete** (alternativa estável) | `curl -X POST "$EVO/message/sendPoll/piloto" -H "apikey: $APIKEY" -H "Content-Type: application/json" -d '{"number":"5547XXXXXXXXX","name":"Tamanho?","selectableCount":1,"values":["Pequena","Média","Grande"]}'` — votar e conferir evento do voto | |
| 9 | Etiquetas (labels) | Aplicar etiqueta pelo app Business e conferir `LABELS_ASSOCIATION`; testar aplicar via API | |
| 10 | Número frio + validação | `curl -X POST "$EVO/chat/whatsappNumbers/piloto" -H "apikey: $APIKEY" -H "Content-Type: application/json" -d '{"numbers":["5547XXXXXXXXX"]}'` e enviar texto a número que nunca conversou | |
| 11 | Áudio | `sendWhatsAppAudio` (ver doc oficial) | |
| 12 | LID ↔ telefone | Conferir nos payloads recebidos se vem `remoteJid` @lid e se há campo com o telefone real | |
| 13 | **Estabilidade** (2–4 semanas) | Deixar conectado; anotar quedas (`CONNECTION_UPDATE` no log), se reconectou sozinho, RAM (`docker stats evolution-piloto`) | |

## 5. Critérios de decisão

- Itens 2, 3, 4, 5 (campanha) **precisam** passar — são o motivo de a API oficial ter sido descartada.
- Itens 6/7 (botões/listas) são **bônus**: se instáveis, a alternativa é o item 8 (enquetes).
- Item 13 decide sobre o problema real: menos desconexão que o whatsapp-web.js atual.

Registrar os resultados na matriz do [doc 14](../docs/14-analise-apis-whatsapp.md) ao final.

## 6. Desmontar o piloto

```bash
docker compose down -v   # -v apaga volumes (sessão e banco do piloto)
```
