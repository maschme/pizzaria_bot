'use strict';

/**
 * Cliente HTTP da API da Multipedidos (docs/17-integracao-multipedidos.md §4).
 * Autenticação: Token de Integração (MULTIPEDIDOS_TOKEN, só no .env) → JWT de 1 h, mantido em cache.
 * O token equivale a credencial de administrador da loja: nunca é logado nem devolvido por aqui.
 */

const axios = require('axios');
const configService = require('./configuracaoService');

const API_URL = (process.env.MULTIPEDIDOS_API_URL || 'https://api.multipedidos.com.br').replace(/\/+$/, '');
const JWT_MARGEM_MS = 10 * 60 * 1000; // renova 10 min antes de expirar

let jwtCache = null; // { token, expiraEm, restaurantId }
let ultimoLogin = null; // { ok, em, erro, restaurantId }

function tokenConfigurado() {
  return !!(process.env.MULTIPEDIDOS_TOKEN || '').trim();
}

function lerClaims(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
  } catch (_) {
    return {};
  }
}

async function login() {
  if (!tokenConfigurado()) {
    ultimoLogin = { ok: false, em: new Date().toISOString(), erro: 'MULTIPEDIDOS_TOKEN não definido no .env' };
    throw new Error(ultimoLogin.erro);
  }
  try {
    const r = await axios.post(`${API_URL}/integration/auth/login`, {}, {
      headers: { 'x-integration-token': process.env.MULTIPEDIDOS_TOKEN.trim() },
      timeout: 15000,
      validateStatus: () => true
    });
    const token = r.data && r.data.token;
    if (r.status !== 200 || !token) {
      throw new Error(r.status === 401 ? 'Token de integração recusado (401)' : `Login respondeu ${r.status}`);
    }
    const claims = lerClaims(token);
    jwtCache = {
      token,
      expiraEm: claims.exp ? claims.exp * 1000 : Date.now() + 50 * 60 * 1000,
      restaurantId: claims.restaurant_id || null
    };
    ultimoLogin = { ok: true, em: new Date().toISOString(), erro: null, restaurantId: jwtCache.restaurantId };
    return jwtCache;
  } catch (e) {
    jwtCache = null;
    ultimoLogin = { ok: false, em: new Date().toISOString(), erro: e.message };
    throw e;
  }
}

/** JWT válido (do cache ou de um login novo). */
async function getSessao() {
  if (jwtCache && jwtCache.expiraEm - Date.now() > JWT_MARGEM_MS) return jwtCache;
  return login();
}

function getUltimoLogin() {
  return ultimoLogin;
}

function invalidarSessao() {
  jwtCache = null;
}

/** Erro de chamada à API com status e corpo (ex.: 422 com `errors` de validação). */
class MultipedidosApiError extends Error {
  constructor(mensagem, status, dados) {
    super(mensagem);
    this.name = 'MultipedidosApiError';
    this.status = status;
    this.dados = dados;
  }
}

/**
 * Chamada autenticada em /restaurant/{id}/<caminho>. Só funciona com a API ligada na tela de
 * Integrações. Refaz o login uma vez em 401 (JWT expirado/invalidado) e tenta de novo uma vez em 5xx.
 */
async function requisicaoRestaurante(metodo, caminho, { params, data } = {}) {
  if ((await configService.getConfiguracao('multipedidos_api_ativa')) !== true) {
    throw new MultipedidosApiError('API da Multipedidos está desativada na tela de Integrações', 0, null);
  }
  let ultima;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const sessao = await getSessao();
    ultima = await axios({
      method: metodo,
      url: `${API_URL}/restaurant/${sessao.restaurantId}${caminho}`,
      params,
      data,
      headers: { Authorization: `Bearer ${sessao.token}` },
      timeout: 15000,
      validateStatus: () => true
    });
    if (ultima.status === 401) { invalidarSessao(); continue; }
    if (ultima.status >= 500) continue;
    break;
  }
  if (ultima.status >= 400) {
    const detalhe = ultima.data && (ultima.data.errors ? JSON.stringify(ultima.data.errors) : ultima.data.message);
    throw new MultipedidosApiError(`Multipedidos ${metodo} ${caminho} → ${ultima.status}${detalhe ? ` (${detalhe})` : ''}`, ultima.status, ultima.data);
  }
  return ultima.data;
}

// ============================================================
// Cupons (docs/17 §4.7)
// ============================================================

/** Cupom pelo código exato, ou null. (Cupom removido não aparece na listagem.) */
async function buscarCupomPorCodigo(codigo) {
  const r = await requisicaoRestaurante('get', '/discount-coupons', { params: { search: codigo } });
  return ((r && r.data) || []).find((c) => c.code === codigo) || null;
}

async function codigoDisponivel(codigo) {
  const r = await requisicaoRestaurante('get', '/discount-coupons/code-availability', { params: { code: codigo } });
  return !!(r && r.data && r.data.available);
}

async function criarCupom(cupom) {
  const r = await requisicaoRestaurante('post', '/discount-coupons', { data: cupom });
  return r.data;
}

/** PUT exige o objeto completo (parcial → 422): recebe o cupom atual já com as alterações aplicadas. */
async function atualizarCupom(cupomCompleto) {
  const r = await requisicaoRestaurante('put', `/discount-coupons/${cupomCompleto.id}`, { data: cupomCompleto });
  return r.data;
}

async function definirCupomAtivo(cupomId, ativo) {
  const r = await requisicaoRestaurante('put', `/discount-coupons/${cupomId}/active`, { data: { active: !!ativo } });
  return r.data;
}

module.exports = {
  tokenConfigurado, login, getSessao, getUltimoLogin, invalidarSessao, API_URL,
  MultipedidosApiError, requisicaoRestaurante,
  buscarCupomPorCodigo, codigoDisponivel, criarCupom, atualizarCupom, definirCupomAtivo
};
