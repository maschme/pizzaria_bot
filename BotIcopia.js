require('dotenv').config();
const { Client, Location, Poll, List, Buttons, LocalAuth, MessageMedia } = require('../index');
const qrcode = require('qrcode-terminal');  // Adicione esta linha
const fs = require('fs');
const path = require('path');

const { lerJson } = require('./utils/lerJson');


const { enviarParaClaude, enviarParaQwen3 } = require('./ias');
const { getprompt } = require('./utils/prompts');
const { buscarOuCriarAtendimento,
    getHistorico,
    adicionarAoHistorico,
    finalizarAtendimento } = require('./historico');

const express = require('express');
//const { Client, LocalAuth } = require('whatsapp-web.js');
//const qrcode = require('qrcode-terminal');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();
const port = process.env.PORT || process.env.APP_PORT || 3007;



const bordas = lerJson('bordas');


// Middleware para JSON
app.use(bodyParser.json());



const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot-ia-pizzaria" // Identificador único para a sessão deste cliente
    }),
    puppeteer: {
        executablePath: '/usr/bin/chromium-browser', // Caminho para o Chromium
        headless: true, // Modo headless
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});
// Mostra o QR Code no terminal
client.on('qr', (qr) => {
    console.log('Escaneie o QR code:');
    qrcode.generate(qr, { small: true });
});

// Loga quando estiver pronto
client.on('ready', () => {
    console.log('🤖 Cliente WhatsApp está pronto!');
});

// Inicializa o cliente
client.initialize();

// Endpoint para enviar mensagens
app.post('/send-message', async (req, res) => {
    let { number, message } = req.body;



    if (!number || !message) {
        return res.status(400).json({ error: 'Campos "number" e "message" são obrigatórios.' });
    }

    try {
        number = number.toString();
        if (!number.includes("@c.us")) {
            number = number + "@c.us";
        }
        // Garante que o número está no formato com @c.us
        const chatId = number;

        await client.sendMessage(chatId, message);
        res.status(200).json({ success: true, sent_to: number });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem', details: error.message });
    }
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${port}`);
});



//#########################################################################

client.on('message', async msg => {
    const numero = msg.from;

    if (msg.type !== 'chat' || msg.fromMe) return;

    try {
        console.log(`Mensagem recebida de ${numero}: ${msg.body}`);

        // 1. Buscar ou criar o atendimento
        const atendimento = await buscarOuCriarAtendimento(numero);

        // 2. Obter o histórico desse atendimento
        const historico = await getHistorico(atendimento.id);

        // 3. Adicionar a mensagem do usuário ao histórico (banco e memória)
        await adicionarAoHistorico(atendimento.id, numero, 'user', msg.body, atendimento.id);
        historico.push({ role: "user", content: msg.body });
        // 4. Montar o histórico em formato de messages para a IA
        const messages = historico.map(h => ({
            role: h.remetente === 'user' ? 'user' : 'assistant',
            content: h.mensagem
        }));

        // 5. Enviar para a IA com base no histórico
        //console.log("\n🤖 historico:", historico);

        const resposta = await enviarParaQwen3(historico);
        const respostalimpa = limparResposta(resposta);

        // 6. Adicionar resposta da IA ao histórico
        await adicionarAoHistorico(atendimento.id, numero, 'assistant', resposta, atendimento.id);
        historico.push({ role: "assistant", content: resposta });
        // 7. Responder o cliente com a resposta limpa
        if (respostalimpa && respostalimpa.trim() !== "") {
            await msg.reply(respostalimpa);
        }


        // 8. Analisar se a IA solicitou informações adicionais
        const retorno_requisições = await analisar_resposta(resposta, historico, atendimento, numero, msg);
        /*
            if (retorno_requisições && retorno_requisições.trim() !== "") {
              await adicionarAoHistorico(atendimento.id, numero, 'assistant', retorno_requisições, atendimento.id);
                    historico.push({ role: "assistant", content: retorno_requisições });
              await msg.reply(retorno_requisições);
              //const nova_resposta = await enviarParaQwen3(historico);
                //const nova_respostalimpa = limparResposta(resposta);
            //	await adicionarAoHistorico(atendimento.id, numero, 'assistant', nova_respostalimpa, atendimento.id);
                  //    	historico.push({ role: "assistant", content: nova_respostalimpa });
             // await msg.reply(nova_respostalimpa);
            } else {
              console.log("⚠️ Nenhuma nova resposta válida para enviar ao cliente.");
            }
        */
    } catch (err) {
        console.error("Erro no atendimento:", err);
        await msg.reply("Desculpe, tivemos um erro. Pode tentar novamente em instantes?");
    }
});


//#########################################################################
async function analisar_resposta(resposta, messages, atendimento, numero, msg) {
  const requisicao = interpretarRespostaAssistente(resposta);
  console.log("\n🤖 IA resposta completa:", resposta);
  console.log("\n🤖 IA resposta limpa:", limparResposta(resposta));

  if (!requisicao) return;

  const { tipo, detalhes } = requisicao;

  console.log(`\n📡 Requisição detectada:\nTipo: ${tipo}\nDetalhes: ${detalhes}`);

  // Utilitário para adicionar no histórico e messages
  const registrarHistorico = async (conteudo) => {
    await adicionarAoHistorico(atendimento.id, numero, 'user', conteudo, atendimento.id);
    messages.push({ role: "user", content: conteudo });
  };

  // Utilitário para montar prompts + enviar para IA
  const montarPromptEEnviar = async (promptChave, systemInfo, userInfo) => {
    let promptBase = await getprompt(promptChave);
    if (systemInfo) promptBase += `\n${systemInfo}`;
    return await enviarParaQwen3([
      { role: "system", content: promptBase },
      { role: "user", content: userInfo }
    ]);
  };

  let retorno;

  switch (tipo) {
    case "tamanhos":
    case "bordas":
      await registrarHistorico(`Retorno Requisição Externa bordas: ${JSON.stringify(bordas, null, 2)}`);
      break;

    case "sabores_salgados":
      const promptCardapio = await getprompt('cardapio');
      retorno = await enviarParaQwen3([
        { role: "system", content: promptCardapio },
        { role: "user", content: `Aqui está a solicitação sobre o cardápio:\n${detalhes}` }
      ]);
      await registrarHistorico(`Retorno Requisição Externa sabores_salgados: ${retorno}`);
      break;

    case "taxa_entrega":
      const endereco = await getRetornoApiGoogle(await getRuaeNumero(detalhes));
      const enderecoInfo = `\nRetorno da API do Google sobre o endereço:\n${JSON.stringify(endereco, null, 2)}\n`;
      retorno = await montarPromptEEnviar('Entrega', enderecoInfo, `Solicitação da IA sobre o endereço:\n${detalhes}`);
      await registrarHistorico(`Retorno Requisição Externa taxa_entrega: ${retorno}`);
      break;

    case "sabores_salgados2":
      retorno = {
        sabores_tradicionais: lerJson('sabores_tradicionais'),
        sabores_especiais: lerJson('sabores_especiais'),
      };
      await registrarHistorico(JSON.stringify(retorno, null, 2));
      break;

    case "sabores_doces":
      retorno = {
        sabores_tradicionais: lerJson('sabores_doces'),
        sabores_especiais: lerJson('sabores_doces_especiais'),
      };
      await registrarHistorico(`Retorno Requisição Externa sabores_doces: ${JSON.stringify(retorno, null, 2)}`);
      break;

    case "atendimento_humano":
      retorno = "ok, encaminhando para atendimento humano";
      await registrarHistorico(`Retorno Requisição Externa atendimento_humano: ${retorno}`);
      break;

    case "finalizar_pedido":
      retorno = `Pedido confirmado com ID 1256\n${detalhes}`;
      await registrarHistorico(`Retorno Requisição Externa finalizar_pedido: ${retorno}`);
      break;

    default:
      return; // Tipo não tratado
  }

  // 🔁 Nova resposta com base no histórico atualizado
  const nova_resposta = await enviarParaQwen3(messages);

  if (nova_resposta) {
    await adicionarAoHistorico(atendimento.id, numero, 'assistant', nova_resposta, atendimento.id);
    messages.push({ role: "assistant", content: nova_resposta });

    const limpa = limparResposta(nova_resposta);
    if (limpa && limpa.trim()) {
      await msg.reply(limpa);
    }

    return await analisar_resposta(nova_resposta, messages, atendimento, numero, msg);
  }

  return null;
}



async function analisar_resposta2(resposta, messages, atendimento, numero, msg) {
    const requisicao = interpretarRespostaAssistente(resposta);
    console.log("\n🤖 IA respostaaaa completa:", resposta);
    console.log("\n🤖 IA respostaaaa limpa:", limparResposta(resposta));

    if (!requisicao) return;

    console.log(`\n📡 Requisição detectada:\nTipo: ${requisicao.tipo}\nDetalhes: ${requisicao.detalhes}`);
    let retorno;

    switch (requisicao.tipo) {
        case "tamanhos":
        case "bordas":
            const textoTamanhos = JSON.stringify(bordas, null, 2);
            await adicionarAoHistorico(atendimento.id, numero, 'user', `Retorno Requisição Externa bordas: ${textoTamanhos}`, atendimento.id);
            messages.push({ role: "user", content: `Retorno Requisição Externa bordas: ${textoTamanhos}` });
            break;

        case "sabores_salgados":
            const historico = await getHistorico(atendimento.id);
            const promptCardapio = await getprompt('cardapio'); // <- AQUI
            console.log("\n🤖 prompt IA cardapio:", promptCardapio);
            retorno = await enviarParaQwen3([
                { role: "system", content: promptCardapio },
                { role: "user", content: `Aqui está a solicitação sobre o cardápio:\n${requisicao.detalhes}` }
            ]);
            console.log("\n🤖 Resposta da ia_Cardapio:", retorno);
            await adicionarAoHistorico(atendimento.id, numero, 'user', `Retorno Requisição Externa bordas: ${retorno}`, atendimento.id);

            messages.push({ role: "user", content: `Retorno Requisição Externa bordas: ${retorno }`});
            break;

        case "taxa_entrega":
            const endereco = await getRetornoApiGoogle(await getRuaeNumero(requisicao.detalhes));
            console.log("\n🤖 Resposta do endereço:", endereco);
            let promptEntrega = await getprompt('Entrega');

            // Agregando dinamicamente as informações ao prompt
            promptEntrega += `

	Retorno da API do Google sobre o endereço:
	${JSON.stringify(endereco, null, 2)}

	`;
            console.log("\n🤖 prompt do endereço:", promptEntrega);
            retorno = await enviarParaQwen3([
                { role: "system", content: promptEntrega },
                { role: "user", content: `Solicitação da IA sobre o endereço:\n${requisicao.detalhes}` }
            ]);
            console.log("\n🤖 Resposta da ia_Tx_entrega:", retorno);
            await adicionarAoHistorico(atendimento.id, numero, 'user', `Retorno Requisição Externa taxa_entrega: ${retorno}`, atendimento.id);
            messages.push({ role: "user", content: `Retorno Requisição Externa taxa_entrega: ${retorno}` });
            break;

        case "sabores_salgados2":
            retorno = {
                sabores_tradicionais: lerJson('sabores_tradicionais'),
                sabores_especiais: lerJson('sabores_especiais')
            };
            const textoSalgados = JSON.stringify(retorno, null, 2);
            await adicionarAoHistorico(atendimento.id, numero, 'user', textoSalgados, atendimento.id);
            messages.push({ role: "user", content: textoSalgados });
            break;

        case "sabores_doces":
            retorno = {
                sabores_tradicionais: lerJson('sabores_doces'),
                sabores_especiais: lerJson('sabores_doces_especiais')
            };
            const textoDoces = JSON.stringify(retorno, null, 2);
            await adicionarAoHistorico(atendimento.id, numero, 'user', `Retorno Requisição Externa sabores_doces: ${textoDoces}`, atendimento.id);
            messages.push({ role: "user", content: `Retorno Requisição Externa sabores_doces: ${textoDoces}` });
            break;

        case "atendimento_humano":
            retorno = "ok, encaminhando para atendimento humano";
            await adicionarAoHistorico(atendimento.id, numero, 'user', `Retorno Requisição Externa atendimento_humano: ${retorno}`, atendimento.id);
            messages.push({ role: "user", content: `Retorno Requisição Externa atendimento_humano: ${retorno }`});
            break;

        case "finalizar_pedido":
            retorno = `Pedido confirmado com ID 1256\n${requisicao.detalhes}`;
            await adicionarAoHistorico(atendimento.id, numero, 'user', `Retorno Requisição Externa finalizar_pedido: ${retorno}`, atendimento.id);
            messages.push({ role: "user", content: `Retorno Requisição Externa finalizar_pedido: ${retorno}` });
            break;

        default:
            return; // Tipo não tratado
    }

    const nova_resposta = await enviarParaQwen3(messages);

    if (nova_resposta) {
        await adicionarAoHistorico(atendimento.id, numero, 'assistant', nova_resposta, atendimento.id);
        messages.push({ role: "assistant", content: nova_resposta });
        console.log("\n🤖 IA:", nova_resposta);
        const respostalimpa = limparResposta(nova_resposta);
        if (respostalimpa && respostalimpa.trim() !== "") {
            await msg.reply(respostalimpa);
        }

        const retorno_requisições = await analisar_resposta(nova_resposta, messages, atendimento, numero, msg);

        return nova_resposta;
    }

    return null;
}

function interpretarRespostaAssistente(resposta) {
    if (!resposta.includes("<REQUISICAO_EXTERNA_INICIO>")) return null;

    const linhas = resposta.split('\n');
    let tipo = null;
    let detalhes = [];
    let capturando = false;

    for (let linha of linhas) {
        linha = linha.trim();

        if (linha === "<REQUISICAO_EXTERNA_FIM>") break;

        // Identificar tipo
        if (linha.toLowerCase().startsWith("tipo:")) {
            tipo = linha.substring(linha.indexOf(":") + 1).trim();
        }

        // Identificar detalhes
        else if (linha.toLowerCase().startsWith("detalhes:")) {
            capturando = true;
            const conteudo = linha.substring(linha.indexOf(":") + 1).trim();
            if (conteudo) detalhes.push(conteudo);
        }

        // Continuar capturando linhas seguintes
        else if (capturando) {
            detalhes.push(linha);
        }
    }

    return {
        tipo,
        detalhes: detalhes.join('\n').trim()
    };
}


function limparResposta(resposta) {
    return resposta.replace(/<REQUISICAO_EXTERNA_INICIO>[\s\S]*?<REQUISICAO_EXTERNA_FIM>/g, '').trim();
}



async function getRuaeNumero(requisicao) {
    const promptRuaeNumero = await getprompt('RuaeNumero'); // <- AQUI
    retorno = await enviarParaQwen3([
        { role: "system", content: promptRuaeNumero },
        { role: "user", content: `Solicitação da IA sobre o endereço:\n${requisicao}` }
    ])
    console.log("\n🤖 Resposta da getRuaeNumero:", retorno);
    return retorno;
}



async function getRetornoApiGoogle(ruaenumero) {
    try {
        // Se for uma string JSON, converte para objeto
        if (typeof ruaenumero === 'string') {
            ruaenumero = JSON.parse(ruaenumero);
        }

        const rua = ruaenumero.rua;
        const numero = ruaenumero.numero;
        const cidade = 'Joinville';

        const endereco = `${rua}, ${numero}, ${cidade}`;
        const enderecoEncoded = encodeURIComponent(endereco);

        const apiKey = 'AIzaSyB1CT-lCQx_m9N4flh5yv91-TFAuCy6QI4'; // Substitua pela sua chave real
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${enderecoEncoded}&key=${apiKey}`;

        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Erro ao consultar a API do Google:', error.message);
        return null;
    }
}



