const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const Gatilho = sequelize.define('Gatilho', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nome: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  tipo: {
    type: DataTypes.ENUM('campanha', 'atendimento', 'promocao', 'outro'),
    defaultValue: 'outro'
  },
  palavrasChave: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON array de palavras-chave',
    get() {
      const raw = this.getDataValue('palavrasChave');
      return raw ? JSON.parse(raw) : [];
    },
    set(value) {
      this.setDataValue('palavrasChave', JSON.stringify(value));
    }
  },
  mensagemExata: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  prioridade: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Maior = mais prioritário'
  },
  configuracoes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON com configurações específicas do gatilho',
    get() {
      const raw = this.getDataValue('configuracoes');
      return raw ? JSON.parse(raw) : {};
    },
    set(value) {
      this.setDataValue('configuracoes', JSON.stringify(value));
    }
  }
}, {
  tableName: 'gatilhos',
  timestamps: true
});

module.exports = { Gatilho, sequelize };
