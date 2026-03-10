const { Sequelize, DataTypes } = require('sequelize');

// Configuração da conexão com o MySQL usando suas credenciais
const sequelize = new Sequelize('pizzaria', 'mitouser', 'naoteconto', {
  host: 'localhost',
  dialect: 'mysql'
});

const ContextoConversa = sequelize.define('conversas_atuais', {
  telefone: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false,
  },
  contexto: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  etapa: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  atualizado_em: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: false
});

module.exports = ContextoConversa;
