const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const { lerJson } = require('./lerJson');
const { enviarParaClaude, enviarParaQwen3 } = require('../ias');
const { getprompt } = require('./prompts');


dayjs.extend(utc);
dayjs.extend(timezone);


async function getDataeHora() {
   const dataHoraFormatada = dayjs().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');

    return dataHoraFormatada;
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

function interpretarRespostaAssistente(resposta) {
    const blocos = resposta.split("<REQUISICAO_EXTERNA_INICIO>").slice(1);
    const requisicoes = [];

    for (let bloco of blocos) {
        const fimIndex = bloco.indexOf("<REQUISICAO_EXTERNA_FIM>");
        if (fimIndex === -1) continue;

        const conteudo = bloco.substring(0, fimIndex);
        const linhas = conteudo.split('\n');
        let tipo = null;
        let detalhes = [];
        let capturando = false;

        for (let linha of linhas) {
            linha = linha.trim();

            if (linha.toLowerCase().startsWith("tipo:")) {
                tipo = linha.substring(linha.indexOf(":") + 1).trim();
            } else if (linha.toLowerCase().startsWith("detalhes:")) {
                capturando = true;
                const conteudo = linha.substring(linha.indexOf(":") + 1).trim();
                if (conteudo) detalhes.push(conteudo);
            } else if (capturando) {
                detalhes.push(linha);
            }
        }

        if (tipo) {
            requisicoes.push({
                tipo,
                detalhes: detalhes.join('\n').trim()
            });
        }
    }

    return requisicoes.length > 0 ? requisicoes : null;
}

function interpretarRespostaAssistente2(resposta) {
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



module.exports = {
  getDataeHora, getRetornoApiGoogle, limparResposta, getRuaeNumero, interpretarRespostaAssistente
};
