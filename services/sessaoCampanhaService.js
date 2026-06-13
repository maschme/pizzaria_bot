'use strict';

const sessoesCampanha = new Map();

function criarSessaoVazia() {
  return {
    etapa: 1,
    subEtapa: 'aguardando_bairro',
    missoes: {
      1: { concluida: false, desconto: 10, descricao: 'Entrar no grupo WhatsApp' },
      2: { concluida: false, desconto: 10, descricao: 'A definir' },
      3: { concluida: false, desconto: 10, descricao: 'A definir' }
    },
    bairro: null,
    descontoTotal: 0,
    historico: [],
    iniciadoEm: new Date()
  };
}

function getOuCriarSessaoCampanha(numero) {
  if (!sessoesCampanha.has(numero)) {
    sessoesCampanha.set(numero, criarSessaoVazia());
  }
  return sessoesCampanha.get(numero);
}

function has(numero) {
  return sessoesCampanha.has(numero);
}

function get(numero) {
  return sessoesCampanha.get(numero);
}

function deleteSessao(numero) {
  return sessoesCampanha.delete(numero);
}

function clearAll() {
  sessoesCampanha.clear();
}

function forEach(fn) {
  sessoesCampanha.forEach(fn);
}

function listarSessoes() {
  const list = [];
  sessoesCampanha.forEach((sessao, numero) => {
    list.push({
      chatId: numero,
      etapa: sessao.etapa,
      subEtapa: sessao.subEtapa,
      bairro: sessao.bairro,
      descontoTotal: sessao.descontoTotal,
      missoes: sessao.missoes,
      iniciadoEm: sessao.iniciadoEm
    });
  });
  return list;
}

function apenasDigitos(s) {
  if (s == null) return '';
  return String(s).replace(/\D/g, '');
}

function getSessaoPorChatId(chatId) {
  if (!chatId) return null;
  const raw = String(chatId).trim();
  if (sessoesCampanha.has(raw)) return { chatId: raw, sessao: sessoesCampanha.get(raw) };
  const comCus = raw.includes('@') ? raw : `${apenasDigitos(raw)}@c.us`;
  if (sessoesCampanha.has(comCus)) return { chatId: comCus, sessao: sessoesCampanha.get(comCus) };
  const digs = apenasDigitos(raw);
  for (const [num, sessao] of sessoesCampanha.entries()) {
    if (apenasDigitos(num) === digs && digs.length >= 8) {
      return { chatId: num, sessao };
    }
  }
  return null;
}

module.exports = {
  getOuCriarSessaoCampanha,
  has,
  get,
  delete: deleteSessao,
  clearAll,
  get size() { return sessoesCampanha.size; },
  forEach,
  listarSessoes,
  getSessaoPorChatId
};
