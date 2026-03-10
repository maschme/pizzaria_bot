const { Sequelize, DataTypes } = require('sequelize');

// Configuração da conexão com o MySQL usando suas credenciais
const sequelize = new Sequelize('pizzaria', 'mitouser', 'naoteconto', {
  host: 'localhost',
  dialect: 'mysql'
});

const Pedido = sequelize.define('pedidos', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    allowNull: false
  },
  metodo_pagamento: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    allowNull: true
  },
  desconto: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  codigo_ifood: {
    type: DataTypes.STRING,
    allowNull: true
  },
  data: {
    type: DataTypes.DATE,
    allowNull: true
  },
  tipo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  nome: {
    type: DataTypes.STRING,
    allowNull: true
  },
  taxa_entrega: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  numero_pedido: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  nota_emitida: {
    type: DataTypes.BOOLEAN,
    allowNull: true
  },
  total: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  status_pedido: {
    type: DataTypes.STRING,
    allowNull: true
  },
  detalhes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  telefone: {
    type: DataTypes.STRING,
    allowNull: true
  },
 
  usuario: {
    type: DataTypes.STRING,
    allowNull: true
  },
  origem: {
    type: DataTypes.STRING,
    allowNull: true
  },
  motoboy: {
    type: DataTypes.STRING,
    allowNull: true
  },
  total_liquido: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  taxa_servico: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  bairro: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: false
});


module.exports = Pedido;
