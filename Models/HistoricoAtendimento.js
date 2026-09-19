const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const HistoricoAtendimento = sequelize.define('HistoricoAtendimento', {
  atendimento_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  numero: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.STRING,
    allowNull: false
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: 'historico_atendimento',
  timestamps: true // cria createdAt e updatedAt
});

module.exports = HistoricoAtendimento;

