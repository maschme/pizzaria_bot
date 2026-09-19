'use strict';

/**
 * Receptor de webhooks do piloto Evolution API.
 * Loga todos os eventos no console e em evolution-events.log (JSON por linha),
 * para validar os itens da matriz do docs/14-analise-apis-whatsapp.md.
 *
 * Uso: node webhook-listener.js   (porta 3099, ou WEBHOOK_PORT no ambiente)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.WEBHOOK_PORT || 3099;
const LOG_FILE = path.join(__dirname, 'evolution-events.log');

app.post('/webhook', (req, res) => {
  const body = req.body || {};
  const evento = body.event || 'desconhecido';
  const instancia = body.instance || '-';

  // Resumo legível no console
  const data = body.data || {};
  const tipoMsg = data.messageType || data.message?.messageType || '';
  const de = data.key?.remoteJid || data.remoteJid || '';
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${evento} | inst=${instancia}${tipoMsg ? ' | tipo=' + tipoMsg : ''}${de ? ' | de=' + de : ''}`);

  // Destaques para os testes do piloto
  if (tipoMsg === 'contactMessage' || tipoMsg === 'contactsArrayMessage') {
    console.log('  🔍 vCARD RECEBIDO — payload completo no log (validar parser)');
  }
  if (evento === 'group-participants.update' || evento === 'GROUP_PARTICIPANTS_UPDATE') {
    console.log('  🔍 EVENTO DE GRUPO — validar entrada de participante (Missão 1)');
  }
  if (tipoMsg === 'pollUpdateMessage' || evento.toLowerCase().includes('poll')) {
    console.log('  🔍 VOTO EM ENQUETE — validar alternativa a botões');
  }

  // Log completo em arquivo (uma linha JSON por evento)
  fs.appendFile(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...body }) + '\n', () => {});

  res.json({ ok: true });
});

app.get('/', (req, res) => res.send('Webhook do piloto Evolution ativo. Eventos em evolution-events.log'));

app.listen(PORT, () => {
  console.log(`🎧 Webhook listener do piloto na porta ${PORT} (POST /webhook)`);
  console.log(`📝 Eventos completos gravados em: ${LOG_FILE}`);
});
