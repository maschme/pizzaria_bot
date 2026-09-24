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
const posVendaService = require('../services/posVendaService');
const contatoService = require('../services/contatoService');

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

    // Processamento depois de responder, isolado: nada aqui pode atrapalhar a captura nem atrasar a Multipedidos.
    processarEvento(req, body).catch((e) => console.error('❌ Webhook Multipedidos: falha ao processar evento —', e.message));
  }
);

/**
 * Interpreta o evento já capturado (docs/18-cupons-multipedidos.md §5). Hoje: uso de cupom emitido pelo bot.
 * Só age sobre evento autenticado: se MULTIPEDIDOS_WEBHOOK_TOKEN está definido, o header `access_token`
 * precisa bater. Evento com token errado continua capturado (para diagnóstico), mas não é processado.
 */
async function processarEvento(req, body) {
  const tokenEsperado = (process.env.MULTIPEDIDOS_WEBHOOK_TOKEN || '').trim();
  const tokenValido = !tokenEsperado || String(req.headers.access_token || '') === tokenEsperado;
  integracaoService.contarEventoWebhook(tokenValido);
  if (!tokenValido) {
    console.warn('⚠️ Webhook Multipedidos: access_token diferente de MULTIPEDIDOS_WEBHOOK_TOKEN — evento capturado, mas não processado.');
    return;
  }
  if (req.method !== 'POST' || !body) return;

  let pedido;
  try {
    pedido = JSON.parse(body);
  } catch (_) {
    return;
  }
  if (!pedido || typeof pedido !== 'object' || !pedido.id || !pedido.order_status) return;

  // Nome do cadastro → contatos. Isolado: falha aqui não pode impedir cupom nem pós-venda.
  // Não loga nome nem telefone (dado pessoal).
  try {
    const n = await contatoService.salvarNomeDoPedidoMultipedidos(pedido);
    if (n.acao === 'criado' || n.acao === 'atualizado') {
      console.log(`👤 Nome do cliente ${n.acao === 'criado' ? 'gravado em contato novo' : 'atualizado'} (pedido ${pedido.order_no || pedido.id})`);
    }
  } catch (e) {
    console.warn('⚠️ Nome do cliente (Multipedidos):', e.message);
  }

  const r = await cupomService.registrarUsoPorPedido(pedido);
  if (r.acao === 'usado') {
    console.log(`🎟️ Cupom ${r.codigo} usado no pedido ${r.pedidoId} (R$ ${r.pedido_valor}, desconto R$ ${r.pedido_desconto ?? '?'})${r.meta ? ` — meta "${r.meta}" marcada` : ''}`);
  } else if (r.acao === 'estornado') {
    console.log(`↩️ Cupom ${r.codigo} voltou a ficar disponível (pedido cancelado)`);
  }

  // Pós-venda (docs/20 frente C): pedido concluído → oferece as campanhas elegíveis, dentro de 24 h.
  try {
    const pv = await posVendaService.avaliarPedido(pedido);
    const ref = pedido.order_no || pedido.id;
    if (pv.enfileirado) {
      console.log(`🛎️ Pós-venda enfileirado para o pedido ${ref}`);
    } else {
      // O motivo era calculado e descartado: quando o pós-venda não saía, o log não dizia nada e
      // só sobrava adivinhar. "pedido não concluído" é o caso comum (todo status que não é
      // DONE/OVER passa por aqui), por isso fica em nível mais baixo.
      const rotina = pv.motivo === 'pedido não concluído';
      const linha = `🛎️ Pós-venda NÃO enfileirado para o pedido ${ref} (${pedido.order_status}): ${pv.motivo}`;
      if (rotina) console.log(linha);
      else console.warn(linha);
    }
  } catch (e) {
    console.warn('⚠️ Pós-venda:', e.message);
  }
}

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
