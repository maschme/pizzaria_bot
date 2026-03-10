// contexto.js
async function getContexto(telefone, db) {
  const [rows] = await db.execute(
    'SELECT * FROM conversas_atuais WHERE telefone = ?',
    [telefone]
  );
  return rows[0] || null;
}

async function setContexto(telefone, contexto, etapa, db) {
  const existente = await getContexto(telefone, db);

  if (existente) {
    await db.execute(
      'UPDATE conversas_atuais SET contexto = ?, etapa = ?, atualizado_em = CURRENT_TIMESTAMP WHERE telefone = ?',
      [contexto, etapa, telefone]
    );
  } else {
    await db.execute(
      'INSERT INTO conversas_atuais (telefone, contexto, etapa) VALUES (?, ?, ?)',
      [telefone, contexto, etapa]
    );
  }
}

module.exports = { getContexto, setContexto };

