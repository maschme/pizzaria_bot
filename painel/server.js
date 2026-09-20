'use strict';

/**
 * Painel Central — operação multi-empresa (Fase 2, doc 15).
 * Processo próprio no PM2:  pm2 start painel/server.js --name painel-central
 * Config: painel/.env (PORT, DB_*, PAINEL_TOKEN)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const db = require('./db');
const acoes = require('./services/acoes');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3100;
const PAINEL_TOKEN = (process.env.PAINEL_TOKEN || '').trim();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!PAINEL_TOKEN) {
  console.warn('⚠️  PAINEL_TOKEN não definido em painel/.env — painel SEM autenticação!');
}

app.use('/api', (req, res, next) => {
  if (!PAINEL_TOKEN) return next();
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token === PAINEL_TOKEN) return next();
  return res.status(401).json({ success: false, error: 'Não autorizado' });
});

const ok = (res, data) => res.json({ success: true, data });
const erro = (res, e, code = 500) => res.status(code).json({ success: false, error: e.message || String(e) });

async function carregarInstancia(id) {
  const [rows] = await db.getPool().execute('SELECT * FROM instancias WHERE id = ?', [Number(id)]);
  if (!rows[0]) throw new Error('Instância não encontrada');
  return rows[0];
}

// ============================================================
// Empresas
// ============================================================

app.get('/api/empresas', async (req, res) => {
  try {
    const [empresas] = await db.getPool().execute('SELECT * FROM empresas ORDER BY nome');
    const [instancias] = await db.getPool().execute('SELECT * FROM instancias');
    const data = empresas.map((e) => ({
      ...e,
      instancia: instancias.find((i) => i.empresa_id === e.id) || null
    }));
    // token não vai para o browser
    for (const e of data) if (e.instancia) delete e.instancia.admin_token;
    ok(res, data);
  } catch (e) { erro(res, e); }
});

app.post('/api/empresas', async (req, res) => {
  try {
    const { nome, slug, telefone_contato, plano, valor_mensal, status, observacoes } = req.body || {};
    if (!nome || !slug) return erro(res, new Error('nome e slug são obrigatórios'), 400);
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) return erro(res, new Error('slug inválido (minúsculas, números, hífen)'), 400);
    const [r] = await db.getPool().execute(
      `INSERT INTO empresas (nome, slug, telefone_contato, plano, valor_mensal, status, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nome, slug, telefone_contato || null, plano || null, valor_mensal || null, status || 'ativa', observacoes || null]
    );
    await db.registrarEvento('empresa_criada', nome, { empresaId: r.insertId });
    ok(res, { id: r.insertId });
  } catch (e) { erro(res, e, e.code === 'ER_DUP_ENTRY' ? 409 : 500); }
});

app.put('/api/empresas/:id', async (req, res) => {
  try {
    const { nome, telefone_contato, plano, valor_mensal, status, observacoes } = req.body || {};
    await db.getPool().execute(
      `UPDATE empresas SET nome = ?, telefone_contato = ?, plano = ?, valor_mensal = ?, status = ?, observacoes = ?
       WHERE id = ?`,
      [nome, telefone_contato || null, plano || null, valor_mensal || null, status || 'ativa', observacoes || null, Number(req.params.id)]
    );
    ok(res, { atualizado: true });
  } catch (e) { erro(res, e); }
});

app.delete('/api/empresas/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [inst] = await db.getPool().execute('SELECT id FROM instancias WHERE empresa_id = ?', [id]);
    if (inst.length) return erro(res, new Error('Empresa tem instância vinculada — desvincule antes (a instância/processo não é apagada pelo painel)'), 409);
    await db.getPool().execute('DELETE FROM empresas WHERE id = ?', [id]);
    ok(res, { removida: true });
  } catch (e) { erro(res, e); }
});

app.get('/api/empresas/:id/eventos', async (req, res) => {
  try {
    const [rows] = await db.getPool().execute(
      'SELECT * FROM eventos WHERE empresa_id = ? ORDER BY criado_em DESC LIMIT 100',
      [Number(req.params.id)]
    );
    ok(res, rows);
  } catch (e) { erro(res, e); }
});

app.post('/api/empresas/:id/eventos', async (req, res) => {
  try {
    const detalhe = String(req.body?.detalhe || '').trim();
    if (!detalhe) return erro(res, new Error('detalhe vazio'), 400);
    await db.registrarEvento('nota', detalhe, { empresaId: Number(req.params.id) });
    ok(res, { registrado: true });
  } catch (e) { erro(res, e); }
});

// ============================================================
// Instâncias: importar, desvincular, saúde, ações
// ============================================================

app.post('/api/empresas/:id/importar-instancia', async (req, res) => {
  try {
    const empresaId = Number(req.params.id);
    const dirPath = String(req.body?.dir_path || '').trim();
    if (!dirPath) return erro(res, new Error('dir_path obrigatório'), 400);
    const inst = acoes.importarInstancia(dirPath);
    const [r] = await db.getPool().execute(
      `INSERT INTO instancias (empresa_id, porta, pm2_name, db_name, dir_path, admin_token, evolution_instance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, inst.porta, inst.pm2_name, inst.db_name, inst.dir_path, inst.admin_token, inst.evolution_instance]
    );
    await db.registrarEvento('instancia_importada', `${inst.pm2_name} (porta ${inst.porta})`, { empresaId, instanciaId: r.insertId });
    ok(res, { id: r.insertId, porta: inst.porta, pm2_name: inst.pm2_name });
  } catch (e) { erro(res, e, e.code === 'ER_DUP_ENTRY' ? 409 : 500); }
});

app.delete('/api/instancias/:id', async (req, res) => {
  try {
    await db.getPool().execute('DELETE FROM instancias WHERE id = ?', [Number(req.params.id)]);
    ok(res, { desvinculada: true });
  } catch (e) { erro(res, e); }
});

app.get('/api/saude', async (req, res) => {
  try {
    const [instancias] = await db.getPool().execute('SELECT id, empresa_id, porta FROM instancias');
    const data = await Promise.all(instancias.map(async (i) => ({
      instancia_id: i.id,
      empresa_id: i.empresa_id,
      ...(await acoes.saudeInstancia(i))
    })));
    ok(res, data);
  } catch (e) { erro(res, e); }
});

app.post('/api/instancias/:id/restart', async (req, res) => {
  try {
    const inst = await carregarInstancia(req.params.id);
    const r = await acoes.restartInstancia(inst);
    await db.registrarEvento('restart', r.ok ? 'ok' : r.out, { empresaId: inst.empresa_id, instanciaId: inst.id });
    if (!r.ok) return erro(res, new Error('pm2 restart falhou: ' + r.out));
    ok(res, { reiniciada: true });
  } catch (e) { erro(res, e); }
});

app.post('/api/instancias/:id/backup', async (req, res) => {
  try {
    const inst = await carregarInstancia(req.params.id);
    const r = await acoes.backupInstancia(inst);
    await db.registrarEvento('backup', r.ok ? 'ok' : r.out, { empresaId: inst.empresa_id, instanciaId: inst.id });
    if (!r.ok) return erro(res, new Error('backup falhou: ' + r.out.slice(-500)));
    ok(res, { backup: true, log: r.out.slice(-800) });
  } catch (e) { erro(res, e); }
});

app.get('/api/instancias/:id/qr', async (req, res) => {
  try {
    const inst = await carregarInstancia(req.params.id);
    const data = await acoes.qrInstancia(inst);
    res.json(data);
  } catch (e) { erro(res, e); }
});

// ============================================================
// Provisionamento (job assíncrono)
// ============================================================

app.post('/api/provisionar', async (req, res) => {
  try {
    const { nome, slug, porta } = req.body || {};
    if (!nome || !slug || !porta) return erro(res, new Error('nome, slug e porta são obrigatórios'), 400);
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) return erro(res, new Error('slug inválido'), 400);

    const [dup] = await db.getPool().execute('SELECT id FROM empresas WHERE slug = ?', [slug]);
    if (dup.length) return erro(res, new Error('Já existe empresa com esse slug'), 409);
    const [dupPorta] = await db.getPool().execute('SELECT id FROM instancias WHERE porta = ?', [Number(porta)]);
    if (dupPorta.length) return erro(res, new Error('Porta já usada por outra instância'), 409);

    const jobId = acoes.provisionarEmpresa(slug, Number(porta));
    ok(res, { jobId });
  } catch (e) { erro(res, e); }
});

app.get('/api/provisionar/:jobId', async (req, res) => {
  try {
    const job = acoes.statusJob(req.params.jobId);
    if (!job) return erro(res, new Error('Job não encontrado'), 404);
    ok(res, { status: job.status, log: job.log.slice(-6000) });
  } catch (e) { erro(res, e); }
});

app.post('/api/provisionar/:jobId/concluir', async (req, res) => {
  try {
    const job = acoes.statusJob(req.params.jobId);
    if (!job) return erro(res, new Error('Job não encontrado'), 404);
    if (job.status !== 'sucesso') return erro(res, new Error(`Job em estado "${job.status}"`), 409);
    const { nome, slug } = req.body || {};
    if (!nome || !slug) return erro(res, new Error('nome e slug obrigatórios'), 400);

    const [r] = await db.getPool().execute(
      `INSERT INTO empresas (nome, slug, status) VALUES (?, ?, 'ativa')`,
      [nome, slug]
    );
    const inst = job.resultado;
    const [ri] = await db.getPool().execute(
      `INSERT INTO instancias (empresa_id, porta, pm2_name, db_name, dir_path, admin_token, evolution_instance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.insertId, inst.porta, inst.pm2_name, inst.db_name, inst.dir_path, inst.admin_token, inst.evolution_instance]
    );
    await db.registrarEvento('provisionada', `porta ${inst.porta}`, { empresaId: r.insertId, instanciaId: ri.insertId });
    ok(res, { empresaId: r.insertId, admin_token: inst.admin_token, porta: inst.porta });
  } catch (e) { erro(res, e); }
});

// ============================================================

(async () => {
  try {
    await db.init();
    app.listen(PORT, () => console.log(`🏢 Painel Central em http://localhost:${PORT}`));
  } catch (e) {
    console.error('❌ Painel não subiu:', e.message);
    process.exit(1);
  }
})();
