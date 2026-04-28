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

module.exports = {
  resolverIdentidadeCliente,
  apenasDigitos
};
