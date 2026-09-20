'use strict';

/**
 * Integração Multipedidos — fase de estudo (docs/17-integracao-multipedidos.md).
 *
 * captura: /webhook/multipedidos/:secret — público, autenticado pelo segredo na URL
 *          (MULTIPEDIDOS_WEBHOOK_SECRET). Grava a requisição crua em webhook_eventos e
 *          responde 200 na hora. Deve ser montado ANTES do bodyParser.json global, para
 *          receber o corpo exatamente como veio (JSON, form, XML ou malformado).
 * admin:   /api/integracoes/multipedidos/eventos — consulta do que foi capturado.
 */

const express = require('express');
const webhookEventoService = require('../services/webhookEventoService');

const ORIGEM = 'multipedidos';

const captura = express.Router();

captura.all(
  ['/:secret', '/:secret/*'],
  express.raw({ type: () => true, limit: '10mb' }),
  async (req, res) => {
    const segredo = (process.env.MULTIPEDIDOS_WEBHOOK_SECRET || '').trim();
    if (!segredo) return res.status(404).json({ ok: false });
    if (req.params.secret !== segredo) return res.status(401).json({ ok: false });

    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const queryString = req.originalUrl.includes('?') ? req.originalUrl.split('?').slice(1).join('?') : '';

    try {
      const id = await webhookEventoService.registrar({
        origem: ORIGEM,
        metodo: req.method,
        caminho: req.params[0] || null,
        queryString,
        contentType: req.headers['content-type'],
        headers: req.headers,
        body,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
      });
      console.log(`📥 Webhook Multipedidos capturado (#${id}, ${req.method}, ${body.length} chars)`);
    } catch (e) {
      // Não perde o payload se o banco falhar: fica no log do processo.
      console.error('❌ Webhook Multipedidos: falha ao gravar —', e.message);
      console.error('   headers:', JSON.stringify(req.headers));
      console.error('   body:', body);
    }

    res.json({ ok: true });
  }
);

const admin = express.Router();

// GET /api/integracoes/multipedidos/eventos?limite=50&corpo=1
admin.get('/eventos', async (req, res) => {
  try {
    const eventos = await webhookEventoService.listar({
      origem: ORIGEM,
      limite: req.query.limite,
      comCorpo: req.query.corpo === '1'
    });
    res.json({ success: true, total: eventos.length, data: eventos });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/integracoes/multipedidos/eventos/:id
admin.get('/eventos/:id', async (req, res) => {
  try {
    const evento = await webhookEventoService.obter(ORIGEM, parseInt(req.params.id, 10) || 0);
    if (!evento) return res.status(404).json({ success: false, error: 'Evento não encontrado' });
    res.json({ success: true, data: evento });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { captura, admin };
