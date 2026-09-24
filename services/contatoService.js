'use strict';

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('./telefoneService');
const contatoIdService = require('./contatoIdService');

const config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

function normalizarWhatsappId(id) {
  if (!id) return '';
  return String(id).replace(/\D/g, '');
}

/**
 * Lista contatos da tabela contatos com paginação.
 */
async function listarContatos(opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 100));
  const offset = (page - 1) * limit;
  const conn = await mysql.createConnection(config);
  try {
    const [[countRow]] = await conn.execute('SELECT COUNT(*) AS total FROM contatos');
    let rows;
    try {
      [rows] = await conn.execute(
        `SELECT c.id, c.whatsapp_id, c.whatsapp_lid, c.nome, c.cam_grupo, c.id_negociacao, c.qt_indicados, c.cam_indicacoes,
                c.created_at, c.updated_at, c.canal_id, ca.nome AS canal_nome
           FROM contatos c
           LEFT JOIN canais ca ON ca.id = c.canal_id
          ORDER BY c.updated_at DESC, c.created_at DESC
          LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    } catch (eJoin) {
      // Instância ainda sem a migração de canais
      [rows] = await conn.execute(
        `SELECT id, whatsapp_id, whatsapp_lid, nome, cam_grupo, id_negociacao, qt_indicados, cam_indicacoes, created_at, updated_at
         FROM contatos ORDER BY updated_at DESC, created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }
    const total = Number(countRow?.total || 0);
    return {
      rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return { rows: [], total: 0, page, limit, totalPages: 1 };
    }
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Deleta um contato (e suas metas). Útil para resetar e testar fluxo de novo.
 * Também remove indicações onde ele é o indicador.
 */
async function deletarContato(whatsappId, opts = {}) {
  const wid = normalizarWhatsappId(whatsappId);
  const lid = (opts.whatsappLid && String(opts.whatsappLid).trim()) || '';
  if (!wid && !lid) throw new Error('whatsapp_id inválido');

  const conn = await mysql.createConnection(config);
  try {
    const widParaMetas = wid || normalizarWhatsappId(lid);
    if (widParaMetas) {
      await conn.execute('DELETE FROM contato_metas WHERE whatsapp_id = ?', [widParaMetas]);
      await conn.execute(
        'DELETE FROM indicacoes WHERE indicador_whatsapp_id = ? OR indicador_whatsapp_id = ?',
        [widParaMetas, widParaMetas + '@c.us']
      );
    }
    let affected = 0;
    if (wid && lid) {
      const [r] = await conn.execute(
        'DELETE FROM contatos WHERE whatsapp_id = ? OR whatsapp_lid = ?',
        [wid, lid]
      );
      affected = r.affectedRows;
    } else if (wid) {
      const [r] = await conn.execute('DELETE FROM contatos WHERE whatsapp_id = ?', [wid]);
      affected = r.affectedRows;
    } else {
      const [r] = await conn.execute('DELETE FROM contatos WHERE whatsapp_lid = ?', [lid]);
      affected = r.affectedRows;
    }
    return { deleted: affected > 0, whatsapp_id: wid || null };
  } finally {
    await conn.end();
  }
}

/** Nome como veio do cadastro, sem espaços sobrando. Vazio ou só números não é nome. */
function limparNome(nome) {
  const n = String(nome == null ? '' : nome).replace(/\s+/g, ' ').trim().slice(0, 255);
  if (!n || !/\p{L}/u.test(n)) return '';
  return n;
}

/**
 * Grava o nome do cliente vindo do cadastro de um sistema de pedidos (Multipedidos).
 *
 * O cadastro é a fonte mais confiável de nome que temos (o perfil do WhatsApp é apelido, emoji ou
 * nada), então ele prevalece: atualiza o nome sempre que mudar.
 *
 * Procura o contato por **todas** as formas do número (com e sem o 9º dígito): se houver duplicata
 * antiga, as duas linhas recebem o nome. Contato que ainda não existe nasce no formato gravável
 * (`resolverIdGravavel`), para que a primeira mensagem dele no WhatsApp já o encontre com nome.
 *
 * @param {string} telefoneBruto - número em qualquer formato (já validado como plausível)
 * @param {string} nome
 * @returns {Promise<{acao: 'criado'|'atualizado'|'igual'|'ignorado', whatsapp_id?: string}>}
 */
async function salvarNomeDoCadastro(telefoneBruto, nome) {
  const nomeLimpo = limparNome(nome);
  const alvo = telefone.clausulaIn('whatsapp_id', telefoneBruto);
  if (!nomeLimpo || !alvo) return { acao: 'ignorado' };

  const conn = await mysql.createConnection(config);
  try {
    const [existentes] = await conn.execute(
      `SELECT id, whatsapp_id, nome FROM contatos WHERE ${alvo.sql}`, alvo.params);

    if (existentes.length) {
      const desatualizados = existentes.filter((c) => (c.nome || '') !== nomeLimpo);
      if (!desatualizados.length) return { acao: 'igual', whatsapp_id: existentes[0].whatsapp_id };
      await conn.execute(
        `UPDATE contatos SET nome = ? WHERE id IN (${desatualizados.map(() => '?').join(', ')})`,
        [nomeLimpo, ...desatualizados.map((c) => c.id)]
      );
      return { acao: 'atualizado', whatsapp_id: existentes[0].whatsapp_id };
    }

    const wid = await contatoIdService.resolverIdGravavel(telefoneBruto, { conn });
    if (!wid) return { acao: 'ignorado' };
    // ON DUPLICATE: corrida com uma mensagem chegando do mesmo número ao mesmo tempo.
    await conn.execute(
      `INSERT INTO contatos (whatsapp_id, nome) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE nome = VALUES(nome)`,
      [wid, nomeLimpo]
    );
    return { acao: 'criado', whatsapp_id: wid };
  } finally {
    await conn.end();
  }
}

/**
 * Nome + telefone de um pedido da Multipedidos → contatos. Pedido de mesa/balcão (sem telefone ou
 * sem nome) e telefone mascarado de marketplace são ignorados.
 */
async function salvarNomeDoPedidoMultipedidos(pedido) {
  if (!pedido || typeof pedido !== 'object') return { acao: 'ignorado' };
  const cliente = pedido.client && typeof pedido.client === 'object' ? pedido.client : {};
  const fone = [cliente.phone, pedido.phone].find((f) => telefone.ehPlausivelParaWhatsapp(f));
  if (!fone) return { acao: 'ignorado' };
  return salvarNomeDoCadastro(fone, cliente.name || pedido.name);
}

module.exports = {
  listarContatos,
  deletarContato,
  normalizarWhatsappId,
  limparNome,
  salvarNomeDoCadastro,
  salvarNomeDoPedidoMultipedidos
};
