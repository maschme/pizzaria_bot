'use strict';

/**
 * Cliente HTTP da API da Multipedidos (docs/17-integracao-multipedidos.md §4).
 * Autenticação: Token de Integração (MULTIPEDIDOS_TOKEN, só no .env) → JWT de 1 h, mantido em cache.
 * O token equivale a credencial de administrador da loja: nunca é logado nem devolvido por aqui.
 */

const axios = require('axios');

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

module.exports = { tokenConfigurado, login, getSessao, getUltimoLogin, invalidarSessao, API_URL };
