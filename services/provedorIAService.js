const { ProvedorIA } = require('../Models/ProvedorIAModel');
const axios = require('axios');
const OpenAI = require('openai');

// Cache de provedores e clientes
let cacheProvedores = {};
let clientesIA = {};
let provedorPrincipal = null;

async function carregarProvedores() {
  const provedores = await ProvedorIA.findAll({ where: { ativo: true } });
  cacheProvedores = {};
  clientesIA = {};
  
  for (const p of provedores) {
    cacheProvedores[p.nome] = p;
    
    // Cria cliente OpenAI para provedores compatíveis
    if (['openai', 'alibaba', 'openrouter'].includes(p.tipo)) {
      clientesIA[p.nome] = new OpenAI({
        apiKey: p.apiKey,
        baseURL: p.baseUrl
      });
    }
    
    if (p.isPrincipal) {
      provedorPrincipal = p;
    }
  }
  
  console.log(`🤖 ${provedores.length} provedores de IA carregados`);
  return cacheProvedores;
}

async function getProvedorPrincipal() {
  if (!provedorPrincipal) {
    await carregarProvedores();
  }
  return provedorPrincipal;
}

async function enviarParaIA(mensagens, provedorNome = null, modelo = null) {
  // Usa provedor principal se não especificado
  let provedor = provedorNome ? cacheProvedores[provedorNome] : provedorPrincipal;
  
  if (!provedor) {
    await carregarProvedores();
    provedor = provedorNome ? cacheProvedores[provedorNome] : provedorPrincipal;
  }
  
  if (!provedor) {
    throw new Error('Nenhum provedor de IA configurado');
  }
  
  const modeloFinal = modelo || provedor.modeloPadrao;
  const cliente = clientesIA[provedor.nome];
  
  try {
    const start = Date.now();
    
    if (cliente) {
      // Usa cliente OpenAI
      const completion = await cliente.chat.completions.create({
        model: modeloFinal,
        messages: mensagens,
        ...provedor.configuracoes
      });
      
      const duration = Date.now() - start;
      const usage = completion.usage;
      
      console.log({
        provedor: provedor.nome,
        modelo: modeloFinal,
        tokens_prompt: usage?.prompt_tokens,
        tokens_resposta: usage?.completion_tokens,
        tempo_ms: duration
      });
      
      return completion.choices[0].message.content;
    } else {
      // Usa axios para APIs custom
      const response = await axios.post(
        provedor.baseUrl,
        {
          model: modeloFinal,
          messages: mensagens,
          ...provedor.configuracoes
        },
        {
          headers: {
            'Authorization': `Bearer ${provedor.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const duration = Date.now() - start;
      console.log({
        provedor: provedor.nome,
        modelo: modeloFinal,
        tempo_ms: duration
      });
      
      return response.data.choices[0].message.content;
    }
  } catch (error) {
    console.error(`❌ Erro ao chamar IA (${provedor.nome}):`, error.message);
    throw error;
  }
}

async function listarProvedores(filtros = {}) {
  const where = {};
  if (filtros.ativo !== undefined) where.ativo = filtros.ativo;
  if (filtros.tipo) where.tipo = filtros.tipo;
  
  return await ProvedorIA.findAll({
    where,
    order: [['isPrincipal', 'DESC'], ['nome', 'ASC']]
  });
}

async function getProvedorPorId(id) {
  return await ProvedorIA.findByPk(id);
}

async function criarProvedor(dados) {
  // Se é principal, remove flag dos outros
  if (dados.isPrincipal) {
    await ProvedorIA.update({ isPrincipal: false }, { where: { isPrincipal: true } });
  }
  
  const provedor = await ProvedorIA.create(dados);
  await carregarProvedores(); // Recarrega cache
  return provedor;
}

async function atualizarProvedor(id, dados) {
  const provedor = await ProvedorIA.findByPk(id);
  if (!provedor) throw new Error('Provedor não encontrado');
  
  // Se é principal, remove flag dos outros
  if (dados.isPrincipal) {
    await ProvedorIA.update({ isPrincipal: false }, { where: { isPrincipal: true } });
  }
  
  await provedor.update(dados);
  await carregarProvedores(); // Recarrega cache
  return provedor;
}

async function deletarProvedor(id) {
  const provedor = await ProvedorIA.findByPk(id);
  if (!provedor) throw new Error('Provedor não encontrado');
  
  await provedor.destroy();
  await carregarProvedores(); // Recarrega cache
  return true;
}

async function definirPrincipal(id) {
  await ProvedorIA.update({ isPrincipal: false }, { where: { isPrincipal: true } });
  
  const provedor = await ProvedorIA.findByPk(id);
  if (!provedor) throw new Error('Provedor não encontrado');
  
  await provedor.update({ isPrincipal: true });
  await carregarProvedores();
  return provedor;
}

async function testarProvedor(id) {
  const provedor = await ProvedorIA.findByPk(id);
  if (!provedor) throw new Error('Provedor não encontrado');
  
  try {
    const start = Date.now();
    const resposta = await enviarParaIA(
      [{ role: 'user', content: 'Responda apenas: OK' }],
      provedor.nome
    );
    const tempo = Date.now() - start;
    
    return {
      sucesso: true,
      resposta: resposta.substring(0, 100),
      tempo_ms: tempo
    };
  } catch (error) {
    return {
      sucesso: false,
      erro: error.message
    };
  }
}

module.exports = {
  carregarProvedores,
  getProvedorPrincipal,
  enviarParaIA,
  listarProvedores,
  getProvedorPorId,
  criarProvedor,
  atualizarProvedor,
  deletarProvedor,
  definirPrincipal,
  testarProvedor
};
