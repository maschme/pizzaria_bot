const { Fluxo } = require('../Models/FluxoModel');

// Cache de fluxos ativos
let cacheFluxos = {};
let cacheTimestamp = null;
const CACHE_TTL = 60000;

async function carregarFluxos() {
  const fluxos = await Fluxo.findAll({ where: { ativo: true } });
  cacheFluxos = {};
  fluxos.forEach(f => {
    cacheFluxos[f.id] = f;
    
    // Indexa por gatilho para busca rápida
    if (f.gatilho) {
      if (f.gatilho.tipo === 'mensagem_exata') {
        cacheFluxos[`msg:${f.gatilho.valor.toLowerCase()}`] = f;
      } else if (f.gatilho.tipo === 'palavra_chave') {
        f.gatilho.palavras?.forEach(p => {
          cacheFluxos[`kw:${p.toLowerCase()}`] = f;
        });
      }
    }
  });
  cacheTimestamp = Date.now();
  console.log(`🔀 ${fluxos.length} fluxos carregados`);
  return cacheFluxos;
}

async function buscarFluxoPorGatilho(mensagem) {
  const agora = Date.now();
  if (!cacheTimestamp || (agora - cacheTimestamp) > CACHE_TTL) {
    await carregarFluxos();
  }
  
  const msgLower = mensagem.toLowerCase().trim();
  
  // Busca por mensagem exata
  if (cacheFluxos[`msg:${msgLower}`]) {
    return cacheFluxos[`msg:${msgLower}`];
  }
  
  // Busca por palavra-chave
  for (const [key, fluxo] of Object.entries(cacheFluxos)) {
    if (key.startsWith('kw:') && msgLower.includes(key.replace('kw:', ''))) {
      return fluxo;
    }
  }
  
  return null;
}

async function listarFluxos(filtros = {}) {
  const where = {};
  if (filtros.tipo) where.tipo = filtros.tipo;
  if (filtros.ativo !== undefined) where.ativo = filtros.ativo;
  
  return await Fluxo.findAll({
    where,
    order: [['updatedAt', 'DESC']]
  });
}

async function getFluxoPorId(id) {
  return await Fluxo.findByPk(id);
}

async function criarFluxo(dados) {
  const fluxo = await Fluxo.create({
    nome: dados.nome || 'Novo Fluxo',
    descricao: dados.descricao,
    tipo: dados.tipo || 'automacao',
    gatilho: dados.gatilho,
    nodes: dados.nodes || [],
    edges: dados.edges || [],
    viewport: dados.viewport || { x: 0, y: 0, zoom: 1 },
    ativo: false,
    versao: 1
  });
  
  cacheTimestamp = null;
  return fluxo;
}

async function atualizarFluxo(id, dados) {
  const fluxo = await Fluxo.findByPk(id);
  if (!fluxo) throw new Error('Fluxo não encontrado');
  
  // Incrementa versão se nodes ou edges mudaram
  if (dados.nodes || dados.edges) {
    dados.versao = fluxo.versao + 1;
  }
  
  await fluxo.update(dados);
  cacheTimestamp = null;
  return fluxo;
}

async function deletarFluxo(id) {
  const fluxo = await Fluxo.findByPk(id);
  if (!fluxo) throw new Error('Fluxo não encontrado');
  
  await fluxo.destroy();
  cacheTimestamp = null;
  return true;
}

async function duplicarFluxo(id, novoNome) {
  const original = await Fluxo.findByPk(id);
  if (!original) throw new Error('Fluxo não encontrado');
  
  const novo = await Fluxo.create({
    nome: novoNome || `${original.nome} (cópia)`,
    descricao: original.descricao,
    tipo: original.tipo,
    gatilho: original.gatilho,
    nodes: original.nodes,
    edges: original.edges,
    viewport: original.viewport,
    ativo: false,
    versao: 1
  });
  
  return novo;
}

async function ativarFluxo(id) {
  const fluxo = await Fluxo.findByPk(id);
  if (!fluxo) throw new Error('Fluxo não encontrado');
  
  await fluxo.update({ ativo: true });
  cacheTimestamp = null;
  return fluxo;
}

async function desativarFluxo(id) {
  const fluxo = await Fluxo.findByPk(id);
  if (!fluxo) throw new Error('Fluxo não encontrado');
  
  await fluxo.update({ ativo: false });
  cacheTimestamp = null;
  return fluxo;
}

function invalidarCache() {
  cacheTimestamp = null;
  cacheFluxos = {};
}

module.exports = {
  carregarFluxos,
  buscarFluxoPorGatilho,
  listarFluxos,
  getFluxoPorId,
  criarFluxo,
  atualizarFluxo,
  deletarFluxo,
  duplicarFluxo,
  ativarFluxo,
  desativarFluxo,
  invalidarCache
};
