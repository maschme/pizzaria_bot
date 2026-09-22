'use strict';

/**
 * Resolve identificador WhatsApp (inclui contas @lid) para telefone (dígitos) e opcionalmente @lid.
 * Usa os mesmos padrões do handler group_join (getContactById + contact.number).
 */
function apenasDigitos(s) {
  if (s == null) return '';
  return String(s).replace(/\D/g, '');
}

/**
 * @param {import('whatsapp-web.js').Client} client
 * @param {string} chatId - ex.: 5547...@c.us ou 152...@lid
 * @returns {Promise<{
 *   chatIdOriginal: string,
 *   widDigitosTelefone: string|null,
 *   whatsappLid: string|null,
 *   chatIdCanonicoCUs: string|null,
 * }>}
 */
async function resolverIdentidadeCliente(client, chatId) {
  const raw = chatId ? String(chatId).trim() : '';
  const resultado = {
    chatIdOriginal: raw,
    widDigitosTelefone: null,
    whatsappLid: raw.endsWith('@lid') ? raw : null,
    chatIdCanonicoCUs: null
  };
  if (!raw || !client) return resultado;

  // 1) Contato já carregado (normalmente funciona também para @lid em conversa aberta / DM)
  try {
    const contact = await client.getContactById(raw);
    if (contact && contact.number) {
      const digs = apenasDigitos(contact.number);
      if (digs && digs.length >= 8) {
        resultado.widDigitosTelefone = digs;
        resultado.chatIdCanonicoCUs = `${digs}@c.us`;
      }
    }
    if (!resultado.whatsappLid && contact?.id?.user && String(contact.id._serialized || '').includes('@lid')) {
      resultado.whatsappLid = String(contact.id._serialized);
    }
  } catch (_) {
    // ignorar
  }

  // 2) API oficial wweb.js (várias versões novas): troca LID ↔ PN
  if (!resultado.widDigitosTelefone && typeof client.getContactLidAndPhone === 'function') {
    try {
      const res = await client.getContactLidAndPhone([raw]);
      const first = Array.isArray(res) && res[0];
      if (first && first.pn) {
        const d = apenasDigitos(first.pn);
        if (d && d.length >= 8) {
          resultado.widDigitosTelefone = d;
          resultado.chatIdCanonicoCUs = String(first.pn).includes('@')
            ? String(first.pn).trim()
            : `${d}@c.us`;
        }
        if (first.lid && String(first.lid).includes('@lid')) resultado.whatsappLid = String(first.lid).trim();
      }
    } catch (_) {
      // Biblioteca antiga ou rate limit
    }
  }

  // 3) Fallback: id já é @c.us (formato PN)
  if (!resultado.widDigitosTelefone && raw.endsWith('@c.us')) {
    const d = apenasDigitos(raw);
    if (d && d.length >= 8) {
      resultado.widDigitosTelefone = d;
      resultado.chatIdCanonicoCUs = raw;
    }
  }

  return resultado;
}

/**
 * Variações brasileiras do mesmo celular, por causa do 9º dígito.
 *
 * Cadastros (gestor, Multipedidos, importação) costumam guardar 13 dígitos — 55 + DDD + 9 + 8 —
 * enquanto o WhatsApp pode entregar as mensagens desse mesmo contato com 12, sem o 9. Enviar
 * funciona nos dois formatos, mas comparar não: `5547984509046` e `554784509046` são strings
 * diferentes. Quem casa contato com sessão precisa considerar as duas.
 *
 * @param {string} entrada - telefone, chatId ou qualquer texto com os dígitos
 * @returns {string[]} dígitos, sem sufixo, começando pela forma recebida
 */
function variantesTelefoneBr(entrada) {
  const d = apenasDigitos(entrada);
  if (!d || d.length < 10) return [];
  const saida = [d];
  const juntar = (v) => { if (v && !saida.includes(v)) saida.push(v); };
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') juntar(d.slice(0, 4) + d.slice(5));
  if (d.startsWith('55') && d.length === 12) juntar(`${d.slice(0, 4)}9${d.slice(4)}`);
  return saida;
}

module.exports = {
  resolverIdentidadeCliente,
  apenasDigitos,
  variantesTelefoneBr
};
