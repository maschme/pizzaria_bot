const express = require('express');
const router = express.Router();

const promptService = require('../services/promptService');
const provedorService = require('../services/provedorIAService');
const requisicaoService = require('../services/requisicaoExternaService');
const arquivoService = require('../services/arquivoService');

// ============================================================
// 📝 PROMPTS
// ============================================================

router.get('/prompts', async (req, res) => {
  try {
    const { tipo, ativo } = req.query;
    const filtros = {};
    if (tipo) filtros.tipo = tipo;
    if (ativo !== undefined) filtros.ativo = ativo === 'true';
    
    const prompts = await promptService.listarPrompts(filtros);
    res.json({ success: true, total: prompts.length, data: prompts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/prompts/:id', async (req, res) => {
  try {
    const prompt = await promptService.getPromptPorId(req.params.id);
    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt não encontrado' });
    }
    res.json({ success: true, data: prompt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/prompts', async (req, res) => {
  try {
    const prompt = await promptService.criarPrompt(req.body);
    res.json({ success: true, data: prompt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/prompts/:id', async (req, res) => {
  try {
    const prompt = await promptService.atualizarPrompt(req.params.id, req.body);
    res.json({ success: true, data: prompt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/prompts/:id', async (req, res) => {
  try {
    await promptService.deletarPrompt(req.params.id);
    res.json({ success: true, message: 'Prompt deletado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/prompts/:id/duplicar', async (req, res) => {
  try {
    const { novoNome } = req.body;
    if (!novoNome) {
      return res.status(400).json({ success: false, error: 'novoNome é obrigatório' });
    }
    const prompt = await promptService.duplicarPrompt(req.params.id, novoNome);
    res.json({ success: true, data: prompt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 🤖 PROVEDORES DE IA
// ============================================================

router.get('/provedores', async (req, res) => {
  try {
    const { tipo, ativo } = req.query;
    const filtros = {};
    if (tipo) filtros.tipo = tipo;
    if (ativo !== undefined) filtros.ativo = ativo === 'true';
    
    const provedores = await provedorService.listarProvedores(filtros);
    
    // Oculta API keys na listagem
    const provedoresSeguros = provedores.map(p => ({
      ...p.toJSON(),
      apiKey: p.apiKey ? '***' + p.apiKey.slice(-4) : null
    }));
    
    res.json({ success: true, total: provedores.length, data: provedoresSeguros });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/provedores/:id', async (req, res) => {
  try {
    const provedor = await provedorService.getProvedorPorId(req.params.id);
    if (!provedor) {
      return res.status(404).json({ success: false, error: 'Provedor não encontrado' });
    }
    
    // Oculta API key
    const provedorSeguro = {
      ...provedor.toJSON(),
      apiKey: provedor.apiKey ? '***' + provedor.apiKey.slice(-4) : null
    };
    
    res.json({ success: true, data: provedorSeguro });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/provedores', async (req, res) => {
  try {
    const provedor = await provedorService.criarProvedor(req.body);
    res.json({ success: true, data: provedor });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/provedores/:id', async (req, res) => {
  try {
    const provedor = await provedorService.atualizarProvedor(req.params.id, req.body);
    res.json({ success: true, data: provedor });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/provedores/:id', async (req, res) => {
  try {
    await provedorService.deletarProvedor(req.params.id);
    res.json({ success: true, message: 'Provedor deletado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/provedores/:id/principal', async (req, res) => {
  try {
    const provedor = await provedorService.definirPrincipal(req.params.id);
    res.json({ success: true, data: provedor });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/provedores/:id/testar', async (req, res) => {
  try {
    const resultado = await provedorService.testarProvedor(req.params.id);
    res.json({ success: true, data: resultado });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 📡 REQUISIÇÕES EXTERNAS
// ============================================================

router.get('/requisicoes', async (req, res) => {
  try {
    const { tipoHandler, ativo } = req.query;
    const filtros = {};
    if (tipoHandler) filtros.tipoHandler = tipoHandler;
    if (ativo !== undefined) filtros.ativo = ativo === 'true';
    
    const requisicoes = await requisicaoService.listarRequisicoes(filtros);
    res.json({ success: true, total: requisicoes.length, data: requisicoes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/requisicoes/:id', async (req, res) => {
  try {
    const requisicao = await requisicaoService.getRequisicaoPorId(req.params.id);
    if (!requisicao) {
      return res.status(404).json({ success: false, error: 'Requisição não encontrada' });
    }
    res.json({ success: true, data: requisicao });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/requisicoes', async (req, res) => {
  try {
    const requisicao = await requisicaoService.criarRequisicao(req.body);
    res.json({ success: true, data: requisicao });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/requisicoes/:id', async (req, res) => {
  try {
    const requisicao = await requisicaoService.atualizarRequisicao(req.params.id, req.body);
    res.json({ success: true, data: requisicao });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/requisicoes/:id', async (req, res) => {
  try {
    await requisicaoService.deletarRequisicao(req.params.id);
    res.json({ success: true, message: 'Requisição deletada' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/requisicoes/executar', async (req, res) => {
  try {
    const { tipo, detalhes, contexto } = req.body;
    if (!tipo) {
      return res.status(400).json({ success: false, error: 'tipo é obrigatório' });
    }
    
    const resultado = await requisicaoService.executarRequisicao(tipo, detalhes, contexto || {});
    res.json({ success: true, data: resultado });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 📁 ARQUIVOS DE DADOS (JSON + instrução IA / formato retorno)
// ============================================================

router.get('/arquivos', async (req, res) => {
  try {
    const arquivos = arquivoService.listar();
    res.json({ success: true, total: arquivos.length, data: arquivos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/arquivos/:nome', async (req, res) => {
  try {
    const nome = decodeURIComponent(req.params.nome);
    const conteudo = arquivoService.getConteudoRaw(nome);
    const meta = arquivoService.getMeta(nome);
    if (conteudo === null) {
      return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
    }
    res.json({ success: true, data: { nome: arquivoService.nomeSeguro(nome), conteudo, meta } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/arquivos', async (req, res) => {
  try {
    const { nome, conteudo, instrucaoProcessamento, formatoRetorno } = req.body;
    if (!nome || nome.trim() === '') {
      return res.status(400).json({ success: false, error: 'nome é obrigatório' });
    }
    const meta = {};
    if (instrucaoProcessamento !== undefined) meta.instrucaoProcessamento = instrucaoProcessamento;
    if (formatoRetorno !== undefined) meta.formatoRetorno = formatoRetorno;
    const result = arquivoService.criar(nome.trim(), conteudo || '{}', meta);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/arquivos/:nome', async (req, res) => {
  try {
    const nome = decodeURIComponent(req.params.nome);
    const { conteudo, instrucaoProcessamento, formatoRetorno } = req.body;
    const meta = (instrucaoProcessamento !== undefined || formatoRetorno !== undefined)
      ? { instrucaoProcessamento, formatoRetorno }
      : null;
    const result = arquivoService.atualizar(nome, conteudo, meta);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/arquivos/:nome/meta', async (req, res) => {
  try {
    const nome = decodeURIComponent(req.params.nome);
    const { instrucaoProcessamento, formatoRetorno } = req.body;
    const result = arquivoService.atualizarMeta(nome, { instrucaoProcessamento, formatoRetorno });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/arquivos/:nome', async (req, res) => {
  try {
    const nome = decodeURIComponent(req.params.nome);
    arquivoService.deletar(nome);
    res.json({ success: true, message: 'Arquivo deletado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 🧪 TESTE DE IA
// ============================================================

router.post('/testar', async (req, res) => {
  try {
    const { mensagem, provedorId, promptNome } = req.body;
    
    if (!mensagem) {
      return res.status(400).json({ success: false, error: 'mensagem é obrigatória' });
    }
    
    const mensagens = [];
    
    // Adiciona prompt se especificado
    if (promptNome) {
      const promptConteudo = await promptService.getPrompt(promptNome);
      if (promptConteudo) {
        mensagens.push({ role: 'system', content: promptConteudo });
      }
    }
    
    mensagens.push({ role: 'user', content: mensagem });
    
    // Busca provedor se especificado
    let provedorNome = null;
    if (provedorId) {
      const provedor = await provedorService.getProvedorPorId(provedorId);
      if (provedor) provedorNome = provedor.nome;
    }
    
    const start = Date.now();
    const resposta = await provedorService.enviarParaIA(mensagens, provedorNome);
    const tempo = Date.now() - start;
    
    res.json({
      success: true,
      data: {
        resposta,
        tempo_ms: tempo
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
