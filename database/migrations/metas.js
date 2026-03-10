'use strict';

/**
 * Migração: tabelas metas e contato_metas para controle dinâmico de campanhas.
 * Permite cadastrar metas (entrada_grupo, 10_indicacoes, cupom_30, etc.) e registrar
 * quais contatos já concluíram cada uma – sem precisar de novas colunas em contatos.
 */

const mysql = require('mysql2/promise');
const { dbConfig } = require('../connection');

const mysql2Config = {
  host: dbConfig.host,
  port: dbConfig.port || 3306,
  user: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.database
};

async function run() {
  const conn = await mysql.createConnection(mysql2Config);

  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS metas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(80) NOT NULL COMMENT 'Identificador único (ex: entrada_grupo, 10_indicacoes)',
        descricao VARCHAR(255) NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_nome (nome)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela metas criada ou já existente.');

    const metasPadrao = [
      { nome: 'entrada_grupo', descricao: 'Entrou no grupo de promoções da campanha' },
      { nome: '10_indicacoes', descricao: 'Concluiu 10 indicações (campanha 30%)' },
      { nome: 'cupom_30_resgatado', descricao: 'Resgatou cupom de 30%' }
    ];
    for (const m of metasPadrao) {
      await conn.execute(
        'INSERT IGNORE INTO metas (nome, descricao, ativo) VALUES (?, ?, 1)',
        [m.nome, m.descricao]
      );
    }
    console.log('✅ Metas padrão inseridas (se não existirem).');

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS contato_metas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        whatsapp_id VARCHAR(50) NOT NULL,
        meta_id INT NOT NULL,
        concluido TINYINT(1) NOT NULL DEFAULT 1,
        concluido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_whatsapp_meta (whatsapp_id, meta_id),
        FOREIGN KEY (meta_id) REFERENCES metas(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅ Tabela contato_metas criada ou já existente.');
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW' || err.message.includes('foreign key')) {
      console.log('⏭️ Tabela contato_metas pode já existir com outra estrutura. Ignorando FK.');
    } else {
      throw err;
    }
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('❌ Erro na migração metas:', err.message);
  process.exit(1);
});

module.exports = { run };
