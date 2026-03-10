'use strict';

/**
 * Extrai número e nome de um vCard (string).
 * Suporta formato WhatsApp (waid no TEL), item1.TEL/item2.TEL e vCard 3.0 comum.
 * @param {string} vcard - Conteúdo do vCard (BEGIN:VCARD ... END:VCARD)
 * @returns {{ numero: string|null, nome: string|null }}
 */
function parseVcard(vcard) {
  if (!vcard || typeof vcard !== 'string') return { numero: null, nome: null };

  let numero = null;
  let nome = null;

  // FN (Full Name) ou N (Name) - aceita também itemX.FN
  const fnMatch = vcard.match(/(?:^|\n)(?:item\d+\.)?FN:(.+?)(?:\n|$)/i) || vcard.match(/(?:^|\n)N:(.+?)(?:\n|$)/i);
  if (fnMatch) nome = fnMatch[1].trim();

  // TEL: aceita "TEL:", "item1.TEL;waid=...:..." (todas as linhas que tenham TEL)
  const telRegex = /(?:^|\n)(?:item\d+\.)?TEL[^:]*:([^\n]+)/gi;
  let telMatch;
  while ((telMatch = telRegex.exec(vcard)) !== null) {
    const tel = telMatch[1].trim();
    const waidMatch = tel.match(/waid=(\d+)/i);
    if (waidMatch) {
      numero = waidMatch[1];
      break;
    }
    const apenasNumeros = tel.replace(/\D/g, '');
    if (apenasNumeros.length >= 10) {
      numero = apenasNumeros;
      break;
    }
  }

  return { numero, nome };
}

/**
 * Se a string contiver vários vCards (vários BEGIN:VCARD), retorna array de strings; senão retorna [str].
 */
function splitVcards(str) {
  if (!str || typeof str !== 'string') return [];
  const parts = str.split(/\n(?=BEGIN:VCARD)/i).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [str];
}

/**
 * Extrai vários contatos de uma mensagem (vcard ou multi_vcard).
 * @param {string[]} vCards - Array de strings vCard (msg.vCards) ou um body com vários BEGIN:VCARD
 * @returns {Array<{ numero: string, nome: string|null }>}
 */
function parseVcards(vCards) {
  if (!Array.isArray(vCards) || vCards.length === 0) return [];
  const parsed = [];
  const seen = new Set();
  for (const v of vCards) {
    const blocos = splitVcards(v);
    for (const bloco of blocos) {
      const { numero, nome } = parseVcard(bloco);
      if (numero && !seen.has(numero)) {
        seen.add(numero);
        parsed.push({ numero, nome: nome || null });
      }
    }
  }
  return parsed;
}

module.exports = { parseVcard, parseVcards };
