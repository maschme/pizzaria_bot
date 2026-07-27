const express = require('express');
const router = express.Router();

const configService = require('../services/configuracaoService');
const grupoService = require('../services/grupoWhatsappService');
const gatilhoService = require('../services/gatilhoService');
const contatoService = require('../services/contatoService');
const chatService = require('../services/chatService');
const fluxoExecutor = require('../services/fluxoExecutor');
const fluxoLogService = require('../services/fluxoLogService');
const fluxoService = require('../services/fluxoService');

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
    if (!whatsappClient?.info) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }

    const resultado = await grupoService.sincronizarGrupos(whatsappClient);
    res.json({ success: true, data: resultado });
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('❌ API sincronizar grupos:', msg);
    res.status(500).json({ success: false, error: msg });
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

// Extrair participantes do grupo (JSON)
router.get('/grupos/:grupoId/participantes', async (req, res) => {
  try {
    if (!whatsappClient?.info) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }
    const resultado = await grupoService.extrairParticipantesGrupo(
      whatsappClient,
      decodeURIComponent(req.params.grupoId)
    );
    res.json({ success: true, ...resultado });
  } catch (error) {
    const msg = error?.message || String(error) || 'Erro ao extrair participantes';
    console.error('❌ API participantes JSON:', msg);
    res.status(400).json({ success: false, error: msg });
  }
});

// Extrair participantes do grupo (CSV para download)
router.get('/grupos/:grupoId/participantes/csv', async (req, res) => {
  try {
    if (!whatsappClient?.info) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }
    const { grupo, participantes } = await grupoService.extrairParticipantesGrupo(
      whatsappClient,
      decodeURIComponent(req.params.grupoId)
    );
    if (!participantes.length) {
      console.warn(`⚠️ Grupo ${grupo.grupoId} sem participantes na metadata`);
    }
    const csv = grupoService.participantesParaCsv(grupo, participantes);
    const slug = grupoService.slugArquivo(grupo.nome);
    const data = new Date().toISOString().slice(0, 10);
    const filename = `participantes-${slug}-${data}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    const msg = error?.message || String(error) || 'Erro ao exportar CSV';
    console.error('❌ API participantes CSV:', msg);
    if (error?.stack) console.error(error.stack);
    res.status(400).json({ success: false, error: msg });
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
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const contatosPage = await contatoService.listarContatos({ page, limit });
    const contatos = contatosPage.rows || [];
    const chatIdsEmFluxo = fluxoExecutor.getChatIdsEmFluxo ? fluxoExecutor.getChatIdsEmFluxo() : [];
    const normalizar = (id) => String(id || '').replace(/\D/g, '');
    const data = contatos.map((c) => ({
      ...c,
      em_fluxo: chatIdsEmFluxo.some((ch) => {
        if (normalizar(ch) === normalizar(c.whatsapp_id)) return true;
        if (c.whatsapp_lid && String(ch).trim() === String(c.whatsapp_lid).trim()) return true;
        return false;
      })
    }));
    res.json({
      success: true,
      total: contatosPage.total,
      page: contatosPage.page,
      limit: contatosPage.limit,
      totalPages: contatosPage.totalPages,
      data
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/contatos/:whatsappId', async (req, res) => {
  try {
    const whatsappId = decodeURIComponent(req.params.whatsappId);
    const lidOpcional = req.query.whatsapp_lid ? decodeURIComponent(String(req.query.whatsapp_lid).trim()) : '';
    const wid = contatoService.normalizarWhatsappId(whatsappId);
    if (!wid && !lidOpcional) return res.status(400).json({ success: false, error: 'whatsapp_id inválido' });
    if (wid) {
      fluxoExecutor.encerrarFluxo(wid);
      fluxoExecutor.encerrarFluxo(`${wid}@c.us`);
    }
    if (lidOpcional) fluxoExecutor.encerrarFluxo(lidOpcional);
    const result = await contatoService.deletarContato(whatsappId, { whatsappLid: lidOpcional || undefined });
    res.json({ success: true, ...result, mensagem: result.deleted ? 'Contato removido' : 'Contato não encontrado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/contatos/:whatsappId/logs', async (req, res) => {
  try {
    const whatsappId = decodeURIComponent(req.params.whatsappId);
    const lidOpcional = req.query.whatsapp_lid ? decodeURIComponent(String(req.query.whatsapp_lid).trim()) : '';
    const wid = contatoService.normalizarWhatsappId(whatsappId);
    if (!wid && !lidOpcional) return res.status(400).json({ success: false, error: 'whatsapp_id inválido' });
    const logs = await fluxoLogService.listarLogsPorContato(whatsappId, req.query.limit || 200, {
      whatsappLid: lidOpcional || undefined
    });
    res.json({ success: true, total: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 💬 CHATS (gerenciador de conversas)
// ============================================================

function decodeChatIdParam(raw) {
  return decodeURIComponent(String(raw || '').trim());
}

router.get('/chats/fluxos-disponiveis', async (req, res) => {
  try {
    const fluxos = await fluxoService.listarFluxos({ ativo: true });
    const data = fluxos
      .filter((f) => f.tipo !== 'automacao')
      .map((f) => ({ id: f.id, nome: f.nome, tipo: f.tipo, descricao: f.descricao }));
    res.json({ success: true, total: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/chats', async (req, res) => {
  try {
    if (!whatsappClient?.info) {
      return res.json({ success: true, connected: false, total: 0, data: [], mensagem: 'WhatsApp não conectado' });
    }
    const result = await chatService.listarConversas(whatsappClient, {
      limit: req.query.limit,
      search: req.query.search,
      somenteNaoLidas: req.query.somenteNaoLidas
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/chats/:chatId/mensagens', async (req, res) => {
  try {
    if (!whatsappClient?.info) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }
    const chatId = decodeChatIdParam(req.params.chatId);
    const data = await chatService.obterMensagens(whatsappClient, chatId, {
      limit: req.query.limit,
      marcarLida: req.query.marcarLida !== 'false'
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/chats/:chatId/mensagens', async (req, res) => {
  try {
    if (!whatsappClient?.info) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }
    const chatId = decodeChatIdParam(req.params.chatId);
    const { mensagem } = req.body;
    const data = await chatService.enviarMensagem(whatsappClient, chatId, mensagem);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/chats/:chatId/estado', async (req, res) => {
  try {
    if (!whatsappClient?.info) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }
    const chatId = decodeChatIdParam(req.params.chatId);
    const data = await chatService.obterEstadoChat(whatsappClient, chatId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/chats/:chatId/iniciar-fluxo', async (req, res) => {
  try {
    if (!whatsappClient?.info) {
      return res.status(503).json({ success: false, error: 'WhatsApp não conectado' });
    }
    const chatId = decodeChatIdParam(req.params.chatId);
    const { fluxoId, encerrarAtual, limparCampanha } = req.body;
    if (!fluxoId) return res.status(400).json({ success: false, error: 'fluxoId é obrigatório' });
    const data = await chatService.iniciarFluxoNoChat(whatsappClient, chatId, fluxoId, {
      encerrarAtual: encerrarAtual !== false,
      limparCampanha: limparCampanha === true
    });
    res.json({ success: true, data, mensagem: `Fluxo "${data.fluxo.nome}" iniciado` });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/chats/:chatId/encerrar-fluxo', async (req, res) => {
  try {
    const chatId = decodeChatIdParam(req.params.chatId);
    const data = await chatService.encerrarFluxoNoChat(whatsappClient, chatId);
    res.json({ success: true, data, mensagem: data.encerrados ? 'Fluxo encerrado' : 'Nenhum fluxo ativo' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = { router, setWhatsappClient };
