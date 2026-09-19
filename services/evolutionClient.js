'use strict';

/**
 * Adaptador Evolution API → interface compatível com whatsapp-web.js.
 * Permite trocar o motor do bot via WA_ENGINE=evolution no .env, sem reescrever
 * o pipeline (BotIApizzaria, fluxoExecutor, chatService, grupoWhatsappService).
 *
 * Implementa o subconjunto usado pelo projeto:
 *   Eventos: qr, ready, message, group_join, disconnected
 *   Client:  initialize, sendMessage, getNumberId, getContactById,
 *            getContactLidAndPhone, getChats, getChatById, info
 *   Msg:     reply, body, from, author, type, fromMe, vCards, timestamp
 *   Chat:    id, name, isGroup, unreadCount, participants, getInviteCode,
 *            fetchMessages, sendSeen (no-op), getLabels ([]), changeLabels (no-op)
 *
 * .env:
 *   EVOLUTION_URL             ex.: http://localhost:8033
 *   EVOLUTION_APIKEY          apikey global da Evolution
 *   EVOLUTION_INSTANCE        nome da instância (ex.: pizzaria)
 *   EVOLUTION_WEBHOOK_SECRET  segredo do endpoint /webhook/evolution/<secret>
 *   EVOLUTION_PUBLIC_URL      URL deste bot alcançável pela Evolution (ex.: http://vms.cutplay.com.br:3087)
 */

const EventEmitter = require('events');
const axios = require('axios');

const JID_CUS = /@s\.whatsapp\.net$/;

function paraCUs(jid) {
  if (!jid) return jid;
  return String(jid).replace(JID_CUS, '@c.us');
}

function paraEvolution(chatId) {
  const raw = String(chatId || '').trim();
  if (raw.endsWith('@g.us') || raw.endsWith('@lid')) return raw;
  return raw.replace(/\D/g, '') || raw;
}

function apenasDigitos(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function extrairTexto(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ''
  );
}

function mapearTipo(messageType) {
  switch (messageType) {
    case 'conversation':
    case 'extendedTextMessage':
      return 'chat';
    case 'contactMessage':
      return 'vcard';
    case 'contactsArrayMessage':
      return 'multi_vcard';
    case 'audioMessage':
      return 'audio';
    case 'imageMessage':
      return 'image';
    case 'videoMessage':
      return 'video';
    case 'documentMessage':
      return 'document';
    case 'pollUpdateMessage':
      return 'poll_response';
    default:
      return messageType || 'unknown';
  }
}

function extrairVcards(message) {
  if (!message) return [];
  if (message.contactMessage?.vcard) return [message.contactMessage.vcard];
  const arr = message.contactsArrayMessage?.contacts;
  if (Array.isArray(arr)) return arr.map((c) => c.vcard).filter(Boolean);
  return [];
}

class EvolutionClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.baseUrl = (config.baseUrl || process.env.EVOLUTION_URL || '').replace(/\/$/, '');
    this.apikey = config.apikey || process.env.EVOLUTION_APIKEY || '';
    this.instance = config.instance || process.env.EVOLUTION_INSTANCE || '';
    this.webhookSecret = config.webhookSecret || process.env.EVOLUTION_WEBHOOK_SECRET || '';
    this.publicUrl = (config.publicUrl || process.env.EVOLUTION_PUBLIC_URL || '').replace(/\/$/, '');

    this.ehEvolution = true;
    this.info = null;               // definido quando conectado (compatível com client.info)
    this.pupPage = undefined;       // inexistente de propósito (caminhos Store fazem fallback)

    this._lidParaPn = new Map();    // cache LID -> telefone (aprendido dos webhooks)
    this._chatsCache = null;
    this._chatsCacheEm = 0;
    this._gruposCache = null;
    this._gruposCacheEm = 0;
    this._participantesCache = new Map(); // groupJid -> { em, lista }
    this._pollTimer = null;
    this._estadoAtual = 'desconhecido';

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { apikey: this.apikey }
    });
  }

  _instPath(p) {
    return `${p}/${encodeURIComponent(this.instance)}`;
  }

  // ============================================================
  // Ciclo de vida / conexão
  // ============================================================

  async initialize() {
    if (!this.baseUrl || !this.apikey || !this.instance) {
      throw new Error('Evolution: configure EVOLUTION_URL, EVOLUTION_APIKEY e EVOLUTION_INSTANCE no .env');
    }
    console.log(`🔌 [Evolution] Iniciando adaptador (instância "${this.instance}")`);

    await this._registrarWebhook();
    await this._checarConexao(true);

    this._pollTimer = setInterval(() => {
      this._checarConexao(false).catch((e) => console.warn('⚠️ [Evolution] poll:', e.message));
    }, 20000);
    if (this._pollTimer.unref) this._pollTimer.unref();
  }

  async _registrarWebhook() {
    if (!this.publicUrl || !this.webhookSecret) {
      console.warn('⚠️ [Evolution] EVOLUTION_PUBLIC_URL/EVOLUTION_WEBHOOK_SECRET ausentes — webhook NÃO registrado (mensagens não chegarão).');
      return;
    }
    const url = `${this.publicUrl}/webhook/evolution/${this.webhookSecret}`;
    try {
      await this.http.post(this._instPath('/webhook/set'), {
        webhook: {
          enabled: true,
          url,
          byEvents: false,
          base64: false,
          events: [
            'MESSAGES_UPSERT',
            'GROUP_PARTICIPANTS_UPDATE',
            'GROUPS_UPSERT',
            'CONNECTION_UPDATE',
            'LABELS_ASSOCIATION'
          ]
        }
      });
      console.log(`✅ [Evolution] Webhook registrado: ${url}`);
    } catch (e) {
      console.error('❌ [Evolution] Falha ao registrar webhook:', e.response?.data?.response?.message || e.message);
    }
  }

  async _checarConexao(primeiraVez) {
    let estado = 'close';
    try {
      const { data } = await this.http.get(this._instPath('/instance/connectionState'));
      estado = data?.instance?.state || data?.state || 'close';
    } catch (e) {
      estado = 'erro';
    }

    if (estado === 'open' && this._estadoAtual !== 'open') {
      await this._carregarInfo();
      this._estadoAtual = 'open';
      this.emit('ready');
    } else if (estado !== 'open' && (this._estadoAtual === 'open' || primeiraVez)) {
      this._estadoAtual = estado;
      this.info = null;
      if (!primeiraVez) this.emit('disconnected', estado);
      await this._solicitarQr();
    } else {
      this._estadoAtual = estado;
    }
  }

  async _carregarInfo() {
    try {
      const { data } = await this.http.get('/instance/fetchInstances');
      const inst = (Array.isArray(data) ? data : []).find((i) => i.name === this.instance);
      const owner = paraCUs(inst?.ownerJid || '');
      this.info = {
        wid: { _serialized: owner, user: apenasDigitos(owner) },
        pushname: inst?.profileName || this.instance
      };
    } catch (_) {
      this.info = { wid: { _serialized: '', user: '' }, pushname: this.instance };
    }
  }

  async _solicitarQr() {
    try {
      const { data } = await this.http.get(this._instPath('/instance/connect'));
      const code = data?.code || data?.qrcode?.code;
      if (code) this.emit('qr', code);
    } catch (e) {
      console.warn('⚠️ [Evolution] connect/QR:', e.response?.data?.response?.message || e.message);
    }
  }

  async destroy() {
    if (this._pollTimer) clearInterval(this._pollTimer);
  }

  // ============================================================
  // Webhook (chamado pela rota /webhook/evolution/:secret)
  // ============================================================

  handleWebhook(body) {
    try {
      const evento = String(body?.event || '').toLowerCase();
      if (evento === 'messages.upsert') return this._onMensagem(body.data);
      if (evento === 'group-participants.update') return this._onGrupoUpdate(body.data);
      if (evento === 'connection.update') return this._onConnectionUpdate(body.data);
    } catch (e) {
      console.error('❌ [Evolution] webhook handler:', e.message);
    }
  }

  _aprenderLid(lid, phoneJid) {
    const l = String(lid || '');
    const pn = apenasDigitos(phoneJid);
    if (l.endsWith('@lid') && pn.length >= 8) this._lidParaPn.set(l, pn);
  }

  _onConnectionUpdate(data) {
    const estado = data?.state || data?.connection || '';
    if (estado === 'open' && this._estadoAtual !== 'open') {
      this._estadoAtual = 'open';
      this._carregarInfo().then(() => this.emit('ready'));
    } else if ((estado === 'close' || estado === 'connecting') && this._estadoAtual === 'open') {
      this._estadoAtual = estado;
      this.info = null;
      this.emit('disconnected', estado);
    }
  }

  _onMensagem(data) {
    if (!data?.key) return;
    const key = data.key;
    const message = data.message || {};

    // Aprende LID→PN quando o payload traz os dois
    if (key.remoteJid && key.remoteJidAlt) this._aprenderLid(key.remoteJid, key.remoteJidAlt);
    if (key.participant && key.participantAlt) this._aprenderLid(key.participant, key.participantAlt);
    if (data.sender && key.remoteJid?.endsWith?.('@lid')) this._aprenderLid(key.remoteJid, data.sender);

    const from = paraCUs(key.remoteJid);
    const tipo = mapearTipo(data.messageType);
    const vCards = extrairVcards(message);
    const body = extrairTexto(message) || (vCards.length ? vCards.join('\n') : '');
    const self = this;

    if (!key.fromMe) {
      console.log(`📩 [Evolution] msg recebida de ${from} (${tipo})`);
    }

    // Mantém o cache de chats vivo: a conversa sobe na lista e ganha não-lida
    this._tocarChatNoCache(from, data.pushName, !key.fromMe);

    const msg = {
      id: { _serialized: key.id || '' },
      from,
      to: this.info?.wid?._serialized || '',
      author: key.participant ? paraCUs(key.participant) : undefined,
      body,
      type: tipo,
      fromMe: !!key.fromMe,
      hasMedia: ['image', 'video', 'audio', 'document'].includes(tipo),
      timestamp: Number(data.messageTimestamp) || Math.floor(Date.now() / 1000),
      vCards,
      _pushName: data.pushName || null,
      async reply(texto) {
        return self.sendMessage(from, texto, { quotedKey: key });
      },
      async getChat() {
        return self.getChatById(from);
      }
    };

    this.emit('message', msg);
  }

  _onGrupoUpdate(data) {
    if (!data?.id) return;
    const action = data.action || '';
    const participantes = Array.isArray(data.participants) ? data.participants : [];

    // Alimenta o cache LID→PN com participantsData/participants
    for (const p of participantes) {
      if (p && typeof p === 'object') this._aprenderLid(p.id, p.phoneNumber);
    }
    if (Array.isArray(data.participantsData)) {
      for (const pd of data.participantsData) this._aprenderLid(pd?.jid?.id, pd?.jid?.phoneNumber);
    }

    if (action !== 'add') return;

    // recipientIds no formato que o handler espera (prefere telefone real)
    const recipientIds = participantes
      .map((p) => {
        if (p && typeof p === 'object') {
          const pn = apenasDigitos(p.phoneNumber);
          if (pn.length >= 8) return `${pn}@c.us`;
          return paraCUs(p.id);
        }
        return paraCUs(p);
      })
      .filter(Boolean);

    this.emit('group_join', {
      chatId: data.id,
      recipientIds,
      author: data.author ? paraCUs(data.author) : null
    });
  }

  // ============================================================
  // Envio / consultas
  // ============================================================

  async sendMessage(chatId, content, opts = {}) {
    const texto = typeof content === 'string' ? content : String(content?.body || content || '');
    if (!texto.trim()) throw new Error('Mensagem vazia');
    const number = paraEvolution(chatId);

    const payload = { number, text: texto };
    if (opts.quotedKey?.id) {
      payload.quoted = { key: opts.quotedKey };
    }

    const { data } = await this.http.post(this._instPath('/message/sendText'), payload);
    return { id: { _serialized: data?.key?.id || '' }, ack: 1 };
  }

  async getNumberId(numero) {
    const digs = apenasDigitos(numero);
    if (digs.length < 8) return null;
    try {
      const { data } = await this.http.post(this._instPath('/chat/whatsappNumbers'), { numbers: [digs] });
      const first = Array.isArray(data) ? data[0] : null;
      if (first && first.exists && first.jid) {
        const jid = paraCUs(first.jid);
        return { _serialized: jid, user: apenasDigitos(jid) };
      }
      return null;
    } catch (e) {
      console.warn('⚠️ [Evolution] whatsappNumbers:', e.response?.data?.response?.message || e.message);
      return null;
    }
  }

  async getContactById(id) {
    const raw = String(id || '').trim();
    let numero = null;

    if (raw.endsWith('@c.us') || raw.endsWith('@s.whatsapp.net')) {
      numero = apenasDigitos(raw);
    } else if (raw.endsWith('@lid')) {
      numero = this._lidParaPn.get(raw) || null;
    } else if (apenasDigitos(raw).length >= 8) {
      numero = apenasDigitos(raw);
    }

    return {
      id: { _serialized: raw, user: numero || apenasDigitos(raw) },
      number: numero,
      pushname: null,
      name: null
    };
  }

  async getContactLidAndPhone(ids) {
    const out = [];
    for (const raw of Array.isArray(ids) ? ids : [ids]) {
      const id = String(raw || '').trim();
      if (id.endsWith('@lid')) {
        const pn = this._lidParaPn.get(id);
        out.push(pn ? { lid: id, pn: `${pn}@c.us` } : { lid: id, pn: null });
      } else {
        const digs = apenasDigitos(id);
        out.push({ lid: null, pn: digs ? `${digs}@c.us` : null });
      }
    }
    return out;
  }

  // ============================================================
  // Chats (chatService / grupoWhatsappService)
  // ============================================================

  /** Atualiza (ou cria) a entrada da conversa no cache quando chega mensagem via webhook. */
  _tocarChatNoCache(chatId, pushName, incrementarNaoLida) {
    if (!this._chatsCache) return;
    const agora = Math.floor(Date.now() / 1000);
    let chat = this._chatsCache.find((c) => c.id._serialized === chatId);
    if (!chat) {
      chat = this._criarChatObj({ chatId, nome: pushName || chatId, timestamp: agora });
      this._chatsCache.push(chat);
    }
    chat.timestamp = agora;
    if (incrementarNaoLida) chat.unreadCount = (Number(chat.unreadCount) || 0) + 1;
    if (pushName && (!chat.name || chat.name === chatId)) {
      chat.name = pushName;
      chat.formattedTitle = pushName;
    }
  }

  _criarChatObj(base) {
    const self = this;
    const chatId = base.chatId;
    return {
      id: { _serialized: chatId },
      name: base.nome || chatId,
      formattedTitle: base.nome || chatId,
      isGroup: chatId.endsWith('@g.us'),
      unreadCount: Number(base.naoLidas) || 0,
      timestamp: base.timestamp || 0,
      participants: base.participants || [],
      async getInviteCode() {
        const { data } = await self.http.get(
          self._instPath('/group/inviteCode') + `?groupJid=${encodeURIComponent(chatId)}`
        );
        return data?.inviteCode || null;
      },
      async fetchMessages(opts = {}) {
        return self._buscarMensagens(chatId, opts.limit || 50);
      },
      async sendSeen() {
        this.unreadCount = 0;
        return true;
      },
      async getLabels() { return []; },
      async changeLabels() {
        console.warn('⚠️ [Evolution] etiquetas ainda não suportadas neste motor');
        return false;
      }
    };
  }

  async _participantesGrupo(groupJid) {
    // Cache 5 min por grupo: o WhatsApp aplica rate limit agressivo em metadados de grupo
    const hit = this._participantesCache.get(groupJid);
    if (hit && Date.now() - hit.em < 300000) return hit.lista;
    try {
      const { data } = await this.http.get(
        this._instPath('/group/participants') + `?groupJid=${encodeURIComponent(groupJid)}`
      );
      const lista = data?.participants || [];
      const mapeada = lista.map((p) => {
        this._aprenderLid(p.id, p.phoneNumber);
        const pn = apenasDigitos(p.phoneNumber);
        return {
          id: { _serialized: pn ? `${pn}@c.us` : paraCUs(p.id) },
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin'
        };
      });
      this._participantesCache.set(groupJid, { em: Date.now(), lista: mapeada });
      return mapeada;
    } catch (e) {
      console.warn(`⚠️ [Evolution] participantes de ${groupJid}:`, e.response?.data?.response?.message || e.message);
      // Cacheia o vazio por 1 min para não martelar durante rate limit
      this._participantesCache.set(groupJid, { em: Date.now() - 240000, lista: [] });
      return [];
    }
  }

  async _buscarGrupos() {
    // Grupos mudam pouco: cache de 5 min. Participantes NÃO são buscados aqui
    // (em conta grande isso levava minutos) — `participants` vira placeholder com
    // o tamanho certo (Array(size)), suficiente para contagens; a lista real vem
    // por getChatById(grupo) quando algum fluxo precisar (ex.: exportar CSV).
    if (this._gruposCache && Date.now() - this._gruposCacheEm < 300000) return this._gruposCache;
    try {
      const { data } = await this.http.get(
        this._instPath('/group/fetchAllGroups') + '?getParticipants=false',
        { timeout: 45000 }
      );
      const grupos = (Array.isArray(data) ? data : []).map((g) => this._criarChatObj({
        chatId: g.id,
        nome: g.subject || g.id,
        participants: new Array(Number(g.size) || 0),
        timestamp: g.creation || 0
      }));
      this._gruposCache = grupos;
      this._gruposCacheEm = Date.now();
      return grupos;
    } catch (e) {
      console.warn('⚠️ [Evolution] fetchAllGroups:', e.response?.data?.response?.message || e.message);
      return this._gruposCache || [];
    }
  }

  async _buscarConversas() {
    try {
      const { data } = await this.http.post(this._instPath('/chat/findChats'), {}, { timeout: 45000 });
      const lista = Array.isArray(data) ? data : (data?.records || []);
      const out = [];
      for (const c of lista) {
        const jid = c.remoteJid || c.id;
        if (!jid || String(jid).endsWith('@g.us')) continue;
        out.push(this._criarChatObj({
          chatId: paraCUs(jid),
          nome: c.pushName || c.name || paraCUs(jid),
          naoLidas: c.unreadCount || c.unreadMessages || 0,
          timestamp: c.updatedAt ? Math.floor(new Date(c.updatedAt).getTime() / 1000) : 0
        }));
      }
      return out;
    } catch (e) {
      console.warn('⚠️ [Evolution] findChats:', e.response?.data?.response?.message || e.message);
      return [];
    }
  }

  async getChats() {
    // cache curto para evitar marteladas (chatService chama com frequência)
    if (this._chatsCache && Date.now() - this._chatsCacheEm < 45000) return this._chatsCache;

    const [grupos, conversas] = await Promise.all([this._buscarGrupos(), this._buscarConversas()]);
    const chats = [...grupos, ...conversas];

    this._chatsCache = chats;
    this._chatsCacheEm = Date.now();
    return chats;
  }

  async getChatById(chatId) {
    const id = String(chatId || '').trim();
    if (!id) throw new Error('chatId inválido');

    if (this._chatsCache) {
      const hit = this._chatsCache.find((c) => c.id._serialized === id);
      if (hit) return hit;
    }

    // Fabrica chat mínimo (equivalente ao comportamento do wwebjs para DMs)
    if (id.endsWith('@g.us')) {
      const participants = await this._participantesGrupo(id);
      return this._criarChatObj({ chatId: id, nome: id, participants });
    }
    return this._criarChatObj({ chatId: paraCUs(id) });
  }

  async _buscarMensagens(chatId, limit) {
    const remoteJid = chatId.endsWith('@g.us') || chatId.endsWith('@lid')
      ? chatId
      : `${apenasDigitos(chatId)}@s.whatsapp.net`;
    try {
      const { data } = await this.http.post(this._instPath('/chat/findMessages'), {
        where: { key: { remoteJid } },
        limit: Math.max(1, Math.min(100, limit))
      });
      const registros = data?.messages?.records || data?.records || (Array.isArray(data) ? data : []);
      return registros.map((r) => ({
        id: { _serialized: r?.key?.id || '' },
        body: extrairTexto(r?.message) || '',
        fromMe: !!r?.key?.fromMe,
        type: mapearTipo(r?.messageType),
        hasMedia: false,
        timestamp: Number(r?.messageTimestamp) || 0,
        author: r?.key?.participant ? paraCUs(r.key.participant) : undefined
      }));
    } catch (e) {
      console.warn('⚠️ [Evolution] findMessages:', e.response?.data?.response?.message || e.message);
      return [];
    }
  }
}

module.exports = { EvolutionClient };
