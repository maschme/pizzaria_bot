'use strict';

/**
 * Canais de aquisição (docs/16-canais-e-funil.md): CRUD, geração de link wa.me/QR
 * e atribuição de origem no primeiro contato do cliente.
 */

const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const { dbConfig } = require('../database/connection');

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
    const [canais] = await conn.execute('SELECT * FROM canais ORDER BY criado_em DESC');
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

async function criarCanal({ nome, slug, tipo, mensagem_entrada, ativo = true }) {
  if (!nome || !mensagem_entrada) throw new Error('nome e mensagem_entrada são obrigatórios');
  const slugFinal = normalizar(slug || nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!slugFinal) throw new Error('slug inválido');

  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [r] = await conn.execute(
      `INSERT INTO canais (nome, slug, tipo, mensagem_entrada, ativo) VALUES (?, ?, ?, ?, ?)`,
      [nome.trim(), slugFinal, tipo || 'outro', mensagem_entrada.trim(), ativo ? 1 : 0]
    );
    invalidarCache();
    return { id: r.insertId, slug: slugFinal };
  } finally {
    await conn.end();
  }
}

async function atualizarCanal(id, { nome, tipo, mensagem_entrada, ativo }) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    await conn.execute(
      `UPDATE canais SET nome = ?, tipo = ?, mensagem_entrada = ?, ativo = ? WHERE id = ?`,
      [String(nome || '').trim(), tipo || 'outro', String(mensagem_entrada || '').trim(), ativo ? 1 : 0, Number(id)]
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
    const [rows] = await conn.execute('SELECT id, mensagem_entrada FROM canais WHERE ativo = 1');
    cacheCanaisAtivos = rows.map((c) => ({ id: c.id, mensagemNorm: normalizar(c.mensagem_entrada) }));
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
 * Nunca sobrescreve atribuição existente. Fire-and-forget: erros só logam.
 * @param {string} chatId - ex.: 5547...@c.us
 * @param {string} texto  - primeira mensagem recebida
 */
async function atribuirCanalSeCorresponder(chatId, texto) {
  try {
    const canais = await canaisAtivos();
    if (!canais.length) return null;

    const msgNorm = normalizar(texto);
    if (!msgNorm) return null;

    const canal = canais.find((c) => c.mensagemNorm && msgNorm.startsWith(c.mensagemNorm));
    if (!canal) return null;

    const wid = apenasDigitos(chatId);
    if (wid.length < 8) return null;

    const conn = await mysql.createConnection(mysql2Config);
    try {
      await conn.execute(
        `INSERT INTO contatos (whatsapp_id, canal_id, canal_atribuido_em)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           canal_id = IF(canal_id IS NULL, VALUES(canal_id), canal_id),
           canal_atribuido_em = IF(canal_atribuido_em IS NULL, NOW(), canal_atribuido_em)`,
        [wid, canal.id]
      );
      console.log(`📍 Canal atribuído: contato ${wid} ← canal #${canal.id}`);
      return canal.id;
    } finally {
      await conn.end();
    }
  } catch (e) {
    console.warn('⚠️ Atribuição de canal falhou:', e.message);
    return null;
  }
}

module.exports = {
  listarCanais,
  criarCanal,
  atualizarCanal,
  excluirCanal,
  gerarQrCanal,
  montarLink,
  atribuirCanalSeCorresponder,
  invalidarCache
};
