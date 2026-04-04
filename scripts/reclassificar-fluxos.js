#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { Fluxo } = require('../Models/FluxoModel');

function detectarTipoPorNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const tipos = new Set(list.map(n => n?.type).filter(Boolean));
  if (tipos.has('trigger_webhook') || tipos.has('trigger_schedule')) return 'automacao';
  if (tipos.has('trigger') || tipos.has('message') || tipos.has('wait') || tipos.has('wait_contacts')) return 'campanha';
  return null;
}

async function main() {
  const fluxos = await Fluxo.findAll({ order: [['id', 'ASC']] });
  let alterados = 0;

  for (const f of fluxos) {
    const tipoAtual = f.tipo;
    const sugerido = detectarTipoPorNodes(f.nodes);
    if (!sugerido) continue;
    if (tipoAtual === sugerido) continue;

    await f.update({ tipo: sugerido });
    alterados++;
    console.log(`- Fluxo ${f.id} "${f.nome}": ${tipoAtual} -> ${sugerido}`);
  }

  console.log(`\nConcluído. ${alterados} fluxo(s) reclassificado(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Erro ao reclassificar fluxos:', err.message);
  process.exit(1);
});

