'use strict';

/**
 * Pós-venda (docs/20-modelos-e-fluxos-completos.md, frente C): depois de um pedido concluído, o bot
 * lista as campanhas que o cliente ainda pode participar e ele escolhe.
 *
 * Regra de ouro, no código (não no fluxo): a oferta vale **até 24 h após o pedido**. Passado isso,
 * a escolha é recusada e o cliente só é abordado de novo no próximo pedido — evita "caçar desconto"
 * na hora de pedir.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const configService = require('./configuracaoService');
const telefone = require('./telefoneService');
const fluxoService = require('./fluxoService');
const abordagemService = require('./abordagemService');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

const JANELA_HORAS = 24;
const STATUS_CONCLUIDO = ['OVER', 'DONE'];

function apenasDigitos(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

async function numeroConfig(chave, padrao) {
  try {
    const v = Number(await configService.getConfiguracao(chave));
    return Number.isFinite(v) && v >= 0 ? v : padrao;
  } catch (_) {
    return padrao;
  }
}

/**
 * Telefone do cliente no payload da Multipedidos. Pedido de mesa/balcão sem cliente vem com
 * phone = "0" ou vazio — nesses casos não há quem abordar.
 */
function telefoneDoPedido(pedido) {
  const cand = [pedido && pedido.client && pedido.client.phone, pedido && pedido.phone];
  for (const c of cand) {
    // canonico() completa o DDI e padroniza o 9º dígito; devolve '' para "0" e vazio.
    const d = telefone.canonico(c);
    if (d && d.length >= 12) return d;
  }
  return null;
}

/**
 * Já abordamos esse contato no pós-venda recentemente? (config pos_venda_repetir_dias, default 7)
 */
async function abordadoRecentemente(whatsappId, dias) {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    // Por variantes: se o mesmo cliente já foi abordado com o número no outro formato, não repete.
    const alvo = telefone.clausulaIn('whatsapp_id', whatsappId);
    if (!alvo) return false;
    const [rows] = await conn.execute(
      `SELECT 1 FROM abordagens_fila
        WHERE ${alvo.sql} AND evento = 'pedido_concluido' AND status IN ('pendente','iniciado')
          AND criado_em >= NOW() - INTERVAL ? DAY LIMIT 1`,
      [...alvo.params, dias]
    );
    return rows.length > 0;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return false;
    throw e;
  } finally {
    await conn.end();
  }
}

/**
 * Chamado pelo webhook a cada evento de pedido. Enfileira o pós-venda quando o pedido é concluído.
 * @returns {{ enfileirado: boolean, motivo?: string }}
 */
async function avaliarPedido(pedido) {
  const status = String(pedido && pedido.order_status || '').toUpperCase();
  if (!STATUS_CONCLUIDO.includes(status)) return { enfileirado: false, motivo: 'pedido não concluído' };

  const fluxo = await fluxoService.buscarFluxoPorEvento('pedido_concluido');
  if (!fluxo) return { enfileirado: false, motivo: 'nenhum fluxo de pós-venda ativo' };

  // Nome distinto do módulo `telefone` importado acima: não sombrear.
  const telefoneCliente = telefoneDoPedido(pedido);
  if (!telefoneCliente) return { enfileirado: false, motivo: 'pedido sem telefone (mesa/balcão)' };

  const dias = await numeroConfig('pos_venda_repetir_dias', 7);
  if (dias > 0 && await abordadoRecentemente(telefoneCliente, dias)) {
    return { enfileirado: false, motivo: `já abordado nos últimos ${dias} dias` };
  }

  const atrasoMin = await numeroConfig('pos_venda_atraso_min', 40);
  const criadoEm = pedido.created_at ? new Date(String(pedido.created_at).replace(' ', 'T')) : new Date();
  const fimDaJanela = new Date(criadoEm.getTime() + JANELA_HORAS * 3600000);
  const horasRestantes = (fimDaJanela.getTime() - Date.now()) / 3600000;
  if (horasRestantes <= 0) return { enfileirado: false, motivo: 'pedido com mais de 24 h' };

  const r = await abordagemService.enfileirar({
    whatsappId: telefoneCliente,
    evento: 'pedido_concluido',
    fluxoId: fluxo.id,
    referencia: `pedido:${pedido.id}`,
    variaveis: {
      pedidoNumero: String(pedido.order_no || pedido.id),
      pedidoId: String(pedido.id),
      pedidoValor: pedido.total_net_value != null ? String(pedido.total_net_value) : '',
      pedidoEm: criadoEm.toISOString(),
      nomeCliente: String((pedido.client && pedido.client.name) || pedido.name || '').split(' ')[0] || '',
      primeiroPedido: pedido.client && Number(pedido.client.orders_count) <= 1 ? 'sim' : 'nao',
      usouCupom: pedido.coupom_code ? 'sim' : 'nao',
      posVendaAte: fimDaJanela.toISOString()
    },
    atrasoMin,
    // Nunca ultrapassa a janela de 24 h do pedido, mesmo que o atraso configurado seja grande.
    validadeHoras: Math.max(0.1, horasRestantes)
  });
  return r.enfileirado ? { enfileirado: true, id: r.id } : { enfileirado: false, motivo: r.motivo };
}

/**
 * A escolha do cliente ainda está dentro da janela de 24 h do pedido?
 * Usado pelo nó `listar_ofertas`/`iniciar_fluxo` via variável {{posVendaAte}} — e aqui, no código,
 * para que a regra não dependa de o operador configurar o fluxo certo.
 */
function dentroDaJanela(posVendaAteIso, agora = new Date()) {
  if (!posVendaAteIso) return true; // fluxo iniciado fora do pós-venda: sem janela
  const fim = new Date(posVendaAteIso);
  return !Number.isNaN(fim.getTime()) && fim.getTime() > agora.getTime();
}

module.exports = { avaliarPedido, dentroDaJanela, telefoneDoPedido, JANELA_HORAS };
