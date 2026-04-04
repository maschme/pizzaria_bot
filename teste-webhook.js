#!/usr/bin/env node
'use strict';
/**
 * Teste rápido do webhook de automação.
 * Uso: node teste-webhook.js [URL]
 * Ex.: node teste-webhook.js
 *      node teste-webhook.js http://localhost:3007/api/fluxos/1/webhook
 */

const axios = require('axios');

const url = process.argv[2] || 'http://localhost:3007/api/fluxos/1/webhook';

const payload = {
  origem: 'teste-webhook.js',
  mensagem: 'Olá, automação!',
  timestamp: new Date().toISOString(),
  numero: 42
};

(async () => {
  console.log('POST', url);
  console.log('Body:', JSON.stringify(payload, null, 2));
  console.log('---');
  try {
    const res = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, validateStatus: () => true });
    const data = res.data;
    console.log('Status HTTP:', res.status);
    console.log('Resposta:', JSON.stringify(data, null, 2));
    if (data.success) {
      console.log('---');
      if (data.data?.logs?.length) console.log('Logs:', data.data.logs);
      if (data.data?.variables) console.log('Variáveis (resumo):', Object.keys(data.data.variables).join(', '));
    }
  } catch (err) {
    console.error('Erro:', err.message);
    if (err.response) console.error('Status:', err.response.status, err.response.data);
    process.exit(1);
  }
})();
