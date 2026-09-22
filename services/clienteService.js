const { Op } = require('sequelize');
const Cliente = require('../Models/clienteModel');
const telefone = require('./telefoneService');

/**
 * Cliente do cadastro legado a partir do identificador do WhatsApp.
 *
 * A coluna `telefone` guarda o número com máscara — "(47) 98450-9046" —, então a varredura começa
 * por um LIKE nos últimos 8 dígitos, que é o que sobrevive a qualquer formatação. Isso sozinho é
 * frágil: ignora o DDD e casa um cliente de outra cidade com o mesmo final. Por isso o resultado
 * passa por uma segunda checagem, comparando o número inteiro.
 */
async function getClientePorWhatsId(whatsId) {
  try {
    const numeros = String(whatsId || '').replace(/\D/g, '');
    const ultimos8 = numeros.slice(-8);
    if (ultimos8.length < 8) return null;

    const candidatos = await Cliente.findAll({
      where: { telefone: { [Op.like]: `%${ultimos8}` } },
      limit: 20
    });
    if (!candidatos.length) return null;

    // Confere DDD e DDI antes de devolver.
    const exato = candidatos.find((c) => telefone.mesmoNumero(c.telefone, whatsId));
    if (exato) return exato;

    // Nenhum bateu por inteiro. Com um único candidato, o telefone gravado provavelmente está
    // incompleto (sem DDD) — mantém o comportamento antigo. Com vários, não há como escolher.
    if (candidatos.length === 1) return candidatos[0];
    console.warn(`⚠️ ${candidatos.length} clientes terminam em ${ultimos8} e nenhum bate com ${numeros}.`);
    return null;
  } catch (error) {
    console.error('Erro ao buscar cliente por WhatsId:', error);
    return null;
  }
}

module.exports = { getClientePorWhatsId };
