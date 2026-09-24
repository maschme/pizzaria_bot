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
  cachePessoas = null;
}

// ============================================================
// Uma pessoa, várias conversas
// ============================================================
//
// O WhatsApp pode manter mais de uma conversa para o mesmo cliente: uma com o número sem o 9º
// dígito (como a conta dele foi registrada), outra com o 9 (aberta pelo bot a partir do número do
// pedido), outra pela conta @lid. Na tela isso virava duas ou três entradas — uma com o nome, outra
// com o id, outra com o número. Aqui elas são juntadas numa "pessoa": a lista mostra uma entrada
// e, ao abrir, as mensagens de todas as conversas aparecem juntas, em ordem.
//
// Como saber que é a mesma pessoa:
//   - números: mesma forma curta (telefone.formaCurta), ou seja, iguais a menos do 9º dígito
//   - @lid: pelo telefone ligado a ele em contatos.whatsapp_lid, ou pelo que o motor do WhatsApp
//     souber (getContactLidAndPhone). O que o motor ensinar fica gravado em contatos, para não
//     depender da memória dele depois de reiniciar.
// Nome igual NÃO junta: dois "João" são duas pessoas.

let cachePessoas = null;
/** @lid → dígitos do telefone, aprendido do motor. null = motor não sabe (reconsulta depois). */
const lidParaPn = new Map();
const LID_NEGATIVO_TTL_MS = 5 * 60 * 1000;

function pareceNome(s) {
  const t = String(s == null ? '' : s).trim();
  return !!t && !t.includes('@') && /\p{L}/u.test(t);
}

/** Grava o @lid aprendido no contato que já existe com aquele telefone (não cria contato). */
async function gravarLidsAprendidos(pares) {
  if (!pares.length) return;
  const conn = await mysql.createConnection(dbConn);
  try {
    for (const { lid, pn } of pares) {
      const alvo = telefone.clausulaIn('whatsapp_id', pn);
      if (!alvo) continue;
      await conn.execute(
        `UPDATE contatos SET whatsapp_lid = ?
          WHERE ${alvo.sql} AND (whatsapp_lid IS NULL OR whatsapp_lid = '')`,
        [lid, ...alvo.params]
      );
    }
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_FIELD_ERROR') {
      console.warn('⚠️ Gravar @lid aprendido:', e.message);
    }
  } finally {
    await conn.end().catch(() => {});
  }
}

/** Telefone (dígitos) de cada @lid da lista, quando se sabe. */
async function resolverLids(client, lids, maps) {
  const resultado = new Map();
  const perguntar = [];
  const agora = Date.now();
  for (const lid of lids) {
    const contato = maps.mapByLid.get(lid);
    if (contato && contato.whatsapp_id) {
      resultado.set(lid, normalizarDigitos(contato.whatsapp_id));
      continue;
    }
    const cache = lidParaPn.get(lid);
    if (cache && cache.pn) resultado.set(lid, cache.pn);
    else if (!cache || agora - cache.em > LID_NEGATIVO_TTL_MS) perguntar.push(lid);
  }

  if (perguntar.length && client && typeof client.getContactLidAndPhone === 'function') {
    const aprendidos = [];
    try {
      const res = await client.getContactLidAndPhone(perguntar);
      const lista = Array.isArray(res) ? res : [];
      perguntar.forEach((lid, i) => {
        const pn = normalizarDigitos(lista[i] && lista[i].pn);
        if (pn.length >= 10 && !telefone.ehLid(lista[i].pn)) {
          lidParaPn.set(lid, { pn, em: agora });
          resultado.set(lid, pn);
          aprendidos.push({ lid, pn });
        } else {
          lidParaPn.set(lid, { pn: null, em: agora });
        }
      });
    } catch (_) {
      for (const lid of perguntar) lidParaPn.set(lid, { pn: null, em: agora });
    }
    gravarLidsAprendidos(aprendidos).catch(() => {});
  }
  return resultado;
}

/**
 * Agrupa as conversas por pessoa.
 * @returns {Promise<{pessoas: Object[], porChatId: Map<string, Object>}>}
 */
async function agruparPorPessoa(client, chats) {
  const maps = await carregarMapaContatos();
  const lids = chats.map((c) => c.id._serialized).filter((id) => telefone.ehLid(id));
  const pnDoLid = await resolverLids(client, lids, maps);

  const porChave = new Map();
  for (const chat of chats) {
    const id = chat.id._serialized;
    const pn = telefone.ehLid(id) ? (pnDoLid.get(id) || '') : normalizarDigitos(id);
    const curta = pn ? telefone.formaCurta(pn) : '';
    const chave = curta ? `n:${curta}` : `id:${id}`;
    if (!porChave.has(chave)) porChave.set(chave, { pn: '', chats: [] });
    const p = porChave.get(chave);
    p.chats.push(chat);
    if (pn && (!p.pn || pn.length > p.pn.length)) p.pn = pn; // prefere a forma com o 9º dígito
  }

  const pessoas = [];
  const porChatId = new Map();
  for (const p of porChave.values()) {
    const membros = [...p.chats].sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
    const principal = membros[0];
    const ids = membros.map((c) => c.id._serialized);

    let contato = null;
    for (const ref of [...ids, p.pn]) {
      contato = ref ? acharContatoRapido(maps, ref) : null;
      if (contato) break;
    }

    const nomeWhatsapp = membros.map((c) => c.name || c.formattedTitle).find(pareceNome) || null;
    const lastMessage = membros.map((c) => c.lastMessage).filter(Boolean)
      .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))[0] || null;

    // Onde responder: a conversa em que o cliente escreveu por último. A mais recente pode ser uma
    // que o bot abriu pelo número do pedido (com o 9º dígito), e não a que o WhatsApp dele usa.
    const ultimaDoCliente = membros
      .filter((c) => c.lastMessage && !c.lastMessage.fromMe && !(c.lastMessage.id && c.lastMessage.id.fromMe))
      .sort((a, b) => (Number(b.lastMessage.timestamp) || 0) - (Number(a.lastMessage.timestamp) || 0))[0];

    const pessoa = {
      principal,
      destino: ultimaDoCliente || principal,
      chats: membros,
      chatIds: ids,
      pn: p.pn || (contato && contato.whatsapp_id ? normalizarDigitos(contato.whatsapp_id) : ''),
      lid: ids.find((id) => telefone.ehLid(id)) || (contato && contato.whatsapp_lid) || null,
      contato,
      // Nome do cadastro (pedido) primeiro: o perfil do WhatsApp costuma ser apelido ou vazio.
      nome: (contato && pareceNome(contato.nome) && String(contato.nome).trim())
        || nomeWhatsapp
        || p.pn
        || principal.name || principal.formattedTitle || ids[0],
      nomeWhatsapp,
      unreadCount: membros.reduce((s, c) => s + (Number(c.unreadCount) || 0), 0),
      timestamp: Number(principal.timestamp) || 0,
      lastMessage
    };
    pessoas.push(pessoa);
    for (const id of ids) porChatId.set(id, pessoa);
  }
  return { pessoas, porChatId, maps };
}

async function garantirPessoas(client) {
  const chats = await garantirCacheChats(client);
  if (cachePessoas && cachePessoas.base === chats) return cachePessoas;
  cachePessoas = { base: chats, ...(await agruparPorPessoa(client, chats)) };
  return cachePessoas;
}

/** A "pessoa" (conversas juntadas) de um chatId, ou null se não estiver na lista. */
async function pessoaDoChat(client, chatId) {
  try {
    const { porChatId } = await garantirPessoas(client);
    return porChatId.get(chatId) || null;
  } catch (e) {
    console.warn('⚠️ Agrupar conversas:', e.message);
    return null;
  }
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

  const { pessoas } = await garantirPessoas(client);
  let filtradas = ordenarChatsWhatsApp(pessoas);

  if (somenteNaoLidas) {
    filtradas = filtradas.filter((p) => p.unreadCount > 0);
  }

  if (search) {
    const digs = normalizarDigitos(search);
    filtradas = filtradas.filter((p) => {
      const nomes = [p.nome, p.nomeWhatsapp, ...p.chats.map((c) => c.name || c.formattedTitle)];
      if (nomes.some((n) => String(n || '').toLowerCase().includes(search))) return true;
      const ids = [...p.chatIds, p.pn].map((x) => String(x || '').toLowerCase());
      if (ids.some((id) => id.includes(search))) return true;
      // Número digitado com ou sem o 9º dígito encontra a pessoa nas duas formas.
      return digs.length >= 4 && ids.some((id) => id.includes(digs)
        || (digs.length >= 10 && telefone.mesmoNumero(id, digs)));
    });
  }

  const totalNaoLidas = pessoas.filter((p) => p.unreadCount > 0).length;
  const sessoesCampanha = sessaoCampanhaService.listarSessoes();
  const chatIdsEmFluxo = fluxoExecutor.getChatIdsEmFluxo ? fluxoExecutor.getChatIdsEmFluxo() : [];

  const data = [];
  for (const p of filtradas.slice(0, limit)) {
    const chatId = p.principal.id._serialized;
    const refs = [...p.chatIds, p.pn ? `${p.pn}@c.us` : null].filter(Boolean);
    const contato = p.contato;
    const executor = refs.map((r) => acharSessaoFluxo(r)).find(Boolean) || null;
    const campanha = sessoesCampanha.find((s) => refs.some((r) => s.chatId === r
      || (!telefone.ehLid(r) && telefone.mesmoNumero(s.chatId, r))));

    const last = p.lastMessage;
    data.push({
      chatId,
      chatIds: p.chatIds,
      conversasUnificadas: p.chatIds.length,
      nome: p.nome,
      nomeWhatsapp: p.nomeWhatsapp,
      naoLidas: p.unreadCount,
      temNaoLidas: p.unreadCount > 0,
      ultimaMensagem: formatarPreviewMensagem(last),
      ultimaMensagemEm: last?.timestamp ? new Date(last.timestamp * 1000).toISOString() : null,
      timestamp: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : null,
      whatsapp_id: (contato && contato.whatsapp_id) || p.pn || null,
      whatsapp_lid: p.lid,
      em_fluxo: refs.some((r) => chatEmFluxo(r, chatIdsEmFluxo)),
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
  const pessoa = await pessoaDoChat(client, chatId);
  const membros = pessoa ? pessoa.chats : [chat];

  if (marcarLida) {
    let marcou = false;
    for (const c of membros) {
      if ((Number(c.unreadCount) || 0) === 0) continue;
      try {
        await c.sendSeen();
        marcou = true;
      } catch (e) {
        console.warn('⚠️ sendSeen:', e.message);
      }
    }
    if (marcou) invalidarCacheConversas();
  }

  // Mensagens de todas as conversas da mesma pessoa, numa linha do tempo só.
  const vistas = new Set();
  const mensagens = [];
  for (const c of membros) {
    for (const m of await fetchMensagensSeguro(client, c, limit)) {
      if (m.id && vistas.has(m.id)) continue;
      if (m.id) vistas.add(m.id);
      mensagens.push(m);
    }
  }
  mensagens.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const ultimas = mensagens.slice(-limit);

  return {
    chatId: pessoa ? pessoa.principal.id._serialized : chatId,
    chatIds: pessoa ? pessoa.chatIds : [chatId],
    nome: pessoa ? pessoa.nome : (chat.name || chat.formattedTitle || chatId),
    total: ultimas.length,
    mensagens: ultimas
  };
}

async function enviarMensagem(client, chatIdRaw, texto) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const mensagem = String(texto || '').trim();
  if (!mensagem) throw new Error('Mensagem vazia');
  const { chatId: resolvido } = await obterChatPorId(client, chatIdRaw);
  // Mesma pessoa em várias conversas: responde onde o cliente escreveu por último.
  const pessoa = await pessoaDoChat(client, resolvido);
  const chatId = pessoa ? pessoa.destino.id._serialized : resolvido;
  await client.sendMessage(chatId, mensagem);
  invalidarCacheConversas();
  return { chatId, enviado: true };
}

async function obterEstadoChat(client, chatIdRaw) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const { chat, chatId } = await obterChatPorId(client, chatIdRaw);
  const identity = await whatsappIdentityService.resolverIdentidadeCliente(client, chatId);
  const maps = await carregarMapaContatos();
  const pessoa = await pessoaDoChat(client, chatId);
  const contato = acharContatoRapido(maps, chatId) || acharContatoRapido(maps, identity.whatsappLid)
    || (pessoa && pessoa.contato) || null;
  const executor = acharSessaoFluxo(chatId);
  const campanhaHit = sessaoCampanhaService.getSessaoPorChatId(chatId);

  let logs = [];
  try {
    logs = await fluxoLogService.listarLogsPorContato(
      identity.widDigitosTelefone || (pessoa && pessoa.pn) || chatId,
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
  obterChatPorId,
  carregarMapaContatos,
  acharContatoRapido
};
