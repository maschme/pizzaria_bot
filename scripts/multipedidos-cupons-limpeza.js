'use strict';

/**
 * Limpeza diária dos cupons únicos emitidos pelos fluxos na Multipedidos (docs/18-cupons-multipedidos.md §6):
 * cupom vencido e não usado é DESATIVADO lá (nunca removido — código removido fica reservado para sempre
 * e perde o histórico de resgates) e marcado como `expirado` aqui. Agendar via PM2 (roda e sai):
 *
 *   pm2 start scripts/multipedidos-cupons-limpeza.js --name cupons-limpeza-<slug> --cron "30 4 * * *" --no-autorestart
 *
 * Uso manual:  node scripts/multipedidos-cupons-limpeza.js          (executa)
 *              node scripts/multipedidos-cupons-limpeza.js --seco   (só lista o que seria expirado)
 *
 * Requer a API da Multipedidos ativa na tela de Integrações e MULTIPEDIDOS_TOKEN no .env.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const integracaoService = require('../services/multipedidosIntegracaoService');
const cupomService = require('../services/multipedidosCupomService');

async function main() {
  if (!(await integracaoService.apiAtiva())) {
    console.log('⏭️ API da Multipedidos desativada (ou sem MULTIPEDIDOS_TOKEN) — nada a fazer.');
    return;
  }

  if (process.argv.includes('--seco')) {
    const conn = await mysql.createConnection({
      host: dbConfig.host, port: dbConfig.port || 3306, user: dbConfig.username, password: dbConfig.password, database: dbConfig.database
    });
    try {
      const [rows] = await conn.query(
        `SELECT codigo, campanha, validade FROM multipedidos_cupons WHERE status = 'ativo' AND validade IS NOT NULL AND validade < NOW() ORDER BY validade`
      );
      console.log(`🔎 ${rows.length} cupom(ns) vencido(s) ainda ativo(s):`);
      for (const r of rows) console.log(`   ${r.codigo}  (${r.campanha})  venceu em ${new Date(r.validade).toLocaleString('pt-BR')}`);
    } finally {
      await conn.end();
    }
    return;
  }

  const r = await cupomService.expirarVencidos();
  console.log(`🧹 Cupons Multipedidos: ${r.analisados} vencido(s) analisado(s) → ${r.expirados} expirado(s), ${r.usados} já usado(s), ${r.sumiram} não encontrado(s) na loja.`);
  for (const erro of r.erros) console.error(`   ❌ ${erro}`);
  if (r.erros.length) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => {
    console.error('❌ Limpeza de cupons Multipedidos:', e.message);
    process.exit(1);
  });
