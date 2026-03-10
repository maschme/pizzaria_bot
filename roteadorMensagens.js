const { getContexto, setContexto } = require('./contexto'); // funções MySQL
const fs = require('fs');
const ContextoConversa = require('./Models/contextoConversaModel');
const { detectarIntencaoComGPT, gpt_get_mensagem_mkt_ativo, gpt_get_mensagem_mkt_ativo_seqsabe, gpt_gerar_audio, gpt_get_mensagem_mkt_ativo_audio} = require('../gpts/gpt_pizzaria');


async function roteadorDeMensagem(msg, db, client) {
  const telefone = msg.from;
  const texto = msg.body;

  const contexto = await getContexto(telefone, db); // busca do BD
  const intencao = await detectarIntencaoComGPT(texto); // GPT identifica o que a pessoa quer

  console.log(`[${telefone}] Intenção: ${intencao}, Contexto: ${contexto?.contexto || 'nenhum'}`);

  // Intenções paralelas que podem ser respondidas a qualquer momento
  if (intencao === 'pergunta_entrega') {
    await client.sendMessage(telefone, 'Sim, entregamos no Centro e região! 🚚🍕');
    return;
  }

  if (intencao === 'pergunta_horario') {
    await client.sendMessage(telefone, 'Funcionamos todos os dias das 18h às 23h! 🕕');
    return;
  }

  if (contexto?.contexto === 'fazendo_pedido') {
    // continua o fluxo do pedido (ex: escolher sabor, tamanho, pagamento)
    await continuarPedido(telefone, texto, contexto, db, client);
    return;
  }

  if (intencao === 'fazer_pedido') {
    await setContexto(telefone, 'fazendo_pedido', 'escolhendo_tamanho', db);
    await client.sendMessage(telefone, 'Beleza! Qual o tamanho da pizza? 🍕 Pequena, média ou grande?');
    return;
  }

  if (intencao === 'cumprimento') {
    await client.sendMessage(telefone, 'Olá! 😄 Bem-vindo à Pizzaria! Posso te ajudar com um pedido ou tirar alguma dúvida?');
    return;
  }

  // fallback
  await client.sendMessage(telefone, 'Desculpe, não entendi bem. Você quer fazer um pedido ou saber algo? 🤔');
}



async function continuarPedido(telefone, texto, contexto, db, client) {
  if (contexto.etapa === 'escolhendo_tamanho') {
    await setContexto(telefone, 'fazendo_pedido', 'escolhendo_sabor', db);
    await client.sendMessage(telefone, `Legal! Tamanho "${texto}" anotado. Agora me diga o sabor da pizza 😋`);
    return;
  }

  if (contexto.etapa === 'escolhendo_sabor') {
    await setContexto(telefone, 'fazendo_pedido', 'escolhendo_pagamento', db);
    await client.sendMessage(telefone, `Boa escolha! "${texto}" é top 🔥 Agora, qual a forma de pagamento? (Pix, Cartão, Dinheiro)`);
    return;
  }

  if (contexto.etapa === 'escolhendo_pagamento') {
    await setContexto(telefone, 'fazendo_pedido', 'finalizando', db);
    await client.sendMessage(telefone, `Tudo certo! Seu pedido está sendo processado com pagamento via ${texto}. Obrigado! 🙌`);
    return;
  }

  // caso algo dê errado
  await client.sendMessage(telefone, 'Tô meio perdido aqui 😅 Pode repetir a informação anterior?');
}




async function iniciarMarketingAtivo(telefone,client) {
  await ContextoConversa.upsert({
    telefone,
    contexto: 'marketing_ativo',
    etapa: 'inicio',
    atualizado_em: new Date(),
  });

  const mensagem = await gpt_get_mensagem_mkt_ativo_seqsabe(telefone);

  await client.sendMessage(telefone, mensagem);
}

async function iniciarMarketingAtivoaudio(telefone, client, MessageMedia) {
  await ContextoConversa.upsert({
    telefone,
    contexto: 'marketing_ativo',
    etapa: 'inicio',
    atualizado_em: new Date(),
  });
  
const mensagem = await gpt_get_mensagem_mkt_ativo_audio(telefone);
/*const mensagem= `Olá, Osmar! 🍕

Saudades de termos você como nosso cliente! 🤗 Estou aqui para surpreender você com o quanto a PizzaIAlo sabe sobre suas preferências! 🤖

Percebi que você adora nossas pizzas exageradas e gigantes, cheias de sabores deliciosos como Strogonoff, Frango, Calabresa Crispy, Divina, Tex Mex e Charge! 🍕🤤 Sem esquecer da sua preferência pela borda de Chocolate ao Leite e Catupiry! 🍫🧀

Hoje é quarta-feira, o dia perfeito para aproveitar uma pizza Tempero Napolitano. 😋 Já estou imaginando uma Exagerada com Frango Catupiry, Calabresa, Portuguesa e Bacon especialmente para você! 🍅🧀

E como você costuma pedir entre 17:40 e 19:53, prepararemos o pedido para chegar no horário que você gosta! 🕒

Ficou com água na boca? 😍 Se sim, quer confirmar o pedido? Basta responder com um "Sim" ou "Ok"! Estamos ansiosos para te servir de novo! 🥳👍

Atenciosamente, PizzaIAlo da Pizzaria Tempero Napolitano 🍕`
*/
  await gpt_gerar_audio(mensagem);
const path = require('path');

const caminhoAudio = path.resolve(__dirname, 'Audios/resposta.mp3');

  
  // Carrega e envia o áudio
  const media = await MessageMedia.fromFilePath(caminhoAudio);
  	
  await client.sendMessage(telefone, media, {
    sendAudioAsVoice: true, // opcional: se quiser mandar como áudio de voz (bolinha)
  });
}
 
module.exports = { iniciarMarketingAtivo, iniciarMarketingAtivoaudio };




