const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const Prompt = sequelize.define('Prompt', {
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
    type: DataTypes.ENUM('sistema', 'atendimento', 'campanha', 'analise', 'extracao'),
    defaultValue: 'sistema'
  },
  conteudo: {
    type: DataTypes.TEXT('long'),
    allowNull: false
  },
  variaveis: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('variaveis');
      return raw ? JSON.parse(raw) : [];
    },
    set(value) {
      this.setDataValue('variaveis', JSON.stringify(value));
    }
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  versao: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  }
}, {
  tableName: 'prompts',
  timestamps: true
});

module.exports = { Prompt };
