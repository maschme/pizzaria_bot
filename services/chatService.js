'use strict';

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const whatsappIdentityService = require('./whatsappIdentityService');
const fluxoExecutor = require('./fluxoExecutor');
const fluxoService = require('./fluxoService');
const sessaoCampanhaService = require('./sessaoCampanhaService');
const fluxoLogService = require('./fluxoLogService');

const dbConn = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

let cacheConversas = null;
let cacheConversasTs = 0;
const CACHE_TTL_MS = 15000;

function normalizarDigitos(id) {
  return whatsappIdentityService.apenasDigitos(id);
}

function invalidarCacheConversas() {
  cacheConversas = null;
  cacheConversasTs = 0;
}

async function resolverChatId(client, identificador) {
  const raw = decodeURIComponent(String(identificador || '').trim());
  if (!raw) throw new Error('chatId inválido');
  if (raw.includes('@')) return raw;
  const digs = normalizarDigitos(raw);
  if (digs.length >= 8) return `${digs}@c.us`;
  const id = await whatsappIdentityService.resolverIdentidadeCliente(client, raw);
  return id.chatIdCanonicoCUs || id.chatIdOriginal || raw;
}

async function carregarMapaContatos() {
  const mapByWid = new Map();
  const mapByLid = new Map();
  const conn = await mysql.createConnection(dbConn);
  try {
    const [rows] = await conn.execute(
      `SELECT whatsapp_id, whatsapp_lid, nome, cam_grupo, qt_indicados, cam_indicacoes
       FROM contatos`
    );
    for (const r of rows) {
      if (r.whatsapp_id) mapByWid.set(normalizarDigitos(r.whatsapp_id), r);
      if (r.whatsapp_lid) mapByLid.set(String(r.whatsapp_lid).trim(), r);
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
  } finally {
    await conn.end();
  }
  return { mapByWid, mapByLid };
}

function acharContato(maps, chatId, identity) {
  const lid = identity?.whatsappLid || (String(chatId).includes('@lid') ? chatId : null);
  if (lid && maps.mapByLid.has(lid)) return maps.mapByLid.get(lid);
  const digs = identity?.widDigitosTelefone || normalizarDigitos(chatId);
  if (digs && maps.mapByWid.has(digs)) return maps.mapByWid.get(digs);
  return null;
}

function acharSessaoFluxo(chatId, identity) {
  const keys = [chatId];
  if (identity?.chatIdCanonicoCUs) keys.push(identity.chatIdCanonicoCUs);
  if (identity?.whatsappLid) keys.push(identity.whatsappLid);
  const digs = identity?.widDigitosTelefone || normalizarDigitos(chatId);
  if (digs) {
    keys.push(`${digs}@c.us`);
    keys.push(digs);
  }
  for (const k of keys) {
    if (fluxoExecutor.temFluxoAtivo(k)) {
      return fluxoExecutor.getSessaoFluxo(k);
    }
  }
  return null;
}

function formatarPreviewMensagem(msg) {
  if (!msg) return '';
  if (msg.type === 'chat' || msg.type === 'text') return msg.body || '';
  if (msg.type === 'vcard' || msg.type === 'multi_vcard') return '📇 Contato';
  if (msg.type === 'image') return '📷 Imagem';
  if (msg.type === 'video') return '🎬 Vídeo';
  if (msg.type === 'audio' || msg.type === 'ptt') return '🎤 Áudio';
  if (msg.type === 'document') return '📄 Documento';
  if (msg.type === 'sticker') return 'Sticker';
  if (msg.type === 'location') return '📍 Localização';
  return `[${msg.type || 'mensagem'}]`;
}

function formatarMensagemApi(msg) {
  const ts = msg.timestamp ? new Date(msg.timestamp * 1000) : null;
  return {
    id: msg.id?._serialized || msg.id?.id || null,
    body: msg.body || '',
    preview: formatarPreviewMensagem(msg),
    fromMe: !!msg.fromMe,
    type: msg.type || 'chat',
    timestamp: msg.timestamp || null,
    dataHora: ts ? ts.toISOString() : null
  };
}

async function listarConversas(client, opts = {}) {
  if (!client?.info) {
    return { connected: false, total: 0, data: [], error: 'WhatsApp não conectado' };
  }

  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 80));
  const search = String(opts.search || '').toLowerCase().trim();
  const now = Date.now();

  if (!cacheConversas || now - cacheConversasTs > CACHE_TTL_MS) {
    const chats = await client.getChats();
    cacheConversas = chats
      .filter((c) => {
        const id = c.id?._serialized || '';
        return !c.isGroup && id !== 'status@broadcast' && !id.includes('@g.us');
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    cacheConversasTs = now;
  }

  let filtradas = cacheConversas;
  if (search) {
    filtradas = filtradas.filter((c) => {
      const nome = (c.name || c.formattedTitle || '').toLowerCase();
      const id = (c.id?._serialized || '').toLowerCase();
      const digs = normalizarDigitos(search);
      return nome.includes(search) || id.includes(search) || (digs && id.includes(digs));
    });
  }

  const maps = await carregarMapaContatos();
  const sessoesCampanha = sessaoCampanhaService.listarSessoes();

  const data = [];
  for (const chat of filtradas.slice(0, limit)) {
    const chatId = chat.id._serialized;
    const identity = await whatsappIdentityService.resolverIdentidadeCliente(client, chatId);
    const contato = acharContato(maps, chatId, identity);
    const executor = acharSessaoFluxo(chatId, identity);
    const campanha = sessoesCampanha.find((s) => {
      if (s.chatId === chatId) return true;
      const d1 = normalizarDigitos(s.chatId);
      const d2 = identity.widDigitosTelefone || normalizarDigitos(chatId);
      return d1 && d2 && d1 === d2;
    });

    const last = chat.lastMessage;
    data.push({
      chatId,
      nome: chat.name || chat.formattedTitle || contato?.nome || normalizarDigitos(chatId) || chatId,
      naoLidas: chat.unreadCount || 0,
      ultimaMensagem: formatarPreviewMensagem(last),
      ultimaMensagemEm: last?.timestamp ? new Date(last.timestamp * 1000).toISOString() : null,
      timestamp: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
      whatsapp_id: identity.widDigitosTelefone || normalizarDigitos(chatId) || null,
      whatsapp_lid: identity.whatsappLid || contato?.whatsapp_lid || null,
      em_fluxo: !!executor,
      fluxo: executor ? {
        id: executor.fluxo?.id,
        nome: executor.fluxo?.nome,
        node_atual: executor.currentNodeId,
        aguardando_resposta: executor.aguardandoResposta,
        aguardando_contatos: executor.aguardandoContatos
      } : null,
      em_campanha: !!campanha,
      campanha: campanha ? {
        etapa: campanha.etapa,
        subEtapa: campanha.subEtapa,
        descontoTotal: campanha.descontoTotal
      } : null,
      contato: contato ? {
        cam_grupo: contato.cam_grupo,
        qt_indicados: contato.qt_indicados,
        cam_indicacoes: contato.cam_indicacoes
      } : null
    });
  }

  return { connected: true, total: filtradas.length, data };
}

async function obterMensagens(client, chatIdRaw, opts = {}) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const chatId = await resolverChatId(client, chatIdRaw);
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
  const chat = await client.getChatById(chatId);
  const messages = await chat.fetchMessages({ limit });
  messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return {
    chatId,
    nome: chat.name || chat.formattedTitle || chatId,
    total: messages.length,
    mensagens: messages.map(formatarMensagemApi)
  };
}

async function enviarMensagem(client, chatIdRaw, texto) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const mensagem = String(texto || '').trim();
  if (!mensagem) throw new Error('Mensagem vazia');
  const chatId = await resolverChatId(client, chatIdRaw);
  await client.sendMessage(chatId, mensagem);
  invalidarCacheConversas();
  return { chatId, enviado: true };
}

async function obterEstadoChat(client, chatIdRaw) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const chatId = await resolverChatId(client, chatIdRaw);
  const identity = await whatsappIdentityService.resolverIdentidadeCliente(client, chatId);
  const maps = await carregarMapaContatos();
  const contato = acharContato(maps, chatId, identity);
  const executor = acharSessaoFluxo(chatId, identity);
  const campanhaHit = sessaoCampanhaService.getSessaoPorChatId(chatId);

  let logs = [];
  try {
    logs = await fluxoLogService.listarLogsPorContato(
      identity.widDigitosTelefone || chatId,
      30,
      { whatsappLid: identity.whatsappLid || undefined }
    );
  } catch (_) {
    logs = [];
  }

  return {
    chatId,
    identity,
    contato,
    fluxo: executor ? {
      id: executor.fluxo?.id,
      nome: executor.fluxo?.nome,
      tipo: executor.fluxo?.tipo,
      node_atual: executor.currentNodeId,
      aguardando_resposta: executor.aguardandoResposta,
      aguardando_contatos: executor.aguardandoContatos,
      variaveis: executor.variaveis || {}
    } : null,
    campanha: campanhaHit ? {
      chatId: campanhaHit.chatId,
      etapa: campanhaHit.sessao.etapa,
      subEtapa: campanhaHit.sessao.subEtapa,
      descontoTotal: campanhaHit.sessao.descontoTotal,
      bairro: campanhaHit.sessao.bairro
    } : null,
    logs_recentes: logs.slice(0, 15)
  };
}

async function iniciarFluxoNoChat(client, chatIdRaw, fluxoId, opts = {}) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const chatId = await resolverChatId(client, chatIdRaw);
  const fluxo = await fluxoService.getFluxoPorId(fluxoId);
  if (!fluxo) throw new Error('Fluxo não encontrado');
  if (fluxo.tipo === 'automacao') throw new Error('Automações não rodam em chat WhatsApp');
  if (!fluxo.ativo) throw new Error('Fluxo está inativo');

  const encerrarAtual = opts.encerrarAtual !== false;
  const limparCampanha = opts.limparCampanha === true;

  const identity = await whatsappIdentityService.resolverIdentidadeCliente(client, chatId);
  const keys = [chatId, identity.chatIdCanonicoCUs, identity.whatsappLid].filter(Boolean);

  if (limparCampanha) {
    for (const k of keys) sessaoCampanhaService.delete(k);
    const hit = sessaoCampanhaService.getSessaoPorChatId(chatId);
    if (hit) sessaoCampanhaService.delete(hit.chatId);
  }

  const temFluxo = keys.some((k) => fluxoExecutor.temFluxoAtivo(k));
  if (temFluxo) {
    if (!encerrarAtual) throw new Error('Chat já possui fluxo ativo. Use encerrarAtual: true');
    for (const k of keys) fluxoExecutor.encerrarFluxo(k);
  }

  await fluxoExecutor.iniciarFluxo(client, chatId, fluxo);
  invalidarCacheConversas();
  return { chatId, fluxo: { id: fluxo.id, nome: fluxo.nome } };
}

async function encerrarFluxoNoChat(client, chatIdRaw) {
  const chatId = await resolverChatId(client, chatIdRaw);
  const identity = await whatsappIdentityService.resolverIdentidadeCliente(client, chatId);
  const keys = [chatId, identity.chatIdCanonicoCUs, identity.whatsappLid].filter(Boolean);
  let encerrados = 0;
  for (const k of keys) {
    if (fluxoExecutor.temFluxoAtivo(k)) {
      fluxoExecutor.encerrarFluxo(k);
      encerrados++;
    }
  }
  invalidarCacheConversas();
  return { chatId, encerrados: encerrados > 0 };
}

module.exports = {
  listarConversas,
  obterMensagens,
  enviarMensagem,
  obterEstadoChat,
  iniciarFluxoNoChat,
  encerrarFluxoNoChat,
  invalidarCacheConversas,
  resolverChatId
};
