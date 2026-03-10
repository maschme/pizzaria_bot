const { Gatilho } = require('../Models/GatilhoModel');

// Cache em memória
let cacheGatilhos = null;
let cacheTimestamp = null;
const CACHE_TTL = 60000; // 1 minuto

async function carregarGatilhos() {
  const agora = Date.now();

  if (cacheGatilhos && cacheTimestamp && (agora - cacheTimestamp) < CACHE_TTL) {
    return cacheGatilhos;
  }

  cacheGatilhos = await Gatilho.findAll({
    where: { ativo: true },
    order: [['prioridade', 'DESC']]
  });

  cacheTimestamp = agora;
  console.log(`📦 ${cacheGatilhos.length} gatilhos carregados do banco`);
  return cacheGatilhos;
}

async function verificarGatilho(texto) {
  const gatilhos = await carregarGatilhos();
  const textoLower = texto.toLowerCase().trim();

  for (const gatilho of gatilhos) {
    // Verifica mensagem exata primeiro (maior prioridade)
    if (gatilho.mensagemExata && texto.trim() === gatilho.mensagemExata) {
      return {
        tipo: gatilho.nome,
        gatilho: {
          id: gatilho.id,
          nome: gatilho.nome,
          tipo: gatilho.tipo,
          configuracoes: gatilho.configuracoes
        }
      };
    }

    // Verifica palavras-chave
    const palavrasChave = gatilho.palavrasChave || [];
    const encontrou = palavrasChave.some(palavra =>
      textoLower.includes(palavra.toLowerCase())
    );

    if (encontrou) {
      return {
        tipo: gatilho.nome,
        gatilho: {
          id: gatilho.id,
          nome: gatilho.nome,
          tipo: gatilho.tipo,
          configuracoes: gatilho.configuracoes
        }
      };
    }
  }

  return null;
}

async function listarGatilhos() {
  return await Gatilho.findAll({
    order: [['prioridade', 'DESC'], ['nome', 'ASC']]
  });
}

async function criarGatilho(dados) {
  const gatilho = await Gatilho.create(dados);
  invalidarCache();
  return gatilho;
}

async function atualizarGatilho(id, dados) {
  const gatilho = await Gatilho.findByPk(id);

  if (!gatilho) {
    throw new Error(`Gatilho ${id} não encontrado`);
  }

  await gatilho.update(dados);
  invalidarCache();
  return gatilho;
}

async function ativarGatilho(id) {
  return await atualizarGatilho(id, { ativo: true });
}

async function desativarGatilho(id) {
  return await atualizarGatilho(id, { ativo: false });
}

async function deletarGatilho(id) {
  const gatilho = await Gatilho.findByPk(id);

  if (!gatilho) {
    throw new Error(`Gatilho ${id} não encontrado`);
  }

  await gatilho.destroy();
  invalidarCache();
  return true;
}

function invalidarCache() {
  cacheTimestamp = null;
  cacheGatilhos = null;
}

module.exports = {
  carregarGatilhos,
  verificarGatilho,
  listarGatilhos,
  criarGatilho,
  atualizarGatilho,
  ativarGatilho,
  desativarGatilho,
  deletarGatilho,
  invalidarCache
};
