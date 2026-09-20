'use strict';

/**
 * Backup automatizado da instância: dump gzip do MySQL + cópia do .env,
 * com retenção configurável. Agendar via PM2 (roda e sai):
 *
 *   pm2 start scripts/backup.js --name backup-pizzaria --cron "0 4 * * *" --no-autorestart
 *
 * .env:
 *   BACKUP_DIR             (default: ../backups relativo ao projeto)
 *   BACKUP_RETENCAO_DIAS   (default: 14)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { dbConfig } = require('../database/connection');

const RAIZ = path.resolve(__dirname, '..');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(RAIZ, '..', 'backups');
const RETENCAO_DIAS = Math.max(1, parseInt(process.env.BACKUP_RETENCAO_DIAS, 10) || 14);
const INSTANCIA = process.env.PM2_APP_NAME || 'pizzaria-bot';

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function acharMysqldump() {
  // No Windows (dev/XAMPP) o mysqldump pode não estar no PATH
  if (process.platform === 'win32') {
    const xampp = 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
    if (fs.existsSync(xampp)) return xampp;
  }
  return 'mysqldump';
}

function dumpBanco(destino) {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', dbConfig.host,
      '-P', String(dbConfig.port || 3306),
      '-u', dbConfig.username,
      '--single-transaction',
      '--routines',
      '--triggers',
      dbConfig.database
    ];

    const proc = spawn(acharMysqldump(), args, {
      env: { ...process.env, MYSQL_PWD: dbConfig.password } // senha fora do argv (não aparece no ps)
    });

    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(destino);
    let stderr = '';

    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (e) => reject(new Error(`mysqldump não encontrado/erro: ${e.message}`)));
    proc.stdout.pipe(gzip).pipe(out);

    out.on('finish', () => {
      if (proc.exitCode === 0 || proc.exitCode === null) resolve();
      else reject(new Error(`mysqldump exit ${proc.exitCode}: ${stderr.slice(0, 300)}`));
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        out.destroy();
        reject(new Error(`mysqldump exit ${code}: ${stderr.slice(0, 300)}`));
      }
    });
    out.on('error', reject);
  });
}

function limparAntigos() {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  let removidos = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.startsWith(`${INSTANCIA}_`)) continue;
    const caminho = path.join(BACKUP_DIR, f);
    try {
      if (fs.statSync(caminho).mtimeMs < limite) {
        fs.unlinkSync(caminho);
        removidos++;
      }
    } catch (_) { /* ignora */ }
  }
  return removidos;
}

async function main() {
  const ts = timestamp();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const arquivoDump = path.join(BACKUP_DIR, `${INSTANCIA}_${dbConfig.database}_${ts}.sql.gz`);
  console.log(`💾 Backup ${INSTANCIA}: ${dbConfig.database}@${dbConfig.host} → ${arquivoDump}`);
  await dumpBanco(arquivoDump);
  const tamanho = (fs.statSync(arquivoDump).size / 1024).toFixed(1);
  console.log(`✅ Dump concluído (${tamanho} KB)`);

  const envOrigem = path.join(RAIZ, '.env');
  if (fs.existsSync(envOrigem)) {
    const envDestino = path.join(BACKUP_DIR, `${INSTANCIA}_env_${ts}.bak`);
    fs.copyFileSync(envOrigem, envDestino);
    console.log(`✅ .env copiado → ${envDestino}`);
  }

  const removidos = limparAntigos();
  if (removidos) console.log(`🧹 Retenção ${RETENCAO_DIAS}d: ${removidos} arquivo(s) antigo(s) removido(s)`);

  console.log('✨ Backup finalizado.');
}

main().catch((e) => {
  console.error('❌ backup:', e.message);
  process.exit(1);
});
