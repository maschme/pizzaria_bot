const express = require('express');
const router = express.Router();
const fluxoService = require('../services/fluxoService');
const automacaoExecutor = require('../services/automacaoExecutor');
const fluxoExecutor = require('../services/fluxoExecutor');

// Listar todos os fluxos
router.get('/', async (req, res) => {
  try {
    const { tipo, ativo } = req.query;
    const filtros = {};
    if (tipo) filtros.tipo = tipo;
    if (ativo !== undefined) filtros.ativo = ativo === 'true';
    
    const fluxos = await fluxoService.listarFluxos(filtros);
    res.json({ success: true, total: fluxos.length, data: fluxos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Exportar fluxo como JSON (download) — rota literal antes de GET /:id
router.get('/export/:id', async (req, res) => {
  try {
    const payload = await fluxoService.exportarFluxoJson(req.params.id);
    if (!payload) {
      return res.status(404).json({ success: false, error: 'Fluxo não encontrado' });
    }
    const slug = String(payload.nome || 'fluxo').replace(/[^\w\-]+/g, '_').slice(0, 48);
    const nomeArquivo = `fluxo-${slug}-${req.params.id}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Importar fluxo a partir de JSON exportado — antes de POST /
router.post('/import', async (req, res) => {
  try {
    const fluxo = await fluxoService.importarFluxoDeExport(req.body);
    res.json({ success: true, data: fluxo });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Obter fluxo por ID
router.get('/:id', async (req, res) => {
  try {
    const fluxo = await fluxoService.getFluxoPorId(req.params.id);
    if (!fluxo) {
      return res.status(404).json({ success: false, error: 'Fluxo não encontrado' });
    }
    res.json({ success: true, data: fluxo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook e run PRECISAM vir antes de outras rotas POST /:id/... (ordem no Express)
// POST /api/fluxos/:id/webhook — gatilho por HTTP (body = payload)
router.post('/:id/webhook', async (req, res) => {
  try {
    const fluxo = await fluxoService.getFluxoPorId(req.params.id);
    if (!fluxo) return res.status(404).json({ success: false, error: 'Fluxo não encontrado' });
    if (fluxo.tipo !== 'automacao') {
      return res.status(400).json({ success: false, error: 'Apenas automações têm webhook' });
    }
    if (!fluxo.ativo) {
      return res.status(400).json({ success: false, error: 'Automação inativa' });
    }
    const result = await automacaoExecutor.executarAutomacao(fluxo, 'webhook', req.body);
    res.json({ success: result.success, data: { variables: result.variables, logs: result.logs }, error: result.error });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/fluxos/:id/run — execução manual
router.post('/:id/run', async (req, res) => {
  try {
    const fluxo = await fluxoService.getFluxoPorId(req.params.id);
    if (!fluxo) return res.status(404).json({ success: false, error: 'Fluxo não encontrado' });
    if (fluxo.tipo !== 'automacao') {
      return res.status(400).json({ success: false, error: 'Apenas automações podem ser executadas por /run' });
    }
    const { triggerType = 'manual', payload = {} } = req.body;
    const result = await automacaoExecutor.executarAutomacao(fluxo, triggerType, payload);
    res.json({ success: result.success, data: { variables: result.variables, logs: result.logs }, error: result.error });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Criar novo fluxo
router.post('/', async (req, res) => {
  try {
    const fluxo = await fluxoService.criarFluxo(req.body);
    res.json({ success: true, data: fluxo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualizar fluxo
router.put('/:id', async (req, res) => {
  try {
    const fluxo = await fluxoService.atualizarFluxo(req.params.id, req.body);
    res.json({ success: true, data: fluxo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Deletar fluxo
router.delete('/:id', async (req, res) => {
  try {
    await fluxoService.deletarFluxo(req.params.id);
    res.json({ success: true, message: 'Fluxo deletado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Duplicar fluxo
router.post('/:id/duplicar', async (req, res) => {
  try {
    const { novoNome } = req.body;
    const fluxo = await fluxoService.duplicarFluxo(req.params.id, novoNome);
    res.json({ success: true, data: fluxo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ativar fluxo
router.post('/:id/ativar', async (req, res) => {
  try {
    const fluxo = await fluxoService.ativarFluxo(req.params.id);
    res.json({ success: true, data: fluxo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Desativar fluxo
router.post('/:id/desativar', async (req, res) => {
  try {
    const fluxo = await fluxoService.desativarFluxo(req.params.id);
    const sessoesEncerradas = fluxoExecutor.encerrarSessoesPorFluxoId
      ? fluxoExecutor.encerrarSessoesPorFluxoId(req.params.id)
      : 0;
    res.json({ success: true, data: fluxo, sessoesEncerradas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
