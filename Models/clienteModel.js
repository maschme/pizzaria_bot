const { Sequelize, DataTypes } = require('sequelize');

// Configuração da conexão com o MySQL usando suas credenciais
const sequelize = new Sequelize('pizzaria', 'mitouser', 'naoteconto', {
  host: 'localhost',
  dialect: 'mysql'
});


const Cliente = sequelize.define('Cliente', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  nome: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  telefone: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  endereco: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  numero: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  complemento: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bairro: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  ticket_medio: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  total_faturado: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  compras: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  ultimo_pedido: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  pontos: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  cliente_desde: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  preferencias: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'clientes',
  timestamps: false, // se não tiver colunas `createdAt` e `updatedAt`
});

module.exports = Cliente;

