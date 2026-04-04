const express = require('express');
const router = express.Router();

const configService = require('../services/configuracaoService');
const grupoService = require('../services/grupoWhatsappService');
const gatilhoService = require('../services/gatilhoService');
const contatoService = require('../services/contatoService');
const fluxoExecutor = require('../services/fluxoExecutor');

// Referência ao client do WhatsApp (será injetada)
let whatsappClient = null;

function setWhatsappClient(client) {
  whatsappClient = client;
}

// ============================================================
// 📊 DASHBOARD - Visão Geral
// ============================================================

router.get('/status', async (req, res) => {
  try {
    const configs = await configService.listarConfiguracoes();
    const gruposStats = await grupoService.getEstatisticas();
    const gatilhos = await gatilhoService.listarGatilhos();

    res.json({
      success: true,
      data: {
        atendimentoAutomatico: configs.atendimento_automatico?.valor || false,
        campanhaAtiva: configs.campanha_ativa?.valor || false,
        grupos: gruposStats,
        gatilhosAtivos: gatilhos.filter(g => g.ativo).length,
        gatilhosTotal: gatilhos.length,
        whatsappConectado: whatsappClient?.info ? true : false
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ⚙️ CONFIGURAÇÕES
// ============================================================

router.get('/configuracoes', async (req, res) => {
  try {
    const configs = await configService.listarConfiguracoes();
    res.json({ success: true, data: configs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/configuracoes/categorias', async (req, res) => {
  try {
    const categorias = await configService.listarCategorias();
    res.json({ success: true, data: categorias });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/configuracoes/categoria/:categoria', async (req, res) => {
  try {
    const { categoria } = req.params;
    const configs = await configService.getConfiguracoesPorCategoria(categoria);
    res.json({ success: true, data: configs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/configuracoes/:chave', async (req, res) => {
  try {
    const { chave } = req.params;
    const valor = await configService.getConfiguracao(chave);
    res.json({ success: true, chave, valor });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/configuracoes/:chave', async (req, res) => {
  try {
    const { chave } = req.params;
    const { valor } = req.body;

    if (valor === undefined) {
      return res.status(400).json({ success: false, error: 'Campo "valor" é obrigatório' });
    }

    const novoValor = await configService.setConfiguracao(chave, valor);
    res.json({ success: true, chave, valor: novoValor });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/configuracoes', async (req, res) => {
  try {
    const config = await configService.criarConfiguracao(req.body);
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 📱 GRUPOS WHATSAPP
// ============================================================

router.get('/grupos', async (req, res) => {
  try {
    const { ativo, tipo, bairro } = req.query;
    const filtros = {};

    if (ativo !== undefined) filtros.ativo = ativo === 'true';
    if (tipo) filtros.tipo = tipo;
    if (bairro) filtros.bairro = bairro;

    const grupos = await grupoService.listarGrupos(filtros);
    res.json({ success: true, total: grupos.length, data: grupos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/grupos/estatisticas', async (req, res) => {
  try {
    const stats = await grupoService.getEstatisticas();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug: Ver grupos ativos com todos os campos
router.get('/grupos/debug', async (req, res) => {
  try {
    const grupos = await grupoService.listarGrupos({ ativo: true });
    const detalhes = grupos.map(g => ({
      id: g.id,
      grupoId: g.grupoId,
      nome: g.nome,
      bairro: g.bairro,
      linkConvite: g.linkConvite,
      ativo: g.ativo,
      isGrupoGeral: g.isGrupoGeral,
      tipo: g.tipo
    }));
    res.json({ 
      success: true, 
      total: grupos.length, 
      data: detalhes 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug: Testar busca por bairro
router.get('/grupos/buscar/:bairro', async (req, res) => {
  try {
    const { bairro } = req.params;
    const resultado = await grupoService.getGrupoPorBairro(bairro);
    res.json({ success: true, bairro, resultado });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Definir link de convite manualmente (quando bot não é admin)
router.post('/grupos/:grupoId/link', async (req, res) => {
  try {
    const { grupoId } = req.params;
    const { linkConvite } = req.body;
    
    if (!linkConvite) {
      return res.status(400).json({ success: false, error: 'linkConvite é obrigatório' });
    }
    
    const grupo = await grupoService.atualizarGrupo(decodeURIComponent(grupoId), { linkConvite });
    res.json({ success: true, message: 'Link atualizado', data: grupo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/grupos/sincronizar', async (req, res) => {
  try {
    if (!whatsappClient) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }

    const resultado = await grupoService.sincronizarGrupos(whatsappClient);
    res.json({ success: true, data: resultado });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/grupos/:grupoId', async (req, res) => {
  try {
    const { grupoId } = req.params;
    const grupo = await grupoService.atualizarGrupo(decodeURIComponent(grupoId), req.body);
    res.json({ success: true, data: grupo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/grupos/:grupoId/ativar', async (req, res) => {
  try {
    const { grupoId } = req.params;
    const { bairro, isGrupoGeral } = req.body;
    const grupo = await grupoService.ativarGrupo(decodeURIComponent(grupoId), bairro, isGrupoGeral);
    res.json({ success: true, data: grupo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/grupos/:grupoId/desativar', async (req, res) => {
  try {
    const { grupoId } = req.params;
    const grupo = await grupoService.desativarGrupo(decodeURIComponent(grupoId));
    res.json({ success: true, data: grupo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/grupos/:grupoId/definir-geral', async (req, res) => {
  try {
    const { grupoId } = req.params;
    const grupo = await grupoService.definirGrupoGeral(decodeURIComponent(grupoId));
    res.json({ success: true, data: grupo, mensagem: 'Grupo definido como geral' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 🎯 GATILHOS
// ============================================================

router.get('/gatilhos', async (req, res) => {
  try {
    const gatilhos = await gatilhoService.listarGatilhos();
    res.json({ success: true, total: gatilhos.length, data: gatilhos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/gatilhos', async (req, res) => {
  try {
    const gatilho = await gatilhoService.criarGatilho(req.body);
    res.json({ success: true, data: gatilho });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/gatilhos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const gatilho = await gatilhoService.atualizarGatilho(id, req.body);
    res.json({ success: true, data: gatilho });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/gatilhos/:id/ativar', async (req, res) => {
  try {
    const { id } = req.params;
    const gatilho = await gatilhoService.ativarGatilho(id);
    res.json({ success: true, data: gatilho });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/gatilhos/:id/desativar', async (req, res) => {
  try {
    const { id } = req.params;
    const gatilho = await gatilhoService.desativarGatilho(id);
    res.json({ success: true, data: gatilho });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/gatilhos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await gatilhoService.deletarGatilho(id);
    res.json({ success: true, mensagem: 'Gatilho removido' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 📇 CONTATOS (para testes de fluxo: listar e deletar)
// ============================================================

router.get('/contatos', async (req, res) => {
  try {
    const contatos = await contatoService.listarContatos();
    const chatIdsEmFluxo = fluxoExecutor.getChatIdsEmFluxo ? fluxoExecutor.getChatIdsEmFluxo() : [];
    const normalizar = (id) => String(id).replace(/\D/g, '');
    const setEmFluxo = chatIdsEmFluxo.reduce((acc, c) => { acc[normalizar(c)] = true; return acc; }, {});
    const data = contatos.map((c) => ({
      ...c,
      em_fluxo: setEmFluxo[normalizar(c.whatsapp_id)] || false
    }));
    res.json({ success: true, total: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/contatos/:whatsappId', async (req, res) => {
  try {
    const whatsappId = decodeURIComponent(req.params.whatsappId);
    const wid = contatoService.normalizarWhatsappId(whatsappId);
    if (!wid) return res.status(400).json({ success: false, error: 'whatsapp_id inválido' });
    fluxoExecutor.encerrarFluxo(wid);
    fluxoExecutor.encerrarFluxo(wid + '@c.us');
    const result = await contatoService.deletarContato(wid);
    res.json({ success: true, ...result, mensagem: result.deleted ? 'Contato removido' : 'Contato não encontrado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = { router, setWhatsappClient };
