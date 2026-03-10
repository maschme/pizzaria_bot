const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const Configuracao = sequelize.define('Configuracao', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  chave: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  valor: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  tipo: {
    type: DataTypes.ENUM('boolean', 'string', 'number', 'json'),
    defaultValue: 'string'
  },
  categoria: {
    type: DataTypes.STRING(50),
    defaultValue: 'geral'
  },
  descricao: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'configuracoes',
  timestamps: true
});

module.exports = { Configuracao, sequelize };
