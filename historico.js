const { v4: uuidv4 } = require('uuid');
const Atendimento = require('./Models/Atendimento');
const HistoricoAtendimento = require('./Models/HistoricoAtendimento');
const { getprompt } = require('./utils/prompts');
const { getDataeHora } = require('./utils/global');
const { getClientePorWhatsId } = require('./services/clienteService');
const { getUltimoPedidoClientePorWhatsID } = require('./services/pedidosService');


const memoria = {}; // { atendimento_id: [...] }

async function buscarOuCriarAtendimento(numero) {
  let atendimento = await Atendimento.findOne({
    where: { numero, status: 'aberto' }
  });

  if (!atendimento) {
     let promptInicial = await getprompt('inicial');
   const resumo = await getResumoCliente(numero);
   promptInicial += `

	Detalhes do Cliente:
	
	${resumo}

	`;
    const id = uuidv4();
    atendimento = await Atendimento.create({
      id,
      numero
    });
    memoria[id] = [{
      role: "system",
      content: promptInicial
    }];
    adicionarAoHistorico(atendimento.id, numero, "system", promptInicial) ;
  }

  return atendimento;
}

async function getHistorico(atendimento_id, tipo = 'atendimento') {
  if (!memoria[atendimento_id]) {
    const mensagens = await HistoricoAtendimento.findAll({
      where: { atendimento_id },
      order: [['createdAt', 'ASC']]
    });

    const promptInicial = await getprompt(tipo);

    memoria[atendimento_id] = mensagens.length > 0
      ? mensagens.map(m => ({ role: m.role, content: m.content }))
      : [{
          role: "system",
          content: promptInicial
        }];
  }

  return memoria[atendimento_id];
}
async function adicionarAoHistorico(atendimento_id, numero, role, content) {
  const historico = await getHistorico(atendimento_id);
    const dataHoraFormatada = await getDataeHora();

    // Certifique-se que content seja string
    const conteudoSeguro = typeof content === 'string' ? content : JSON.stringify(content);

    // ✅ Aqui garantimos que não há erro
    //content = `${conteudoSeguro}\n\n🕒 Data/Hora: ${dataHoraFormatada}`;
    content = conteudoSeguro;

    //console.log("📦 contentComData gerado:", content); // debug


  if (historico.length > 30) {
    historico.splice(1, historico.length - 30);
  }

  await HistoricoAtendimento.create({ atendimento_id, numero, role, content });
}

async function finalizarAtendimento(atendimento_id) {
  await Atendimento.update(
    { status: 'finalizado', finalizado_em: new Date() },
    { where: { id: atendimento_id } }
  );

  delete memoria[atendimento_id]; // limpa da memória
}

async function getResumoCliente(numero) {
  try {
     console.log(`📞 Número recebido: ${numero}`);

    const cliente = await getClientePorWhatsId(numero);
    console.log("🧑‍💼 Cliente encontrado:", cliente);

    const ultimopedido = await getUltimoPedidoClientePorWhatsID(numero);
    console.log("🧾 Último pedido encontrado:", ultimopedido);

    const nomeCliente = cliente?.nome || 'Cliente não identificado';
    const preferencias = cliente?.preferencias || 'Nenhuma preferência registrada.';
    const ultpedido = ultimopedido?.detalhes || null;

    console.log("📌 Nome:", nomeCliente);
    console.log("📌 Preferências:", preferencias);
    console.log("📌 Último pedido (detalhes):", ultpedido);


    const resumo = `👤 Cliente: ${nomeCliente}

💡 Resumo de Preferências:
${preferencias}

🛒 Último Pedido:
${ultpedido}
`;

    return resumo;
  } catch (error) {
    console.error('Erro ao consultar resumo cliente:', error.message);
    return '❌ Erro ao buscar resumo do cliente.';
  }
}





module.exports = {
  buscarOuCriarAtendimento,
  getHistorico,
  adicionarAoHistorico,
  finalizarAtendimento
};

