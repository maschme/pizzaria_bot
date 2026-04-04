require('dotenv').config();
const { Client, Location, Poll, List, Buttons, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');  // Adicione esta linha
const fs = require('fs');
const path = require('path');

const { lerJson } = require('./utils/lerJson');
const { getRetornoApiGoogle, limparResposta, getRuaeNumero, interpretarRespostaAssistente } = require('./utils/global');
const { enviarParaClaude, enviarParaQwen3 } = require('./ias');
const { getprompt: getPromptLegado } = require('./utils/prompts'); // Fallback para prompts antigos
const { buscarOuCriarAtendimento,
    getHistorico,
    adicionarAoHistorico,
    finalizarAtendimento } = require('./historico');

// Services do Dashboard
const configService = require('./services/configuracaoService');
const grupoService = require('./services/grupoWhatsappService');
const gatilhoService = require('./services/gatilhoService');
const promptService = require('./services/promptService');
const provedorService = require('./services/provedorIAService');
const requisicaoService = require('./services/requisicaoExternaService');
const { router: dashboardRoutes, setWhatsappClient } = require('./routes/dashboardRoutes');
const iaRoutes = require('./routes/iaRoutes');
const fluxoRoutes = require('./routes/fluxoRoutes');
const fluxoService = require('./services/fluxoService');
const fluxoExecutor = require('./services/fluxoExecutor');
const indicacaoService = require('./services/indicacaoService');
const metaService = require('./services/metaService');
const { setupDatabase } = require('./database/setup');
const { dbConfig } = require('./database/connection');

// Handoff: quando o fluxo visual de campanha termina (ex.: após entrada no grupo), passa o usuário para a campanha legada na Missão 2
fluxoExecutor.setOnCampanhaFlowEnd(async (client, chatId, fluxo) => {
  const sessao = getOuCriarSessaoCampanha(chatId);
  sessao.etapa = 2;
  sessao.subEtapa = 'aguardando_contatos';
  sessao.missoes[1].concluida = true;
  sessao.descontoTotal = 10;
  const msgMissao2 = `🎉 *MISSÃO 1 CONCLUÍDA!* 🔥

✅ Você liberou *+10% de desconto*! (Total: *${sessao.descontoTotal}%*)

🔥 *Quer chegar a 30%?* Envie *10 contatos* da sua agenda! Cada indicado ganha *10% de desconto* na 1ª compra.

*Como:* contato → ⋮ → Compartilhar contato → envie aqui. Pode enviar um por um ou vários. Meta: *10 indicações* 📇`;
  await client.sendMessage(chatId, msgMissao2);
  console.log(`🎁 Handoff campanha: ${chatId} passou para Missão 2 (10 contatos).`);
});

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mysql = require('mysql2/promise');
const app = express();
const port = process.env.PORT || process.env.APP_PORT || 3007;

const bordas = lerJson('bordas');
const bebidas = lerJson('bebidas');
const gruposWhatsapp = lerJson('grupos_whatsapp');

// ============================================================
// 📝 FUNÇÃO PARA BUSCAR PROMPTS (banco de dados com fallback)
// ============================================================
async function getprompt(nome, variaveis = {}) {
  try {
    // Tenta buscar do banco de dados primeiro
    const promptDB = await promptService.getPrompt(nome, variaveis);
    if (promptDB) {
      console.log(`📝 Prompt "${nome}" carregado do banco de dados`);
      return promptDB;
    }
  } catch (error) {
    console.warn(`⚠️ Erro ao buscar prompt "${nome}" do banco:`, error.message);
  }
  
  // Fallback para o arquivo de prompts legado
  console.log(`📝 Prompt "${nome}" usando fallback (arquivo local)`);
  return await getPromptLegado(nome, variaveis);
}

// ============================================================
// 🤖 FUNÇÃO PARA ENVIAR PARA IA (usando provedor dinâmico)
// ============================================================
async function enviarParaIADinamica(mensagens, provedorNome = null) {
  try {
    // Tenta usar o serviço de provedores dinâmico
    const resposta = await provedorService.enviarParaIA(mensagens, provedorNome);
    return resposta;
  } catch (error) {
    console.warn(`⚠️ Erro no provedor dinâmico, usando fallback:`, error.message);
    // Fallback para função original
    return await enviarParaQwen3(mensagens);
  }
}

// ============================================================
// 🎁 SESSÕES DE CAMPANHA (em memória)
// ============================================================
const sessoesCampanha = new Map(); // numero -> { etapa, missoes, historico }

function getOuCriarSessaoCampanha(numero) {
  if (!sessoesCampanha.has(numero)) {
    sessoesCampanha.set(numero, {
      etapa: 1,
      subEtapa: 'aguardando_bairro', // aguardando_bairro, aguardando_confirmacao_grupo
      missoes: {
        1: { concluida: false, desconto: 10, descricao: 'Entrar no grupo WhatsApp' },
        2: { concluida: false, desconto: 10, descricao: 'A definir' },
        3: { concluida: false, desconto: 10, descricao: 'A definir' }
      },
      bairro: null,
      descontoTotal: 0,
      historico: [],
      iniciadoEm: new Date()
    });
  }
  return sessoesCampanha.get(numero);
}

function getProgressoCampanha(sessao) {
  const concluidas = Object.values(sessao.missoes).filter(m => m.concluida).length;
  return `${sessao.descontoTotal}% (${concluidas}/3 missões)`;
}

function buscarGrupoWhatsapp(bairro) {
  const bairroLower = bairro.toLowerCase().trim();
  
  // Busca o grupo específico do bairro
  const grupoEncontrado = gruposWhatsapp.grupos.find(g => 
    g.bairro.toLowerCase() === bairroLower ||
    bairroLower.includes(g.bairro.toLowerCase()) ||
    g.bairro.toLowerCase().includes(bairroLower)
  );
  
  if (grupoEncontrado) {
    return {
      encontrado: true,
      bairro: grupoEncontrado.bairro,
      link: grupoEncontrado.link,
      grupoId: grupoEncontrado.grupoId,
      tipo: 'especifico'
    };
  }
  
  // Se não encontrar, retorna o grupo geral
  return {
    encontrado: false,
    bairro: 'Geral',
    link: gruposWhatsapp.grupo_geral.link,
    grupoId: gruposWhatsapp.grupo_geral.grupoId,
    nome: gruposWhatsapp.grupo_geral.nome,
    tipo: 'geral'
  };
}

// Verifica se o grupoId é um dos nossos grupos de campanha (usa banco de dados)
async function isGrupoCampanhaDB(grupoId) {
  return await grupoService.isGrupoCampanha(grupoId);
}

// Fallback: Verifica grupos em memória (JSON local)
function isGrupoCampanhaLocal(grupoId) {
  const grupoEspecifico = gruposWhatsapp.grupos.find(g => g.grupoId === grupoId);
  if (grupoEspecifico) return { valido: true, bairro: grupoEspecifico.bairro };
  
  if (gruposWhatsapp.grupo_geral.grupoId === grupoId) {
    return { valido: true, bairro: 'Geral' };
  }
  
  if (gruposWhatsapp.todosGruposIds && gruposWhatsapp.todosGruposIds.includes(grupoId)) {
    return { valido: true, bairro: 'Cadastrado' };
  }
  
  return { valido: false };
}

// Busca grupo por bairro (usa banco de dados)
async function buscarGrupoWhatsappDB(bairro) {
  return await grupoService.getGrupoPorBairro(bairro);
}

// Converte número para formato @c.us
function formatarNumeroWhatsapp(numero) {
  // Remove tudo que não é número
  const apenasNumeros = numero.replace(/\D/g, '');
  return `${apenasNumeros}@c.us`;
}

// Função para mover card no funil do CRM (placeholder - implementar conforme seu CRM)
async function moverCardNoFunil(idNegociacao) {
  console.log(`📊 [CRM] Movendo card ${idNegociacao} no funil...`);
  // TODO: Implementar integração com seu CRM
  // Exemplo: await axios.post('URL_DO_CRM', { id: idNegociacao, etapa: 'nova_etapa' });
}

// ============================================================
// 🎛️ CONFIGURAÇÕES DE ATENDIMENTO
// ============================================================
const config = {
  atendimentoAutomatico: false,  // true = IA responde | false = silencioso
  // Segurança: fallback legado desligado por padrão para não disparar fluxos "fantasma".
  gatilhosLegadoAtivos: String(process.env.LEGACY_GATILHOS_ATIVOS || 'false').toLowerCase() === 'true',
  
  // Gatilhos especiais que ativam fluxos específicos
  gatilhos: {
    'campanha_desconto': {
      ativo: true,
      palavrasChave: ['campanha', '30% de desconto', 'desconto', 'promoção'],
      mensagemExata: 'Quero saber mais sobre a campanha de até 30% de desconto.'
    }
  }
};

// Funções para controle externo
function setAtendimentoAutomatico(valor) {
  config.atendimentoAutomatico = Boolean(valor);
  console.log(`🎛️ Atendimento automático: ${config.atendimentoAutomatico ? '✅ ATIVADO' : '❌ DESATIVADO'}`);
  return config.atendimentoAutomatico;
}

function getAtendimentoAutomatico() {
  return config.atendimentoAutomatico;
}

function getConfig() {
  return { ...config };
}

// Verifica se a mensagem é um gatilho especial (usa banco de dados)
async function verificarGatilhoDB(texto) {
  return await gatilhoService.verificarGatilho(texto);
}

// Fallback: Verifica gatilhos em memória (config local)
function verificarGatilhoLocal(texto) {
  for (const [nome, gatilho] of Object.entries(config.gatilhos)) {
    if (!gatilho.ativo) continue;
    
    if (gatilho.mensagemExata && texto.trim() === gatilho.mensagemExata) {
      return { tipo: nome, gatilho };
    }
    
    if (gatilho.palavrasChave) {
      const textoLower = texto.toLowerCase();
      const encontrou = gatilho.palavrasChave.some(palavra => 
        textoLower.includes(palavra.toLowerCase())
      );
      if (encontrou) {
        return { tipo: nome, gatilho };
      }
    }
  }
  return null;
}

const atendimentoEmProcesso = new Map();  // número -> true/false
const filaPendente = new Map();           // número -> true/false
const DEBOUNCE_MS_PADRAO = 10000;         // fallback se não houver config

// Debounce unificado: fluxo visual, campanha e atendimento (numero -> { buffer, timerId, mode, lastMsg })
const debounceState = new Map();


// Middleware para JSON
app.use(bodyParser.json({ limit: '10mb' }));

// Servir arquivos estáticos (Dashboard)
app.use(express.static(path.join(__dirname, 'public')));

// Rotas do Dashboard
app.use('/api/dashboard', dashboardRoutes);

// Rotas de IA, Prompts e Requisições
app.use('/api/ia', iaRoutes);

// Rotas de Fluxos
app.use('/api/fluxos', fluxoRoutes);



const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot-ia-pizzaria3" // Identificador único para a sessão deste cliente
    }),
    puppeteer: {
        //executablePath: '/usr/bin/google-chrome', // Caminho para o Chromium
        headless: true, // Modo headless
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

// ============================================================
// 📱 ESTADO DO WHATSAPP (QR Code, Status, etc)
// ============================================================
const whatsappState = {
  qrCode: null,
  status: 'disconnected', // disconnected, qr_ready, connected
  info: null,
  lastQrUpdate: null
};

// Mostra o QR Code no terminal e salva para API
client.on('qr', (qr) => {
    console.log('📱 Novo QR Code gerado - escaneie:');
    qrcode.generate(qr, { small: true });
    
    // Salva o QR Code para disponibilizar via API
    whatsappState.qrCode = qr;
    whatsappState.status = 'qr_ready';
    whatsappState.lastQrUpdate = new Date();
});

// Loga quando estiver pronto
client.on('ready', async () => {
  console.log('🤖 Cliente WhatsApp conectado!');
  
  // Atualiza estado do WhatsApp
  whatsappState.status = 'connected';
  whatsappState.qrCode = null; // Limpa QR após conectar
  whatsappState.info = client.info;
  
  // Injeta o client nas rotas do dashboard
  setWhatsappClient(client);
  
  // Sincroniza grupos automaticamente ao conectar
  try {
    console.log('🔄 Sincronizando grupos do WhatsApp...');
    await grupoService.sincronizarGrupos(client);
  } catch (err) {
    console.error('⚠️ Erro ao sincronizar grupos:', err.message);
  }

  // 1. acessa o objeto Store já definido pelo whatsapp-web.js
  const Store = await client.pupPage.evaluateHandle(() => window.Store);

  // 2. expõe uma função Node que vai receber o evento
  await client.pupPage.exposeFunction('onInternalLabelChange', ({ chatId, added, removed }) => {
    // aqui você pode emitir no seu client, logar ou tratar:
    client.emit('label_change', { chatId, added, removed });
  });

  // 3. injeta no contexto do WhatsApp Web o listener para mudanças em cada Chat
  await client.pupPage.evaluate(() => {
  const ChatClass = window.Store.Chat;
  // obtém o container de instâncias (Map ou objeto)
  const rawModels = ChatClass._models || ChatClass.models;
  if (!rawModels) {
    console.error('❌ Não achei Chat._models nem Chat.models em window.Store.Chat');
    return;
  }
  // Normaliza para array de chats
  const chats = rawModels instanceof Map
    ? Array.from(rawModels.values())
    : Object.values(rawModels);

  chats.forEach(chat => {
    // safety-check: só adiciona listener se existir labels.models e on()
    if (chat.labels?.models?.on) {
      chat.labels.models.on('change', changes => {
        const added   = changes.added.map(l => ({ id: l.id, name: l.name }));
        const removed = changes.removed.map(l => ({ id: l.id, name: l.name }));
        window.onInternalLabelChange({
          chatId: chat.id._serialized,
          added,
          removed
        });
      });
    }
  });
});

    console.log('🤖 Cliente WhatsApp está pronto!');
});

// Inicializa o cliente
client.initialize();

// Endpoint para enviar mensagens
app.post('/send-message', async (req, res) => {
  console.log('solicitado envio de mensagem!');
    let { number, message } = req.body;



    if (!number || !message) {
        return res.status(400).json({ error: 'Campos "number" e "message" são obrigatórios.' });
    }

    try {
        number = number.toString();
        if (!number.includes("@c.us")) {
            number = number + "@c.us";
        }
        // Garante que o número está no formato com @c.us
        const chatId = number;

        await client.sendMessage(chatId, message);
        res.status(200).json({ success: true, sent_to: number });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem', details: error.message });
    }
});

app.post('/webhook/movimento', async (req, res) => {
  console.log('novo movimento no crm!');
  console.log(req.body);
  res.json({ success: true });
});

// ============================================================
// 📱 ENDPOINTS DO WHATSAPP (QR Code, Status)
// ============================================================

// GET /whatsapp/status - Status completo do WhatsApp
app.get('/whatsapp/status', (req, res) => {
  res.json({
    success: true,
    data: {
      status: whatsappState.status,
      connected: whatsappState.status === 'connected',
      qrAvailable: whatsappState.qrCode !== null,
      lastQrUpdate: whatsappState.lastQrUpdate,
      info: whatsappState.info ? {
        pushname: whatsappState.info.pushname,
        wid: whatsappState.info.wid?._serialized
      } : null
    }
  });
});

// GET /whatsapp/qr - Retorna o QR Code atual (texto)
app.get('/whatsapp/qr', (req, res) => {
  if (!whatsappState.qrCode) {
    return res.status(404).json({
      success: false,
      error: whatsappState.status === 'connected' 
        ? 'WhatsApp já está conectado' 
        : 'QR Code não disponível ainda'
    });
  }
  
  res.json({
    success: true,
    qr: whatsappState.qrCode,
    generatedAt: whatsappState.lastQrUpdate
  });
});

// GET /whatsapp/qr-image - Retorna QR Code como imagem PNG
app.get('/whatsapp/qr-image', async (req, res) => {
  if (!whatsappState.qrCode) {
    return res.status(404).json({
      success: false,
      error: whatsappState.status === 'connected' 
        ? 'WhatsApp já está conectado' 
        : 'QR Code não disponível ainda'
    });
  }
  
  try {
    const QRCode = require('qrcode');
    const qrImage = await QRCode.toDataURL(whatsappState.qrCode, {
      width: 300,
      margin: 2
    });
    
    res.json({
      success: true,
      qrImage: qrImage,
      generatedAt: whatsappState.lastQrUpdate
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 🎛️ ENDPOINTS DE CONTROLE DO ATENDIMENTO
// ============================================================

// GET /config - Retorna configuração atual
app.get('/config', (req, res) => {
  res.json({
    success: true,
    config: getConfig()
  });
});

// ============================================================
// 🎁 ENDPOINTS DA CAMPANHA
// ============================================================

// GET /campanha/sessoes - Lista todas as sessões ativas
app.get('/campanha/sessoes', (req, res) => {
  const sessoes = [];
  sessoesCampanha.forEach((sessao, numero) => {
    sessoes.push({
      numero,
      etapa: sessao.etapa,
      subEtapa: sessao.subEtapa,
      bairro: sessao.bairro,
      descontoTotal: sessao.descontoTotal,
      missoes: sessao.missoes,
      iniciadoEm: sessao.iniciadoEm
    });
  });
  res.json({ success: true, total: sessoes.length, sessoes });
});

// GET /campanha/sessao/:numero - Detalhes de uma sessão específica
app.get('/campanha/sessao/:numero', (req, res) => {
  let { numero } = req.params;
  if (!numero.includes('@c.us')) numero = numero + '@c.us';
  
  const sessao = sessoesCampanha.get(numero);
  if (!sessao) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }
  res.json({ success: true, numero, sessao });
});

// DELETE /campanha/sessao/:numero - Remove uma sessão (para testes)
app.delete('/campanha/sessao/:numero', (req, res) => {
  let { numero } = req.params;
  if (!numero.includes('@c.us')) numero = numero + '@c.us';
  
  if (sessoesCampanha.has(numero)) {
    sessoesCampanha.delete(numero);
    res.json({ success: true, mensagem: `Sessão ${numero} removida` });
  } else {
    res.status(404).json({ error: 'Sessão não encontrada' });
  }
});

// DELETE /campanha/sessoes - Limpa todas as sessões (para testes)
app.delete('/campanha/sessoes', (req, res) => {
  const total = sessoesCampanha.size;
  sessoesCampanha.clear();
  res.json({ success: true, mensagem: `${total} sessões removidas` });
});

// POST /config/atendimento-automatico - Liga/desliga atendimento
app.post('/config/atendimento-automatico', (req, res) => {
  const { ativo } = req.body;
  
  if (typeof ativo !== 'boolean') {
    return res.status(400).json({ 
      error: 'Campo "ativo" (boolean) é obrigatório.' 
    });
  }
  
  const novoStatus = setAtendimentoAutomatico(ativo);
  res.json({
    success: true,
    atendimentoAutomatico: novoStatus,
    mensagem: novoStatus ? 'Atendimento automático ATIVADO' : 'Atendimento automático DESATIVADO'
  });
});

// GET /config/status - Status rápido
app.get('/config/status', (req, res) => {
  res.json({
    atendimentoAutomatico: getAtendimentoAutomatico(),
    timestamp: new Date().toISOString()
  });
});

// Inicia o servidor com setup do banco
async function iniciarServidor() {
  try {
    // Setup do banco de dados
    console.log('🔧 Configurando banco de dados...');
    await setupDatabase();
    
    // Carrega configurações do banco
    const configs = await configService.carregarConfiguracoes();
    config.atendimentoAutomatico = configs.atendimento_automatico?.valor || false;
    
    // Carrega provedores de IA do banco
    await provedorService.carregarProvedores();
    
    // Carrega prompts do banco
    await promptService.carregarPrompts();
    
    // Carrega fluxos visuais do banco
    await fluxoService.carregarFluxos();
    
    // Inicia o servidor HTTP
    app.listen(port, () => {
      console.log(`\n🚀 Servidor rodando em http://localhost:${port}`);
      console.log(`📊 Dashboard: http://localhost:${port}/dashboard.html`);
      console.log(`🎛️ Atendimento automático: ${config.atendimentoAutomatico ? '✅ ATIVADO' : '❌ DESATIVADO'}`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error.message);
    process.exit(1);
  }
}

iniciarServidor();



//#########################################################################

// Evento principal de mensagem
client.on('message', async (msg) => {
  console.log("Mensagem recebida", msg.body);
  const chat = await msg.getChat();

  // ❌ Ignorar mensagens de grupos
  if (msg.author !== undefined) return;

  // ❌ Ignorar mensagens de status (broadcasts)
  if (msg.from === 'status@broadcast') return;

  // ❌ Ignorar mensagens enviadas pelo próprio bot
  if (msg.fromMe) return;

  const numero = msg.from;

  // 📇 Contatos (vCard): prioridade para fluxo visual (nó Aguardar contatos), depois campanha legada
  const isContactMessage = msg.type === 'vcard' || msg.type === 'multi_vcard';
  if (isContactMessage) {
    if (fluxoExecutor.temFluxoAtivo(numero) && fluxoExecutor.estaAguardandoContatos(numero)) {
      const processado = await fluxoExecutor.processarContatosFluxo(numero, msg);
      if (processado) return;
    }
    if (sessoesCampanha.has(numero)) {
      const sessaoCamp = sessoesCampanha.get(numero);
      if (sessaoCamp.etapa === 2 && (sessaoCamp.subEtapa === 'aguardando_contatos' || sessaoCamp.subEtapa === 'inicio')) {
        if (sessaoCamp.subEtapa === 'inicio') sessaoCamp.subEtapa = 'aguardando_contatos';
        await processarContatosIndicados(numero, msg, sessaoCamp);
        return;
      }
    }
  }

  // ❌ Ignorar mensagens sem texto
  if (!msg.body || msg.body.trim() === '') return;

  const texto = msg.body.trim();

  // Gatilhos e início de fluxo: processados na hora (sem debounce)
  const fluxoVisual = await fluxoService.buscarFluxoPorGatilho(texto);
  if (fluxoVisual && !fluxoExecutor.temFluxoAtivo(numero)) {
    console.log(`🔀 Fluxo visual detectado: ${fluxoVisual.nome}`);
    await fluxoExecutor.iniciarFluxo(client, numero, fluxoVisual);
    return;
  }
  let gatilhoDetectado = await verificarGatilhoDB(texto);
  if (!gatilhoDetectado && config.gatilhosLegadoAtivos) gatilhoDetectado = verificarGatilhoLocal(texto);
  if (gatilhoDetectado && !sessoesCampanha.has(numero)) {
    console.log(`🎯 Gatilho detectado: ${gatilhoDetectado.tipo}`);
    await processarGatilho(gatilhoDetectado, numero, texto, msg);
    return;
  }

  // ============================================================
  // 📥 DEBOUNCE unificado: fluxo, campanha e atendimento
  // ============================================================
  let mode = 'atendimento';
  if (fluxoExecutor.temFluxoAtivo(numero)) mode = 'fluxo';
  else if (sessoesCampanha.has(numero)) mode = 'campanha';

  if (!debounceState.has(numero)) {
    debounceState.set(numero, { buffer: [], timerId: null, mode: 'atendimento', lastMsg: null });
    const labels = await client.getLabels();
    console.log(labels.map(l => ({ id: l.id, name: l.name, color: l })));
    const chatLabels = await chat.getLabels();
    console.log(chatLabels);
    removeLabelFromChat(msg.from, msg.body);
    const label = await client.getLabelById('1');
    const associatedChats = await label.getChats();
    console.log(associatedChats.map(a => ({ id: a.id, name: a })));
  }

  const state = debounceState.get(numero);
  state.buffer.push(msg.body.trim());
  state.mode = mode;
  state.lastMsg = msg;

  if (atendimentoEmProcesso.get(numero)) {
    filaPendente.set(numero, true);
    console.log(`⏳ ${numero} aguardando (em fila).`);
    return;
  }

  if (state.timerId) clearTimeout(state.timerId);

  let delayMs = await configService.getConfiguracao('debounce_mensagens_ms');
  if (typeof delayMs !== 'number' || delayMs <= 0) delayMs = await configService.getConfiguracao('delay_resposta_ms');
  const delay = (typeof delayMs === 'number' && delayMs > 0) ? delayMs : DEBOUNCE_MS_PADRAO;

  state.timerId = setTimeout(async () => {
    atendimentoEmProcesso.set(numero, true);
    const mensagens = state.buffer.splice(0, state.buffer.length);
    const mensagemFinal = mensagens.join(' ').trim();
    const modoAtual = state.mode;
    const lastMsg = state.lastMsg;
    state.timerId = null;

    if (mensagemFinal === '') {
      atendimentoEmProcesso.set(numero, false);
      debounceState.delete(numero);
      return;
    }

    console.log(`📤 [Debounce] ${mensagens.length} msg agrupada(s) para ${numero} (modo: ${modoAtual})`);

    try {
      if (modoAtual === 'fluxo') {
        await fluxoExecutor.processarMensagemFluxo(numero, mensagemFinal);
      } else if (modoAtual === 'campanha') {
        await processarCampanhaDesconto(numero, mensagemFinal, lastMsg, false);
      } else {
        const atendimentoAtivo = await configService.getConfiguracao('atendimento_automatico');
        if (!atendimentoAtivo) {
          console.log(`⏸️ Atendimento DESATIVADO - mensagens não processadas`);
          atendimentoEmProcesso.set(numero, false);
          if (filaPendente.get(numero)) filaPendente.delete(numero);
          debounceState.delete(numero);
          return;
        }
        await processarMensagem(numero, mensagemFinal, lastMsg);
      }
    } catch (err) {
      console.error('❌ Erro ao processar:', err);
      if (lastMsg) lastMsg.reply('Desculpe, tivemos um erro. Pode tentar novamente?');
    } finally {
      atendimentoEmProcesso.set(numero, false);
      if (filaPendente.get(numero)) {
        filaPendente.delete(numero);
        console.log(`🔁 Reprocessando ${numero} por pendência.`);
        const stateAgain = debounceState.get(numero);
        const txtPendente = stateAgain?.buffer?.length ? stateAgain.buffer.splice(0, stateAgain.buffer.length).join(' ').trim() : '';
        if (stateAgain && !stateAgain.buffer.length) debounceState.delete(numero);
        if (txtPendente) {
          atendimentoEmProcesso.set(numero, true);
          try {
            const modo = stateAgain?.mode || 'atendimento';
            if (modo === 'fluxo') await fluxoExecutor.processarMensagemFluxo(numero, txtPendente);
            else if (modo === 'campanha') await processarCampanhaDesconto(numero, txtPendente, stateAgain?.lastMsg || lastMsg, false);
            else await processarMensagem(numero, txtPendente, stateAgain?.lastMsg || lastMsg);
          } catch (e) {
            console.error('❌ Erro no reprocessamento:', e);
            if (lastMsg) lastMsg.reply('Erro ao continuar o atendimento.');
          } finally {
            atendimentoEmProcesso.set(numero, false);
          }
        }
      } else {
        debounceState.delete(numero);
      }
    }
  }, delay);
});

// (Opcional) Cancela o timer se o cliente começar a digitar (nem sempre funciona)
client.on('typing', (chat) => {
  const numero = chat.id._serialized;
  const state = debounceState.get(numero);
  if (state?.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
    console.log(`⌨️ ${numero} está digitando... aguardando...`);
  }
});

//#############################################################33


async function processarMensagem(numero, texto, msg) {
  const atendimento = await buscarOuCriarAtendimento(numero);
  const historico = await getHistorico(atendimento.id);
  await adicionarAoHistorico(atendimento.id, numero, 'user', texto, atendimento.id);
  historico.push({ role: "assistant", content: texto });

  const resposta = await enviarParaIADinamica(historico);
  const respostalimpa = limparResposta(resposta);

  await adicionarAoHistorico(atendimento.id, numero, 'assistant', resposta, atendimento.id);
  historico.push({ role: "assistant", content: resposta });

  // 🔄 Analisa a resposta e executa requisições externas se necessário
  const novaRespostaFinal = await analisar_resposta(resposta, historico, atendimento, numero, msg);

  // 📨 Enviar resposta final (da IA ou da análise externa)
  const mensagemFinal = limparResposta(novaRespostaFinal || resposta);
  if (mensagemFinal && mensagemFinal.trim() !== "") {
    await msg.reply(mensagemFinal);
  }
}


//#########################################################################

// 🎯 Processador de Gatilhos Especiais
async function processarGatilho(gatilhoDetectado, numero, texto, msg) {
  const { tipo } = gatilhoDetectado;

  switch (tipo) {
    case 'campanha_desconto':
      await processarCampanhaDesconto(numero, texto, msg, true);
      break;

    default:
      console.log(`⚠️ Gatilho "${tipo}" não possui handler implementado`);
  }
}

// ============================================================
// 🤖 FUNÇÕES DE IA PARA INTERPRETAR RESPOSTAS
// ============================================================

// Extrai o bairro da resposta do cliente usando IA
async function extrairBairroComIA(texto) {
  const prompt = `Você é um assistente que extrai informações de mensagens.
O cliente enviou uma mensagem informando seu bairro. Extraia APENAS o nome do bairro.

Regras:
- Retorne SOMENTE o nome do bairro, sem pontuação ou texto adicional
- Se não conseguir identificar um bairro, retorne "NAO_IDENTIFICADO"
- Corrija erros de digitação comuns
- Ignore palavras como "meu bairro é", "moro no", "fico no", etc.

Exemplos:
- "meu bairro é petropolis" → Petrópolis
- "moro no centro" → Centro
- "fico la no bucarein" → Bucarein
- "é gloria" → Glória
- "iririú" → Iririú
- "to no aventureiro" → Aventureiro

Mensagem do cliente: "${texto}"

Responda APENAS com o nome do bairro:`;

  try {
    const resposta = await enviarParaIADinamica([
      { role: "user", content: prompt }
    ]);
    
    const bairro = resposta.trim().replace(/['"]/g, '');
    console.log(`🤖 IA extraiu bairro: "${bairro}" da mensagem: "${texto}"`);
    
    if (bairro === 'NAO_IDENTIFICADO' || bairro.length > 50) {
      return null;
    }
    
    return bairro;
  } catch (error) {
    console.error('❌ Erro ao extrair bairro com IA:', error.message);
    return texto.trim(); // Fallback para o texto original
  }
}

// Gera resposta contextual para a campanha quando cliente não confirma ou faz perguntas
async function gerarRespostaContextualCampanha(sessao, textoCliente) {
  const linkGrupo = sessao.grupoEncontrado?.link || gruposWhatsapp.grupo_geral.link;
  
  const prompt = `Você é o assistente de uma campanha de desconto de uma pizzaria.

CONTEXTO ATUAL:
- O cliente está na Missão 1: Entrar no grupo de WhatsApp
- Bairro do cliente: ${sessao.bairro || 'não informado'}
- Link do grupo: ${linkGrupo}
- Desconto atual: ${sessao.descontoTotal}%
- O cliente precisa entrar no grupo e confirmar para ganhar +10% de desconto

MENSAGEM DO CLIENTE: "${textoCliente}"

REGRAS:
- Seja simpático, informal e use emojis
- Se o cliente fez uma pergunta, responda de forma breve
- Sempre lembre o cliente de entrar no grupo e confirmar
- Inclua o link do grupo na resposta
- Mantenha a resposta curta (máximo 3-4 linhas)
- Se o cliente disse que não conseguiu ou teve problema, seja compreensivo e ofereça ajuda

Responda de forma natural e amigável:`;

  try {
    const resposta = await enviarParaIADinamica([
      { role: "user", content: prompt }
    ]);
    
    // Garante que o link está na resposta
    let respostaFinal = resposta.trim();
    if (!respostaFinal.includes(linkGrupo)) {
      respostaFinal += `\n\n🔗 ${linkGrupo}`;
    }
    
    return respostaFinal;
  } catch (error) {
    console.error('❌ Erro ao gerar resposta contextual:', error.message);
    // Fallback para mensagem padrão
    return `Entendi! 😊 Mas pra liberar seu desconto, preciso que você entre no grupo primeiro!

🔗 Clica aqui: ${linkGrupo}

Depois me avisa que eu libero seus *10% de desconto*! ✅`;
  }
}

// Verifica se o cliente confirmou entrada no grupo usando IA
async function verificarConfirmacaoComIA(texto) {
  const prompt = `Você é um assistente que analisa se o cliente confirmou que entrou em um grupo do WhatsApp.

Analise a mensagem e responda APENAS "SIM" ou "NAO".

Considere SIM se o cliente:
- Disse que entrou no grupo
- Confirmou que já está no grupo
- Usou palavras como: entrei, pronto, feito, já entrei, tô lá, estou no grupo, confirmado, ok, sim, done, já tô, entrei sim, etc.

Considere NAO se o cliente:
- Fez uma pergunta
- Disse que não conseguiu entrar
- Mudou de assunto
- Não confirmou claramente

Mensagem do cliente: "${texto}"

Responda APENAS "SIM" ou "NAO":`;

  try {
    const resposta = await enviarParaIADinamica([
      { role: "user", content: prompt }
    ]);
    
    const confirmou = resposta.trim().toUpperCase().includes('SIM');
    console.log(`🤖 IA verificou confirmação: ${confirmou ? 'SIM' : 'NÃO'} para: "${texto}"`);
    
    return confirmou;
  } catch (error) {
    console.error('❌ Erro ao verificar confirmação com IA:', error.message);
    // Fallback para verificação simples
    const confirmacoes = ['entrei', 'pronto', 'feito', 'já entrei', 'sim', 'ok', 'done', 'já', 'confirmado', 'tô no grupo', 'estou no grupo'];
    return confirmacoes.some(c => texto.toLowerCase().includes(c));
  }
}

// ============================================================
// 🎁 PROCESSADOR DA CAMPANHA DE DESCONTO
// ============================================================
async function processarCampanhaDesconto(numero, texto, msg, isNovoGatilho = false) {
  const sessao = getOuCriarSessaoCampanha(numero);
  
  console.log(`🎁 Campanha - ${numero} | Etapa: ${sessao.etapa} | SubEtapa: ${sessao.subEtapa}`);

  // Se é um novo gatilho (primeira mensagem), envia boas-vindas
  if (isNovoGatilho) {
    sessao.historico.push({ role: "assistant", content: "Início da campanha" });
    
    const msgBoasVindas = `Olá! Vi que você quer liberar os seus *30% de desconto*. Vamos lá? 🍕🔥

São *3 missões* rápidas e a pizza sai quase de graça!

Para começarmos, preciso saber: *qual o seu bairro?* 📍`;

    await msg.reply(msgBoasVindas);
    sessao.subEtapa = 'aguardando_bairro';
    return;
  }

  // Processa baseado na etapa atual
  switch (sessao.etapa) {
    case 1: // Missão 1 - Grupo WhatsApp
      await processarMissao1(sessao, numero, texto, msg);
      break;
    
    case 2: // Missão 2 - Indicar 10 contatos (30% desconto)
      await processarMissao2(sessao, numero, texto, msg);
      break;
    
    case 3: // Missão 3 - A definir
      await msg.reply('🚧 Missão 3 ainda em desenvolvimento! Aguarde novidades.');
      break;
    
    default:
      await msg.reply('🎉 Você já completou todas as missões! Aproveite seu desconto.');
  }
}

// 🎯 MISSÃO 1: Entrar no grupo de WhatsApp
async function processarMissao1(sessao, numero, texto, msg) {

  switch (sessao.subEtapa) {
    case 'aguardando_bairro':
      // 🤖 Usa IA para extrair o bairro da resposta do cliente
      const bairroExtraido = await extrairBairroComIA(texto);
      
      if (!bairroExtraido) {
        await msg.reply('Desculpa, não consegui entender seu bairro. 🤔\n\nPode me dizer novamente? Por exemplo: "Centro", "Bucarein", "Glória"...');
        return;
      }
      
      sessao.bairro = bairroExtraido;
      console.log(`📍 Bairro extraído pela IA: ${sessao.bairro}`);
      
      // Busca o grupo correspondente (banco de dados primeiro, fallback JSON)
      let resultado = await buscarGrupoWhatsappDB(sessao.bairro);
      console.log(`🔍 [DEBUG] Resultado busca DB:`, JSON.stringify(resultado, null, 2));
      
      if (resultado.erro) {
        console.log(`⚠️ [DEBUG] Erro no DB, usando fallback JSON`);
        resultado = buscarGrupoWhatsapp(sessao.bairro);
        console.log(`🔍 [DEBUG] Resultado busca JSON:`, JSON.stringify(resultado, null, 2));
      }
      sessao.grupoEncontrado = resultado;
      console.log(`✅ [DEBUG] Grupo final:`, JSON.stringify(sessao.grupoEncontrado, null, 2));
      
      let msgGrupo;
      if (resultado.tipo === 'especifico') {
        msgGrupo = `Show! Encontrei o grupo do *${resultado.bairro}*! 🎉

🔗 *Entre no grupo clicando aqui:*
${resultado.link}

Depois que entrar, me avisa aqui que você já está no grupo para eu liberar seus *10% de desconto*! ✅`;
      } else {
        msgGrupo = `Entendi, você é do *${sessao.bairro}*! 😊

Não temos um grupo específico pra lá ainda, mas sem problemas!

🔗 *Entre no nosso grupo geral de promoções:*
${resultado.link}

Lá você vai receber todas as promoções! Depois que entrar, me avisa aqui que eu libero seus *10% de desconto*! ✅`;
      }
      
      await msg.reply(msgGrupo);
      sessao.subEtapa = 'aguardando_confirmacao_grupo';
      break;

    case 'aguardando_confirmacao_grupo':
      // 🤖 Usa IA para verificar se o cliente confirmou entrada no grupo
      const confirmou = await verificarConfirmacaoComIA(texto);
      
      if (confirmou) {
        // Marca missão 1 como concluída
        sessao.missoes[1].concluida = true;
        sessao.descontoTotal += 10;
        sessao.etapa = 2;
        sessao.subEtapa = 'inicio';
        
        const msgSucesso = `🎉 *MISSÃO 1 CONCLUÍDA!* 🎉

✅ Você liberou *+10% de desconto*! (Total: *${sessao.descontoTotal}%*)

🔥 *Quer chegar a 30%?* Envie *10 contatos* da sua agenda! Cada indicado ganha *10% de desconto* na 1ª compra.

*Como:* contato → ⋮ → Compartilhar contato → envie aqui. Meta: *10 indicações* 📇`;

        await msg.reply(msgSucesso);
      } else {
        // 🤖 Usa IA para responder de forma contextual
        const respostaContextual = await gerarRespostaContextualCampanha(sessao, texto);
        await msg.reply(respostaContextual);
      }
      break;

    default:
      sessao.subEtapa = 'aguardando_bairro';
      await msg.reply('Ops! Vamos recomeçar. *Qual o seu bairro?* 📍');
  }
}

// 🎯 MISSÃO 2: Indicar 10 contatos para ganhar +10% (total 30%)
async function processarMissao2(sessao, numero, texto, msg) {
  const META_INDICACOES = 10;

  switch (sessao.subEtapa) {
    case 'inicio':
      sessao.subEtapa = 'aguardando_contatos';
      const msgOferta = `🔥 *Quer aumentar seu desconto para 30%?*

É só nos enviar *10 contatos* da sua agenda do WhatsApp! Cada pessoa que você indicar ganha um *cupom de 10% de desconto* na primeira compra.

*Como fazer:* abra um contato na sua agenda → toque nos 3 pontinhos → *Compartilhar contato* → envie aqui. Pode enviar um por um ou vários de uma vez.

📊 *Meta: 10 indicações* (contamos só contatos válidos, sem repetir).

Quando você completar, liberamos seus *30% de desconto*! 🍕`;
      await msg.reply(msgOferta);
      break;

    case 'aguardando_contatos':
      const qtAtual = await indicacaoService.obterQtIndicados(numero);
      if (qtAtual >= META_INDICACOES) {
        await msg.reply('✅ Você já completou a missão de indicações! Seu desconto já está em 30%. 🎉');
        return;
      }
      await msg.reply(
        `📇 Envie os *contatos da sua agenda* (toque no contato → Compartilhar contato → aqui).\n\n` +
        `📊 Progresso: *${qtAtual}/${META_INDICACOES}* indicações.`
      );
      break;

    default:
      sessao.subEtapa = 'aguardando_contatos';
      await processarMissao2(sessao, numero, texto, msg);
  }
}

// 📇 Processa contatos (vCard) enviados na Missão 2
async function processarContatosIndicados(numero, msg, sessao) {
  const META_INDICACOES = 10;
  const vCards = msg.vCards && msg.vCards.length ? msg.vCards : (msg.body ? [msg.body] : []);

  if (vCards.length === 0) {
    if (msg.reply) await msg.reply('Não consegui ler os contatos. Envie de novo usando *Compartilhar contato* do WhatsApp.');
    return;
  }

  const indicados = indicacaoService.parseVcards(vCards);
  if (indicados.length === 0) {
    if (msg.reply) await msg.reply('Nenhum número válido nesses contatos. Envie contatos com telefone.');
    return;
  }

  try {
    const { qtInseridos, qtTotal, completouMissao } = await indicacaoService.registrarIndicacoes(numero, indicados);

    if (qtInseridos > 0) {
      const textoProgresso = completouMissao
        ? `✅ *${qtInseridos}* contato(s) recebido(s)! Total: *${qtTotal}/10*.\n\n🎉 *MISSÃO 2 CONCLUÍDA!* Você liberou *30% de desconto*!`
        : `✅ *${qtInseridos}* contato(s) recebido(s)! Total: *${qtTotal}/10* indicações.`;
      if (msg.reply) await msg.reply(textoProgresso);
    } else {
      if (msg.reply) await msg.reply(`Esses contatos já tinham sido contados. 📊 Total: *${qtTotal}/10*.`);
    }

    if (completouMissao) {
      sessao.missoes[2].concluida = true;
      sessao.descontoTotal = 30;
      sessao.etapa = 3;
      sessao.subEtapa = 'inicio';
      try {
        await metaService.marcarConcluido(numero, '10_indicacoes');
      } catch (e) {
        console.warn('⚠️ Meta 10_indicacoes:', e.message);
      }
      const msgSucesso = `🎉 *Parabéns!* Suas *30% de desconto* estão liberadas!\n\n🚧 *Missão 3* em breve... Aguarde novidades!`;
      if (msg.reply) await msg.reply(msgSucesso);
    }
  } catch (err) {
    console.error('❌ Erro ao registrar indicações:', err);
    if (msg.reply) await msg.reply('Ocorreu um erro ao salvar os contatos. Tente de novo.');
  }
}

//#########################################################################

async function analisar_resposta(resposta, messages, atendimento, numero, msg) {
  const requisicoes = interpretarRespostaAssistente(resposta);
  console.log("\n🤖 IA resposta completa:", 'Retirado para teste');

  if (!requisicoes || requisicoes.length === 0) return resposta;

  const registrarHistorico = async (conteudo) => {
    await adicionarAoHistorico(atendimento.id, numero, 'user', conteudo, atendimento.id);
    messages.push({ role: "user", content: conteudo });
  };

  const montarPromptEEnviar = async (promptChave, systemInfo, userInfo) => {
    let promptBase = await getprompt(promptChave);
    if (systemInfo) promptBase += `\n${systemInfo}`;
    return await enviarParaIADinamica([
      { role: "system", content: promptBase },
      { role: "user", content: userInfo }
    ]);
  };

  for (const { tipo, detalhes } of requisicoes) {
    console.log(`\n📡 Requisição detectada:\nTipo: ${tipo}\nDetalhes: ${detalhes}`);

    let retorno;

    switch (tipo) {
      case "bordas":
        await registrarHistorico(`Retorno Requisição Externa bordas: ${JSON.stringify(bordas, null, 2)}`);
        break;

      case "sabores_salgados":
        const promptCardapio = await getprompt('analise_cardapio'); // Usando nome do banco
        retorno = await enviarParaIADinamica([
          { role: "system", content: promptCardapio },
          { role: "user", content: `Aqui está a solicitação sobre o cardápio:\n${detalhes}` }
        ]);
        await registrarHistorico(`Retorno Requisição Externa sabores_salgados: ${retorno}`);
        break;

      case "taxa_entrega":
        const endereco = await getRetornoApiGoogle(await getRuaeNumero(detalhes));
        const enderecoInfo = `\nRetorno da API do Google sobre o endereço:\n${JSON.stringify(endereco, null, 2)}\n`;
        retorno = await montarPromptEEnviar('Entrega', enderecoInfo, `Solicitação da IA sobre o endereço:\n${detalhes}`);
        await registrarHistorico(`Retorno Requisição Externa taxa_entrega: ${retorno}`);
        break;

      case "sabores_salgados2":
        retorno = {
          sabores_tradicionais: lerJson('sabores_tradicionais'),
          sabores_especiais: lerJson('sabores_especiais'),
        };
        await registrarHistorico(JSON.stringify(retorno, null, 2));
        break;

      case "sabores_doces":
        retorno = {
          sabores_tradicionais: lerJson('sabores_doces'),
          sabores_especiais: lerJson('sabores_doces_especiais'),
        };
        await registrarHistorico(`Retorno Requisição Externa sabores_doces: ${JSON.stringify(retorno, null, 2)}`);
        break;

      case "atendimento_humano":
        retorno = "ok, encaminhando para atendimento humano";
        await registrarHistorico(`Retorno Requisição Externa atendimento_humano: ${retorno}`);
        break;

      case "finalizar_pedido":
        retorno = `Pedido confirmado com ID 1256\n${detalhes}`;
        await registrarHistorico(`Retorno Requisição Externa finalizar_pedido: ${retorno}`);
        break;

      case "bebidas":
        await registrarHistorico(`Retorno Requisição Externa bebidas: ${JSON.stringify(bebidas, null, 2)}`);
        break;

      default:
        console.log("⚠️ Tipo de requisição não tratado:", tipo);
    }
  }

  // 🔁 Agora sim, após processar tudo, nova resposta com histórico completo
  const nova_resposta = await enviarParaIADinamica(messages);

  if (nova_resposta) {
    await adicionarAoHistorico(atendimento.id, numero, 'assistant', nova_resposta, atendimento.id);
    messages.push({ role: "assistant", content: nova_resposta });

    // Recursivamente tratar nova resposta (caso a IA peça mais requisições)
    return await analisar_resposta(nova_resposta, messages, atendimento, numero, msg);
  }

  return resposta;
}




async function analisar_resposta2(resposta, messages, atendimento, numero, msg) {
  const requisicao = interpretarRespostaAssistente(resposta);
  console.log("\n🤖 IA resposta completa:", 'Retirado para teste');

  if (!requisicao) return resposta;

  const { tipo, detalhes } = requisicao;

  console.log(`\n📡 Requisição detectada:\nTipo: ${tipo}\nDetalhes: ${detalhes}`);

  // Utilitário para adicionar no histórico e messages
  const registrarHistorico = async (conteudo) => {
    await adicionarAoHistorico(atendimento.id, numero, 'user', conteudo, atendimento.id);
    messages.push({ role: "user", content: conteudo });
  };

  // Utilitário para montar prompts + enviar para IA
  const montarPromptEEnviar = async (promptChave, systemInfo, userInfo) => {
    let promptBase = await getprompt(promptChave);
    if (systemInfo) promptBase += `\n${systemInfo}`;
    return await enviarParaIADinamica([
      { role: "system", content: promptBase },
      { role: "user", content: userInfo }
    ]);
  };

  let retorno;

  switch (tipo) {
    
    case "bordas":
      await registrarHistorico(`Retorno Requisição Externa bordas: ${JSON.stringify(bordas, null, 2)}`);
      break;

    case "sabores_salgados":
      const promptCardapio = await getprompt('analise_cardapio');
      retorno = await enviarParaIADinamica([
        { role: "system", content: promptCardapio },
        { role: "user", content: `Aqui está a solicitação sobre o cardápio:\n${detalhes}` }
      ]);
      await registrarHistorico(`Retorno Requisição Externa sabores_salgados: ${retorno}`);
      break;

    case "taxa_entrega":
      const endereco = await getRetornoApiGoogle(await getRuaeNumero(detalhes));
      const enderecoInfo = `\nRetorno da API do Google sobre o endereço:\n${JSON.stringify(endereco, null, 2)}\n`;
      retorno = await montarPromptEEnviar('Entrega', enderecoInfo, `Solicitação da IA sobre o endereço:\n${detalhes}`);
      await registrarHistorico(`Retorno Requisição Externa taxa_entrega: ${retorno}`);
      break;

    case "sabores_salgados2":
      retorno = {
        sabores_tradicionais: lerJson('sabores_tradicionais'),
        sabores_especiais: lerJson('sabores_especiais'),
      };
      await registrarHistorico(JSON.stringify(retorno, null, 2));
      break;

    case "sabores_doces":
      retorno = {
        sabores_tradicionais: lerJson('sabores_doces'),
        sabores_especiais: lerJson('sabores_doces_especiais'),
      };
      await registrarHistorico(`Retorno Requisição Externa sabores_doces: ${JSON.stringify(retorno, null, 2)}`);
      break;

    case "atendimento_humano":
      retorno = "ok, encaminhando para atendimento humano";
      await registrarHistorico(`Retorno Requisição Externa atendimento_humano: ${retorno}`);
      break;

    case "finalizar_pedido":
      retorno = `Pedido confirmado com ID 1256\n${detalhes}`;
      await registrarHistorico(`Retorno Requisição Externa finalizar_pedido: ${retorno}`);
      break;
 
    case "bebidas":
      await registrarHistorico(`Retorno Requisição Externa bebidas: ${JSON.stringify(bebidas, null, 2)}`);
      break;
    default:
      return resposta; // Tipo não tratado
  }

  // 🔁 Nova resposta com base no histórico atualizado
  /*const nova_resposta = await enviarParaQwen3(messages);

  if (nova_resposta) {
    await adicionarAoHistorico(atendimento.id, numero, 'assistant', nova_resposta, atendimento.id);
    messages.push({ role: "assistant", content: nova_resposta });

    // Recursivamente tratar nova resposta (caso a IA peça mais requisições)
    return await analisar_resposta(nova_resposta, messages, atendimento, numero, msg);
  }
*/
  return resposta;
}


async function addLabelToChat(chatId, newLabelId) {
  // 1. Pega o objeto Chat
  const chat = await client.getChatById(chatId);

  // 2. Busca labels existentes
  const existing = await chat.getLabels();            // retorna Label[]
  const existingIds = existing.map(l => l.id);        // ['id1','id2',...]

  // 3. Se ainda não existe, adiciona
  if (!existingIds.includes(newLabelId)) {
    existingIds.push(newLabelId);
  }

  // 4. Substitui pelas IDs atualizadas
  await chat.changeLabels(existingIds);
}



async function removeLabelFromChat(chatId, labelToRemoveId) {
  const chat = await client.getChatById(chatId);

  const existing = await chat.getLabels();
  // filtra pra fora a que quero remover
  const updatedIds = existing
    .map(l => l.id)
    .filter(id => id !== labelToRemoveId);

  await chat.changeLabels(updatedIds);
}



// Agora você pode usar:
client.on('label_change', ({ chatId, added, removed }) => {
  console.log(`Chat ${chatId} recebeu labels +[${added.map(l=>l.name)}], -[${removed.map(l=>l.name)}]`);
});


// ============================================================
// 🎁 EVENTO: ENTRADA EM GRUPO (Confirmação automática Missão 1)
// ============================================================
client.on('group_join', async (notification) => {
  const grupoID = notification.chatId;
  const novosMembros = notification.recipientIds; 

  console.log(`\n📥 Nova entrada no grupo: ${grupoID}`);

  // Verifica se é um dos nossos grupos de campanha (banco primeiro, fallback local)
  let verificacaoGrupo = await isGrupoCampanhaDB(grupoID);
  if (!verificacaoGrupo.valido) {
    verificacaoGrupo = isGrupoCampanhaLocal(grupoID);
  }
  
  if (!verificacaoGrupo.valido) {
    console.log(`⏭️ Grupo ${grupoID} não é um grupo de campanha - ignorando`);
    return;
  }

  console.log(`✅ Grupo válido da campanha! Bairro: ${verificacaoGrupo.bairro}`);

  try {
    const connection = await mysql.createConnection(dbConfig);

    for (const oderId of novosMembros) {
      console.log(`👤 Processando membro: ${oderId}`);

      // Busca o contato completo para obter o número real
      const contact = await client.getContactById(oderId);
      const numeroReal = contact.number;
      
      if (!numeroReal) {
        console.log(`⚠️ Não foi possível obter o número real para ${oderId}`);
        continue;
      }

      const numeroFormatado = formatarNumeroWhatsapp(numeroReal);
      console.log(`📱 Número formatado: ${numeroFormatado}`);

      // ============================================================
      // 🎁 INTEGRAÇÃO COM CAMPANHA DE DESCONTO
      // ============================================================
      if (sessoesCampanha.has(numeroFormatado)) {
        const sessao = sessoesCampanha.get(numeroFormatado);
        
        // Verifica se está na etapa de aguardar confirmação do grupo
        if (sessao.etapa === 1 && sessao.subEtapa === 'aguardando_confirmacao_grupo') {
          console.log(`🎉 Cliente ${numeroFormatado} entrou no grupo - confirmando Missão 1 automaticamente!`);
          
          // Marca missão 1 como concluída
          sessao.missoes[1].concluida = true;
          sessao.descontoTotal += 10;
          sessao.etapa = 2;
          sessao.subEtapa = 'inicio';
          sessao.confirmaçãoAutomatica = true;
          
          // Envia mensagem de parabéns + oferta Missão 2 (10 contatos = 30%)
          const msgSucesso = `🎉 *MISSÃO 1 CONCLUÍDA!* Vi que você entrou no grupo! 🔥

✅ Você liberou *+10% de desconto*! (Total: *${sessao.descontoTotal}%*)

🔥 *Quer chegar a 30%?* Envie *10 contatos* da sua agenda! Cada indicado ganha *10% de desconto* na 1ª compra.

*Como:* contato → ⋮ → Compartilhar contato → envie aqui. Pode enviar um por um ou vários. Meta: *10 indicações* 📇`;

          try {
            await client.sendMessage(numeroFormatado, msgSucesso);
            console.log(`📨 Mensagem de confirmação enviada para ${numeroFormatado}`);
          } catch (sendErr) {
            console.error(`❌ Erro ao enviar mensagem: ${sendErr.message}`);
          }
        }
      }

      // ============================================================
      // 🔀 FLUXO VISUAL: confirmação automática de entrada no grupo
      // ============================================================
      if (fluxoExecutor.temFluxoAtivo(numeroFormatado)) {
        const executor = fluxoExecutor.getSessaoFluxo(numeroFormatado);
        if (executor.aguardandoResposta && executor.currentNodeId) {
          const currentNode = executor.getNode(executor.currentNodeId);
          const variavelWait = currentNode?.data?.variavelResposta || '';
          const ehAguardandoConfirmacaoGrupo = variavelWait === 'confirmacaoGrupo' || variavelWait === 'confirmacao' || (currentNode?.type === 'wait' && String(variavelWait).toLowerCase().includes('grupo'));
          if (currentNode?.type === 'wait' && ehAguardandoConfirmacaoGrupo) {
            console.log(`🎉 [Fluxo] Cliente ${numeroFormatado} entrou no grupo - confirmando automaticamente no fluxo visual`);
            try {
              await fluxoExecutor.processarMensagemFluxo(numeroFormatado, 'entrei no grupo');
            } catch (err) {
              console.error('❌ [Fluxo] Erro ao processar confirmação automática:', err.message);
            }
          }
        }
      }

      // ============================================================
      // 📊 ATUALIZAÇÃO NO BANCO DE DADOS (CRM)
      // ============================================================
      const sql = `UPDATE contatos SET cam_grupo = 1 WHERE whatsapp_id = ?`;
      const [result] = await connection.execute(sql, [numeroReal]);

      if (result.affectedRows > 0) {
        console.log(`✅ SUCESSO: Lead ${numeroReal} marcado como entrou no grupo.`);
        try {
          await metaService.marcarConcluido(numeroReal, 'entrada_grupo');
        } catch (e) {
          console.warn('⚠️ Meta entrada_grupo:', e.message);
        }
        // Busca o id_negociacao do contato para mover no funil
        const [rows] = await connection.execute(
          'SELECT id_negociacao FROM contatos WHERE whatsapp_id = ?', 
          [numeroReal]
        );
        
        if (rows.length > 0 && rows[0].id_negociacao) {
          await moverCardNoFunil(rows[0].id_negociacao);
        }
      } else {
        console.log(`⚠️ AVISO: O número ${numeroReal} NÃO foi encontrado na tabela 'contatos'.`);
      }
    }

    await connection.end();
  } catch (err) {
    console.error('❌ Erro no processamento:', err.message);
  }
});






