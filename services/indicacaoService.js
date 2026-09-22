'use strict';

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('./telefoneService');
const { parseVcards } = require('../utils/vcardParser');
const fluxoService = require('./fluxoService');
const abordagemService = require('./abordagemService');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

/** Normaliza número para comparação com whatsapp_id (apenas dígitos) */
function normalizarWhatsappId(id) {
  if (!id) return '';
  return String(id).replace(/\D/g, '');
}

/**
 * Registra uma ou mais indicações (contatos enviados por um usuário).
 * Evita duplicatas (mesmo indicador + mesmo indicado).
 * Atualiza contatos.qt_indicados e contatos.cam_indicacoes.
 * @param {string} indicadorWhatsappId - Quem está indicando (ex: 5511999999999@c.us ou xxx@lid)
 * @param {Array<{ numero: string, nome?: string|null }>} indicados - Lista de { numero, nome }
 * @param {string|null} [telefoneIndicadorDigits] – Se já resolvido (PN só dígitos), evita usar LID como “número” no CRM
 * @returns {Promise<{ qtInseridos: number, qtTotal: number, completouMissao: boolean }>}
 */
async function registrarIndicacoes(indicadorWhatsappId, indicados, telefoneIndicadorDigits = null) {
  if (!indicados || indicados.length === 0) {
    const qt = await obterQtIndicados(indicadorWhatsappId);
    return { qtInseridos: 0, qtTotal: qt, completouMissao: qt >= 10 };
  }

  const conn = await mysql.createConnection(mysql2Config);
  try {
    let qtInseridos = 0;
    const indicadorNorm =
      (telefoneIndicadorDigits && String(telefoneIndicadorDigits).replace(/\D/g, '').length >= 10
        ? String(telefoneIndicadorDigits).replace(/\D/g, '')
        : null) ||
      normalizarWhatsappId(indicadorWhatsappId) ||
      String(indicadorWhatsappId || '').trim();

    const novos = [];
    for (const { numero, nome } of indicados) {
      // Canônico: o vCard chega sem DDI, com máscara e às vezes sem o 9º dígito. Se gravássemos
      // cru, a conversão (que busca com o telefone do pedido, completo) nunca encontraria.
      const numNorm = telefone.canonico(numero);
      if (!numNorm || numNorm.length < 12) continue;
      try {
        const [result] = await conn.execute(
          `INSERT INTO indicacoes (indicador_whatsapp_id, indicado_numero, indicado_nome)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE indicado_nome = VALUES(indicado_nome)`,
          [indicadorNorm, numNorm, nome || null]
        );
        if (result.affectedRows === 1) {
          qtInseridos++;
          novos.push({ numero: numNorm, nome: nome || null });
        }
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }

    const [rows] = await conn.execute(
      'SELECT COUNT(*) as total FROM indicacoes WHERE indicador_whatsapp_id = ?',
      [indicadorNorm]
    );
    const qtTotal = (rows[0] && rows[0].total) ? Number(rows[0].total) : 0;

    const whatsappIdParaContato =
      (telefoneIndicadorDigits && String(telefoneIndicadorDigits).replace(/\D/g, '').length >= 10
        ? String(telefoneIndicadorDigits).replace(/\D/g, '')
        : null) ||
      normalizarWhatsappId(indicadorWhatsappId);
    try {
      await conn.execute(
        `UPDATE contatos SET qt_indicados = ?, cam_indicacoes = ? WHERE whatsapp_id = ?`,
        [qtTotal, qtTotal >= 10 ? 1 : 0, whatsappIdParaContato]
      );
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
      console.warn('⚠️ Tabela contatos não existe; qt_indicados/cam_indicacoes só em indicacoes.');
    }

    // Abordagem ativa do indicado (docs/20 frente B): 1 mensagem perguntando se ele quer o cupom.
    // Fire-and-forget: falha aqui não pode derrubar o registro da indicação.
    if (novos.length) {
      abordarIndicados(indicadorNorm, novos).catch((e) => console.warn('⚠️ Abordagem de indicados:', e.message));
    }

    return {
      qtInseridos,
      qtTotal,
      completouMissao: qtTotal >= 10
    };
  } finally {
    await conn.end();
  }
}

/**
 * Enfileira a abordagem ao indicado, se houver um fluxo ativo para o evento 'indicacao_registrada'.
 * Sem fluxo configurado, não faz nada (comportamento anterior: o indicado não recebe mensagem).
 */
async function abordarIndicados(indicadorWhatsappId, novos) {
  const fluxo = await fluxoService.buscarFluxoPorEvento('indicacao_registrada');
  if (!fluxo) return;

  // Conexão própria: isto roda depois que registrarIndicacoes já fechou a dele (fire-and-forget).
  const conn = await mysql.createConnection(mysql2Config);
  try {
    let indicadorNome = '';
    try {
      const alvoInd = telefone.clausulaIn('whatsapp_id', indicadorWhatsappId);
      if (alvoInd) {
        const [rows] = await conn.execute(
          `SELECT nome FROM contatos WHERE ${alvoInd.sql} AND nome IS NOT NULL LIMIT 1`, alvoInd.params);
        indicadorNome = (rows[0] && rows[0].nome) || '';
      }
    } catch (_) { /* contatos pode não existir */ }

    for (const { numero, nome } of novos) {
      if (telefone.mesmoNumero(numero, indicadorWhatsappId)) continue; // não aborda quem indicou a si mesmo
      const r = await abordagemService.enfileirar({
        whatsappId: numero,
        evento: 'indicacao_registrada',
        fluxoId: fluxo.id,
        referencia: `indicacao:${indicadorWhatsappId}:${numero}`,
        variaveis: {
          indicadorNome: indicadorNome || 'Um amigo',
          indicadorTelefone: indicadorWhatsappId,
          indicadoNome: nome || ''
        },
        atrasoMin: 2,        // deixa o indicador terminar de enviar os contatos
        validadeHoras: 48
      });
      if (!r.enfileirado) continue;
      try {
        await conn.execute(
          'UPDATE indicacoes SET abordado_em = NOW() WHERE indicador_whatsapp_id = ? AND indicado_numero = ?',
          [indicadorWhatsappId, numero]
        );
      } catch (e) {
        if (e.code !== 'ER_BAD_FIELD_ERROR') throw e; // migração do ciclo ainda não rodou
      }
    }
  } finally {
    await conn.end();
  }
}

/**
 * Marca que o indicado virou cliente (usou o cupom num pedido). Chamado pelo webhook da Multipedidos.
 * @returns {{ convertido: boolean, indicador?: string }}
 */
async function marcarConversaoIndicado(indicadoWhatsappId, { pedidoId = null, pedidoValor = null } = {}) {
  const num = String(indicadoWhatsappId || '').replace(/\D/g, '');
  if (num.length < 10) return { convertido: false };
  const conn = await mysql.createConnection(mysql2Config);
  try {
    // Indicações antigas foram gravadas no formato cru do vCard: procura por todas as variantes.
    const alvo = telefone.clausulaIn('indicado_numero', num);
    if (!alvo) return { convertido: false };
    const [rows] = await conn.execute(
      `SELECT id, indicador_whatsapp_id FROM indicacoes
        WHERE ${alvo.sql} AND convertido_em IS NULL ORDER BY id LIMIT 1`,
      alvo.params
    );
    if (!rows.length) return { convertido: false };
    await conn.execute(
      'UPDATE indicacoes SET convertido_em = NOW(), pedido_id = ?, pedido_valor = ? WHERE id = ?',
      [pedidoId, pedidoValor, rows[0].id]
    );
    return { convertido: true, indicador: rows[0].indicador_whatsapp_id };
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE') return { convertido: false };
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Retorna quantas pessoas o usuário já indicou.
 * @param {string} indicadorWhatsappId
 * @returns {Promise<number>}
 */
async function obterQtIndicados(indicadorWhatsappId) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      'SELECT COUNT(*) as total FROM indicacoes WHERE indicador_whatsapp_id = ?',
      [indicadorWhatsappId || '']
    );
    return (rows[0] && rows[0].total) ? Number(rows[0].total) : 0;
  } finally {
    await conn.end();
  }
}

/**
 * Verifica se o contato já completou a missão de indicações (cam_indicacoes).
 * @param {string} whatsappId - Número ou id do contato (pode ser com ou sem @c.us)
 * @returns {Promise<boolean>}
 */
async function completouMissaoIndicacoes(whatsappId) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const alvo = telefone.clausulaIn('whatsapp_id', normalizarWhatsappId(whatsappId));
    if (!alvo) return false;
    const [rows] = await conn.execute(
      `SELECT cam_indicacoes FROM contatos WHERE ${alvo.sql} LIMIT 1`,
      alvo.params
    );
    return rows[0] ? Boolean(rows[0].cam_indicacoes) : false;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Lista indicações com paginação e busca (nome/número do indicado ou indicador).
 * Traz o nome do indicador quando existir em contatos.
 * @param {{ page?: number, limit?: number, busca?: string }} opts
 */
async function listarIndicacoes(opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const offset = (page - 1) * limit;
  const busca = String(opts.busca || '').trim();

  const conn = await mysql.createConnection(mysql2Config);
  try {
    let where = '';
    const params = [];
    if (busca) {
      where = `WHERE i.indicado_nome LIKE ? OR i.indicado_numero LIKE ? OR i.indicador_whatsapp_id LIKE ? OR c.nome LIKE ?`;
      const like = `%${busca}%`;
      params.push(like, like, like, like);
    }

    const [countRows] = await conn.execute(
      `SELECT COUNT(*) AS total
         FROM indicacoes i
         LEFT JOIN contatos c ON c.whatsapp_id = SUBSTRING_INDEX(i.indicador_whatsapp_id, '@', 1)
        ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await conn.execute(
      `SELECT i.id, i.indicador_whatsapp_id, i.indicado_numero, i.indicado_nome, i.created_at,
              c.nome AS indicador_nome
         FROM indicacoes i
         LEFT JOIN contatos c ON c.whatsapp_id = SUBSTRING_INDEX(i.indicador_whatsapp_id, '@', 1)
        ${where}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return {
      rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    };
  } finally {
    await conn.end();
  }
}

/**
 * Busca uma indicação pelo id.
 * @param {number} id
 */
async function obterIndicacaoPorId(id) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      `SELECT id, indicador_whatsapp_id, indicado_numero, indicado_nome, created_at
         FROM indicacoes WHERE id = ? LIMIT 1`,
      [Number(id)]
    );
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

/**
 * Exclui indicações por id e recalcula qt_indicados/cam_indicacoes dos indicadores afetados.
 * @param {number[]} ids
 * @returns {Promise<{ qtExcluidas: number }>}
 */
async function excluirIndicacoes(ids) {
  const lista = (Array.isArray(ids) ? ids : [ids])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!lista.length) return { qtExcluidas: 0 };

  const conn = await mysql.createConnection(mysql2Config);
  try {
    const placeholders = lista.map(() => '?').join(',');
    const [afetados] = await conn.execute(
      `SELECT DISTINCT indicador_whatsapp_id FROM indicacoes WHERE id IN (${placeholders})`,
      lista
    );

    const [result] = await conn.execute(
      `DELETE FROM indicacoes WHERE id IN (${placeholders})`,
      lista
    );

    for (const { indicador_whatsapp_id: indicador } of afetados) {
      const [rows] = await conn.execute(
        'SELECT COUNT(*) AS total FROM indicacoes WHERE indicador_whatsapp_id = ?',
        [indicador]
      );
      const qtTotal = Number(rows[0]?.total || 0);
      const widContato = String(indicador || '').split('@')[0].replace(/\D/g, '') || indicador;
      try {
        await conn.execute(
          `UPDATE contatos SET qt_indicados = ?, cam_indicacoes = ? WHERE whatsapp_id = ?`,
          [qtTotal, qtTotal >= 10 ? 1 : 0, widContato]
        );
      } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
      }
    }

    return { qtExcluidas: result.affectedRows || 0 };
  } finally {
    await conn.end();
  }
}

module.exports = {
  registrarIndicacoes,
  marcarConversaoIndicado,
  obterQtIndicados,
  completouMissaoIndicacoes,
  listarIndicacoes,
  obterIndicacaoPorId,
  excluirIndicacoes,
  normalizarWhatsappId,
  parseVcards
};
