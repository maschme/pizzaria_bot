'use strict';

/**
 * Monitor de saúde do bot: consulta /health e alerta quando o WhatsApp cai
 * (ou o banco fica fora), com aviso de recuperação e re-alerta periódico.
 *
 * Rodar como processo separado (sobrevive a quedas do bot):
 *   pm2 start scripts/monitor-health.js --name monitor-pizzaria
 *
 * Configuração via .env do projeto:
 *   HEALTH_URL                (default: http://localhost:<PORT>/health)
 *   MONITOR_INTERVALO_S       (default: 60)   — frequência da checagem
 *   MONITOR_REALERTA_MIN      (default: 30)   — re-alerta enquanto continuar fora
 *
 * Canais de alerta (configure um ou ambos):
 *   ALERTA_WEBHOOK_URL        — POST JSON genérico { texto, status, instancia, ... } (n8n, Slack, etc.)
 *   ALERTA_EVOLUTION_URL      — ex.: http://localhost:8033
 *   ALERTA_EVOLUTION_APIKEY
 *   ALERTA_EVOLUTION_INSTANCE — nome da instância na Evolution (URL-encoded automaticamente)
 *   ALERTA_NUMERO             — WhatsApp que recebe o alerta (ex.: 5547999999999)
 */

require('dotenv').config();
const axios = require('axios');

const HEALTH_URL = process.env.HEALTH_URL || `http://localhost:${process.env.PORT || 3007}/health`;
const INTERVALO_MS = Math.max(15, parseInt(process.env.MONITOR_INTERVALO_S, 10) || 60) * 1000;
const REALERTA_MS = Math.max(5, parseInt(process.env.MONITOR_REALERTA_MIN, 10) || 30) * 60 * 1000;

const WEBHOOK_URL = (process.env.ALERTA_WEBHOOK_URL || '').trim();
const EVO_URL = (process.env.ALERTA_EVOLUTION_URL || '').trim().replace(/\/$/, '');
const EVO_APIKEY = (process.env.ALERTA_EVOLUTION_APIKEY || '').trim();
const EVO_INSTANCE = (process.env.ALERTA_EVOLUTION_INSTANCE || '').trim();
const ALERTA_NUMERO = (process.env.ALERTA_NUMERO || '').replace(/\D/g, '');

let estadoAnterior = 'desconhecido'; // ok | down | desconhecido
let ultimoAlertaEm = 0;
let caiuEm = null;

function agora() { return new Date().toLocaleString('pt-BR'); }

async function enviarAlerta(texto, payloadExtra = {}) {
  const enviados = [];

  if (WEBHOOK_URL) {
    try {
      await axios.post(WEBHOOK_URL, { texto, ...payloadExtra }, { timeout: 10000 });
      enviados.push('webhook');
    } catch (e) {
      console.error('⚠️ Alerta webhook falhou:', e.message);
    }
  }

  if (EVO_URL && EVO_APIKEY && EVO_INSTANCE && ALERTA_NUMERO) {
    try {
      await axios.post(
        `${EVO_URL}/message/sendText/${encodeURIComponent(EVO_INSTANCE)}`,
        { number: ALERTA_NUMERO, text: texto },
        { headers: { apikey: EVO_APIKEY }, timeout: 15000 }
      );
      enviados.push('evolution');
    } catch (e) {
      console.error('⚠️ Alerta Evolution falhou:', e.message);
    }
  }

  if (!enviados.length) console.warn('⚠️ Nenhum canal de alerta configurado/funcionando — alerta só no log.');
  return enviados;
}

async function checar() {
  let health = null;
  let erroRede = null;
  try {
    const res = await axios.get(HEALTH_URL, { timeout: 15000, validateStatus: () => true });
    health = res.data;
  } catch (e) {
    erroRede = e.message;
  }

  const ok = !!(health && health.status === 'ok');
  const instancia = (health && health.instancia) || process.env.PM2_APP_NAME || 'pizzaria-bot';

  if (ok) {
    if (estadoAnterior === 'down') {
      const fora = caiuEm ? Math.round((Date.now() - caiuEm) / 60000) : '?';
      const texto = `✅ *${instancia}* voltou ao normal (${agora()}). Ficou degradado por ~${fora} min.`;
      console.log(texto);
      await enviarAlerta(texto, { status: 'recuperado', instancia });
    }
    estadoAnterior = 'ok';
    caiuEm = null;
    return;
  }

  // Degradado ou fora do ar
  const detalhe = erroRede
    ? `sem resposta do /health (${erroRede}) — processo pode estar parado`
    : `whatsapp: ${health?.whatsapp?.estado || '?'}${health?.whatsapp?.qrPendente ? ' (QR AGUARDANDO LEITURA)' : ''} | db: ${health?.db ? 'ok' : 'FORA'}`;

  const primeiraVez = estadoAnterior !== 'down';
  if (primeiraVez) caiuEm = Date.now();
  estadoAnterior = 'down';

  const deveAlertar = primeiraVez || (Date.now() - ultimoAlertaEm) >= REALERTA_MS;
  console.warn(`[${agora()}] 🔴 ${instancia} degradado: ${detalhe}`);

  if (deveAlertar) {
    ultimoAlertaEm = Date.now();
    const texto = `🔴 *Alerta ${instancia}* (${agora()})\n${detalhe}\n${health?.whatsapp?.qrPendente ? '📱 Abra o dashboard > aba Whats e escaneie o QR.' : ''}`.trim();
    await enviarAlerta(texto, { status: 'degradado', instancia, detalhe });
  }
}

console.log(`🩺 Monitor iniciado: ${HEALTH_URL} a cada ${INTERVALO_MS / 1000}s (re-alerta ${REALERTA_MS / 60000}min)`);
console.log(`   Canais: webhook=${WEBHOOK_URL ? 'sim' : 'não'} | evolution=${EVO_URL && ALERTA_NUMERO ? 'sim' : 'não'}`);
checar().catch(() => {});
setInterval(() => checar().catch((e) => console.error('monitor:', e.message)), INTERVALO_MS);
