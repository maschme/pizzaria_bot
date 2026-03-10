const fs = require('fs');
const path = require('path');

function lerJson(nomeArquivo) {
  const filePath = path.join(__dirname, '..', 'arquivos', `${nomeArquivo}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

module.exports = {lerJson};

