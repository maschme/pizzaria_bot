const { Sequelize } = require('sequelize');

// Configuração centralizada do banco de dados (servidor externo)
const dbConfig = {
  database: 'pizzaria',
  username: 'mitouser',
  password: 'naoteconto',
  host: 'vms.cutplay.com.br',  // Servidor externo
  port: 3306,
  dialect: 'mysql',
  logging: false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
};

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
