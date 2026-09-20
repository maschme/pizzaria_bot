'use strict';

/**
 * Ações do painel sobre as instâncias: saúde, restart, backup, QR remoto,
 * importação de instância existente e provisionamento de empresa nova.
 * O painel roda no MESMO servidor das instâncias (usa pm2/scripts locais).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const crypto = require('crypto');

const REPO_RAIZ = path.resolve(__dirname, '..', '..');

/**
 * Ambiente limpo para processos filhos: sem as variáveis do painel (PORT etc.),
 * senão elas "vazam" para as instâncias e vencem o .env delas (dotenv não
 * sobrescreve variáveis já definidas) — foi a causa do bug da porta 3100.
 */
function envLimpo() {
  const env = { ...process.env };
  for (const k of ['PORT', 'PAINEL_TOKEN', 'PAINEL_DB_NAME', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD']) {
    delete env[k];
  }
  return env;
}

// ============================================================
// Saúde
// ============================================================

async function saudeInstancia(inst) {
  try {
    const { data, status } = await axios.get(`http://localhost:${inst.porta}/health`, {
      timeout: 5000,
      validateStatus: () => true
    });
    if (!data || typeof data !== 'object') return { ok: false, erro: `resposta inválida (HTTP ${status})` };
    return { ok: data.status === 'ok', ...data };
  } catch (e) {
    return { ok: false, erro: 'sem resposta (processo parado?)' };
  }
}

// ============================================================
// pm2 / processos
// ============================================================

function rodar(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { ...opts, shell: false });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d; });
    proc.stderr?.on('data', (d) => { out += d; });
    proc.on('error', (e) => resolve({ ok: false, out: e.message }));
    proc.on('close', (code) => resolve({ ok: code === 0, code, out: out.slice(-4000) }));
  });
}

async function restartInstancia(inst) {
  return rodar('pm2', ['restart', inst.pm2_name]);
}

async function backupInstancia(inst) {
  return rodar(process.execPath, [path.join(inst.dir_path, 'scripts', 'backup.js')], { cwd: inst.dir_path, env: envLimpo() });
}

// ============================================================
// QR remoto (proxy para a instância, com o admin_token dela)
// ============================================================

async function qrInstancia(inst) {
  const headers = inst.admin_token ? { 'x-admin-token': inst.admin_token } : {};
  const { data } = await axios.get(`http://localhost:${inst.porta}/whatsapp/qr-image`, {
    timeout: 10000,
    headers,
    validateStatus: () => true
  });
  return data; // { success, qrImage } ou { success:false, error }
}

// ============================================================
// Importar instância existente (lê o .env da pasta)
// ============================================================

function lerEnvArquivo(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) throw new Error(`.env não encontrado em ${dir}`);
  const out = {};
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function importarInstancia(dirPath) {
  const dir = path.resolve(dirPath);
  if (!fs.existsSync(path.join(dir, 'BotIApizzaria.js'))) {
    throw new Error(`${dir} não parece uma instância do bot (BotIApizzaria.js ausente)`);
  }
  const env = lerEnvArquivo(dir);
  if (!env.PORT || !env.PM2_APP_NAME || !env.DB_NAME) {
    throw new Error('.env da instância sem PORT/PM2_APP_NAME/DB_NAME');
  }
  return {
    porta: parseInt(env.PORT, 10),
    pm2_name: env.PM2_APP_NAME,
    db_name: env.DB_NAME,
    dir_path: dir,
    admin_token: env.ADMIN_TOKEN || null,
    evolution_instance: env.EVOLUTION_INSTANCE || null
  };
}

// ============================================================
// Provisionar empresa nova (job assíncrono — npm install demora minutos)
// ============================================================

const jobs = new Map(); // id -> { status: rodando|sucesso|erro, log, resultado }

function provisionarEmpresa(slug, porta) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, status: 'rodando', log: '', resultado: null, iniciadoEm: new Date() };
  jobs.set(id, job);

  const script = path.join(REPO_RAIZ, 'scripts', 'provisionar-empresa.sh');
  const proc = spawn('bash', [script, slug, String(porta)], { cwd: REPO_RAIZ, env: envLimpo() });

  const anexar = (d) => { job.log = (job.log + d).slice(-20000); };
  proc.stdout.on('data', anexar);
  proc.stderr.on('data', anexar);
  proc.on('error', (e) => { job.status = 'erro'; job.log += `\n${e.message}`; });
  proc.on('close', (code) => {
    if (code === 0) {
      const tokenMatch = job.log.match(/ADMIN_TOKEN:\s*([0-9a-f]+)/i);
      const evoMatch = job.log.match(/EVOLUTION_INSTANCE:\s*(\S+)/);
      job.resultado = {
        porta,
        pm2_name: `bot-${slug}`,
        db_name: `pizzaria_${slug.replace(/-/g, '_')}`,
        dir_path: path.join(REPO_RAIZ, '..', `bot-${slug}`),
        admin_token: tokenMatch ? tokenMatch[1] : null,
        evolution_instance: evoMatch ? evoMatch[1] : null
      };
      job.status = 'sucesso';
    } else {
      job.status = 'erro';
      job.log += `\n(exit ${code})`;
    }
  });

  return id;
}

function statusJob(id) {
  return jobs.get(id) || null;
}

module.exports = {
  saudeInstancia,
  restartInstancia,
  backupInstancia,
  qrInstancia,
  importarInstancia,
  provisionarEmpresa,
  statusJob
};
