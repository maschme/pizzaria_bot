'use strict';

/**
 * Preenche o nome dos contatos a partir dos pedidos da Multipedidos que já foram capturados em
 * webhook_eventos (antes de o webhook passar a gravar o nome sozinho).
 *
 * Uso:
 *   node scripts/contatos-nomes-multipedidos.js            # só mostra quantos seriam gravados
 *   node scripts/contatos-nomes-multipedidos.js --aplicar  # grava
 *
 * Percorre os eventos do mais antigo para o mais novo: se o cliente mudou o nome no cadastro, fica
 * o mais recente. Não imprime nome nem telefone de ninguém (dado pessoal), só contagens.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const telefone = require('../services/telefoneService');
const contatoService = require('../services/contatoService');

const APLICAR = process.argv.includes('--aplicar');
const LOTE = 200;

(async () => {
  const conn = await mysql.createConnection({
    host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username,
    password: dbConfig.password, database: dbConfig.database
  });

  // Último nome conhecido por pessoa (chave = forma curta do número).
  const porPessoa = new Map();
  let eventos = 0;
  try {
    let ultimoId = 0;
    for (;;) {
      const [rows] = await conn.execute(
        `SELECT id, body FROM webhook_eventos
          WHERE origem = 'multipedidos' AND body_json_valido = 1 AND id > ?
          ORDER BY id LIMIT ${LOTE}`,
        [ultimoId]
      );
      if (!rows.length) break;
      for (const r of rows) {
        ultimoId = r.id;
        eventos++;
        let pedido;
        try { pedido = JSON.parse(r.body); } catch (_) { continue; }
        if (!pedido || typeof pedido !== 'object') continue;
        const cliente = pedido.client && typeof pedido.client === 'object' ? pedido.client : {};
        const fone = [cliente.phone, pedido.phone].find((f) => telefone.ehPlausivelParaWhatsapp(f));
        const nome = contatoService.limparNome(cliente.name || pedido.name);
        if (!fone || !nome) continue;
        porPessoa.set(telefone.formaCurta(fone), { fone, nome });
      }
    }
  } finally {
    await conn.end();
  }

  console.log(`\n${eventos} evento(s) lidos, ${porPessoa.size} cliente(s) com telefone e nome.`);
  if (!APLICAR) {
    console.log('Nada foi gravado. Rode com --aplicar para gravar.\n');
    return;
  }

  const contagem = { criado: 0, atualizado: 0, igual: 0, ignorado: 0, erro: 0 };
  for (const { fone, nome } of porPessoa.values()) {
    try {
      const r = await contatoService.salvarNomeDoCadastro(fone, nome);
      contagem[r.acao] = (contagem[r.acao] || 0) + 1;
    } catch (e) {
      contagem.erro++;
      if (contagem.erro <= 3) console.warn('  erro:', e.message);
    }
  }
  console.log(`Contatos com nome atualizado: ${contagem.atualizado}`);
  console.log(`Contatos novos criados com nome: ${contagem.criado}`);
  console.log(`Já estavam com o nome certo: ${contagem.igual}`);
  if (contagem.ignorado) console.log(`Ignorados: ${contagem.ignorado}`);
  if (contagem.erro) console.log(`Erros: ${contagem.erro}`);
  console.log('');
})().then(() => process.exit(0)).catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
