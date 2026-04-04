const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const Fluxo = sequelize.define('Fluxo', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nome: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  descricao: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  tipo: {
    type: DataTypes.ENUM('atendimento', 'campanha', 'automacao', 'suporte'),
    defaultValue: 'campanha'
  },
  gatilho: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('gatilho');
      return raw ? JSON.parse(raw) : null;
    },
    set(value) {
      this.setDataValue('gatilho', JSON.stringify(value));
    }
  },
  nodes: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('nodes');
      return raw ? JSON.parse(raw) : [];
    },
    set(value) {
      this.setDataValue('nodes', JSON.stringify(value));
    }
  },
  edges: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    get() {
      const raw = this.getDataValue('edges');
      return raw ? JSON.parse(raw) : [];
    },
    set(value) {
      this.setDataValue('edges', JSON.stringify(value));
    }
  },
  viewport: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('viewport');
      return raw ? JSON.parse(raw) : { x: 0, y: 0, zoom: 1 };
    },
    set(value) {
      this.setDataValue('viewport', JSON.stringify(value));
    }
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  versao: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  }
}, {
  tableName: 'fluxos',
  timestamps: true
});

module.exports = { Fluxo };
