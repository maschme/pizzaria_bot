const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const ProvedorIA = sequelize.define('ProvedorIA', {
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
  descricao: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  tipo: {
    type: DataTypes.ENUM('openai', 'openrouter', 'alibaba', 'anthropic', 'custom'),
    defaultValue: 'custom'
  },
  baseUrl: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  apiKey: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  modeloPadrao: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  modelos: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('modelos');
      return raw ? JSON.parse(raw) : [];
    },
    set(value) {
      this.setDataValue('modelos', JSON.stringify(value));
    }
  },
  configuracoes: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('configuracoes');
      return raw ? JSON.parse(raw) : {};
    },
    set(value) {
      this.setDataValue('configuracoes', JSON.stringify(value));
    }
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  isPrincipal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'provedores_ia',
  timestamps: true
});

module.exports = { ProvedorIA };
