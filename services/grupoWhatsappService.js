const { GrupoWhatsapp } = require('../Models/GrupoWhatsappModel');
const { Op } = require('sequelize');

// Cache em memória
let cacheGrupos = null;
let cacheTimestamp = null;
const CACHE_TTL = 30000; // 30 segundos

async function sincronizarGrupos(client) {
  console.log('🔄 Iniciando sincronização de grupos do WhatsApp...');

  try {
    const chats = await client.getChats();
    const grupos = chats.filter(chat => chat.isGroup);

    console.log(`📋 Encontrados ${grupos.length} grupos`);

    let novos = 0;
    let atualizados = 0;
    let linksObtidos = 0;
    let linksManuais = 0;

    for (const grupo of grupos) {
      const grupoId = grupo.id._serialized;
      const nome = grupo.name;
      const participantes = grupo.participants?.length || 0;

      // Busca grupo existente no banco
      const grupoExistente = await GrupoWhatsapp.findOne({ where: { grupoId } });
      const linkExistente = grupoExistente?.linkConvite;

      // Tenta obter link de convite automaticamente
      let linkConvite = null;
      try {
        const inviteCode = await grupo.getInviteCode();
        if (inviteCode) {
          linkConvite = `https://chat.whatsapp.com/${inviteCode}`;
          linksObtidos++;
          console.log(`🔗 Link obtido automaticamente: ${nome}`);
        }
      } catch (e) {
        // Não é admin do grupo, não consegue pegar o link automaticamente
      }

      // Se não conseguiu obter link automaticamente, mantém o existente (manual)
      const linkFinal = linkConvite || linkExistente;
      if (!linkConvite && linkExistente) {
        linksManuais++;
      }

      if (!grupoExistente) {
        // Criar novo grupo
        await GrupoWhatsapp.create({
          grupoId,
          nome,
          participantes,
          linkConvite: linkFinal,
          ultimaSincronizacao: new Date()
        });
        novos++;
        console.log(`➕ Novo grupo: ${nome} ${linkFinal ? '✅' : '⚠️ sem link'}`);
      } else {
        // Atualizar grupo existente
        await grupoExistente.update({
          nome,
          participantes,
          linkConvite: linkFinal,
          ultimaSincronizacao: new Date()
        });
        atualizados++;
      }
    }

    // Invalida cache
    cacheTimestamp = null;

    console.log(`\n✅ Sincronização concluída:`);
    console.log(`   📊 Total: ${grupos.length} grupos`);
    console.log(`   ➕ Novos: ${novos}`);
    console.log(`   🔄 Atualizados: ${atualizados}`);
    console.log(`   🔗 Links automáticos: ${linksObtidos}`);
    console.log(`   ✋ Links manuais preservados: ${linksManuais}`);

    return {
      total: grupos.length,
      novos,
      atualizados,
      linksObtidos,
      linksManuais
    };

  } catch (error) {
    console.error('❌ Erro na sincronização:', error.message);
    throw error;
  }
}

async function listarGrupos(filtros = {}) {
  const where = {};

  if (filtros.ativo !== undefined) {
    where.ativo = filtros.ativo;
  }

  if (filtros.tipo) {
    where.tipo = filtros.tipo;
  }

  if (filtros.bairro) {
    where.bairro = { [Op.like]: `%${filtros.bairro}%` };
  }

  return await GrupoWhatsapp.findAll({
    where,
    order: [['nome', 'ASC']]
  });
}

async function getGruposAtivos() {
  const agora = Date.now();

  if (cacheGrupos && cacheTimestamp && (agora - cacheTimestamp) < CACHE_TTL) {
    return cacheGrupos;
  }

  cacheGrupos = await GrupoWhatsapp.findAll({
    where: { ativo: true },
    order: [['bairro', 'ASC']]
  });

  cacheTimestamp = agora;
  return cacheGrupos;
}

async function getGrupoPorBairro(bairro) {
  const bairroLower = bairro.toLowerCase().trim();
  
  console.log(`🔍 [DEBUG] Buscando grupo para bairro: "${bairro}" (normalizado: "${bairroLower}")`);

  // Busca grupo específico do bairro
  const grupo = await GrupoWhatsapp.findOne({
    where: {
      ativo: true,
      bairro: { [Op.like]: `%${bairroLower}%` }
    }
  });

  console.log(`🔍 [DEBUG] Resultado busca específica:`, grupo ? {
    id: grupo.id,
    nome: grupo.nome,
    bairro: grupo.bairro,
    linkConvite: grupo.linkConvite,
    ativo: grupo.ativo
  } : 'Nenhum encontrado');

  if (grupo) {
    return {
      encontrado: true,
      bairro: grupo.bairro,
      link: grupo.linkConvite,
      grupoId: grupo.grupoId,
      tipo: 'especifico'
    };
  }

  // Busca grupo geral
  const grupoGeral = await GrupoWhatsapp.findOne({
    where: {
      ativo: true,
      isGrupoGeral: true
    }
  });

  console.log(`🔍 [DEBUG] Resultado busca grupo geral:`, grupoGeral ? {
    id: grupoGeral.id,
    nome: grupoGeral.nome,
    linkConvite: grupoGeral.linkConvite,
    isGrupoGeral: grupoGeral.isGrupoGeral
  } : 'Nenhum encontrado');

  if (grupoGeral) {
    return {
      encontrado: false,
      bairro: 'Geral',
      link: grupoGeral.linkConvite,
      grupoId: grupoGeral.grupoId,
      nome: grupoGeral.nome,
      tipo: 'geral'
    };
  }

  return {
    encontrado: false,
    erro: 'Nenhum grupo configurado'
  };
}

async function atualizarGrupo(grupoId, dados) {
  const grupo = await GrupoWhatsapp.findOne({ where: { grupoId } });

  if (!grupo) {
    throw new Error(`Grupo ${grupoId} não encontrado`);
  }

  await grupo.update(dados);

  // Invalida cache
  cacheTimestamp = null;

  return grupo;
}

async function ativarGrupo(grupoId, bairro = null, isGrupoGeral = false) {
  return await atualizarGrupo(grupoId, {
    ativo: true,
    bairro,
    isGrupoGeral,
    tipo: 'campanha'
  });
}

async function desativarGrupo(grupoId) {
  return await atualizarGrupo(grupoId, {
    ativo: false,
    isGrupoGeral: false
  });
}

async function definirGrupoGeral(grupoId) {
  // Remove flag de grupo geral de todos
  await GrupoWhatsapp.update(
    { isGrupoGeral: false },
    { where: { isGrupoGeral: true } }
  );

  // Define o novo grupo geral
  return await atualizarGrupo(grupoId, {
    ativo: true,
    isGrupoGeral: true,
    tipo: 'campanha'
  });
}

async function isGrupoCampanha(grupoId) {
  const grupo = await GrupoWhatsapp.findOne({
    where: {
      grupoId,
      ativo: true,
      tipo: 'campanha'
    }
  });

  if (grupo) {
    return { valido: true, bairro: grupo.bairro || 'Geral' };
  }

  return { valido: false };
}

async function getEstatisticas() {
  const total = await GrupoWhatsapp.count();
  const ativos = await GrupoWhatsapp.count({ where: { ativo: true } });
  const campanha = await GrupoWhatsapp.count({ where: { tipo: 'campanha', ativo: true } });
  const totalParticipantes = await GrupoWhatsapp.sum('participantes', { where: { ativo: true } });

  return {
    total,
    ativos,
    campanha,
    totalParticipantes: totalParticipantes || 0
  };
}

function invalidarCache() {
  cacheTimestamp = null;
  cacheGrupos = null;
}

module.exports = {
  sincronizarGrupos,
  listarGrupos,
  getGruposAtivos,
  getGrupoPorBairro,
  atualizarGrupo,
  ativarGrupo,
  desativarGrupo,
  definirGrupoGeral,
  isGrupoCampanha,
  getEstatisticas,
  invalidarCache
};
