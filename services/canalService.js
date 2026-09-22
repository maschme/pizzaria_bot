'use strict';

/**
 * Canais de aquisição (docs/16-canais-e-funil.md): CRUD, geração de link wa.me/QR
 * e atribuição de origem no primeiro contato do cliente.
 */

const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const { dbConfig } = require('../database/connection');
const telefone = require('./telefoneService');
const contatoIdService = require('./contatoIdService');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

let cacheCanaisAtivos = null;
let cacheCanaisEm = 0;

function normalizar(texto) {
  return String(texto || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function apenasDigitos(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

function invalidarCache() {
  cacheCanaisAtivos = null;
}

function montarLink(numeroBot, mensagemEntrada) {
  const digs = apenasDigitos(numeroBot);
  if (!digs) return null;
  return `https://wa.me/${digs}?text=${encodeURIComponent(mensagemEntrada)}`;
}

// ============================================================
// CRUD
// ============================================================

async function listarCanais() {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    // Junta o fluxo apontado (nome/ativo) para a tela mostrar "fluxo inativo" e o nome na lista
    const [canais] = await conn.execute(
      `SELECT c.*, f.nome AS fluxo_nome, f.ativo AS fluxo_ativo
         FROM canais c LEFT JOIN fluxos f ON f.id = c.fluxo_id
        ORDER BY c.criado_em DESC`
    );
    // Contagem de contatos atribuídos por canal
    let contagens = [];
    try {
      const [rows] = await conn.execute(
        'SELECT canal_id, COUNT(*) AS total FROM contatos WHERE canal_id IS NOT NULL GROUP BY canal_id'
      );
      contagens = rows;
    } catch (_) { /* contatos pode não existir ainda */ }
    return canais.map((c) => ({
      ...c,
      contatos: Number(contagens.find((x) => x.canal_id === c.id)?.total || 0)
    }));
  } finally {
    await conn.end();
  }
}

/** Eventos que podem atribuir canal — os mesmos do gatilho por evento (docs/20 B0). */
const EVENTOS_CANAL = ['indicacao_registrada', 'pedido_concluido'];

function eventoOuNull(v) {
  const e = String(v || '').trim();
  return EVENTOS_CANAL.includes(e) ? e : null;
}

function fluxoIdOuNull(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function criarCanal({ nome, slug, tipo, mensagem_entrada, evento, fluxo_id, ativo = true }) {
  const eventoFinal = eventoOuNull(evento);
  // Canal de evento (indicado, pós-venda) não tem frase de entrada: o bot é quem inicia a conversa.
  if (!nome || (!mensagem_entrada && !eventoFinal)) throw new Error('nome e (mensagem de entrada ou evento) são obrigatórios');
  const slugFinal = normalizar(slug || nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove acentos
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!slugFinal) throw new Error('slug inválido');

  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [r] = await conn.execute(
      `INSERT INTO canais (nome, slug, tipo, mensagem_entrada, evento, fluxo_id, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nome.trim(), slugFinal, tipo || 'outro', eventoFinal ? null : mensagem_entrada.trim(), eventoFinal,
        eventoFinal ? null : fluxoIdOuNull(fluxo_id), ativo ? 1 : 0]
    );
    invalidarCache();
    return { id: r.insertId, slug: slugFinal };
  } finally {
    await conn.end();
  }
}

async function atualizarCanal(id, { nome, tipo, mensagem_entrada, evento, fluxo_id, ativo }) {
  const eventoFinal = eventoOuNull(evento);
  const conn = await mysql.createConnection(mysql2Config);
  try {
    await conn.execute(
      `UPDATE canais SET nome = ?, tipo = ?, mensagem_entrada = ?, evento = ?, fluxo_id = ?, ativo = ? WHERE id = ?`,
      [String(nome || '').trim(), tipo || 'outro', eventoFinal ? null : String(mensagem_entrada || '').trim(), eventoFinal,
        eventoFinal ? null : fluxoIdOuNull(fluxo_id), ativo ? 1 : 0, Number(id)]
    );
    invalidarCache();
    return { atualizado: true };
  } finally {
    await conn.end();
  }
}

async function excluirCanal(id) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    // Preserva a atribuição histórica? Não: contatos deste canal voltam a "orgânico".
    // Para manter histórico, prefira DESATIVAR o canal em vez de excluir.
    try {
      await conn.execute('UPDATE contatos SET canal_id = NULL, canal_atribuido_em = NULL WHERE canal_id = ?', [Number(id)]);
    } catch (_) { /* contatos pode não existir */ }
    const [r] = await conn.execute('DELETE FROM canais WHERE id = ?', [Number(id)]);
    invalidarCache();
    return { excluido: r.affectedRows > 0 };
  } finally {
    await conn.end();
  }
}

async function gerarQrCanal(id, numeroBot) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute('SELECT * FROM canais WHERE id = ? LIMIT 1', [Number(id)]);
    const canal = rows[0];
    if (!canal) throw new Error('Canal não encontrado');
    const link = montarLink(numeroBot, canal.mensagem_entrada);
    if (!link) throw new Error('WhatsApp não conectado — o link precisa do número do bot');
    const qrDataUrl = await QRCode.toDataURL(link, { width: 512, margin: 2 });
    return { canal: { id: canal.id, nome: canal.nome, slug: canal.slug }, link, qrDataUrl };
  } finally {
    await conn.end();
  }
}

// ============================================================
// Atribuição de origem (chamada no pipeline de mensagens)
// ============================================================

async function canaisAtivos() {
  if (cacheCanaisAtivos && Date.now() - cacheCanaisEm < 60000) return cacheCanaisAtivos;
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute('SELECT id, slug, nome, mensagem_entrada, fluxo_id FROM canais WHERE ativo = 1 AND mensagem_entrada IS NOT NULL');
    cacheCanaisAtivos = rows.map((c) => ({ id: c.id, slug: c.slug, nome: c.nome, fluxoId: c.fluxo_id || null, mensagemNorm: normalizar(c.mensagem_entrada) }));
    cacheCanaisEm = Date.now();
    return cacheCanaisAtivos;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Se a mensagem casa com um canal ativo, marca o contato (cria se não existir).
 * Nunca sobrescreve atribuição existente. Erros só logam.
 * @param {string} chatId - ex.: 5547...@c.us
 * @param {string} texto  - primeira mensagem recebida
 * @returns {{ id, slug, nome, fluxoId }|null} o canal que casou (fluxoId = fluxo que ele inicia, ou null)
 */
async function atribuirCanalSeCorresponder(chatId, texto) {
  try {
    const canais = await canaisAtivos();
    if (!canais.length) return null;

    const msgNorm = normalizar(texto);
    if (!msgNorm) return null;

    const canal = canais.find((c) => c.mensagemNorm && msgNorm.startsWith(c.mensagemNorm));
    if (!canal) return null;

    const wid = await contatoIdService.resolverIdGravavel(chatId);
    if (!wid) return null; // conta @lid ou número inválido: não vira whatsapp_id

    await marcarContatoComCanal(wid, canal.id);
    return { id: canal.id, slug: canal.slug, nome: canal.nome, fluxoId: canal.fluxoId };
  } catch (e) {
    console.warn('⚠️ Atribuição de canal falhou:', e.message);
    return null;
  }
}

/**
 * Atribui ao contato o canal daquele evento do sistema (ex.: 'indicacao_registrada'), se houver um
 * canal ativo configurado. É o par do casamento por mensagem: quem o bot aborda nunca manda a frase
 * do canal, então a origem viria vazia no funil. Nunca sobrescreve atribuição existente.
 * @returns {{ id, slug, nome }|null}
 */
async function atribuirCanalPorEvento(chatId, evento) {
  const nomeEvento = eventoOuNull(evento);
  if (!nomeEvento) return null;
  const wid = await contatoIdService.resolverIdGravavel(chatId);
  if (!wid) return null;

  let canal = null;
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      'SELECT id, slug, nome FROM canais WHERE evento = ? AND ativo = 1 LIMIT 1',
      [nomeEvento]
    );
    canal = rows[0] || null;
  } catch (e) {
    // Migração do canal por evento ainda não rodou nesta instância: segue sem atribuir.
    if (e.code !== 'ER_BAD_FIELD_ERROR' && e.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('⚠️ Canal por evento:', e.message);
    }
    return null;
  } finally {
    await conn.end();
  }

  if (!canal) return null;
  await marcarContatoComCanal(wid, canal.id);
  return canal;
}

/** Upsert do contato com canal — nunca sobrescreve atribuição existente. */
async function marcarContatoComCanal(widDigitos, canalId) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [r] = await conn.execute(
      `INSERT INTO contatos (whatsapp_id, canal_id, canal_atribuido_em)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         canal_id = IF(canal_id IS NULL, VALUES(canal_id), canal_id),
         canal_atribuido_em = IF(canal_atribuido_em IS NULL, NOW(), canal_atribuido_em)`,
      [widDigitos, canalId]
    );
    // affectedRows: 1 = contato novo, 2 = atualizado, 0 = já tinha canal (guarda preservou)
    if (r.affectedRows > 0) console.log(`📍 Canal atribuído: contato ${widDigitos} ← canal #${canalId}`);
  } finally {
    await conn.end();
  }
}

/**
 * Marcação ATIVA de canal (pós-venda/envios iniciados pelo bot ou operador).
 * @param {string} chatId - número ou chatId do destinatário
 * @param {number|string} canalRef - id numérico ou slug do canal
 * @returns {Promise<number|null>} id do canal aplicado (ou null)
 */
async function marcarCanal(chatId, canalRef) {
  try {
    if (!canalRef) return null;
    const wid = await contatoIdService.resolverIdGravavel(chatId);
    if (!wid) return null;

    const conn = await mysql.createConnection(mysql2Config);
    let canal;
    try {
      const porId = Number.isInteger(Number(canalRef)) && String(canalRef).trim() !== '' && !isNaN(Number(canalRef));
      const [rows] = porId
        ? await conn.execute('SELECT id FROM canais WHERE id = ? AND ativo = 1 LIMIT 1', [Number(canalRef)])
        : await conn.execute('SELECT id FROM canais WHERE slug = ? AND ativo = 1 LIMIT 1', [String(canalRef).trim()]);
      canal = rows[0];
    } finally {
      await conn.end();
    }
    if (!canal) return null;

    await marcarContatoComCanal(wid, canal.id);
    return canal.id;
  } catch (e) {
    console.warn('⚠️ marcarCanal falhou:', e.message);
    return null;
  }
}

// ============================================================
// Funil por canal (docs/16-canais-e-funil.md, etapa 2)
// ============================================================

/**
 * Funil de conversão agrupado por canal.
 * Etapas: chegou → iniciou campanha → missão 1 (grupo) → missão 2 (10 indicações) → converteu (cupom).
 * @param {{ inicio?: string, fim?: string }} opts - datas YYYY-MM-DD (período sobre a chegada do contato)
 */
async function obterFunil(opts = {}) {
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(opts.inicio || '') ? opts.inicio : null;
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(opts.fim || '') ? opts.fim : null;

  const conn = await mysql.createConnection(mysql2Config);
  try {
    const where = [];
    const params = [];
    if (inicio) { where.push('COALESCE(c.canal_atribuido_em, c.created_at) >= ?'); params.push(inicio); }
    if (fim) { where.push('COALESCE(c.canal_atribuido_em, c.created_at) < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(fim); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const sqlCompleto = `
      SELECT c.canal_id,
        COUNT(*) AS chegou,
        SUM(CASE WHEN s.numero IS NOT NULL OR c.cam_grupo = 1 OR c.qt_indicados > 0 OR c.cam_indicacoes = 1 THEN 1 ELSE 0 END) AS iniciou,
        SUM(CASE WHEN c.cam_grupo = 1 THEN 1 ELSE 0 END) AS missao1,
        SUM(CASE WHEN c.cam_indicacoes = 1 THEN 1 ELSE 0 END) AS missao2,
        SUM(CASE WHEN cm.id IS NOT NULL THEN 1 ELSE 0 END) AS converteu
      FROM contatos c
      LEFT JOIN sessoes_campanha s ON s.numero = CONCAT(c.whatsapp_id, '@c.us')
      LEFT JOIN contato_metas cm ON cm.whatsapp_id = c.whatsapp_id AND cm.concluido = 1
        AND cm.meta_id = (SELECT id FROM metas WHERE nome = 'cupom_30_resgatado' LIMIT 1)
      ${whereSql}
      GROUP BY c.canal_id`;

    // Fallback sem joins opcionais (instâncias sem tabelas de sessão/metas)
    const sqlSimples = `
      SELECT c.canal_id,
        COUNT(*) AS chegou,
        SUM(CASE WHEN c.cam_grupo = 1 OR c.qt_indicados > 0 OR c.cam_indicacoes = 1 THEN 1 ELSE 0 END) AS iniciou,
        SUM(CASE WHEN c.cam_grupo = 1 THEN 1 ELSE 0 END) AS missao1,
        SUM(CASE WHEN c.cam_indicacoes = 1 THEN 1 ELSE 0 END) AS missao2,
        0 AS converteu
      FROM contatos c
      ${whereSql}
      GROUP BY c.canal_id`;

    let linhas;
    try {
      [linhas] = await conn.execute(sqlCompleto, params);
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
      [linhas] = await conn.execute(sqlSimples, params);
    }

    let canais = [];
    try {
      const [cs] = await conn.execute('SELECT id, nome, tipo FROM canais');
      canais = cs;
    } catch (_) { /* sem tabela canais */ }

    const porCanal = linhas.map((l) => {
      const canal = l.canal_id ? canais.find((c) => c.id === l.canal_id) : null;
      return {
        canal_id: l.canal_id,
        nome: canal ? canal.nome : (l.canal_id ? `Canal #${l.canal_id}` : 'Orgânico / sem canal'),
        tipo: canal ? canal.tipo : null,
        chegou: Number(l.chegou) || 0,
        iniciou: Number(l.iniciou) || 0,
        missao1: Number(l.missao1) || 0,
        missao2: Number(l.missao2) || 0,
        converteu: Number(l.converteu) || 0
      };
    }).sort((a, b) => b.chegou - a.chegou);

    const total = porCanal.reduce((acc, c) => ({
      chegou: acc.chegou + c.chegou,
      iniciou: acc.iniciou + c.iniciou,
      missao1: acc.missao1 + c.missao1,
      missao2: acc.missao2 + c.missao2,
      converteu: acc.converteu + c.converteu
    }), { chegou: 0, iniciou: 0, missao1: 0, missao2: 0, converteu: 0 });

    return { periodo: { inicio, fim }, total, porCanal };
  } finally {
    await conn.end();
  }
}

module.exports = {
  listarCanais,
  obterFunil,
  marcarCanal,
  criarCanal,
  atualizarCanal,
  excluirCanal,
  gerarQrCanal,
  montarLink,
  atribuirCanalSeCorresponder,
  atribuirCanalPorEvento,
  EVENTOS_CANAL,
  invalidarCache
};
