const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'arquivos');
const META_FILE = path.join(DIR, '_meta.json');

function ensureDir() {
  if (!fs.existsSync(DIR)) {
    fs.mkdirSync(DIR, { recursive: true });
  }
}

function lerMeta() {
  ensureDir();
  if (!fs.existsSync(META_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(META_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function salvarMeta(meta) {
  ensureDir();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

function nomeSeguro(nome) {
  return (nome || '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'arquivo';
}

function caminhoArquivo(nome) {
  const base = nomeSeguro(nome);
  return path.join(DIR, `${base}.json`);
}

function listar() {
  ensureDir();
  const meta = lerMeta();
  const arquivos = fs.readdirSync(DIR)
    .filter(f => f.endsWith('.json') && f !== '_meta.json')
    .map(f => {
      const nome = f.replace('.json', '');
      const filePath = path.join(DIR, f);
      const stat = fs.statSync(filePath);
      const m = meta[nome] || {};
      return {
        nome,
        tamanho: stat.size,
        atualizado: stat.mtime,
        instrucaoProcessamento: m.instrucaoProcessamento || '',
        formatoRetorno: m.formatoRetorno || ''
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome));
  return arquivos;
}

function getConteudo(nome) {
  const filePath = caminhoArquivo(nome);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getConteudoRaw(nome) {
  const filePath = caminhoArquivo(nome);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function getMeta(nome) {
  const meta = lerMeta();
  const key = nomeSeguro(nome);
  return meta[key] || { instrucaoProcessamento: '', formatoRetorno: '' };
}

function criar(nome, conteudo, meta = {}) {
  ensureDir();
  const base = nomeSeguro(nome);
  const filePath = path.join(DIR, `${base}.json`);
  
  if (fs.existsSync(filePath)) {
    throw new Error(`Arquivo "${base}" já existe`);
  }
  
  const str = typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2);
  fs.writeFileSync(filePath, str, 'utf-8');
  
  if (meta.instrucaoProcessamento !== undefined || meta.formatoRetorno !== undefined) {
    const m = lerMeta();
    m[base] = {
      instrucaoProcessamento: meta.instrucaoProcessamento || '',
      formatoRetorno: meta.formatoRetorno || ''
    };
    salvarMeta(m);
  }
  
  return { nome: base, path: filePath };
}

function atualizar(nome, conteudo, meta = null) {
  const filePath = caminhoArquivo(nome);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo "${nome}" não encontrado`);
  }
  
  if (conteudo !== undefined) {
    const str = typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2);
    fs.writeFileSync(filePath, str, 'utf-8');
  }
  
  if (meta !== null && meta !== undefined) {
    const m = lerMeta();
    const base = nomeSeguro(nome);
    m[base] = {
      instrucaoProcessamento: meta.instrucaoProcessamento !== undefined ? meta.instrucaoProcessamento : (m[base]?.instrucaoProcessamento || ''),
      formatoRetorno: meta.formatoRetorno !== undefined ? meta.formatoRetorno : (m[base]?.formatoRetorno || '')
    };
    salvarMeta(m);
  }
  
  return { nome: nomeSeguro(nome) };
}

function atualizarMeta(nome, meta) {
  const m = lerMeta();
  const base = nomeSeguro(nome);
  m[base] = {
    instrucaoProcessamento: meta.instrucaoProcessamento !== undefined ? meta.instrucaoProcessamento : (m[base]?.instrucaoProcessamento || ''),
    formatoRetorno: meta.formatoRetorno !== undefined ? meta.formatoRetorno : (m[base]?.formatoRetorno || '')
  };
  salvarMeta(m);
  return m[base];
}

function deletar(nome) {
  const filePath = caminhoArquivo(nome);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo "${nome}" não encontrado`);
  }
  fs.unlinkSync(filePath);
  const m = lerMeta();
  const base = nomeSeguro(nome);
  delete m[base];
  salvarMeta(m);
  return true;
}

function existe(nome) {
  return fs.existsSync(caminhoArquivo(nome));
}

module.exports = {
  listar,
  getConteudo,
  getConteudoRaw,
  getMeta,
  criar,
  atualizar,
  atualizarMeta,
  deletar,
  existe,
  nomeSeguro,
  lerMeta,
  DIR
};
