'use strict';

/**
 * Migra um fluxo exportado (Editor de Fluxos → Exportar) dos cupons de arquivo (`enviar_cupom`) para o
 * cupom único da Multipedidos (docs/18-cupons-multipedidos.md §2.3). Não toca no banco: lê um JSON e
 * grava outro, para importar como cópia, revisar no editor e só então ativar no lugar do antigo.
 *
 *   node scripts/migrar-fluxo-cupons-multipedidos.js <exportado.json> <saida.json> [--dias 15] [--campanha slug]
 *
 * Para cada nó `enviar_cupom`, na ordem em que aparecem a partir do gatilho:
 *   1º → "Multipedidos: criar cupom único" · demais → "Multipedidos: alterar cupom"
 *   (o percentual vem do prompt antigo: "cupom de 10% …" → 10)
 * e o trecho vira:
 *   [nó Multipedidos] → [Verificar {{cupomStatus}} = erro] ─ não → [Mensagem com o cupom] → (destino antigo)
 *                                                          └ sim → [enviar_cupom original, de arquivo] → (destino antigo)
 * Ou seja: se a API da Multipedidos falhar, o cliente recebe o cupom de arquivo como hoje.
 */

const fs = require('fs');

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function main() {
  const [entrada, saida] = process.argv.slice(2).filter((a, i, l) => !a.startsWith('--') && !(l[i - 1] || '').startsWith('--'));
  if (!entrada || !saida) {
    console.log('Uso: node scripts/migrar-fluxo-cupons-multipedidos.js <exportado.json> <saida.json> [--dias 15] [--campanha slug]');
    process.exit(1);
  }
  const dias = Math.max(1, parseInt(arg('--dias', '15'), 10) || 15);
  const fluxo = JSON.parse(fs.readFileSync(entrada, 'utf8'));
  const nodes = fluxo.nodes || [];
  const edges = fluxo.edges || [];
  const campanha = arg('--campanha', slug(fluxo.nome) || 'campanha');

  // Ordem dos nós a partir do gatilho (largura), para saber qual cupom vem primeiro.
  const inicio = nodes.find((n) => n.type === 'trigger');
  const ordem = [];
  const vistos = new Set();
  const fila = inicio ? [inicio.id] : [];
  while (fila.length) {
    const id = fila.shift();
    if (vistos.has(id)) continue;
    vistos.add(id);
    ordem.push(id);
    edges.filter((e) => e.source === id).forEach((e) => fila.push(e.target));
  }
  const cupons = ordem.map((id) => nodes.find((n) => n.id === id)).filter((n) => n && n.type === 'action' && n.data && n.data.tipo === 'enviar_cupom');
  if (cupons.length === 0) {
    console.log('Nenhum nó enviar_cupom alcançável a partir do gatilho — nada a migrar.');
    process.exit(1);
  }

  let contador = nodes.reduce((m, n) => Math.max(m, parseInt(String(n.id).replace(/\D/g, ''), 10) || 0), 0);
  const novoId = () => `node_${++contador}`;
  const novaAresta = (source, target, sourceHandle) => ({ id: `edge_mp_${source}_${target}`, source, target, sourceHandle });

  cupons.forEach((antigo, i) => {
    const prompt = String(antigo.data.promptCupom || '');
    const pct = (prompt.match(/(\d+)\s*%/) || [])[1];
    const link = (prompt.match(/https?:\/\/\S+/) || [])[0];
    if (!pct) console.warn(`⚠️ ${antigo.id}: não achei o percentual no prompt antigo — revise o comando no editor.`);
    const criar = i === 0;

    const mp = {
      id: novoId(), type: 'action', x: antigo.x, y: antigo.y,
      data: criar
        ? { tipo: 'multipedidos_criar_cupom', promptCupom: `criar cupom de ${pct || '??'}% válido por ${dias} dias a partir de hoje`, campanha, prefixoCodigo: '', metaAoResgatar: '' }
        : { tipo: 'multipedidos_alterar_cupom', promptCupom: `subir para ${pct || '??'}% e renovar a validade por ${dias} dias`, campanha, seJaUsado: 'criar_novo', seNaoExiste: 'criar_novo', metaAoResgatar: '' }
    };
    const cond = { id: novoId(), type: 'condition_var', x: antigo.x, y: antigo.y + 160, data: { variavelNome: 'cupomStatus', operador: 'igual', valorComparacao: 'erro' } };
    const msg = {
      id: novoId(), type: 'message', x: antigo.x + 340, y: antigo.y + 320,
      data: {
        delay: 500,
        texto: `🎟️ *Seu cupom de {{cupomDesconto}} de desconto:* {{cupomCodigo}}\n\nÉ só seu e vale para 1 pedido até o dia {{cupomValidade}}. 🍕\n\n`
          + (criar ? '' : 'É o mesmo código de antes — agora valendo mais!\n\n')
          + `Faça seu pedido no link abaixo e informe o cupom no final:\n${link || '(link do cardápio)'}`
      }
    };
    // o nó antigo vira o ramo de erro (fallback de arquivo), deslocado para a esquerda
    antigo.x -= 340;
    antigo.y += 320;

    const destinos = edges.filter((e) => e.source === antigo.id);
    edges.filter((e) => e.target === antigo.id).forEach((e) => { e.target = mp.id; });
    nodes.push(mp, cond, msg);
    edges.push(novaAresta(mp.id, cond.id, 'output'), novaAresta(cond.id, antigo.id, 'output-true'), novaAresta(cond.id, msg.id, 'output-false'));
    destinos.forEach((d) => edges.push({ id: `edge_mp_${msg.id}_${d.target}`, source: msg.id, target: d.target, sourceHandle: d.sourceHandle || 'output' }));
    console.log(`✅ ${antigo.id} (${pct || '?'}%) → ${mp.id} [${criar ? 'criar' : 'alterar'}] → ${cond.id} → ${msg.id}; fallback de arquivo mantido em ${antigo.id}`);
  });

  fluxo.nome = `${fluxo.nome || 'Fluxo'} (cupom único)`;
  fluxo.nodes = nodes;
  fluxo.edges = edges;
  delete fluxo.id;
  fs.writeFileSync(saida, JSON.stringify(fluxo, null, 2));
  console.log(`\n💾 ${saida}\n   campanha = "${campanha}" · validade = ${dias} dias · ${cupons.length} nó(s) migrado(s)`);
  console.log('   Próximos passos: Fluxos → Importar → revisar comandos/mensagens (botão Interpretar) → desativar o fluxo antigo → ativar o novo.');
}

main();
