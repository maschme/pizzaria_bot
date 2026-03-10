// models/HistoricoAtendimento.js
const  { Sequelize, DataTypes }  = require('sequelize');

// Configuração da conexão com o MySQL usando suas credenciais
const sequelize = new Sequelize('pizzaria', 'mitouser', 'naoteconto', {
  host: 'localhost',
  dialect: 'mysql'
});

const Atendimento = sequelize.define('Atendimento', {
  id: {
    type: DataTypes.STRING, // UUID
    primaryKey: true
  },
  numero: {
    type: DataTypes.STRING,
    allowNull: false
  },
  iniciado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  finalizado_em: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('aberto', 'finalizado'),
    defaultValue: 'aberto'
  }
}, {
  tableName: 'atendimentos',
  timestamps: false
});

module.exports = Atendimento;

