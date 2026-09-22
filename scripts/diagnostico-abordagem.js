'use strict';

/**
 * Diagnóstico de uma abordagem ativa (pós-venda ou indicado) que não deu certo para um contato.
 *
 * Mostra, para o telefone informado: a identidade conhecida (incluindo @lid), a trilha de execução
 * do fluxo, a fila de abordagem e se a resposta digitada casaria com algum gatilho de texto.
 *
 * Uso:
 *   node scripts/diagnostico-abordagem.js 5547999998888
 *   node scripts/diagnostico-abordagem.js 5547999998888 1     # testa a resposta "1" contra os gatilhos
 *
 * Somente leitura: não altera nada.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('../services/telefoneService');

const alvo = String(process.argv[2] || '').replace(/\D/g, '');
const resposta = process.argv[3] != null ? String(process.argv[3]) : '1';

if (!alvo) {
  console.error('Informe o telefone com DDI e DDD. Ex.: node scripts/diagnostico-abordagem.js 5547999998888');
  process.exit(1);
}

const titulo = (s) => console.log(`\n=== ${s} ===`);

async function valorConfig(conn, chave, padrao) {
  try {
    const [rows] = await conn.execute('SELECT valor FROM configuracoes WHERE chave = ? LIMIT 1', [chave]);
    return (rows[0] && rows[0].valor) || padrao;
  } catch (_) {
    return padrao;
  }
}

function emMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

(async () => {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });

  const consultar = async (sql, params = []) => {
    try {
      const [rows] = await conn.execute(sql, params);
      return rows;
    } catch (e) {
      console.log(`  (consulta indisponível: ${e.message})`);
      return [];
    }
  };

  try {
    titulo('identidade do contato');
    const alvoContato = telefone.clausulaIn('whatsapp_id', alvo);
    const contatos = alvoContato ? await consultar(
      `SELECT id, whatsapp_id, whatsapp_lid, nome, canal_id FROM contatos WHERE ${alvoContato.sql}`,
      alvoContato.params) : [];
    if (!contatos.length) console.log('  contato não encontrado');
    if (contatos.length > 1) {
      console.log('  >>> o mesmo número está cadastrado em mais de um formato (9º dígito).');
    }
    for (const c of contatos) {
      console.log(`  id=${c.id}  telefone=${c.whatsapp_id}  lid=${c.whatsapp_lid || '(nenhum)'}  canal=${c.canal_id || '-'}`);
      if (c.whatsapp_lid) {
        console.log('  >>> contato com @lid: quando o bot abre a conversa, a resposta chega por esse outro id.');
      }
    }

    titulo('trilha de execução do fluxo (mais antigo primeiro)');
    // Por variantes: registros antigos podem estar gravados sem o 9º dígito, e ficariam escondidos.
    const alvoLogs = telefone.clausulaIn('whatsapp_id', alvo);
    const logs = alvoLogs ? await consultar(
      `SELECT created_at, chat_id, fluxo_nome, evento, mensagem, detalhes_json
         FROM fluxo_exec_logs
        WHERE ${alvoLogs.sql}
        ORDER BY id DESC LIMIT 40`,
      alvoLogs.params) : [];
    if (!logs.length) console.log('  nenhum registro');
    for (const l of logs.reverse()) {
      const detalhes = l.detalhes_json ? String(l.detalhes_json) : '';
      console.log(`  ${new Date(l.created_at).toLocaleString('pt-BR')} | ${l.chat_id || '-'} | ${l.fluxo_nome || '-'} | ${l.evento} | ${l.mensagem}${detalhes ? ' | ' + detalhes.slice(0, 140) : ''}`);
    }
    const esperou = logs.some((l) => l.evento === 'wait_start');
    const respondeu = logs.some((l) => l.evento === 'wait_response');
    if (esperou && !respondeu) {
      console.log('\n  >>> o fluxo ficou esperando e a resposta nunca chegou nele.');
      console.log('      Causas: contato com @lid (veja acima), processo reiniciado, ou gatilho de texto no caminho.');
    }

    titulo('fila de abordagem');
    const alvoFila = telefone.clausulaIn('whatsapp_id', alvo);
    const fila = alvoFila ? await consultar(
      `SELECT id, evento, status, motivo, tentativas, agendado_para, processado_em
         FROM abordagens_fila WHERE ${alvoFila.sql} ORDER BY id DESC LIMIT 5`, alvoFila.params) : [];
    if (!fila.length) console.log('  nenhum item: a abordagem nem chegou a ser enfileirada');
    for (const f of fila) {
      console.log(`  #${f.id} ${f.evento} ${f.status}${f.motivo ? ' (' + f.motivo + ')' : ''}`
        + ` tentativas=${f.tentativas} agendado=${f.agendado_para} processado=${f.processado_em || '-'}`);
    }
    const pendente = fila.find((f) => f.status === 'pendente');

    titulo('o bot consegue enviar agora?');

    // Sem o scheduler ligado, a fila enche e nada sai — e o bot continua respondendo normalmente.
    const ultimoCiclo = await valorConfig(conn, 'abordagem_ultimo_ciclo', null);
    if (!ultimoCiclo) {
      console.log('  scheduler: NUNCA registrou um ciclo.');
      console.log('  >>> ou o processo não subiu depois desta versão, ou o scheduler não ligou.');
      console.log('      Confira: sudo pm2 logs pizzaria-crm --nostream | grep -i scheduler');
    } else {
      const seg = Math.round((Date.now() - new Date(String(ultimoCiclo).replace(' ', 'T')).getTime()) / 1000);
      const saudavel = seg >= 0 && seg < 180;
      console.log(`  scheduler: último ciclo há ${seg} s (${ultimoCiclo}) -> ${saudavel ? 'OK' : 'PARADO'}`);
      if (!saudavel) console.log('  >>> o scheduler deveria rodar a cada 60 s. Reinicie o processo.');
    }

    const ini = await valorConfig(conn, 'horario_funcionamento_inicio', '00:00');
    const fim = await valorConfig(conn, 'horario_funcionamento_fim', '23:59');
    const agora = new Date();
    const minutos = agora.getHours() * 60 + agora.getMinutes();
    const dentro = minutos >= emMinutos(ini) && minutos <= emMinutos(fim);
    console.log(`  horário de funcionamento: ${ini} às ${fim}`);
    console.log(`  agora: ${agora.toLocaleTimeString('pt-BR')} -> ${dentro ? 'DENTRO' : 'FORA (a abordagem espera a loja abrir)'}`);

    const fluxos = await consultar(
      "SELECT id, nome, ativo FROM fluxos WHERE gatilho LIKE '%pedido_concluido%' ORDER BY ativo DESC, id");
    console.log('  fluxo de pós-venda: ' + (fluxos.length
      ? fluxos.map((f) => `#${f.id} "${f.nome}" ${f.ativo ? 'ATIVO' : 'inativo'}`).join(' | ')
      : 'nenhum cadastrado'));

    if (pendente && !dentro) {
      console.log('\n  >>> item PENDENTE e fora do horário: é só esperar a loja abrir.');
    }

    // Pós-venda sem oferta elegível inicia e encerra em silêncio, sem mandar nada. Visto de fora,
    // parece que o fluxo não rodou — por isso vale mostrar a conta por campanha.
    titulo('o que o pós-venda ofereceria a este contato');
    try {
      const fluxoService = require('../services/fluxoService');
      const participacao = require('../services/participacaoService');
      const posVenda = fluxos.find((f) => f.ativo);

      const todos = await fluxoService.listarFluxos({ ativo: true });
      const candidatos = todos.filter((f) => f.tipo !== 'automacao'
        && (!posVenda || f.id !== posVenda.id)
        && f.gatilho && f.gatilho.oferta && f.gatilho.oferta.ativa);

      if (!candidatos.length) {
        console.log('  Nenhuma campanha ativa está marcada como oferta.');
        console.log('  >>> abra a campanha, nó Gatilho, e ligue "Oferecer este fluxo no pós-venda".');
      } else {
        const historico = await participacao.historicoDoContato(alvo,
          { fluxoIdEmAberto: posVenda ? posVenda.id : null });
        let elegiveis = 0;
        for (const f of candidatos) {
          const regra = f.gatilho.oferta.elegivel_se || 'nunca_participou';
          const situacao = participacao.situacaoDe(historico, f.id);
          const pode = participacao.elegivel(situacao, regra);
          if (pode) elegiveis++;
          const h = historico[f.id];
          const quando = h && h.ultimoInicio ? `, último início ${new Date(h.ultimoInicio).toLocaleString('pt-BR')}` : '';
          console.log(`  #${f.id} "${f.nome}"`);
          console.log(`      regra: ${regra} | situação do contato: ${situacao}${quando} -> ${pode ? 'OFERECE' : 'NÃO oferece'}`);
        }
        console.log(`\n  Total elegível: ${elegiveis}`);
        if (!elegiveis) {
          console.log('  >>> com zero, o fluxo inicia e encerra em SILÊNCIO: o cliente não recebe nada.');
          console.log('      Para testar com este número, mude a regra da campanha para "sempre",');
          console.log('      ou use um número que ainda não participou.');
        }
      }
    } catch (e) {
      console.log(`  não foi possível calcular: ${e.message}`);
    }

    titulo(`a resposta "${resposta}" dispara algum gatilho de texto?`);
    try {
      const gatilhoService = require('../services/gatilhoService');
      const g = await gatilhoService.verificarGatilho(resposta);
      console.log(g ? `  SIM: gatilho "${g.tipo}"` : '  não');
    } catch (e) {
      console.log(`  não foi possível verificar: ${e.message}`);
    }
  } finally {
    await conn.end();
  }
})().then(() => process.exit(0)).catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
