'use strict';

/**
 * Histórico de participação do contato nos fluxos (docs/20 §C.2): a partir de fluxo_exec_logs
 * (fluxo_start / fluxo_end) e das sessões vivas em memória.
 *
 * Situação por fluxo: 'nunca' | 'em_aberto' | 'concluido' | 'abandonado'
 *   em_aberto  = sessão viva agora, ou start sem end há menos de ABANDONO_DIAS
 *   abandonado = start sem end há mais de ABANDONO_DIAS
 *   concluido  = último start tem um end depois dele
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('./telefoneService');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

const ABANDONO_DIAS = 7;

function apenasDigitos(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

/**
 * @param {string} whatsappId
 * @param {{ fluxoIdEmAberto?: number|null }} [opts] - id do fluxo com sessão viva (o executor sabe; passa aqui)
 * @returns {Promise<Object<number, { situacao: string, inicios: number, ultimoInicio: Date|null, ultimoFim: Date|null }>>}
 */
async function historicoDoContato(whatsappId, { fluxoIdEmAberto = null } = {}) {
  const wid = apenasDigitos(whatsappId);
  const resultado = {};
  if (wid.length < 8) return resultado;
  // Procura por todas as formas do mesmo número (9º dígito), senão o histórico "some".
  const alvo = telefone.clausulaIn('whatsapp_id', wid);
  if (!alvo) return resultado;

  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [rows] = await conn.execute(
      `SELECT fluxo_id,
              SUM(evento = 'fluxo_start') AS inicios,
              MAX(CASE WHEN evento = 'fluxo_start' THEN created_at END) AS ultimo_inicio,
              MAX(CASE WHEN evento = 'fluxo_end' THEN created_at END) AS ultimo_fim
         FROM fluxo_exec_logs
        WHERE ${alvo.sql} AND fluxo_id IS NOT NULL AND evento IN ('fluxo_start','fluxo_end')
        GROUP BY fluxo_id`,
      alvo.params
    );
    const agora = Date.now();
    for (const r of rows) {
      const inicio = r.ultimo_inicio ? new Date(r.ultimo_inicio) : null;
      const fim = r.ultimo_fim ? new Date(r.ultimo_fim) : null;
      let situacao;
      if (Number(r.fluxo_id) === Number(fluxoIdEmAberto)) situacao = 'em_aberto';
      else if (!inicio) situacao = 'nunca';
      else if (fim && fim.getTime() >= inicio.getTime()) situacao = 'concluido';
      else if (agora - inicio.getTime() > ABANDONO_DIAS * 86400000) situacao = 'abandonado';
      else situacao = 'em_aberto';
      resultado[r.fluxo_id] = { situacao, inicios: Number(r.inicios || 0), ultimoInicio: inicio, ultimoFim: fim };
    }
    if (fluxoIdEmAberto && !resultado[fluxoIdEmAberto]) {
      resultado[fluxoIdEmAberto] = { situacao: 'em_aberto', inicios: 1, ultimoInicio: new Date(), ultimoFim: null };
    }
    return resultado;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return resultado;
    throw e;
  } finally {
    await conn.end();
  }
}

function situacaoDe(historico, fluxoId) {
  return (historico[fluxoId] && historico[fluxoId].situacao) || 'nunca';
}

/** Regra `elegivel_se` do bloco oferta do fluxo (docs/20 §C.2). */
function elegivel(situacao, regra) {
  if (situacao === 'em_aberto') return false; // em aberto nunca é ofertado — é retomado
  switch (regra || 'nunca_participou') {
    case 'sempre': return true;
    case 'nao_concluiu': return situacao === 'nunca' || situacao === 'abandonado';
    case 'nunca_participou':
    default: return situacao === 'nunca';
  }
}

module.exports = { historicoDoContato, situacaoDe, elegivel, ABANDONO_DIAS };
