'use strict';

/**
 * Exploração (somente leitura) da API da Multipedidos — ver docs/17-integracao-multipedidos.md.
 * O contrato veio de fontes indiretas (não há doc oficial); este script serve para confirmá-lo.
 *
 * Uso:
 *   node scripts/multipedidos-explorar.js login          — testa o token (POST /integration/auth/login)
 *   node scripts/multipedidos-explorar.js poll           — busca pedidos pendentes (NÃO dá acknowledge)
 *   node scripts/multipedidos-explorar.js get <caminho>  — GET autenticado (JWT) em api.multipedidos.com.br
 *                                                          ex.: get /restaurant/123/order/456
 *
 * Só faz GET (e o POST de login). Nunca chama acknowledge nem muda status de pedido —
 * essas chamadas têm efeito na operação da loja.
 *
 * Configuração via .env:
 *   MULTIPEDIDOS_TOKEN      — Token de Integração gerado no painel (Integrações → Token de Integração)
 *   MULTIPEDIDOS_API_URL    (default: https://api.multipedidos.com.br)
 *   MULTIPEDIDOS_POLL_URL   (default: URL Lambda encontrada no cliente C# de 2023 — pode ter mudado)
 *
 * Cada resposta é salva em capturas/multipedidos/ (fora do git: contém dados pessoais de clientes).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TOKEN = (process.env.MULTIPEDIDOS_TOKEN || '').trim();
const API_URL = (process.env.MULTIPEDIDOS_API_URL || 'https://api.multipedidos.com.br').replace(/\/+$/, '');
const POLL_URL = (process.env.MULTIPEDIDOS_POLL_URL || 'https://2bhghu4v3iluwl77hwcmwkbije0rroef.lambda-url.us-east-1.on.aws').replace(/\/+$/, '');
const DIR_CAPTURAS = path.join(__dirname, '..', 'capturas', 'multipedidos');

function salvar(nome, resposta) {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const arquivo = path.join(DIR_CAPTURAS, `${carimbo}-${nome.replace(/[^a-z0-9]+/gi, '_')}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({
    status: resposta.status,
    headers: resposta.headers,
    data: resposta.data
  }, null, 2));
  return arquivo;
}

function resumir(data) {
  const texto = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return texto.length > 3000 ? `${texto.slice(0, 3000)}\n… (${texto.length} chars — completo no arquivo)` : texto;
}

async function login() {
  const r = await axios.post(`${API_URL}/integration/auth/login`, {}, {
    headers: { 'x-integration-token': TOKEN },
    validateStatus: () => true,
    timeout: 20000
  });
  return r;
}

async function main() {
  const [comando, arg] = process.argv.slice(2);
  if (!['login', 'poll', 'get'].includes(comando) || (comando === 'get' && !arg)) {
    console.log('Uso: node scripts/multipedidos-explorar.js login | poll | get <caminho>');
    process.exit(1);
  }
  if (!TOKEN) {
    console.error('❌ Defina MULTIPEDIDOS_TOKEN no .env');
    process.exit(1);
  }

  if (comando === 'login') {
    const r = await login();
    // Não grava o JWT em disco: só confirma que veio.
    const jwt = r.data && r.data.token;
    console.log(`POST /integration/auth/login → ${r.status}`);
    console.log(jwt ? `✅ JWT recebido (${String(jwt).length} chars). Campos da resposta: ${Object.keys(r.data).join(', ')}` : resumir(r.data));
    return;
  }

  if (comando === 'poll') {
    const r = await axios.get(`${POLL_URL}/poll`, {
      headers: { Authorization: TOKEN },
      validateStatus: () => true,
      timeout: 30000
    });
    console.log(`GET ${POLL_URL}/poll → ${r.status}`);
    console.log(resumir(r.data));
    console.log(`💾 ${salvar('poll', r)}`);
    return;
  }

  const rLogin = await login();
  const jwt = rLogin.data && rLogin.data.token;
  if (!jwt) {
    console.error(`❌ Login falhou (${rLogin.status}):`, resumir(rLogin.data));
    process.exit(1);
  }
  const caminho = arg.startsWith('/') ? arg : `/${arg}`;
  const r = await axios.get(`${API_URL}${caminho}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    validateStatus: () => true,
    timeout: 30000
  });
  console.log(`GET ${caminho} → ${r.status}`);
  console.log(resumir(r.data));
  console.log(`💾 ${salvar(`get${caminho}`, r)}`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
