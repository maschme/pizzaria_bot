const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const RequisicaoExterna = sequelize.define('RequisicaoExterna', {
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
    type: DataTypes.STRING(50),
    allowNull: false
  },
  descricao: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  tipoHandler: {
    type: DataTypes.ENUM('ia', 'api', 'json', 'funcao'),
    defaultValue: 'ia'
  },
  promptId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  provedorId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  endpoint: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  metodo: {
    type: DataTypes.ENUM('GET', 'POST', 'PUT', 'DELETE'),
    defaultValue: 'POST'
  },
  headers: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('headers');
      return raw ? JSON.parse(raw) : {};
    },
    set(value) {
      this.setDataValue('headers', JSON.stringify(value));
    }
  },
  arquivoJson: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  funcaoNome: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  parametros: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('parametros');
      return raw ? JSON.parse(raw) : {};
    },
    set(value) {
      this.setDataValue('parametros', JSON.stringify(value));
    }
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'requisicoes_externas',
  timestamps: true
});

module.exports = { RequisicaoExterna };
