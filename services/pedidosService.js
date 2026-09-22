const { Op } = require('sequelize');
const Pedidos = require('../Models/PedidosModel');
const telefone = require('./telefoneService');

/**
 * Último pedido do cliente no cadastro legado, pelo identificador do WhatsApp.
 *
 * Mesma lógica de [clienteService](./clienteService.js): a coluna `telefone` vem com máscara, então
 * o LIKE usa os últimos 8 dígitos (com o hífen no meio, como o cadastro grava) e a confirmação
 * compara o número inteiro, para não entregar o pedido de um cliente de outro DDD.
 */
async function getUltimoPedidoClientePorWhatsID(whatsId) {
  const numeros = String(whatsId || '').replace(/\D/g, '');
  const ultimos8 = numeros.slice(-8);
  if (ultimos8.length < 8) return null;

  const parte1 = ultimos8.slice(0, 4);
  const parte2 = ultimos8.slice(4);

  const candidatos = await Pedidos.findAll({
    where: { telefone: { [Op.like]: `%${parte1}-%${parte2}%` } },
    order: [['data', 'DESC']],
    limit: 20
  });
  if (!candidatos.length) return null;

  const exato = candidatos.find((p) => telefone.mesmoNumero(p.telefone, whatsId));
  if (exato) return exato;

  // Telefone gravado sem DDD: com um candidato só, não há ambiguidade.
  if (candidatos.length === 1) return candidatos[0];
  console.warn(`⚠️ ${candidatos.length} pedidos terminam em ${ultimos8} e nenhum bate com ${numeros}.`);
  return null;
}

module.exports = { getUltimoPedidoClientePorWhatsID };
