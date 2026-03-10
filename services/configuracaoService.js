const { Configuracao } = require('../Models/ConfiguracaoModel');

// Cache em memória para performance
let cacheConfig = {};
let cacheTimestamp = null;
const CACHE_TTL = 60000; // 1 minuto

async function carregarConfiguracoes() {
  const agora = Date.now();
  
  // Retorna cache se ainda válido
  if (cacheTimestamp && (agora - cacheTimestamp) < CACHE_TTL) {
    return cacheConfig;
  }

  const configs = await Configuracao.findAll();
  cacheConfig = {};

  for (const config of configs) {
    let valor = config.valor;

    // Converte para o tipo correto
    switch (config.tipo) {
      case 'boolean':
        valor = valor === 'true';
        break;
      case 'number':
        valor = Number(valor);
        break;
      case 'json':
        try {
          valor = JSON.parse(valor);
        } catch (e) {
          valor = null;
        }
        break;
    }

    cacheConfig[config.chave] = {
      valor,
      tipo: config.tipo,
      categoria: config.categoria,
      descricao: config.descricao
    };
  }

  cacheTimestamp = agora;
  console.log('📦 Configurações carregadas do banco');
  return cacheConfig;
}

async function getConfiguracao(chave) {
  const configs = await carregarConfiguracoes();
  return configs[chave]?.valor ?? null;
}

async function getConfiguracoesPorCategoria(categoria) {
  const configs = await carregarConfiguracoes();
  const resultado = {};

  for (const [chave, dados] of Object.entries(configs)) {
    if (dados.categoria === categoria) {
      resultado[chave] = dados;
    }
  }

  return resultado;
}

async function setConfiguracao(chave, valor) {
  const config = await Configuracao.findOne({ where: { chave } });

  if (!config) {
    throw new Error(`Configuração "${chave}" não encontrada`);
  }

  // Converte valor para string para salvar
  let valorString;
  if (config.tipo === 'json') {
    valorString = JSON.stringify(valor);
  } else {
    valorString = String(valor);
  }

  await config.update({ valor: valorString });

  // Invalida cache
  cacheTimestamp = null;

  console.log(`⚙️ Configuração "${chave}" atualizada para: ${valorString}`);
  return await getConfiguracao(chave);
}

async function criarConfiguracao(dados) {
  const { chave, valor, tipo = 'string', categoria = 'geral', descricao = '' } = dados;

  let valorString;
  if (tipo === 'json') {
    valorString = JSON.stringify(valor);
  } else {
    valorString = String(valor);
  }

  const config = await Configuracao.create({
    chave,
    valor: valorString,
    tipo,
    categoria,
    descricao
  });

  // Invalida cache
  cacheTimestamp = null;

  return config;
}

async function listarConfiguracoes() {
  return await carregarConfiguracoes();
}

async function listarCategorias() {
  const configs = await Configuracao.findAll({
    attributes: ['categoria'],
    group: ['categoria']
  });
  return configs.map(c => c.categoria);
}

// Invalida o cache manualmente
function invalidarCache() {
  cacheTimestamp = null;
}

module.exports = {
  carregarConfiguracoes,
  getConfiguracao,
  getConfiguracoesPorCategoria,
  setConfiguracao,
  criarConfiguracao,
  listarConfiguracoes,
  listarCategorias,
  invalidarCache
};
