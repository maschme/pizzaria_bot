const { Prompt } = require('../Models/PromptModel');

// Cache em memória
let cachePrompts = {};
let cacheTimestamp = null;
const CACHE_TTL = 60000; // 1 minuto

async function carregarPrompts() {
  const prompts = await Prompt.findAll({ where: { ativo: true } });
  cachePrompts = {};
  prompts.forEach(p => {
    cachePrompts[p.nome] = p;
  });
  cacheTimestamp = Date.now();
  console.log(`📝 ${prompts.length} prompts carregados do banco`);
  return cachePrompts;
}

async function getPrompt(nome, variaveis = {}) {
  const agora = Date.now();
  
  if (!cacheTimestamp || (agora - cacheTimestamp) > CACHE_TTL) {
    await carregarPrompts();
  }
  
  const prompt = cachePrompts[nome];
  if (!prompt) {
    console.warn(`⚠️ Prompt "${nome}" não encontrado`);
    return null;
  }
  
  // Substitui variáveis no conteúdo
  let conteudo = prompt.conteudo;
  for (const [key, value] of Object.entries(variaveis)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    conteudo = conteudo.replace(regex, value);
  }
  
  return conteudo;
}

async function listarPrompts(filtros = {}) {
  const where = {};
  
  if (filtros.tipo) where.tipo = filtros.tipo;
  if (filtros.ativo !== undefined) where.ativo = filtros.ativo;
  
  return await Prompt.findAll({ 
    where,
    order: [['tipo', 'ASC'], ['nome', 'ASC']]
  });
}

async function getPromptPorId(id) {
  return await Prompt.findByPk(id);
}

async function criarPrompt(dados) {
  const prompt = await Prompt.create(dados);
  cacheTimestamp = null; // Invalida cache
  return prompt;
}

async function atualizarPrompt(id, dados) {
  const prompt = await Prompt.findByPk(id);
  if (!prompt) throw new Error('Prompt não encontrado');
  
  // Incrementa versão se o conteúdo mudou
  if (dados.conteudo && dados.conteudo !== prompt.conteudo) {
    dados.versao = prompt.versao + 1;
  }
  
  await prompt.update(dados);
  cacheTimestamp = null; // Invalida cache
  return prompt;
}

async function deletarPrompt(id) {
  const prompt = await Prompt.findByPk(id);
  if (!prompt) throw new Error('Prompt não encontrado');
  
  await prompt.destroy();
  cacheTimestamp = null; // Invalida cache
  return true;
}

async function duplicarPrompt(id, novoNome) {
  const original = await Prompt.findByPk(id);
  if (!original) throw new Error('Prompt não encontrado');
  
  const novo = await Prompt.create({
    nome: novoNome,
    descricao: `Cópia de: ${original.descricao || original.nome}`,
    tipo: original.tipo,
    conteudo: original.conteudo,
    variaveis: original.variaveis,
    ativo: false,
    versao: 1
  });
  
  return novo;
}

function invalidarCache() {
  cacheTimestamp = null;
  cachePrompts = {};
}

module.exports = {
  carregarPrompts,
  getPrompt,
  listarPrompts,
  getPromptPorId,
  criarPrompt,
  atualizarPrompt,
  deletarPrompt,
  duplicarPrompt,
  invalidarCache
};
