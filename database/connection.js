require('dotenv').config();
const { Sequelize } = require('sequelize');

// Configuração centralizada do banco (Opção 1: uma instância = um .env = um banco por empresa)
const dbConfig = {
  host: process.env.DB_HOST || 'vms.cutplay.com.br',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  username: process.env.DB_USER || 'mitouser',
  password: process.env.DB_PASSWORD || 'naoteconto',
  database: process.env.DB_NAME || 'pizzaria',
  dialect: 'mysql',
  logging: false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
};
// mysql2 createConnection usa "user"; Sequelize usa "username"
dbConfig.user = dbConfig.username;

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging,
    pool: dbConfig.pool
  }
);

// Testar conexão
async function testarConexao() {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexão com MySQL estabelecida com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar no MySQL:', error.message);
    return false;
  }
}

module.exports = { sequelize, dbConfig, testarConexao };
