const express = require('express');
const router = express.Router();
const fluxoService = require('../services/fluxoService');

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
    res.json({ success: true, data: fluxo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
