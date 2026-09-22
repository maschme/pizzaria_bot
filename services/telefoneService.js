'use strict';

/**
 * Padronização de número de telefone e de identificador do WhatsApp.
 *
 * Por que existe: o mesmo contato aparece no sistema em formatos diferentes, e comparar strings
 * cruas gera sessão perdida, contato duplicado e campanha oferecida duas vezes.
 *
 *   - o gestor e a Multipedidos trazem o celular com o 9º dígito: 55 + DDD + 9 + 8 = 13 dígitos
 *   - o WhatsApp entrega mensagens de parte desses contatos sem o 9: 55 + DDD + 8 = 12 dígitos
 *   - formulários e vCards chegam sem DDI, com máscara, com +, com espaço
 *   - contas novas conversam por `@lid`, que não é telefone nenhum
 *
 * Regra da casa:
 *   - para GRAVAR, use `canonico()`  — uma forma só, previsível
 *   - para BUSCAR ou COMPARAR, use `variantes()` / `mesmoNumero()` — nunca `=` direto numa string
 *   - para ENVIAR, use `chatId()`, e deixe a biblioteca resolver o WID real
 *
 * Nada aqui toca banco nem rede: são funções puras, fáceis de testar.
 */

const DDI_BR = '55';
/** DDDs válidos no Brasil. Fora desta lista, não mexemos no 9º dígito. */
const DDDS_BR = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

/** Só os dígitos. Aceita '+55 (47) 98450-9046', '5547...@c.us', null. */
function digitos(entrada) {
  if (entrada == null) return '';
  return String(entrada).replace(/\D/g, '');
}

/** O identificador é de conta @lid (não é telefone e não deve ser normalizado). */
function ehLid(entrada) {
  return String(entrada == null ? '' : entrada).trim().toLowerCase().endsWith('@lid');
}

function dddValido(d) {
  return DDDS_BR.has(Number(d));
}

/**
 * Celular brasileiro completo: 55 + DDD + 9 + 8 dígitos, com o 9º dígito no lugar certo.
 * O primeiro dígito do número local em celular é 6, 7, 8 ou 9.
 */
function ehCelularBr13(d) {
  return d.length === 13 && d.startsWith(DDI_BR) && dddValido(d.slice(2, 4)) && d[4] === '9';
}

/** Número brasileiro de 12 dígitos: 55 + DDD + 8. Pode ser celular antigo (sem o 9) ou fixo. */
function ehBr12(d) {
  return d.length === 12 && d.startsWith(DDI_BR) && dddValido(d.slice(2, 4));
}

/** Local de 8 dígitos que é celular (e portanto ganha o 9º dígito): começa com 6, 7, 8 ou 9. */
function localEhCelular(local8) {
  return /^[6-9]/.test(local8);
}

/**
 * Acrescenta o DDI 55 quando o número veio só com DDD (10 ou 11 dígitos).
 * Número que já tem DDI, ou que claramente não é brasileiro, passa intacto.
 */
function comDdi(entrada) {
  const d = digitos(entrada);
  if (!d) return '';
  if (d.startsWith(DDI_BR) && (d.length === 12 || d.length === 13)) return d;
  // 11 dígitos só é celular brasileiro se o número local começa com 9 (é o próprio 9º dígito).
  // Sem essa checagem, um número estrangeiro de 11 dígitos ganharia um 55 indevido.
  if (d.length === 11 && dddValido(d.slice(0, 2)) && d[2] === '9') return DDI_BR + d;
  // 10 dígitos: DDD + 8, que pode ser fixo ou celular antigo.
  if (d.length === 10 && dddValido(d.slice(0, 2))) return DDI_BR + d;
  return d;
}

/**
 * Forma preferida para GRAVAR: celular brasileiro sempre com o 9º dígito.
 * Fixo, número curto e número estrangeiro ficam como estão (só com DDI, quando dá para inferir).
 */
function canonico(entrada) {
  if (ehLid(entrada)) return String(entrada).trim();
  const d = comDdi(entrada);
  if (!d) return '';
  if (ehBr12(d) && localEhCelular(d.slice(4))) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

/**
 * Todas as formas pelas quais este mesmo contato pode aparecer, em dígitos puros.
 * A primeira é a canônica. Use em `WHERE whatsapp_id IN (...)` e em chaves de cache.
 */
function variantes(entrada) {
  if (ehLid(entrada)) {
    const lid = String(entrada).trim();
    return lid ? [lid] : [];
  }
  const d = comDdi(entrada);
  if (!d || d.length < 10) return [];
  const saida = [];
  const juntar = (v) => { if (v && !saida.includes(v)) saida.push(v); };
  juntar(canonico(d));
  juntar(d);
  if (ehCelularBr13(d)) juntar(d.slice(0, 4) + d.slice(5));
  if (ehBr12(d) && localEhCelular(d.slice(4))) juntar(`${d.slice(0, 4)}9${d.slice(4)}`);
  return saida;
}

/** É o mesmo contato, apesar do formato? */
function mesmoNumero(a, b) {
  const va = variantes(a);
  const vb = variantes(b);
  if (!va.length || !vb.length) return false;
  return va.some((x) => vb.includes(x));
}

/** Identificador de chat para envio: `<canônico>@c.us`. Um @lid é devolvido como veio. */
function chatId(entrada) {
  if (ehLid(entrada)) return String(entrada).trim();
  const c = canonico(entrada);
  return c ? `${c}@c.us` : '';
}

/** Todos os chatIds `@c.us` sob os quais este contato pode aparecer. */
function chatIdsPossiveis(entrada) {
  if (ehLid(entrada)) return [String(entrada).trim()].filter(Boolean);
  return variantes(entrada).map((d) => `${d}@c.us`);
}

/**
 * Trecho `IN (?, ?, ...)` e os parâmetros, para consultar por qualquer variante.
 * Devolve null quando não há número utilizável — nesse caso, não consulte.
 */
function clausulaIn(coluna, entrada) {
  const vals = variantes(entrada);
  if (!vals.length) return null;
  return { sql: `${coluna} IN (${vals.map(() => '?').join(', ')})`, params: vals };
}

/**
 * Expressão SQL que reduz um número à forma **sem** o 9º dígito.
 *
 * Serve para comparar duas colunas que podem estar em formatos diferentes, em JOIN ou GROUP BY,
 * onde não dá para passar a lista de variantes como parâmetro. Aplique dos dois lados:
 *
 *   ON ${sqlFormaCurta('a.whatsapp_id')} = ${sqlFormaCurta('b.whatsapp_id')}
 *
 * Reduzir em vez de expandir mantém a comparação com um valor só de cada lado. O custo é não usar
 * índice na coluna — aceitável em consulta de relatório, não em caminho de mensagem.
 *
 * @param {string} expr - nome de coluna ou expressão SQL que resulta em dígitos
 */
function sqlFormaCurta(expr) {
  return `IF(CHAR_LENGTH(${expr}) = 13 AND SUBSTRING(${expr}, 1, 2) = '${DDI_BR}' AND SUBSTRING(${expr}, 5, 1) = '9', `
    + `CONCAT(LEFT(${expr}, 4), SUBSTRING(${expr}, 6)), ${expr})`;
}

module.exports = {
  digitos,
  ehLid,
  comDdi,
  canonico,
  variantes,
  mesmoNumero,
  chatId,
  chatIdsPossiveis,
  clausulaIn,
  sqlFormaCurta,
  DDI_BR
};
