'use strict';

/**
 * Cria o database do .env se não existir (uma instância = um banco por empresa).
 * Rode antes do setup: node database/create-database.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const dbName = process.env.DB_NAME || 'pizzaria';
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || ''
};

async function run() {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    await conn.execute(
      `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log('✅ Database "' + dbName + '" existe ou foi criado.');
  } catch (err) {
    console.error('❌ Erro ao criar database:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

run();
