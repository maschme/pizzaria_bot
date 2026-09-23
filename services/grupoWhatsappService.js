const { GrupoWhatsapp } = require('../Models/GrupoWhatsappModel');
const { Op } = require('sequelize');

// Cache em memória
let cacheGrupos = null;
let cacheTimestamp = null;
const CACHE_TTL = 30000; // 30 segundos

/**
 * Lista grupos de forma resiliente.
 * getChats() quebra em versões novas do WhatsApp Web (GroupMetadata.update undefined).
 * Fallback lê Store.Chat direto, sem forçar update de metadata.
 */
async function listarGruposDoWhatsapp(client, { forcar = false } = {}) {
  // 0) Motor Evolution: busca só os grupos (getChats também baixa todas as
  //    conversas, lento em conta grande) e, se `forcar`, sem cache.
  if (typeof client._buscarGrupos === 'function') {
    const chats = await client._buscarGrupos({ forcar });
    return chats.map((c) => ({
      grupoId: c.id._serialized,
      nome: c.name || c.id._serialized,
      participantes: c.participants?.length || 0,
      chatObj: c
    }));
  }

  // 1) Tenta API oficial
  try {
    const chats = await client.getChats();
    return chats
      .filter((c) => c?.isGroup && String(c.id?._serialized || '').endsWith('@g.us'))
      .map((c) => ({
        grupoId: c.id._serialized,
        nome: c.name || c.formattedTitle || c.id._serialized,
        participantes: c.participants?.length || 0,
        chatObj: c
      }));
  } catch (e) {
    console.warn('⚠️ client.getChats() falhou, usando fallback Store.Chat:', e.message || e);
  }

  // 2) Fallback via Puppeteer / Store interno
  if (!client.pupPage) {
    throw new Error('WhatsApp Web não disponível (pupPage ausente)');
  }

  const raw = await client.pupPage.evaluate(() => {
    const out = [];
    try {
      const chats = window.Store?.Chat?.getModelsArray?.() || [];
      for (const chat of chats) {
        try {
          const id = chat.id?._serialized || '';
          if (!id.endsWith('@g.us')) continue;
          // Ignora canais/newsletter se algum id estranho passar
          if (id.includes('@newsletter') || id.includes('@broadcast')) continue;

          let participantes = 0;
          try {
            const parts = chat.groupMetadata?.participants;
            if (parts?.getModelsArray) participantes = parts.getModelsArray().length;
            else if (parts?._models) participantes = parts._models.length;
            else if (Array.isArray(parts)) participantes = parts.length;
          } catch (_) { /* metadata não carregada */ }

          out.push({
            grupoId: id,
            nome: chat.formattedTitle || chat.name || id,
            participantes
          });
        } catch (_) { /* chat individual inválido */ }
      }
    } catch (err) {
      return { __error: err?.message || String(err) };
    }
    return out;
  });

  if (raw && raw.__error) {
    throw new Error('Fallback Store.Chat falhou: ' + raw.__error);
  }

  const lista = (Array.isArray(raw) ? raw : []).map((g) => ({
    grupoId: g.grupoId,
    nome: g.nome,
    participantes: g.participantes || 0,
    chatObj: null
  }));
  // Store.Chat só tem os chats já carregados no WhatsApp Web: lista parcial,
  // não serve de base para remover grupos do banco.
  lista.parcial = true;
  return lista;
}

// Estado da sincronização, exposto ao painel (loading/aviso). Uma por vez:
// quem pedir enquanto outra roda recebe a mesma promise.
const estadoSync = {
  emAndamento: false,
  origem: null,          // 'conexao' | 'manual'
  etapa: null,           // texto curto para o painel
  inicio: null,
  fim: null,
  resultado: null,
  erro: null
};
let syncEmCurso = null;

function getEstadoSincronizacao() {
  return { ...estadoSync };
}

function iniciarSync(origem, trabalho) {
  if (syncEmCurso) return syncEmCurso;
  Object.assign(estadoSync, {
    emAndamento: true, origem, etapa: 'Lendo grupos do WhatsApp',
    inicio: new Date(), fim: null, resultado: null, erro: null
  });
  syncEmCurso = (async () => {
    try {
      const r = await trabalho();
      estadoSync.resultado = r;
      return r;
    } catch (e) {
      estadoSync.erro = e.message || String(e);
      throw e;
    } finally {
      estadoSync.emAndamento = false;
      estadoSync.etapa = null;
      estadoSync.fim = new Date();
      syncEmCurso = null;
    }
  })();
  return syncEmCurso;
}

function sincronizarGrupos(client, { forcar = false } = {}) {
  return iniciarSync('manual', () => executarSincronizacao(client, { forcar }));
}

/**
 * Sincronização disparada ao conectar o número. Logo após o pareamento a
 * Evolution ainda não baixou os grupos e devolve lista vazia — tenta de novo
 * algumas vezes, mantendo o painel em "sincronizando" durante a espera.
 */
function sincronizarAoConectar(client, { tentativas = 4, intervaloMs = 45000 } = {}) {
  return iniciarSync('conexao', async () => {
    for (let i = 1; ; i++) {
      if (!client?.info) throw new Error('WhatsApp desconectou durante a sincronização');
      estadoSync.etapa = i === 1
        ? 'Lendo grupos do WhatsApp'
        : `Aguardando o WhatsApp baixar os grupos (tentativa ${i} de ${tentativas})`;
      const r = await executarSincronizacao(client, { forcar: i > 1 });
      if (r.total || i >= tentativas) return r;
      console.log(`⏳ Nenhum grupo retornado ainda; nova tentativa em ${intervaloMs / 1000}s`);
      await new Promise((ok) => setTimeout(ok, intervaloMs));
    }
  });
}

async function executarSincronizacao(client, { forcar = false } = {}) {
  console.log('🔄 Iniciando sincronização de grupos do WhatsApp...');

  try {
    if (!client?.info) {
      throw new Error('WhatsApp não conectado ainda');
    }

    const grupos = await listarGruposDoWhatsapp(client, { forcar });
    console.log(`📋 Encontrados ${grupos.length} grupos`);
    estadoSync.etapa = `Gravando ${grupos.length} grupos`;

    let novos = 0;
    let atualizados = 0;
    let linksObtidos = 0;
    let linksManuais = 0;
    let errosIndividuais = 0;

    for (const g of grupos) {
      try {
        const grupoId = g.grupoId;
        const nome = g.nome;
        let participantes = g.participantes || 0;

        // Se temos o objeto Chat, tenta participantes e link
        let linkConvite = null;
        if (g.chatObj) {
          try {
            participantes = g.chatObj.participants?.length || participantes;
          } catch (_) { /* ignore */ }
          try {
            const inviteCode = await g.chatObj.getInviteCode();
            if (inviteCode) {
              linkConvite = `https://chat.whatsapp.com/${inviteCode}`;
              linksObtidos++;
              console.log(`🔗 Link obtido automaticamente: ${nome}`);
            }
          } catch (_) {
            // Sem permissão de admin
          }
        }

        const grupoExistente = await GrupoWhatsapp.findOne({ where: { grupoId } });
        const linkExistente = grupoExistente?.linkConvite;
        const linkFinal = linkConvite || linkExistente || null;
        if (!linkConvite && linkExistente) linksManuais++;

        if (!grupoExistente) {
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
          await grupoExistente.update({
            nome,
            participantes,
            linkConvite: linkFinal,
            ultimaSincronizacao: new Date()
          });
          atualizados++;
        }
      } catch (eGrupo) {
        errosIndividuais++;
        console.warn(`⚠️ Falha ao sincronizar grupo ${g?.grupoId || '?'}:`, eGrupo.message || eGrupo);
      }
    }

    // Remove os grupos que o número conectado não tem mais (ex.: trocou o número).
    // Só com lista completa e não vazia: vazia/parcial apagaria grupos válidos.
    let removidos = 0;
    const removidosEmUso = [];
    if (grupos.length && !grupos.parcial) {
      const orfaos = await GrupoWhatsapp.findAll({
        where: { grupoId: { [Op.notIn]: grupos.map((g) => g.grupoId) } }
      });
      for (const o of orfaos) {
        if (o.ativo || o.isGrupoGeral || o.bairro) removidosEmUso.push(o.nome || o.grupoId);
        await o.destroy();
        removidos++;
        console.log(`➖ Removido (não está no número conectado): ${o.nome || o.grupoId}`);
      }
    }

    cacheTimestamp = null;

    console.log(`\n✅ Sincronização concluída:`);
    console.log(`   📊 Total: ${grupos.length} grupos`);
    console.log(`   ➕ Novos: ${novos}`);
    console.log(`   🔄 Atualizados: ${atualizados}`);
    console.log(`   🔗 Links automáticos: ${linksObtidos}`);
    console.log(`   ✋ Links manuais preservados: ${linksManuais}`);
    console.log(`   ➖ Removidos: ${removidos}`);
    if (removidosEmUso.length) console.log(`   ⚠️ Removidos que estavam configurados: ${removidosEmUso.join(', ')}`);
    if (errosIndividuais) console.log(`   ⚠️ Erros individuais: ${errosIndividuais}`);

    return {
      total: grupos.length,
      novos,
      atualizados,
      removidos,
      removidosEmUso,
      linksObtidos,
      linksManuais,
      errosIndividuais
    };
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('❌ Erro na sincronização:', msg);
    if (error?.stack) console.error(error.stack);
    throw new Error(msg);
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

function apenasDigitos(s) {
  if (s == null) return '';
  return String(s).replace(/\D/g, '');
}

function escaparCsv(valor) {
  const s = valor == null ? '' : String(valor);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Extrai participantes via Store interno (evita getChatById / GroupMetadata.update).
 */
async function extrairParticipantesViaStore(client, grupoId) {
  if (!client.pupPage) throw new Error('WhatsApp Web não disponível (pupPage ausente)');

  const raw = await client.pupPage.evaluate(async (gid) => {
    try {
      const chats = window.Store?.Chat?.getModelsArray?.() || [];
      let chatModel = chats.find((c) => c.id?._serialized === gid) || null;

      if (!chatModel && window.Store?.WidFactory) {
        try {
          const wid = window.Store.WidFactory.createWid(gid);
          chatModel = window.Store.Chat.get(wid) || null;
        } catch (_) { /* ignore */ }
      }

      if (!chatModel) {
        return { ok: false, error: 'Grupo não encontrado no WhatsApp (abra o grupo no celular e tente de novo)' };
      }

      // Tenta atualizar metadata com API nova (sem GroupMetadata.update quebrado)
      try {
        if (window.Store?.GroupMetadata?.compare && chatModel.id) {
          // no-op: só garante módulo carregado
        }
        const queryFn =
          window.Store?.GroupQueryAndUpdate ||
          window.Store?.queryAndUpdateGroupMetadataById ||
          (window.mR && window.mR.findModule && window.mR.findModule('queryAndUpdateGroupMetadataById')?.[0]?.queryAndUpdateGroupMetadataById);

        if (typeof queryFn === 'function') {
          await queryFn(gid);
        } else if (typeof window.require === 'function') {
          try {
            const job = window.require('WAWebGroupQueryJob');
            if (job?.queryAndUpdateGroupMetadataById) {
              await job.queryAndUpdateGroupMetadataById(gid);
            }
          } catch (_) { /* ignore */ }
        }
      } catch (_) {
        // segue com metadata já carregada em memória
      }

      // Recarrega chat após possível update
      const chats2 = window.Store?.Chat?.getModelsArray?.() || [];
      chatModel = chats2.find((c) => c.id?._serialized === gid) || chatModel;

      const nomeGrupo = chatModel.formattedTitle || chatModel.name || gid;
      const meta = chatModel.groupMetadata;
      if (!meta || !meta.participants) {
        return {
          ok: false,
          error: 'Metadados do grupo não carregados. Abra o grupo no WhatsApp do celular e tente novamente.'
        };
      }

      let list = [];
      try {
        if (meta.participants.getModelsArray) list = meta.participants.getModelsArray();
        else if (meta.participants._models) list = meta.participants._models;
        else if (Array.isArray(meta.participants)) list = meta.participants;
      } catch (e) {
        return { ok: false, error: 'Falha ao ler participantes: ' + (e?.message || String(e)) };
      }

      const apenasDigitos = (s) => String(s || '').replace(/\D/g, '');
      const participantes = list.map((p) => {
        const id = p.id?._serialized || '';
        const contact = p.contact;
        let numero = '';
        let nome = '';
        let pushname = '';

        if (contact) {
          nome = contact.name || contact.pushname || contact.shortName || '';
          pushname = contact.pushname || '';
          if (contact.phoneNumber) {
            const pn = contact.phoneNumber._serialized || contact.phoneNumber.user || contact.phoneNumber;
            numero = apenasDigitos(pn);
          } else if (contact.number) {
            numero = apenasDigitos(contact.number);
          }
        }

        if (!numero && id.endsWith('@c.us')) numero = apenasDigitos(id);

        // Em contas @lid, às vezes o PN está em contact.phoneNumber
        if (!numero && p.id?.user && String(id).includes('@lid') && contact?.phoneNumber) {
          numero = apenasDigitos(contact.phoneNumber.user || contact.phoneNumber);
        }

        return {
          whatsapp_id: id,
          numero,
          nome,
          pushname,
          whatsapp_lid: id.includes('@lid') ? id : '',
          is_admin: !!(p.isAdmin || p.isSuperAdmin),
          is_super_admin: !!p.isSuperAdmin
        };
      });

      return {
        ok: true,
        grupo: { grupoId: gid, nome: nomeGrupo, total: participantes.length },
        participantes
      };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }, grupoId);

  if (!raw || !raw.ok) {
    throw new Error(raw?.error || 'Falha ao extrair participantes via Store');
  }
  return raw;
}

function formatarErroWhatsapp(error) {
  if (!error) return 'Erro desconhecido';
  if (typeof error === 'string') return error;
  let msg = error.message || error.msg || '';
  if (!msg && error.name) msg = error.name;
  if (!msg) msg = String(error);
  // Erros do Puppeteer costumam ser longos; mantém o essencial
  if (msg.includes("reading 'update'")) {
    return 'Falha interna do WhatsApp Web (getChatById/GroupMetadata). Usando método alternativo ou abra o grupo no celular.';
  }
  return msg.length > 400 ? msg.slice(0, 400) + '...' : msg;
}

/**
 * Extrai participantes de um grupo WhatsApp (ao vivo via client).
 * @param {import('whatsapp-web.js').Client} client
 * @param {string} grupoId - ex.: 120363...@g.us
 * @returns {Promise<{ grupo: Object, participantes: Array }>}
 */
async function extrairParticipantesGrupo(client, grupoId) {
  if (!client?.info) throw new Error('WhatsApp não conectado');
  const id = decodeURIComponent(String(grupoId || '').trim());
  if (!id || !id.includes('@g.us')) {
    throw new Error('grupoId inválido (esperado ...@g.us)');
  }

  console.log(`📇 Extraindo participantes do grupo: ${id}`);

  // Método principal: Store (resiliente às mudanças do WhatsApp Web)
  try {
    const viaStore = await extrairParticipantesViaStore(client, id);
    const participantes = viaStore.participantes || [];
    participantes.sort((a, b) => {
      if (a.is_super_admin !== b.is_super_admin) return a.is_super_admin ? -1 : 1;
      if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
      return (a.nome || a.numero || '').localeCompare(b.nome || b.numero || '', 'pt-BR');
    });
    console.log(`✅ Extraídos ${participantes.length} participantes de "${viaStore.grupo.nome}"`);
    return {
      grupo: { ...viaStore.grupo, total: participantes.length },
      participantes
    };
  } catch (eStore) {
    console.warn('⚠️ Extração via Store falhou:', formatarErroWhatsapp(eStore));
  }

  // Fallback legado (pode falhar no WhatsApp Web atual)
  try {
    const chat = await client.getChatById(id);
    if (!chat || !chat.isGroup) {
      throw new Error('Chat não encontrado ou não é um grupo');
    }

    const participantesRaw = chat.participants || [];
    const participantes = [];
    for (const p of participantesRaw) {
      const contactId = p.id?._serialized || (typeof p.id === 'string' ? p.id : null);
      let nome = '';
      let pushname = '';
      let numero = '';
      let whatsappLid = '';
      if (contactId) {
        if (String(contactId).includes('@lid')) whatsappLid = contactId;
        if (String(contactId).endsWith('@c.us')) numero = apenasDigitos(contactId);
      }
      participantes.push({
        whatsapp_id: contactId || '',
        numero,
        nome,
        pushname,
        whatsapp_lid: whatsappLid,
        is_admin: !!p.isAdmin,
        is_super_admin: !!p.isSuperAdmin
      });
    }

    console.log(`✅ Extraídos ${participantes.length} participantes (fallback getChatById)`);
    return {
      grupo: {
        grupoId: chat.id._serialized,
        nome: chat.name || chat.formattedTitle || id,
        total: participantes.length
      },
      participantes
    };
  } catch (eLegacy) {
    const msg = formatarErroWhatsapp(eLegacy);
    console.error('❌ Extração de participantes falhou:', msg);
    if (eLegacy?.stack) console.error(eLegacy.stack);
    throw new Error(msg);
  }
}

/**
 * Converte lista de participantes em CSV (UTF-8 com BOM para Excel).
 */
function participantesParaCsv(grupo, participantes) {
  const header = [
    'grupo_id',
    'grupo_nome',
    'numero',
    'whatsapp_id',
    'whatsapp_lid',
    'nome',
    'pushname',
    'is_admin',
    'is_super_admin'
  ];
  const linhas = [header.join(',')];
  for (const p of participantes) {
    linhas.push([
      escaparCsv(grupo.grupoId),
      escaparCsv(grupo.nome),
      escaparCsv(p.numero),
      escaparCsv(p.whatsapp_id),
      escaparCsv(p.whatsapp_lid),
      escaparCsv(p.nome),
      escaparCsv(p.pushname),
      escaparCsv(p.is_admin ? '1' : '0'),
      escaparCsv(p.is_super_admin ? '1' : '0')
    ].join(','));
  }
  return `\uFEFF${linhas.join('\r\n')}`;
}

function slugArquivo(nome) {
  return String(nome || 'grupo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 48) || 'grupo';
}

module.exports = {
  sincronizarGrupos,
  sincronizarAoConectar,
  getEstadoSincronizacao,
  listarGrupos,
  getGruposAtivos,
  getGrupoPorBairro,
  atualizarGrupo,
  ativarGrupo,
  desativarGrupo,
  definirGrupoGeral,
  isGrupoCampanha,
  getEstatisticas,
  invalidarCache,
  extrairParticipantesGrupo,
  participantesParaCsv,
  slugArquivo
};
