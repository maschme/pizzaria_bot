'use strict';

/**
 * Estado e liga/desliga da integração Multipedidos (docs/18-cupons-multipedidos.md §1).
 * Toggles e limites ficam em `configuracoes` (categoria `integracoes`); segredos, só no .env —
 * aqui só se informa se estão configurados, nunca o valor.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const configService = require('./configuracaoService');
const multipedidosClient = require('./multipedidosClient');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

const LIMITES = {
  multipedidos_cupom_max_percent: { campo: 'cupomMaxPercent', min: 1, max: 100 },
  multipedidos_cupom_max_valor_fixo: { campo: 'cupomMaxValorFixo', min: 1, max: 10000 },
  multipedidos_cupom_max_validade_dias: { campo: 'cupomMaxValidadeDias', min: 1, max: 3650 }
};

function envDefinido(nome) {
  return !!(process.env[nome] || '').trim();
}

// Desde a última subida do bot. Serve para a tela avisar quando o access_token cadastrado no painel
// da Multipedidos não bate com o MULTIPEDIDOS_WEBHOOK_TOKEN do .env (eventos chegam, mas não são processados).
const contadorToken = { validos: 0, invalidos: 0, ultimoInvalidoEm: null };

function contarEventoWebhook(tokenValido) {
  if (tokenValido) contadorToken.validos++;
  else {
    contadorToken.invalidos++;
    contadorToken.ultimoInvalidoEm = new Date().toISOString();
  }
}

async function webhookAtivo() {
  try {
    const valor = await configService.getConfiguracao('multipedidos_webhook_ativo');
    // null = migração das configs ainda não rodou: mantém o comportamento anterior (captura ligada pelo .env).
    return valor === null ? true : valor === true;
  } catch (e) {
    // Banco fora: não descarta evento por causa da leitura do toggle (a gravação decide o resto).
    console.warn('⚠️ Multipedidos: não foi possível ler o toggle do webhook —', e.message);
    return true;
  }
}

async function apiAtiva() {
  try {
    return (await configService.getConfiguracao('multipedidos_api_ativa')) === true && multipedidosClient.tokenConfigurado();
  } catch (_) {
    return false;
  }
}

async function estatisticasWebhook() {
  const conn = await mysql.createConnection(mysql2Config);
  try {
    const [[linha]] = await conn.execute(
      `SELECT MAX(recebido_em) AS ultimo,
              SUM(recebido_em >= NOW() - INTERVAL 1 DAY) AS ultimas24h,
              COUNT(*) AS total
         FROM webhook_eventos WHERE origem = 'multipedidos'`
    );
    return { ultimoEvento: linha.ultimo, ultimas24h: Number(linha.ultimas24h || 0), total: Number(linha.total || 0) };
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return { ultimoEvento: null, ultimas24h: 0, total: 0 };
    throw e;
  } finally {
    await conn.end();
  }
}

async function getStatus() {
  const cfg = await configService.getConfiguracoesPorCategoria('integracoes');
  const val = (chave) => (cfg[chave] ? cfg[chave].valor : null);
  return {
    configurada: Object.keys(cfg).length > 0, // false = falta rodar a migração
    webhook: {
      ativo: val('multipedidos_webhook_ativo') === true,
      segredoConfigurado: envDefinido('MULTIPEDIDOS_WEBHOOK_SECRET'),
      accessTokenConfigurado: envDefinido('MULTIPEDIDOS_WEBHOOK_TOKEN'),
      accessToken: { ...contadorToken },
      ...(await estatisticasWebhook())
    },
    api: {
      ativa: val('multipedidos_api_ativa') === true,
      tokenConfigurado: multipedidosClient.tokenConfigurado(),
      ultimoLogin: multipedidosClient.getUltimoLogin()
    },
    limites: {
      cupomMaxPercent: val('multipedidos_cupom_max_percent'),
      cupomMaxValorFixo: val('multipedidos_cupom_max_valor_fixo'),
      cupomMaxValidadeDias: val('multipedidos_cupom_max_validade_dias'),
      cupomPrefixo: val('multipedidos_cupom_prefixo')
    }
  };
}

/** Aplica só os campos enviados. Lança Error com mensagem para o operador quando algo não pode ser ligado. */
async function salvar(dados = {}) {
  if (typeof dados.webhookAtivo === 'boolean') {
    if (dados.webhookAtivo && !envDefinido('MULTIPEDIDOS_WEBHOOK_SECRET')) {
      throw new Error('Defina MULTIPEDIDOS_WEBHOOK_SECRET no .env antes de ativar o webhook.');
    }
    await configService.setConfiguracao('multipedidos_webhook_ativo', dados.webhookAtivo);
  }

  if (typeof dados.apiAtiva === 'boolean') {
    if (dados.apiAtiva && !multipedidosClient.tokenConfigurado()) {
      throw new Error('Defina MULTIPEDIDOS_TOKEN no .env antes de ativar a API.');
    }
    await configService.setConfiguracao('multipedidos_api_ativa', dados.apiAtiva);
    if (!dados.apiAtiva) multipedidosClient.invalidarSessao();
  }

  for (const [chave, regra] of Object.entries(LIMITES)) {
    if (dados[regra.campo] === undefined || dados[regra.campo] === null || dados[regra.campo] === '') continue;
    const n = Number(dados[regra.campo]);
    if (!Number.isFinite(n) || n < regra.min || n > regra.max) {
      throw new Error(`Valor inválido para ${regra.campo} (entre ${regra.min} e ${regra.max}).`);
    }
    await configService.setConfiguracao(chave, n);
  }

  if (typeof dados.cupomPrefixo === 'string') {
    const prefixo = dados.cupomPrefixo.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(prefixo)) {
      throw new Error('Prefixo do cupom: 2 a 12 caracteres, só letras e números.');
    }
    await configService.setConfiguracao('multipedidos_cupom_prefixo', prefixo);
  }

  return getStatus();
}

/** Login só-leitura para validar o token — funciona mesmo com a API desligada (para testar antes de ligar). */
async function testarApi() {
  try {
    const sessao = await multipedidosClient.login();
    return { ok: true, restaurantId: sessao.restaurantId };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

module.exports = { webhookAtivo, apiAtiva, getStatus, salvar, testarApi, contarEventoWebhook };
