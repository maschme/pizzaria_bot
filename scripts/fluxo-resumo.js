'use strict';

/**
 * Mostra o mapa de um fluxo: por onde ele passa, o que envia e onde termina.
 *
 * Serve para responder "de onde veio esta mensagem?". Nem tudo que o cliente recebe durante uma
 * campanha está no fluxo: quando um fluxo de campanha termina SEM ter enviado cupom, o bot legado
 * assume as Missões 2 e 3, e aquelas mensagens vivem no código e nas configurações, não no editor.
 * O resumo diz, no fim, qual dos dois casos é o seu.
 *
 * Uso:
 *   node scripts/fluxo-resumo.js 2
 *   node scripts/fluxo-resumo.js "Campanha 30"
 *   node scripts/fluxo-resumo.js            # lista os fluxos
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');

const alvo = String(process.argv[2] || '').trim();

const ENVIAM_CUPOM = new Set(['enviar_cupom', 'multipedidos_criar_cupom', 'multipedidos_alterar_cupom']);

function resumir(texto, limite = 90) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > limite ? `${t.slice(0, limite)}…` : t;
}

function descreverNo(n) {
  const d = n.data || {};
  switch (n.type) {
    case 'trigger': return d.tipo === 'evento' ? `gatilho: evento "${d.evento}"`
      : `gatilho: texto ${JSON.stringify(d.palavrasChave || [])}`;
    case 'message': return `ENVIA: "${resumir(d.texto)}"`;
    case 'wait': return `espera a resposta do cliente${d.timeout ? ` (até ${Math.round(d.timeout / 3600000)} h)` : ''}`;
    case 'wait_contacts': return `espera ${d.meta || '?'} contatos (indicações)`;
    case 'condition': return `condição: ${resumir(d.condicao || d.valorComparacao, 40)}`;
    case 'condition_var': return `se {{${d.variavelNome}}} ${d.operador} "${d.valorComparacao}"`;
    case 'ia': return `pergunta à inteligência artificial, guarda em {{${d.variavelSaida || 'respostaIA'}}}`;
    case 'action': return `ação: ${d.tipo}${ENVIAM_CUPOM.has(d.tipo) ? '  <<< ENVIA CUPOM' : ''}`;
    case 'end': return d.mensagemFinal ? `FIM, enviando "${resumir(d.mensagemFinal)}"` : 'FIM';
    default: return n.type;
  }
}

(async () => {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });

  try {
    if (!alvo) {
      const [todos] = await conn.execute('SELECT id, nome, tipo, ativo FROM fluxos ORDER BY ativo DESC, id');
      console.log('\nFluxos cadastrados:\n');
      for (const f of todos) {
        console.log(`  #${f.id}  ${f.ativo ? 'ATIVO   ' : 'inativo '} ${f.nome}  (tipo: ${f.tipo})`);
      }
      console.log('\nPara ver um: node scripts/fluxo-resumo.js <id ou parte do nome>\n');
      return;
    }

    const porId = /^\d+$/.test(alvo);
    const [rows] = porId
      ? await conn.execute('SELECT * FROM fluxos WHERE id = ?', [Number(alvo)])
      : await conn.execute('SELECT * FROM fluxos WHERE nome LIKE ? ORDER BY ativo DESC LIMIT 1', [`%${alvo}%`]);

    const f = rows[0];
    if (!f) {
      console.error(`Nenhum fluxo encontrado para "${alvo}".`);
      process.exit(1);
    }

    const ler = (v) => {
      if (!v) return null;
      try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; }
    };
    const nodes = ler(f.nodes) || [];
    const edges = ler(f.edges) || [];
    const gatilho = ler(f.gatilho) || {};

    console.log(`\n=== #${f.id} "${f.nome}" ===`);
    console.log(`tipo: ${f.tipo} | ${f.ativo ? 'ATIVO' : 'inativo'} | ${nodes.length} nós`);
    if (gatilho.oferta && gatilho.oferta.ativa) {
      console.log(`oferecido no pós-venda: sim ("${gatilho.oferta.titulo || f.nome}", regra ${gatilho.oferta.elegivel_se || 'nunca_participou'})`);
    }

    console.log('\n--- caminho a partir do gatilho ---');
    const porNodeId = new Map(nodes.map((n) => [n.id, n]));
    const saidas = new Map();
    for (const e of edges) {
      if (!saidas.has(e.source)) saidas.set(e.source, []);
      saidas.get(e.source).push(e);
    }

    const inicio = nodes.find((n) => n.type === 'trigger') || nodes[0];
    const visto = new Set();
    const caminhar = (id, prefixo, rotulo) => {
      const n = porNodeId.get(id);
      if (!n) return;
      const repetido = visto.has(id);
      console.log(`${prefixo}${rotulo ? `[${rotulo}] ` : ''}${descreverNo(n)}${repetido ? '  (já mostrado acima)' : ''}`);
      if (repetido) return;
      visto.add(id);
      const proximas = saidas.get(id) || [];
      for (const e of proximas) {
        const marca = e.sourceHandle === 'output-true' ? 'sim'
          : e.sourceHandle === 'output-false' ? 'não' : '';
        caminhar(e.target, `${prefixo}  `, marca);
      }
    };
    if (inicio) caminhar(inicio.id, '  ', '');

    console.log('\n--- o que acontece quando este fluxo termina ---');
    const enviaCupom = nodes.some((n) => n.type === 'action' && ENVIAM_CUPOM.has((n.data || {}).tipo));
    const ehCampanha = f.tipo === 'campanha' || String(f.nome).toLowerCase().includes('campanha');
    const porEvento = gatilho.tipo === 'evento';

    if (!ehCampanha) {
      console.log('  Nada além do fluxo. Ele não é do tipo campanha.');
    } else if (porEvento) {
      console.log('  Nada além do fluxo. É o BOT que inicia este fluxo (gatilho de evento),');
      console.log('  e nesse caso não há entrega para a campanha antiga.');
    } else if (enviaCupom) {
      console.log('  Nada além do fluxo. Ele envia cupom, ou seja, conduz a campanha até o fim sozinho.');
    } else {
      console.log('  >>> O BOT ANTIGO ASSUME AQUI.');
      console.log('  Este fluxo é de campanha, o cliente o inicia por texto e ele termina SEM enviar cupom.');
      console.log('  Ao terminar, o cliente é passado para a Missão 2 (as 10 indicações) e recebe a');
      console.log('  mensagem configurada em Dashboard > Whats > Configurações,');
      console.log('  na chave "campanha_missao2_mensagem".');
      console.log('  As Missões 2 e 3 são conduzidas pelo bot antigo, fora do editor de fluxos.');
    }
    console.log('');
  } finally {
    await conn.end();
  }
})().then(() => process.exit(0)).catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
