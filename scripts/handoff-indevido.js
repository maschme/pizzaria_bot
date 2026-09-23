'use strict';

/**
 * Encontra contatos que caíram na campanha legada por engano.
 *
 * Até 22/09/2026, quando QUALQUER fluxo do tipo "campanha" terminava sem ter enviado cupom, o bot
 * entregava o contato à campanha legada na Missão 2 e mandava "MISSÃO 1 CONCLUÍDA". Todos os
 * modelos são tipo "campanha", então o pós-venda e o fluxo do indicado disparavam isso ao encerrar:
 * um cliente que só fez um pedido recebia a mensagem do nada e ficava esperando indicações.
 *
 * O bug está corrigido (fluxo iniciado pelo sistema não faz mais handoff). Este script mostra quem
 * ficou com a sessão aberta por causa dele: contatos cuja última execução foi de um fluxo iniciado
 * por evento e que têm sessão de campanha na Missão 2.
 *
 * Uso:
 *   node scripts/handoff-indevido.js              # só mostra
 *   node scripts/handoff-indevido.js --aplicar    # remove as sessões encontradas
 *
 * Remover a sessão não apaga contato, cupom, meta nem histórico: o cliente apenas deixa de estar
 * "aguardando contatos" numa campanha em que nunca entrou.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');

const aplicar = process.argv.includes('--aplicar');

(async () => {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });

  try {
    // Fluxos que o sistema inicia: são os que disparavam o handoff por engano.
    const [fluxosEvento] = await conn.execute(
      "SELECT id, nome FROM fluxos WHERE gatilho LIKE '%\"tipo\":\"evento\"%' OR gatilho LIKE '%pedido_concluido%' OR gatilho LIKE '%indicacao_registrada%'");
    if (!fluxosEvento.length) {
      console.log('\nNenhum fluxo iniciado por evento. Nada a verificar.\n');
      return;
    }
    const ids = fluxosEvento.map((f) => f.id);
    console.log(`\nFluxos iniciados pelo sistema: ${fluxosEvento.map((f) => `#${f.id} "${f.nome}"`).join(', ')}`);

    // Contatos que terminaram um desses fluxos.
    const [fins] = await conn.execute(
      `SELECT DISTINCT whatsapp_id, chat_id FROM fluxo_exec_logs
        WHERE evento = 'fluxo_end' AND fluxo_id IN (${ids.map(() => '?').join(',')})`, ids);
    if (!fins.length) {
      console.log('Nenhum contato terminou esses fluxos ainda.\n');
      return;
    }

    const [sessoes] = await conn.execute(
      'SELECT numero, dados, criado_em, atualizado_em FROM sessoes_campanha');

    const suspeitos = [];
    for (const s of sessoes) {
      let d = {};
      try { d = typeof s.dados === 'string' ? JSON.parse(s.dados) : (s.dados || {}); } catch (_) { continue; }
      if (Number(d.etapa) !== 2) continue; // só a Missão 2, que é onde o handoff deixa o contato

      const digitos = String(s.numero || '').replace(/\D/g, '');
      const casou = fins.some((f) => String(f.whatsapp_id || '') === digitos
        || String(f.chat_id || '').replace(/\D/g, '') === digitos);
      if (casou) suspeitos.push({ numero: s.numero, criado: s.criado_em, sub: d.subEtapa, desconto: d.descontoTotal });
    }

    if (!suspeitos.length) {
      console.log('Nenhuma sessão de campanha aberta por handoff indevido.\n');
      return;
    }

    console.log(`\n${suspeitos.length} contato(s) com sessão da campanha legada na Missão 2`);
    console.log('após terminarem um fluxo que o BOT iniciou:\n');
    for (const s of suspeitos) {
      const d = String(s.numero).replace(/\D/g, '');
      console.log(`  …${d.slice(-4)}  criada ${new Date(s.criado).toLocaleString('pt-BR')}`
        + `  etapa 2/${s.sub || '?'}  desconto ${s.desconto || 0}%`);
    }

    if (!aplicar) {
      console.log('\nNada foi alterado. Para remover essas sessões:');
      console.log('   node scripts/handoff-indevido.js --aplicar\n');
      return;
    }

    let removidas = 0;
    for (const s of suspeitos) {
      const [r] = await conn.execute('DELETE FROM sessoes_campanha WHERE numero = ?', [s.numero]);
      removidas += r.affectedRows;
    }
    console.log(`\n${removidas} sessão(ões) removida(s). Contatos, cupons e metas ficaram intactos.`);
    console.log('Reinicie o processo para limpar também as sessões em memória:');
    console.log('   sudo pm2 restart pizzaria-crm\n');
  } finally {
    await conn.end();
  }
})().then(() => process.exit(0)).catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
