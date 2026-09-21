'use strict';

/**
 * Integração Multipedidos — fase de estudo (docs/17-integracao-multipedidos.md).
 *
 * captura: /webhook/multipedidos/:secret — público, autenticado pelo segredo na URL
 *          (MULTIPEDIDOS_WEBHOOK_SECRET). Grava a requisição crua em webhook_eventos e
 *          responde 200 na hora. Deve ser montado ANTES do bodyParser.json global, para
 *          receber o corpo exatamente como veio (JSON, form, XML ou malformado).
 * admin:   /api/integracoes/multipedidos — estado e liga/desliga da integração (tela de Integrações,
 *          docs/18-cupons-multipedidos.md §1) e consulta do que foi capturado (/eventos).
 */

const express = require('express');
const webhookEventoService = require('../services/webhookEventoService');
const integracaoService = require('../services/multipedidosIntegracaoService');
const cupomService = require('../services/multipedidosCupomService');

const ORIGEM = 'multipedidos';

const captura = express.Router();

captura.all(
  ['/:secret', '/:secret/*'],
  express.raw({ type: () => true, limit: '10mb' }),
  async (req, res) => {
    const segredo = (process.env.MULTIPEDIDOS_WEBHOOK_SECRET || '').trim();
    if (!segredo) return res.status(404).json({ ok: false });
    // Desligado na tela de Integrações: responde como se a rota não existisse.
    if (!(await integracaoService.webhookAtivo())) return res.status(404).json({ ok: false });
    if (req.params.secret !== segredo) {
      // Ajuda a diagnosticar URL cadastrada errada no painel (não loga o segredo recebido).
      console.warn(`⚠️ Webhook Multipedidos: segredo inválido (${req.method}, ip ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}, ua ${req.headers['user-agent'] || '-'})`);
      return res.status(401).json({ ok: false });
    }

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

// GET /api/integracoes/multipedidos/status — toggles, segredos configurados (sem valores), estatísticas
admin.get('/status', async (req, res) => {
  try {
    res.json({ success: true, data: await integracaoService.getStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/integracoes/multipedidos — { webhookAtivo, apiAtiva, cupomMaxPercent, cupomMaxValorFixo, cupomMaxValidadeDias, cupomPrefixo }
admin.put('/', async (req, res) => {
  try {
    res.json({ success: true, data: await integracaoService.salvar(req.body || {}) });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/integracoes/multipedidos/testar — login só-leitura na API
admin.post('/testar', async (req, res) => {
  const resultado = await integracaoService.testarApi();
  res.status(resultado.ok ? 200 : 502).json({ success: resultado.ok, data: resultado, error: resultado.erro });
});

// POST /api/integracoes/multipedidos/cupons/interpretar — { prompt, modo: 'criar'|'alterar', provedor }
// Mostra ao operador (botão "Interpretar" do editor de fluxos) o que a IA entendeu do comando,
// já com os limites de segurança aplicados. Não cria nem altera nada.
admin.post('/cupons/interpretar', async (req, res) => {
  try {
    const { prompt, modo, provedor } = req.body || {};
    const r = await cupomService.interpretarComando({
      promptTemplate: prompt,
      promptFinal: prompt,
      modo: modo === 'alterar' ? 'alterar' : 'criar',
      provedor: provedor || null
    });
    res.json({ success: true, data: r });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// GET /api/integracoes/multipedidos/webhook-url — URL completa (com o segredo) para cadastrar no painel deles.
// Rota separada do /status de propósito: o segredo só trafega quando o operador pede para copiar.
admin.get('/webhook-url', (req, res) => {
  const segredo = (process.env.MULTIPEDIDOS_WEBHOOK_SECRET || '').trim();
  if (!segredo) return res.status(404).json({ success: false, error: 'MULTIPEDIDOS_WEBHOOK_SECRET não definido no .env' });
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.json({ success: true, data: { url: `${base}/webhook/multipedidos/${segredo}` } });
});

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
