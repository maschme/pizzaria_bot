'use strict';

/**
 * Banco central do painel (painel_central): empresas, instancias, eventos.
 * Cria o database e as tabelas no primeiro boot.
 */

const mysql = require('mysql2/promise');

const DB_NAME = process.env.PAINEL_DB_NAME || 'painel_central';

const baseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
};

let pool = null;

async function init() {
  const conn = await mysql.createConnection(baseConfig);
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARSET utf8mb4`);
  } finally {
    await conn.end();
  }

  pool = mysql.createPool({ ...baseConfig, database: DB_NAME, connectionLimit: 5 });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(120) NOT NULL,
      slug VARCHAR(60) NOT NULL UNIQUE,
      telefone_contato VARCHAR(30) NULL,
      plano VARCHAR(60) NULL,
      valor_mensal DECIMAL(10,2) NULL,
      status ENUM('ativa','inadimplente','suspensa','encerrada') NOT NULL DEFAULT 'ativa',
      observacoes TEXT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS instancias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      porta INT NOT NULL UNIQUE,
      pm2_name VARCHAR(80) NOT NULL,
      db_name VARCHAR(80) NOT NULL,
      dir_path VARCHAR(255) NOT NULL,
      admin_token VARCHAR(120) NULL,
      evolution_instance VARCHAR(120) NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS eventos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      instancia_id INT NULL,
      empresa_id INT NULL,
      tipo VARCHAR(40) NOT NULL,
      detalhe TEXT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_empresa (empresa_id),
      INDEX idx_instancia (instancia_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log(`🗄️  Banco ${DB_NAME} pronto`);
}

function getPool() {
  if (!pool) throw new Error('db.init() não foi chamado');
  return pool;
}

async function registrarEvento(tipo, detalhe, { empresaId = null, instanciaId = null } = {}) {
  try {
    await getPool().execute(
      'INSERT INTO eventos (empresa_id, instancia_id, tipo, detalhe) VALUES (?, ?, ?, ?)',
      [empresaId, instanciaId, tipo, String(detalhe || '').slice(0, 4000)]
    );
  } catch (e) {
    console.warn('⚠️ evento não registrado:', e.message);
  }
}

module.exports = { init, getPool, registrarEvento, DB_NAME };
