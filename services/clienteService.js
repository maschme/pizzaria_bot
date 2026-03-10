const { Op } = require('sequelize');
const Cliente = require('../Models/clienteModel');

async function getClientePorWhatsId(whatsId) {
  try {
    // Extrai apenas os números (remove "@c.us" e possíveis letras)
    const numeros = whatsId.replace(/\D/g, '');

    // Pega os últimos 8 dígitos
    const ultimos8 = numeros.slice(-8);

    // Busca no banco clientes cujo telefone termina com os 8 dígitos
    const cliente = await Cliente.findOne({
      where: {
        telefone: {
          [Op.like]: `%${ultimos8}`,
        },
      },
    });

    return cliente;
  } catch (error) {
    console.error('Erro ao buscar cliente por WhatsId:', error);
    return null;
  }
}

module.exports = { getClientePorWhatsId };

