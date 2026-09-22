'use strict';

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('./telefoneService');
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
let cacheChatsMap = new Map();
let cacheConversasTs = 0;
const CACHE_TTL_MS = 15000;

function normalizarDigitos(id) {
  return whatsappIdentityService.apenasDigitos(id);
}

function invalidarCacheConversas() {
  cacheConversas = null;
  cacheChatsMap = new Map();
  cacheConversasTs = 0;
}

async function garantirCacheChats(client) {
  const now = Date.now();
  if (cacheConversas && now - cacheConversasTs <= CACHE_TTL_MS) return cacheConversas;
  const chats = await client.getChats();
  cacheConversas = chats.filter((c) => {
    const id = c.id?._serialized || '';
    return !c.isGroup && id !== 'status@broadcast' && !id.includes('@g.us');
  });
  cacheChatsMap = new Map();
  for (const c of cacheConversas) {
    cacheChatsMap.set(c.id._serialized, c);
  }
  cacheConversasTs = now;
  return cacheConversas;
}

function ordenarChatsWhatsApp(chats) {
  return [...chats].sort((a, b) => {
    const ua = Number(a.unreadCount) || 0;
    const ub = Number(b.unreadCount) || 0;
    if (ua > 0 && ub === 0) return -1;
    if (ub > 0 && ua === 0) return 1;
    if (ua !== ub) return ub - ua;
    return (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0);
  });
}

async function montarCandidatosChatId(client, preferido) {
  const raw = String(preferido || '').trim();
  const candidatos = [];
  const add = (id) => {
    if (id && !candidatos.includes(id)) candidatos.push(id);
  };

  add(raw);
  if (!raw.includes('@')) {
    const digs = normalizarDigitos(raw);
    if (digs.length >= 8) add(`${digs}@c.us`);
  }

  try {
    const identity = await whatsappIdentityService.resolverIdentidadeCliente(client, raw);
    add(identity.chatIdOriginal);
    add(identity.chatIdCanonicoCUs);
    add(identity.whatsappLid);
  } catch (_) {
    // ignora
  }

  return candidatos;
}

async function obterChatPorId(client, chatIdRaw) {
  const preferido = decodeURIComponent(String(chatIdRaw || '').trim());
  if (!preferido) throw new Error('chatId inválido');

  await garantirCacheChats(client);
  const candidatos = await montarCandidatosChatId(client, preferido);

  for (const id of candidatos) {
    if (cacheChatsMap.has(id)) {
      const chat = cacheChatsMap.get(id);
      return { chat, chatId: chat.id._serialized };
    }
  }

  const chats = await client.getChats();
  for (const id of candidatos) {
    const found = chats.find((c) => c.id._serialized === id);
    if (found) {
      cacheChatsMap.set(found.id._serialized, found);
      return { chat: found, chatId: found.id._serialized };
    }
  }

  for (const id of candidatos) {
    try {
      const chat = await client.getChatById(id);
      if (chat) {
        cacheChatsMap.set(chat.id._serialized, chat);
        return { chat, chatId: chat.id._serialized };
      }
    } catch (_) {
      // tenta próximo id
    }
  }

  throw new Error('Conversa não encontrada no WhatsApp');
}

async function resolverChatId(client, identificador) {
  const { chatId } = await obterChatPorId(client, identificador);
  return chatId;
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

function acharContatoRapido(maps, chatId) {
  const raw = String(chatId || '');
  if (raw.includes('@lid') && maps.mapByLid.has(raw)) return maps.mapByLid.get(raw);
  // Todas as formas do mesmo número (9º dígito, DDI): o contato pode estar gravado na outra.
  for (const d of telefone.variantes(raw)) {
    if (maps.mapByWid.has(d)) return maps.mapByWid.get(d);
  }
  const digs = normalizarDigitos(raw);
  if (digs && maps.mapByWid.has(digs)) return maps.mapByWid.get(digs);
  return null;
}

function chatEmFluxo(chatId, chatIdsEmFluxo) {
  return chatIdsEmFluxo.some((ch) => ch === chatId || telefone.mesmoNumero(ch, chatId));
}

function acharSessaoFluxo(chatId) {
  const keys = [chatId, ...telefone.chatIdsPossiveis(chatId), ...telefone.variantes(chatId)];
  const digs = normalizarDigitos(chatId);
  if (digs.length >= 8) {
    keys.push(`${digs}@c.us`, digs);
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
  const type = msg.type || 'chat';
  if (type === 'chat' || type === 'text') return msg.body || '';
  if (type === 'vcard' || type === 'multi_vcard') return '📇 Contato';
  if (type === 'image') return '📷 Imagem';
  if (type === 'video') return '🎬 Vídeo';
  if (type === 'audio' || type === 'ptt') return '🎤 Áudio';
  if (type === 'document') return '📄 Documento';
  if (type === 'sticker') return 'Sticker';
  if (type === 'location') return '📍 Localização';
  return `[${type}]`;
}

function formatarMensagemApiFromRaw(m) {
  const ts = m.timestamp || m.t;
  return {
    id: m.id?._serialized || m.id?.id || null,
    body: m.body || '',
    preview: formatarPreviewMensagem(m),
    fromMe: !!(m.fromMe ?? m.id?.fromMe),
    type: m.type || 'chat',
    timestamp: ts || null,
    dataHora: ts ? new Date(ts * 1000).toISOString() : null
  };
}

function formatarMensagemApi(msg) {
  if (!msg) return null;
  const ts = msg.timestamp ?? msg.t ?? null;
  return {
    id: msg.id?._serialized || msg.id?.id || null,
    body: msg.body || '',
    preview: formatarPreviewMensagem(msg),
    fromMe: !!(msg.fromMe ?? msg.id?.fromMe),
    type: msg.type || 'chat',
    timestamp: ts,
    dataHora: ts ? new Date(ts * 1000).toISOString() : null
  };
}

async function fetchMensagensSeguro(client, chat, limit) {
  const chatId = chat.id._serialized;
  const lim = Math.max(1, Math.min(100, limit));

  // Motor evolution não tem Puppeteer: vai direto ao fetchMessages do chat
  if (!client.pupPage) {
    try {
      const msgs = await chat.fetchMessages({ limit: lim });
      return msgs.map(formatarMensagemApi).filter(Boolean);
    } catch (e) {
      console.warn('⚠️ fetchMessages (evolution):', e.message);
      return [];
    }
  }

  try {
    const raw = await client.pupPage.evaluate(async (cid, max) => {
      try {
        const chatW = await window.WWebJS.getChat(cid, { getAsModel: false });
        if (!chatW || !chatW.msgs) return { ok: false, msgs: [] };
        const arr = chatW.msgs.getModelsArray().filter((m) => !m.isNotification);
        const slice = arr.slice(-max);
        return {
          ok: true,
          msgs: slice.map((m) => window.WWebJS.getMessageModel(m))
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err), msgs: [] };
      }
    }, chatId, lim);

    if (raw?.ok && Array.isArray(raw.msgs) && raw.msgs.length > 0) {
      return raw.msgs.map(formatarMensagemApiFromRaw);
    }
  } catch (e) {
    console.warn('⚠️ fetchMensagens in-memory:', e.message);
  }

  if (chat.lastMessage) {
    const one = formatarMensagemApi(chat.lastMessage);
    return one ? [one] : [];
  }

  try {
    const msgs = await chat.fetchMessages({ limit: Math.min(lim, 20) });
    if (msgs.length) return msgs.map(formatarMensagemApi).filter(Boolean);
  } catch (e) {
    console.warn('⚠️ fetchMessages fallback falhou:', e.message);
  }

  throw new Error('Não foi possível carregar mensagens desta conversa. O WhatsApp Web pode ainda estar sincronizando.');
}

async function listarConversas(client, opts = {}) {
  if (!client?.info) {
    return { connected: false, total: 0, totalNaoLidas: 0, data: [], error: 'WhatsApp não conectado' };
  }

  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 100));
  const search = String(opts.search || '').toLowerCase().trim();
  const somenteNaoLidas = opts.somenteNaoLidas === true || opts.somenteNaoLidas === 'true';

  const chatsBase = await garantirCacheChats(client);
  let filtradas = ordenarChatsWhatsApp(chatsBase);

  if (somenteNaoLidas) {
    filtradas = filtradas.filter((c) => (Number(c.unreadCount) || 0) > 0);
  }

  if (search) {
    filtradas = filtradas.filter((c) => {
      const nome = (c.name || c.formattedTitle || '').toLowerCase();
      const id = (c.id?._serialized || '').toLowerCase();
      const digs = normalizarDigitos(search);
      return nome.includes(search) || id.includes(search) || (digs && id.includes(digs));
    });
  }

  const totalNaoLidas = chatsBase.filter((c) => (Number(c.unreadCount) || 0) > 0).length;
  const maps = await carregarMapaContatos();
  const sessoesCampanha = sessaoCampanhaService.listarSessoes();
  const chatIdsEmFluxo = fluxoExecutor.getChatIdsEmFluxo ? fluxoExecutor.getChatIdsEmFluxo() : [];

  const data = [];
  for (const chat of filtradas.slice(0, limit)) {
    const chatId = chat.id._serialized;
    const contato = acharContatoRapido(maps, chatId);
    const executor = acharSessaoFluxo(chatId);
    const digs = normalizarDigitos(chatId);
    const campanha = sessoesCampanha.find((s) => {
      if (s.chatId === chatId) return true;
      return digs.length >= 8 && normalizarDigitos(s.chatId) === digs;
    });

    const last = chat.lastMessage;
    const naoLidas = Number(chat.unreadCount) || 0;
    data.push({
      chatId,
      nome: chat.name || chat.formattedTitle || contato?.nome || digs || chatId,
      naoLidas,
      temNaoLidas: naoLidas > 0,
      ultimaMensagem: formatarPreviewMensagem(last),
      ultimaMensagemEm: last?.timestamp ? new Date(last.timestamp * 1000).toISOString() : null,
      timestamp: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
      whatsapp_id: chatId.endsWith('@c.us') ? digs : (contato?.whatsapp_id || null),
      whatsapp_lid: chatId.includes('@lid') ? chatId : (contato?.whatsapp_lid || null),
      em_fluxo: chatEmFluxo(chatId, chatIdsEmFluxo),
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

  return { connected: true, total: filtradas.length, totalNaoLidas, data };
}

async function obterMensagens(client, chatIdRaw, opts = {}) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
  const marcarLida = opts.marcarLida !== false;

  const { chat, chatId } = await obterChatPorId(client, chatIdRaw);

  if (marcarLida && (Number(chat.unreadCount) || 0) > 0) {
    try {
      await chat.sendSeen();
      invalidarCacheConversas();
    } catch (e) {
      console.warn('⚠️ sendSeen:', e.message);
    }
  }

  const mensagens = await fetchMensagensSeguro(client, chat, limit);
  mensagens.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  return {
    chatId,
    nome: chat.name || chat.formattedTitle || chatId,
    total: mensagens.length,
    mensagens
  };
}

async function enviarMensagem(client, chatIdRaw, texto) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const mensagem = String(texto || '').trim();
  if (!mensagem) throw new Error('Mensagem vazia');
  const { chatId } = await obterChatPorId(client, chatIdRaw);
  await client.sendMessage(chatId, mensagem);
  invalidarCacheConversas();
  return { chatId, enviado: true };
}

async function obterEstadoChat(client, chatIdRaw) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const { chat, chatId } = await obterChatPorId(client, chatIdRaw);
  const identity = await whatsappIdentityService.resolverIdentidadeCliente(client, chatId);
  const maps = await carregarMapaContatos();
  const contato = acharContatoRapido(maps, chatId) || acharContatoRapido(maps, identity.whatsappLid);
  const executor = acharSessaoFluxo(chatId);
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
    naoLidas: Number(chat.unreadCount) || 0,
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
  const { chatId } = await obterChatPorId(client, chatIdRaw);
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
  const { chatId } = await obterChatPorId(client, chatIdRaw);
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

/**
 * Envia mensagem para um número mesmo sem conversa existente (ex.: indicados).
 * Resolve o WID via getNumberId, tentando variações com/sem DDI 55 e 9º dígito.
 */
async function enviarMensagemParaNumero(client, numeroRaw, texto) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const mensagem = String(texto || '').trim();
  if (!mensagem) throw new Error('Mensagem vazia');

  const digitos = normalizarDigitos(numeroRaw);
  if (digitos.length < 8) throw new Error('Número inválido');

  const candidatos = [digitos];
  if (!digitos.startsWith('55') && digitos.length <= 11) candidatos.push('55' + digitos);
  if (digitos.startsWith('55') && digitos.length === 12) {
    // BR sem 9º dígito: 55 + DDD (2) + 8 dígitos → tenta com 9
    candidatos.push(digitos.slice(0, 4) + '9' + digitos.slice(4));
  }

  let wid = null;
  for (const cand of candidatos) {
    try {
      wid = await client.getNumberId(cand);
      if (wid) break;
    } catch (_) {
      // tenta próximo candidato
    }
  }
  if (!wid) throw new Error('Número não encontrado no WhatsApp: ' + digitos);

  const chatId = wid._serialized;
  await client.sendMessage(chatId, mensagem);
  invalidarCacheConversas();
  return { chatId, enviado: true };
}

module.exports = {
  listarConversas,
  obterMensagens,
  enviarMensagem,
  enviarMensagemParaNumero,
  obterEstadoChat,
  iniciarFluxoNoChat,
  encerrarFluxoNoChat,
  invalidarCacheConversas,
  resolverChatId,
  obterChatPorId
};
