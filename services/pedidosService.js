const { Op } = require('sequelize');
const Pedidos = require('../Models/PedidosModel');


async function getUltimoPedidoClientePorWhatsID(whatsId) {
  // Extrai apenas os números do WhatsApp ID (remove @c.us e tudo que não for dígito)
  const numeros = whatsId.replace(/\D/g, '');

  // Pega os últimos 8 dígitos
  const ultimos8 = numeros.slice(-8);

// Divide em duas partes para colocar hífen
  const parte1 = ultimos8.slice(0, 4);  // '8450'
  const parte2 = ultimos8.slice(4);     // '9046'

  // Monta o padrão com hífen para busca
  const telefoneFormatado = `%${parte1}-%${parte2}%`; // '%8450-%9046%'
  
  // Faz a busca usando LIKE nos últimos 8 dígitos
  return await Pedidos.findOne({
    where: {
      telefone: {
        [Op.like]: `%${telefoneFormatado}`
      }
    },
    order: [['data', 'DESC']]
  });
}

module.exports = { getUltimoPedidoClientePorWhatsID };
