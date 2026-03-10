const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const GrupoWhatsapp = sequelize.define('GrupoWhatsapp', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  grupoId: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: 'ID do grupo no WhatsApp (ex: 120363xxx@g.us)'
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  descricao: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  bairro: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Bairro associado ao grupo (para campanha)'
  },
  linkConvite: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  participantes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  tipo: {
    type: DataTypes.ENUM('campanha', 'promocao', 'suporte', 'outro'),
    defaultValue: 'outro'
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Se o grupo está ativo para uso na campanha'
  },
  isGrupoGeral: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Se é o grupo geral de fallback'
  },
  ultimaSincronizacao: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'grupos_whatsapp',
  timestamps: true
});

module.exports = { GrupoWhatsapp, sequelize };
