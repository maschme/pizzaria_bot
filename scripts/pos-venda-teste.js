'use strict';

/**
 * Dispara o pós-venda para um número, sem depender de um pedido real.
 *
 * Coloca uma abordagem na fila; o processo que já está rodando (pizzaria-crm) a pega no próximo
 * ciclo do scheduler, em até 60 s, e inicia o fluxo de pós-venda. Serve para testar o menu de
 * campanhas e a escolha do cliente sem fazer pedido no cardápio e sem esperar o atraso configurado.
 *
 * Pula de propósito a regra de "não repetir em 7 dias", que vale para o disparo automático — por
 * isso é um script de teste, para usar com o SEU número.
 *
 * Uso:
 *   node scripts/pos-venda-teste.js 5547999998888
 *   node scripts/pos-venda-teste.js 5547999998888 "Marcos"
 *   node scripts/pos-venda-teste.js 5547999998888 --limpar          # zera antes e dispara de novo
 *   node scripts/pos-venda-teste.js 5547999998888 --so-limpar       # só zera, não dispara
 *
 * `--limpar` marca como descartadas as abordagens de pós-venda que ainda estão pendentes ou
 * iniciadas para esse número, deixando o terreno limpo para um teste do zero. Não apaga linha nem
 * histórico: só muda o status, e o motivo fica registrado.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('../services/telefoneService');
const fluxoService = require('../services/fluxoService');
const abordagemService = require('../services/abordagemService');
const posVendaService = require('../services/posVendaService');

const args = process.argv.slice(2);
const limpar = args.includes('--limpar') || args.includes('--so-limpar');
const soLimpar = args.includes('--so-limpar');
const posicionais = args.filter((a) => !a.startsWith('--'));

const alvo = telefone.canonico(posicionais[0] || '');
const nome = String(posicionais[1] || '').trim();

if (!alvo || alvo.length < 12) {
  console.error('Informe o telefone com DDI e DDD. Ex.: node scripts/pos-venda-teste.js 5547999998888');
  process.exit(1);
}

/** Descarta as abordagens de pós-venda ainda abertas para o número, em qualquer formato. */
async function limparFila() {
  const alvoSql = telefone.clausulaIn('whatsapp_id', alvo);
  if (!alvoSql) return;

  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });
  try {
    const [antes] = await conn.execute(
      `SELECT id, status FROM abordagens_fila
        WHERE ${alvoSql.sql} AND evento = 'pedido_concluido' AND status IN ('pendente','iniciado')`,
      alvoSql.params
    );
    if (!antes.length) {
      console.log('Nada a limpar: nenhuma abordagem de pós-venda aberta para este número.');
      return;
    }
    const [r] = await conn.execute(
      `UPDATE abordagens_fila
          SET status = 'descartado', motivo = 'limpo para reteste', processado_em = NOW()
        WHERE ${alvoSql.sql} AND evento = 'pedido_concluido' AND status IN ('pendente','iniciado')`,
      alvoSql.params
    );
    console.log(`🧹 ${r.affectedRows} abordagem(ns) descartada(s): ${antes.map((a) => `#${a.id} (${a.status})`).join(', ')}`);
    console.log('   A regra de não repetir em 7 dias deixa de contar essas.');
  } finally {
    await conn.end();
  }
}

(async () => {
  if (limpar) await limparFila();
  if (soLimpar) {
    console.log('\nPronto. Para disparar um novo pós-venda:');
    console.log(`   node scripts/pos-venda-teste.js ${alvo}\n`);
    return;
  }

  const fluxo = await fluxoService.buscarFluxoPorEvento('pedido_concluido');
  if (!fluxo) {
    console.error('❌ Nenhum fluxo ATIVO com gatilho "pedido_concluido". Ative o fluxo de pós-venda e tente de novo.');
    process.exit(1);
  }
  console.log(`Fluxo de pós-venda: "${fluxo.nome}" (#${fluxo.id})`);

  if (await abordagemService.temOptOut(alvo)) {
    console.error(`❌ ${alvo} está com opt-out: pediu para não receber mensagens. Desfaça antes de testar.`);
    process.exit(1);
  }

  const noHorario = await abordagemService.dentroDoHorario();
  if (!noHorario) {
    const configService = require('../services/configuracaoService');
    const ini = await configService.getConfiguracao('horario_funcionamento_inicio').catch(() => '?');
    const fim = await configService.getConfiguracao('horario_funcionamento_fim').catch(() => '?');
    const agora = new Date();
    const [h, m] = String(ini).split(':').map(Number);
    const faltam = Number.isFinite(h)
      ? Math.round((h * 60 + (m || 0)) - (agora.getHours() * 60 + agora.getMinutes()))
      : null;

    console.log('');
    console.log('  ┌──────────────────────────────────────────────────────────────┐');
    console.log('  │  ATENÇÃO: FORA DO HORÁRIO DE FUNCIONAMENTO                   │');
    console.log('  └──────────────────────────────────────────────────────────────┘');
    console.log(`  A loja atende das ${ini} às ${fim} e agora são ${agora.toLocaleTimeString('pt-BR')}.`);
    console.log('  A abordagem VAI PARA A FILA, mas a mensagem NÃO SERÁ ENVIADA agora.');
    if (faltam !== null && faltam > 0) {
      const hh = Math.floor(faltam / 60);
      const mm = faltam % 60;
      console.log(`  Ela sai quando a loja abrir, daqui a ${hh ? hh + ' h e ' : ''}${mm} min.`);
    }
    console.log('  Para testar agora, amplie o horário em Dashboard → Whats → Configurações');
    console.log('  (horario_funcionamento_inicio) e devolva o valor depois do teste.');
    console.log('');
  }

  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });
  try {
    // Referência única: não colide com o dedupe de um pedido real.
    const referencia = `teste:${Date.now()}`;
    const fimDaJanela = new Date(Date.now() + posVendaService.JANELA_HORAS * 3600000);

    const r = await abordagemService.enfileirar({
      whatsappId: alvo,
      evento: 'pedido_concluido',
      fluxoId: fluxo.id,
      referencia,
      variaveis: {
        pedidoNumero: 'TESTE',
        nomeCliente: nome,
        posVendaAte: fimDaJanela.toISOString(),
        primeiroPedido: 'nao',
        usouCupom: 'nao'
      },
      atrasoMin: 0,
      validadeHoras: posVendaService.JANELA_HORAS
    });

    if (!r.enfileirado) {
      console.error(`❌ Não enfileirou: ${r.motivo}`);
      process.exit(1);
    }
    console.log(`✅ Abordagem #${r.id} na fila para ${alvo}.`);
    console.log(noHorario
      ? '   A mensagem deve chegar em até 60 s.'
      : '   Sairá quando entrar no horário de funcionamento.');
    console.log('\nPara acompanhar:');
    console.log('   sudo pm2 logs pizzaria-crm --nostream --lines 40 | grep -iE "abordagem|oferta"');
    console.log(`   node scripts/diagnostico-abordagem.js ${alvo}`);
  } finally {
    await conn.end();
  }
})().then(() => process.exit(0)).catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
