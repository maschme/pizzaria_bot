'use strict';

/**
 * Biblioteca de modelos de fluxo (docs/20-modelos-e-fluxos-completos.md, frente A).
 * Modelos são JSONs versionados em fluxos-modelos/, no formato do export (schemaVersion, nome, tipo,
 * gatilho, nodes, edges, viewport) mais um bloco `modelo` (slug, titulo, descricao, categoria, requer,
 * variaveis). Instanciar = criar um fluxo novo, inativo, com as variáveis {{CHAVE}} substituídas nos textos.
 */

const fs = require('fs');
const path = require('path');
const fluxoService = require('./fluxoService');

const DIR = path.join(__dirname, '..', 'fluxos-modelos');
const CACHE_TTL = 60000;
let cache = null;
let cacheEm = 0;

function lerTodos() {
  if (cache && Date.now() - cacheEm < CACHE_TTL) return cache;
  const lista = [];
  if (fs.existsSync(DIR)) {
    for (const arquivo of fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(DIR, arquivo), 'utf8'));
        const m = json.modelo;
        if (!m || !m.slug || !Array.isArray(json.nodes)) {
          console.warn(`⚠️ Modelo de fluxo ignorado (sem bloco "modelo" ou "nodes"): ${arquivo}`);
          continue;
        }
        lista.push({ arquivo, json });
      } catch (e) {
        console.warn(`⚠️ Modelo de fluxo inválido (${arquivo}): ${e.message}`);
      }
    }
  }
  cache = lista;
  cacheEm = Date.now();
  return lista;
}

function resumo({ arquivo, json }) {
  const m = json.modelo;
  return {
    slug: m.slug,
    titulo: m.titulo || json.nome || m.slug,
    descricao: m.descricao || json.descricao || '',
    categoria: m.categoria || 'geral',
    requer: Array.isArray(m.requer) ? m.requer : [],
    variaveis: Array.isArray(m.variaveis) ? m.variaveis : [],
    aviso: m.aviso || null,
    tipo: json.tipo || 'campanha',
    nos: json.nodes.length,
    arquivo
  };
}

function listar() {
  return lerTodos().map(resumo);
}

function obter(slug) {
  const item = lerTodos().find((x) => x.json.modelo.slug === slug);
  return item ? { ...resumo(item), json: item.json } : null;
}

/** Substitui {{CHAVE}} (só as declaradas em modelo.variaveis) em qualquer string do JSON. */
function aplicarVariaveis(obj, valores) {
  const chaves = Object.keys(valores);
  if (!chaves.length) return obj;
  const re = new RegExp(`\\{\\{\\s*(${chaves.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\}\\}`, 'g');
  const andar = (v) => {
    if (typeof v === 'string') return v.replace(re, (_, k) => valores[k]);
    if (Array.isArray(v)) return v.map(andar);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, andar(x)]));
    return v;
  };
  return andar(obj);
}

/**
 * Cria um fluxo (inativo) a partir do modelo.
 * @param {string} slug
 * @param {{ nome?: string, variaveis?: Object }} opcoes
 */
async function instanciar(slug, { nome, variaveis } = {}) {
  const modelo = obter(slug);
  if (!modelo) throw new Error('Modelo não encontrado');

  const valores = {};
  const faltando = [];
  for (const v of modelo.variaveis) {
    const valor = variaveis && variaveis[v.chave] != null ? String(variaveis[v.chave]).trim() : '';
    if (valor) valores[v.chave] = valor;
    else if (v.obrigatoria !== false) faltando.push(v.rotulo || v.chave);
  }
  if (faltando.length) throw new Error(`Preencha: ${faltando.join(', ')}`);

  const { modelo: _bloco, ...exportado } = modelo.json;
  const corpo = aplicarVariaveis(exportado, valores);
  corpo.novoNome = (nome && String(nome).trim()) || modelo.titulo;
  corpo.descricao = `${corpo.descricao ? corpo.descricao + ' ' : ''}[modelo: ${modelo.slug}]`.trim();

  const fluxo = await fluxoService.importarFluxoDeExport(corpo);
  // importarFluxoDeExport pode criar ativo conforme o payload; modelo instanciado nasce sempre inativo
  if (fluxo && fluxo.ativo) await fluxoService.desativarFluxo(fluxo.id);
  return { id: fluxo.id, nome: fluxo.nome, modelo: modelo.slug };
}

function invalidarCache() {
  cache = null;
}

module.exports = { listar, obter, instanciar, aplicarVariaveis, invalidarCache, DIR };
