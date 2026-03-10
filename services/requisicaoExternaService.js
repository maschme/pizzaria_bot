const { RequisicaoExterna } = require('../Models/RequisicaoExternaModel');
const promptService = require('./promptService');
const provedorService = require('./provedorIAService');
const arquivoService = require('./arquivoService');
const axios = require('axios');
const { lerJson } = require('../utils/lerJson');

// Cache
let cacheRequisicoes = {};
let cacheTimestamp = null;
const CACHE_TTL = 60000;

async function carregarRequisicoes() {
  const requisicoes = await RequisicaoExterna.findAll({ where: { ativo: true } });
  cacheRequisicoes = {};
  requisicoes.forEach(r => {
    cacheRequisicoes[r.tipo] = r;
  });
  cacheTimestamp = Date.now();
  console.log(`📡 ${requisicoes.length} tipos de requisições externas carregados`);
  return cacheRequisicoes;
}

async function getRequisicao(tipo) {
  const agora = Date.now();
  if (!cacheTimestamp || (agora - cacheTimestamp) > CACHE_TTL) {
    await carregarRequisicoes();
  }
  return cacheRequisicoes[tipo];
}

async function executarRequisicao(tipo, detalhes, contexto = {}) {
  const requisicao = await getRequisicao(tipo);
  
  if (!requisicao) {
    console.warn(`⚠️ Tipo de requisição "${tipo}" não encontrado`);
    return { erro: `Tipo de requisição "${tipo}" não configurado` };
  }
  
  console.log(`📡 Executando requisição: ${tipo} (${requisicao.tipoHandler})`);
  
  try {
    switch (requisicao.tipoHandler) {
      case 'ia':
        return await executarRequisicaoIA(requisicao, detalhes, contexto);
      
      case 'api':
        return await executarRequisicaoAPI(requisicao, detalhes, contexto);
      
      case 'json':
        return await executarRequisicaoJSON(requisicao, detalhes, contexto);
      
      case 'funcao':
        return await executarRequisicaoFuncao(requisicao, detalhes, contexto);
      
      default:
        return { erro: `Tipo de handler "${requisicao.tipoHandler}" não suportado` };
    }
  } catch (error) {
    console.error(`❌ Erro na requisição ${tipo}:`, error.message);
    return { erro: error.message };
  }
}

async function executarRequisicaoIA(requisicao, detalhes, contexto) {
  // Busca o prompt associado
  let promptConteudo = null;
  
  if (requisicao.promptId) {
    const prompt = await promptService.getPromptPorId(requisicao.promptId);
    if (prompt) {
      promptConteudo = prompt.conteudo;
      // Substitui variáveis do contexto
      for (const [key, value] of Object.entries(contexto)) {
        promptConteudo = promptConteudo.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
    }
  }
  
  const mensagens = [];
  
  if (promptConteudo) {
    mensagens.push({ role: 'system', content: promptConteudo });
  }
  
  mensagens.push({ role: 'user', content: detalhes });
  
  const resposta = await provedorService.enviarParaIA(mensagens);
  return { resultado: resposta };
}

async function executarRequisicaoAPI(requisicao, detalhes, contexto) {
  const config = {
    method: requisicao.metodo,
    url: requisicao.endpoint,
    headers: requisicao.headers || {}
  };
  
  // Substitui variáveis na URL
  let url = requisicao.endpoint;
  for (const [key, value] of Object.entries(contexto)) {
    url = url.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  config.url = url;
  
  // Adiciona body para POST/PUT
  if (['POST', 'PUT'].includes(requisicao.metodo)) {
    config.data = {
      detalhes,
      ...contexto,
      ...requisicao.parametros
    };
  }
  
  const response = await axios(config);
  return { resultado: response.data };
}

async function executarRequisicaoJSON(requisicao, detalhes, contexto) {
  if (!requisicao.arquivoJson) {
    return { erro: 'Arquivo JSON não configurado' };
  }
  
  const nomeArquivo = requisicao.arquivoJson.replace('.json', '').trim();
  
  // Se o arquivo tem meta com instrução para IA, processa com IA
  const meta = arquivoService.getMeta(nomeArquivo);
  if (meta.instrucaoProcessamento && meta.instrucaoProcessamento.trim() !== '') {
    try {
      const conteudo = arquivoService.getConteudo(nomeArquivo);
      if (conteudo === null) {
        return { erro: `Arquivo "${nomeArquivo}" não encontrado` };
      }
      const contextoStr = JSON.stringify(contexto);
      const dadosStr = typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo);
      const prompt = `${meta.instrucaoProcessamento}

DADOS DO ARQUIVO (JSON):
${dadosStr}

CONTEXTO DA REQUISIÇÃO (variáveis disponíveis):
${contextoStr}

${meta.formatoRetorno ? `Retorne APENAS no seguinte formato: ${meta.formatoRetorno}` : 'Retorne o resultado em JSON quando possível.'}`;
      
      const resposta = await provedorService.enviarParaIA([
        { role: 'user', content: prompt }
      ]);
      
      let resultado = resposta.trim();
      console.log('📡 [JSON+IA] Resposta bruta da IA:', JSON.stringify(resultado));
      
      if (meta.formatoRetorno && (meta.formatoRetorno.toLowerCase().includes('json') || resultado.startsWith('{'))) {
        try {
          const jsonMatch = resultado.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resultado = JSON.parse(jsonMatch[0]);
            console.log('📡 [JSON+IA] Resultado parseado (objeto):', JSON.stringify(resultado));
          } else {
            console.log('📡 [JSON+IA] Nenhum objeto JSON encontrado na resposta');
          }
        } catch (e) {
          console.log('📡 [JSON+IA] Erro ao parsear JSON:', e.message);
        }
      }
      // Se ainda for string e contiver URL de WhatsApp, extrai link para compatibilidade
      if (typeof resultado === 'string' && resultado.includes('chat.whatsapp.com')) {
        const urlMatch = resultado.match(/https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/);
        if (urlMatch) {
          console.log('📡 [JSON+IA] Link extraído do texto:', urlMatch[0]);
          resultado = { link: urlMatch[0], linkGrupo: urlMatch[0], raw: resultado };
        }
      }
      return { resultado };
    } catch (error) {
      console.error('Erro ao processar arquivo com IA:', error.message);
      return { erro: error.message };
    }
  }
  
  // Comportamento padrão: retorna o JSON do arquivo
  if (arquivoService.existe(nomeArquivo)) {
    const dados = arquivoService.getConteudo(nomeArquivo);
    return { resultado: dados };
  }
  const dados = lerJson(nomeArquivo);
  return { resultado: dados };
}

async function executarRequisicaoFuncao(requisicao, detalhes, contexto) {
  // Funções customizadas podem ser registradas aqui
  const funcoes = {
    // Exemplo: 'calcularTaxa': (detalhes, contexto) => { ... }
  };
  
  const funcao = funcoes[requisicao.funcaoNome];
  if (!funcao) {
    return { erro: `Função "${requisicao.funcaoNome}" não encontrada` };
  }
  
  return await funcao(detalhes, contexto);
}

async function listarRequisicoes(filtros = {}) {
  const where = {};
  if (filtros.ativo !== undefined) where.ativo = filtros.ativo;
  if (filtros.tipoHandler) where.tipoHandler = filtros.tipoHandler;
  
  return await RequisicaoExterna.findAll({
    where,
    order: [['tipo', 'ASC']]
  });
}

async function getRequisicaoPorId(id) {
  return await RequisicaoExterna.findByPk(id);
}

async function criarRequisicao(dados) {
  const requisicao = await RequisicaoExterna.create(dados);
  cacheTimestamp = null;
  return requisicao;
}

async function atualizarRequisicao(id, dados) {
  const requisicao = await RequisicaoExterna.findByPk(id);
  if (!requisicao) throw new Error('Requisição não encontrada');
  
  await requisicao.update(dados);
  cacheTimestamp = null;
  return requisicao;
}

async function deletarRequisicao(id) {
  const requisicao = await RequisicaoExterna.findByPk(id);
  if (!requisicao) throw new Error('Requisição não encontrada');
  
  await requisicao.destroy();
  cacheTimestamp = null;
  return true;
}

function invalidarCache() {
  cacheTimestamp = null;
  cacheRequisicoes = {};
}

module.exports = {
  carregarRequisicoes,
  getRequisicao,
  executarRequisicao,
  listarRequisicoes,
  getRequisicaoPorId,
  criarRequisicao,
  atualizarRequisicao,
  deletarRequisicao,
  invalidarCache
};
