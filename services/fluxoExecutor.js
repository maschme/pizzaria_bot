const mysql = require('mysql2/promise');
const { dbConfig } = require('../database/connection');
const fluxoService = require('./fluxoService');
const promptService = require('./promptService');
const provedorService = require('./provedorIAService');
const requisicaoService = require('./requisicaoExternaService');
const indicacaoService = require('./indicacaoService');
const arquivoService = require('./arquivoService');
const metaService = require('./metaService');

const CAMPOS_CONTATO_PERMITIDOS = ['cam_grupo', 'qt_indicados', 'cam_indicacoes', 'nome', 'id_negociacao'];

/** Parse dd/mm/yyyy para Date (meia-noite). Retorna null se inválido. */
function parseDataBR(str) {
  if (!str || typeof str !== 'string') return null;
  const [d, m, y] = str.trim().split(/[/-]/).map(Number);
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Extrai do prompt os critérios mencionados (qualquer % e N dias) e busca no arquivo
 * um cupom que atenda. Tudo vem do prompt e do arquivo; o fluxo não precisa mudar.
 * Retorna apenas o campo texto de um item que EXISTE no arquivo; nunca inventa dados.
 */
function selecionarCupomPorCriterio(listaCupons, instrucao) {
  if (!Array.isArray(listaCupons) || listaCupons.length === 0) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const inst = (instrucao || '').toLowerCase();

  // Qual percentual o prompt pede? (ex.: "30%", "10%") – qualquer número seguido de %
  const matchPct = inst.match(/(\d+)\s*%/);
  const pctPedido = matchPct ? matchPct[1] + '%' : null;

  // Quantos dias de validade? (ex.: "10 dias", "validade para 5 dias")
  const matchDias = inst.match(/(\d+)\s*dias?/i);
  const diasValidade = matchDias ? parseInt(matchDias[1], 10) : null;
  const dataLimite = diasValidade != null ? (() => {
    const d = new Date(hoje);
    d.setDate(d.getDate() + diasValidade);
    return d;
  })() : null;

  const textoOuDescricao = (item) => `${item.descricao || ''} ${item.texto || ''} ${item.mensagem || ''}`.toLowerCase();
  const contemPercentual = (item, pct) => textoOuDescricao(item).includes(pct.toLowerCase());

  const validadeDentroDoPeriodo = (item) => {
    if (!item.validade || dataLimite == null) return true;
    const dataVal = parseDataBR(item.validade);
    if (!dataVal) return true;
    dataVal.setHours(0, 0, 0, 0);
    return dataVal >= hoje && dataVal <= dataLimite;
  };

  const candidatos = listaCupons.filter(item => {
    if (!item || !(item.texto || item.mensagem)) return false;
    if (pctPedido && !contemPercentual(item, pctPedido)) return false;
    return validadeDentroDoPeriodo(item);
  });

  // Ordenar por validade (mais próxima primeiro) para priorizar cupons “vencendo”
  if (candidatos.some(c => c.validade)) {
    candidatos.sort((a, b) => {
      const da = parseDataBR(a.validade);
      const db = parseDataBR(b.validade);
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });
  }
  const escolhido = candidatos[0];
  return escolhido ? (escolhido.texto || escolhido.mensagem) : null;
}

// Sessões ativas de fluxos
const sessoesFluxo = new Map();

// Callback opcional: quando um fluxo de campanha termina (ex.: após entrada no grupo), o bot pode passar o usuário para a campanha legada (Missão 2)
let onCampanhaFlowEnd = null;
function setOnCampanhaFlowEnd(fn) {
  onCampanhaFlowEnd = fn;
}

class FluxoExecutor {
  constructor(client, chatId, fluxo) {
    this.client = client;
    this.chatId = chatId;
    this.fluxo = fluxo;
    this.nodes = fluxo.nodes || [];
    this.edges = fluxo.edges || [];
    this.currentNodeId = null;
    this.variaveis = {};
    this.historico = [];
    this.aguardandoResposta = false;
    this.aguardandoContatos = false;
    this.waitContactsMeta = 10;
    this.fluxoCompletouCampanha = false;
  }

  // Encontra o nó inicial (trigger)
  findStartNode() {
    return this.nodes.find(n => n.type === 'trigger');
  }

  // Encontra próximo nó baseado nas conexões
  findNextNode(currentId, handleType = 'output') {
    const edge = this.edges.find(e => e.source === currentId && e.sourceHandle === handleType);
    if (!edge) return null;
    return this.nodes.find(n => n.id === edge.target);
  }

  // Encontra nó por ID
  getNode(nodeId) {
    return this.nodes.find(n => n.id === nodeId);
  }

  // Inicia execução do fluxo
  async start() {
    const startNode = this.findStartNode();
    if (!startNode) {
      console.log(`❌ Fluxo ${this.fluxo.id} não tem nó de gatilho`);
      return false;
    }

    console.log(`🔀 Iniciando fluxo "${this.fluxo.nome}" para ${this.chatId}`);
    
    // Pula o trigger e vai para o próximo nó
    const nextNode = this.findNextNode(startNode.id);
    if (nextNode) {
      await this.executeNode(nextNode);
    }
    
    return true;
  }

  // Executa um nó específico
  async executeNode(node) {
    if (!node) {
      console.log(`✅ Fluxo "${this.fluxo.nome}" finalizado para ${this.chatId}`);
      sessoesFluxo.delete(this.chatId);
      return;
    }

    this.currentNodeId = node.id;
    this.historico.push({ nodeId: node.id, timestamp: Date.now() });

    console.log(`▶️ Executando nó ${node.type}: ${node.id}`);

    switch (node.type) {
      case 'message':
        await this.executeMessage(node);
        break;
      case 'wait':
        await this.executeWait(node);
        break;
      case 'condition':
        await this.executeCondition(node);
        break;
      case 'ia':
        await this.executeIA(node);
        break;
      case 'action':
        await this.executeAction(node);
        break;
      case 'wait_contacts':
        await this.executeWaitContacts(node);
        break;
      case 'condition_var':
        await this.executeConditionVar(node);
        break;
      case 'end':
        await this.executeEnd(node);
        return;
      default:
        const next = this.findNextNode(node.id);
        await this.executeNode(next);
    }
  }

  // Executa nó de mensagem
  async executeMessage(node) {
    let texto = node.data.texto || '';
    
    // Substitui variáveis
    texto = this.substituirVariaveis(texto);
    
    // Delay se configurado
    if (node.data.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, node.data.delay));
    }
    
    // Envia mensagem
    if (texto) {
      await this.client.sendMessage(this.chatId, texto);
    }
    
    // Continua para próximo nó
    const nextNode = this.findNextNode(node.id);
    await this.executeNode(nextNode);
  }

  // Executa nó de aguardar resposta
  async executeWait(node) {
    console.log(`⏳ Aguardando resposta do cliente (variável: ${node.data.variavelResposta || 'resposta'})`);
    this.aguardandoResposta = true;
    this.currentNodeId = node.id;
    this.waitVariableName = node.data.variavelResposta || 'resposta';
  }

  // Executa nó de aguardar contatos (indicações) – texto editável no nó
  async executeWaitContacts(node) {
    const meta = node.data.meta || 10;
    this.aguardandoContatos = true;
    this.aguardandoResposta = false;
    this.currentNodeId = node.id;
    this.waitContactsMeta = meta;
    this.variaveis.qtIndicados = 0;
    this.variaveis.metaIndicados = meta;

    const mensagemConvite = (node.data.mensagemConvite || '').trim();
    if (mensagemConvite) {
      const texto = this.substituirVariaveis(mensagemConvite);
      await this.client.sendMessage(this.chatId, texto);
    }
    console.log(`📇 Aguardando ${meta} contatos (indicações) para ${this.chatId}`);
  }

  // Executa nó de verificação por variável (sem IA): segue dois caminhos conforme comparação
  async executeConditionVar(node) {
    const nomeVar = (node.data.variavelNome || '').trim() || 'resposta';
    const operador = (node.data.operador || 'igual').toLowerCase();
    const valorComparacao = node.data.valorComparacao != null ? String(node.data.valorComparacao).trim() : '';
    const valorAtual = this.variaveis[nomeVar] != null ? String(this.variaveis[nomeVar]).trim() : '';

    let resultado = false;
    switch (operador) {
      case 'igual':
      case '==':
        resultado = valorAtual === valorComparacao;
        break;
      case 'diferente':
      case '!=':
        resultado = valorAtual !== valorComparacao;
        break;
      case 'contem':
        resultado = valorAtual.toLowerCase().includes(valorComparacao.toLowerCase());
        break;
      case 'maior':
        resultado = Number(valorAtual) > Number(valorComparacao);
        break;
      case 'menor':
        resultado = Number(valorAtual) < Number(valorComparacao);
        break;
      case 'maior_igual':
        resultado = Number(valorAtual) >= Number(valorComparacao);
        break;
      case 'menor_igual':
        resultado = Number(valorAtual) <= Number(valorComparacao);
        break;
      default:
        resultado = valorAtual === valorComparacao;
    }
    console.log(`🔀 [Variável] {{${nomeVar}}} (${operador}) "${valorComparacao}" → ${resultado ? 'SIM' : 'NÃO'}`);
    const handleType = resultado ? 'output-true' : 'output-false';
    const nextNode = this.findNextNode(node.id, handleType);
    await this.executeNode(nextNode);
  }

  // Executa nó de condição
  async executeCondition(node, userMessage = null) {
    // Pega a última mensagem do cliente (pode vir do wait anterior)
    const mensagem = userMessage || this.variaveis.ultimaMensagem || '';
    
    const pergunta = this.substituirVariaveis(node.data.pergunta || '');
    
    // Usa IA para avaliar condição
    const prompt = `Analise a mensagem do usuário e responda APENAS "SIM" ou "NAO".

Pergunta a avaliar: ${pergunta}

Mensagem do usuário: "${mensagem}"

Responda apenas SIM ou NAO (sem pontuação ou explicação):`;

    try {
      console.log(`🔀 Avaliando condição: "${pergunta.substring(0, 50)}..."`);
      const resposta = await provedorService.enviarParaIA([
        { role: 'user', content: prompt }
      ]);
      
      const resultado = resposta.toLowerCase().trim().startsWith('sim');
      console.log(`🔀 Resultado: ${resultado ? 'SIM ✅' : 'NÃO ❌'}`);
      
      // Salva resultado
      this.variaveis[`${node.id}_resultado`] = resultado;
      this.variaveis.ultimaCondicao = resultado;
      
      // Segue para o caminho correto
      const handleType = resultado ? 'output-true' : 'output-false';
      const nextNode = this.findNextNode(node.id, handleType);
      this.aguardandoResposta = false;
      await this.executeNode(nextNode);
    } catch (error) {
      console.error('Erro ao avaliar condição:', error);
      const nextNode = this.findNextNode(node.id, 'output-false');
      await this.executeNode(nextNode);
    }
  }

  // Executa nó de IA
  async executeIA(node, userMessage = null) {
    // Pega a última mensagem do cliente
    const mensagem = userMessage || this.variaveis.ultimaMensagem || '';
    
    try {
      // Monta a instrução (pode usar variáveis)
      let instrucao = this.substituirVariaveis(node.data.instrucao || '');
      
      // Se tem um prompt do banco
      if (node.data.promptId) {
        const promptObj = await promptService.getPromptPorNome(node.data.promptId);
        if (promptObj) {
          instrucao = this.substituirVariaveis(promptObj.conteudo);
        }
      }
      
      const mensagens = [];
      if (instrucao) {
        mensagens.push({ role: 'system', content: instrucao });
      }
      if (mensagem) {
        mensagens.push({ role: 'user', content: mensagem });
      }
      
      console.log(`🤖 Executando IA: "${instrucao.substring(0, 50)}..."`);
      const resposta = await provedorService.enviarParaIA(mensagens, node.data.provedorId);
      
      // Salva resposta na variável configurada
      const varName = node.data.variavelSaida || 'respostaIA';
      this.variaveis[varName] = resposta.trim();
      this.variaveis.ultimaRespostaIA = resposta.trim();
      
      console.log(`📝 IA respondeu, salvo em {{${varName}}}: "${resposta.trim().substring(0, 50)}..."`);
      
      this.aguardandoResposta = false;
      const nextNode = this.findNextNode(node.id);
      await this.executeNode(nextNode);
    } catch (error) {
      console.error('Erro ao executar IA:', error);
      this.aguardandoResposta = false;
      const nextNode = this.findNextNode(node.id);
      await this.executeNode(nextNode);
    }
  }

  // Executa nó de ação
  async executeAction(node) {
    try {
      switch (node.data.tipo) {
        case 'requisicao':
          if (node.data.requisicaoTipo) {
            console.log(`⚙️ Executando requisição: ${node.data.requisicaoTipo}`);
            
            // Caso especial apenas para gruposdewhats: usa banco (grupos sincronizados do WhatsApp)
            const tipoReq = String(node.data.requisicaoTipo).trim().toLowerCase();
            if (tipoReq === 'gruposdewhats') {
              const grupoWhatsappService = require('./grupoWhatsappService');
              const bairro = (this.variaveis.bairro || this.variaveis.respostaIA || '').trim();
              console.log(`🔍 Buscando grupo (DB) para bairro: "${bairro}"`);
              const grupo = await grupoWhatsappService.getGrupoPorBairro(bairro);
              if (grupo && grupo.link) {
                this.variaveis.linkGrupo = grupo.link;
                this.variaveis.nomeGrupo = grupo.nome || grupo.bairro || 'Grupo';
                console.log(`✅ Grupo encontrado: ${this.variaveis.nomeGrupo}`);
              } else {
                const grupoGeral = await grupoWhatsappService.getGrupoPorBairro('geral');
                this.variaveis.linkGrupo = grupoGeral?.link || 'https://chat.whatsapp.com/LINK_NAO_ENCONTRADO';
                this.variaveis.nomeGrupo = grupoGeral?.nome || 'Grupo Geral';
                console.log(`⚠️ Usando grupo geral`);
              }
            } else {
              // Requisições configuradas na dash (JSON + IA, API, etc.): ex. BuscarGruporPorBairro → arquivo grupos_whatsapp
              const resposta = await requisicaoService.executarRequisicao(
                node.data.requisicaoTipo,
                this.variaveis.ultimaMensagem || '',
                this.variaveis
              );
              console.log('🔀 [Fluxo] Resposta da requisição:', JSON.stringify({ erro: resposta.erro, temResultado: resposta.resultado !== undefined, tipoResultado: typeof resposta.resultado }));
              if (resposta.erro) {
                console.error(`❌ Requisição ${node.data.requisicaoTipo}:`, resposta.erro);
                this.variaveis[`${node.id}_erro`] = resposta.erro;
              } else if (resposta.resultado !== undefined) {
                this.variaveis[`${node.id}_resultado`] = resposta.resultado;
                const res = resposta.resultado;
                if (typeof res === 'object' && res !== null) {
                  Object.assign(this.variaveis, res);
                  if (res.link && !this.variaveis.linkGrupo) this.variaveis.linkGrupo = res.link;
                  if (res.linkGrupo) this.variaveis.linkGrupo = res.linkGrupo;
                  if (res.nome && !this.variaveis.nomeGrupo) this.variaveis.nomeGrupo = res.nome;
                  console.log('🔀 [Fluxo] Variáveis após ação (linkGrupo, bairro):', this.variaveis.linkGrupo, this.variaveis.bairro);
                } else if (typeof res === 'string' && res.includes('chat.whatsapp.com')) {
                  const urlMatch = res.match(/https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/);
                  if (urlMatch) {
                    this.variaveis.linkGrupo = urlMatch[0];
                    console.log('🔀 [Fluxo] linkGrupo definido a partir do texto:', urlMatch[0]);
                  }
                }
              }
            }
          }
          break;
          
        case 'salvar_variavel':
          if (node.data.nomeVariavel) {
            const valor = this.substituirVariaveis(node.data.valorVariavel || '');
            this.variaveis[node.data.nomeVariavel] = valor;
            console.log(`📝 Variável salva: {{${node.data.nomeVariavel}}} = "${valor}"`);
          }
          break;

        case 'marcar_meta': {
          const metaNome = (node.data.metaNome || '').trim();
          if (metaNome) {
            const res = await metaService.marcarConcluido(this.chatId, metaNome);
            this.variaveis['meta_' + metaNome] = 'concluido';
            if (res.ok) console.log(`✅ Meta "${metaNome}" marcada como concluída para ${this.chatId}`);
            else console.warn(`⚠️ Marcar meta "${metaNome}":`, res.erro);
          }
          break;
        }

        case 'verificar_meta': {
          const metaNome = (node.data.metaNome || '').trim();
          const variavelSaida = (node.data.variavelSaidaMeta || 'meta_' + metaNome).trim();
          if (metaNome) {
            const concluido = await metaService.verificarConcluido(this.chatId, metaNome);
            this.variaveis[variavelSaida] = concluido ? 'concluido' : 'pendente';
            console.log(`🔍 Meta "${metaNome}" para ${this.chatId}: ${concluido ? 'concluído' : 'pendente'} → {{${variavelSaida}}}`);
          }
          break;
        }

        case 'ler_contato': {
          const campo = (node.data.campoContato || 'cam_grupo').trim().toLowerCase();
          const variavelSaida = (node.data.variavelSaidaContato || campo).trim() || 'cam_grupo';
          if (!CAMPOS_CONTATO_PERMITIDOS.includes(campo)) {
            console.warn(`⚠️ Ler contato: campo "${campo}" não permitido. Use: ${CAMPOS_CONTATO_PERMITIDOS.join(', ')}`);
            break;
          }
          const wid = metaService.normalizarWhatsappId(this.chatId);
          if (!wid) {
            this.variaveis[variavelSaida] = '';
            console.log(`📋 Ler contato {{${variavelSaida}}}: chatId inválido`);
            break;
          }
          try {
            const conn = await mysql.createConnection({
              host: dbConfig.host,
              port: dbConfig.port || 3306,
              user: dbConfig.username,
              password: dbConfig.password,
              database: dbConfig.database
            });
            let rows = [];
            const [rows1] = await conn.execute(
              `SELECT \`${campo}\` FROM contatos WHERE whatsapp_id = ? LIMIT 1`,
              [wid]
            );
            rows = rows1;
            if (rows.length === 0 && this.chatId && String(this.chatId) !== wid) {
              const [rows2] = await conn.execute(
                `SELECT \`${campo}\` FROM contatos WHERE whatsapp_id = ? LIMIT 1`,
                [String(this.chatId).trim()]
              );
              rows = rows2;
            }
            if (rows.length === 0) {
              try {
                await conn.execute(
                  'INSERT INTO contatos (whatsapp_id) VALUES (?) ON DUPLICATE KEY UPDATE updated_at = NOW()',
                  [wid]
                );
                const [rowsNovo] = await conn.execute(
                  `SELECT \`${campo}\` FROM contatos WHERE whatsapp_id = ? LIMIT 1`,
                  [wid]
                );
                rows = rowsNovo;
              } catch (ins) {
                if (ins.code !== 'ER_NO_SUCH_TABLE') console.warn('⚠️ Ler contato (criar linha):', ins.message);
              }
            }
            await conn.end();
            const valor = rows.length > 0 ? (rows[0][campo] != null ? String(rows[0][campo]) : '') : '';
            this.variaveis[variavelSaida] = valor;
            if (valor === '') {
              console.log(`📋 Ler contato {{${variavelSaida}}} = ${campo} → (vazio: nenhum registro em contatos para esse número)`);
            } else {
              console.log(`📋 Ler contato {{${variavelSaida}}} = ${campo} → "${valor}"`);
            }
          } catch (e) {
            if (e.code === 'ER_NO_SUCH_TABLE') {
              this.variaveis[variavelSaida] = '';
              console.warn('⚠️ Ler contato: tabela contatos não existe');
            } else {
              this.variaveis[variavelSaida] = '';
              console.warn('⚠️ Ler contato:', e.message);
            }
          }
          break;
        }
          
        case 'webhook':
          if (node.data.webhookUrl) {
            const url = this.substituirVariaveis(node.data.webhookUrl);
            console.log(`🌐 Enviando webhook para: ${url}`);
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.variaveis)
            });
          }
          break;

        case 'enviar_cupom': {
          const nomeArquivo = (node.data.arquivoCupons || 'cupons_desconto').trim();
          const promptCupom = (node.data.promptCupom || '').trim();
          this.variaveis.dataatual = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
          this.variaveis.dataHoraAtual = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

          const conteudo = arquivoService.getConteudo(nomeArquivo);
          const listaCupons = Array.isArray(conteudo) ? conteudo : (conteudo && typeof conteudo === 'object' ? [conteudo] : []);
          const textosValidos = listaCupons.map(c => (c && (c.texto || c.mensagem)) ? (c.texto || c.mensagem) : null).filter(Boolean);

          let mensagemCupom = '';
          if (promptCupom && textosValidos.length > 0) {
            const instrucao = this.substituirVariaveis(promptCupom);
            const regra = `REGRAS OBRIGATÓRIAS: Sua resposta deve ser EXATAMENTE uma das mensagens do campo "texto" da lista abaixo, copiada inteira sem alterar NADA. É PROIBIDO inventar códigos, criar textos ou modificar o conteúdo. Se nenhum cupom da lista atender ao critério pedido, responda apenas: NAO_ENCONTRADO`;
            const conteudoParaIA = JSON.stringify(listaCupons, null, 2);
            const mensagens = [
              { role: 'system', content: `${instrucao}\n\n${regra}` },
              { role: 'user', content: 'Lista de cupons (use apenas um dos campos "texto" exatamente como está):\n' + conteudoParaIA }
            ];
            try {
              console.log(`🎟️ Buscando cupom com IA (prompt do nó): "${instrucao.substring(0, 50)}..."`);
              const respostaIA = (await provedorService.enviarParaIA(mensagens, node.data.provedorCupom)).trim();
              if (respostaIA.toUpperCase() === 'NAO_ENCONTRADO') {
                mensagemCupom = selecionarCupomPorCriterio(listaCupons, instrucao);
              } else if (textosValidos.some(t => t === respostaIA || t.trim() === respostaIA.trim())) {
                mensagemCupom = respostaIA;
              } else {
                mensagemCupom = selecionarCupomPorCriterio(listaCupons, instrucao);
                if (!mensagemCupom) mensagemCupom = textosValidos[0];
                console.warn('⚠️ IA retornou texto que não está no arquivo; usado cupom do arquivo.');
              }
            } catch (err) {
              console.error('❌ Erro IA ao processar cupom:', err.message);
              mensagemCupom = selecionarCupomPorCriterio(listaCupons, promptCupom) || textosValidos[0];
            }
          }
          if (!mensagemCupom) {
            if (textosValidos.length > 0) mensagemCupom = textosValidos[0];
            else if (listaCupons.length > 0 && listaCupons[0]) {
              const c = listaCupons[0];
              mensagemCupom = c.texto || c.mensagem || (c.codigo ? `Cupom: ${c.codigo}` : '');
            }
          }
          if (mensagemCupom) {
            mensagemCupom = this.substituirVariaveis(mensagemCupom);
            await this.client.sendMessage(this.chatId, mensagemCupom);
            console.log(`🎟️ Cupom enviado para ${this.chatId} (arquivo: ${nomeArquivo})`);
          } else {
            console.warn(`⚠️ Nenhum cupom em "${nomeArquivo}"`);
          }
          this.fluxoCompletouCampanha = true;
          break;
        }
      }
    } catch (error) {
      console.error('Erro ao executar ação:', error);
    }
    
    const nextNode = this.findNextNode(node.id);
    await this.executeNode(nextNode);
  }

  // Executa nó de fim
  async executeEnd(node) {
    if (node.data.mensagemFinal) {
      const texto = this.substituirVariaveis(node.data.mensagemFinal);
      await this.client.sendMessage(this.chatId, texto);
    }

    const ehFluxoCampanha = this.fluxo.tipo === 'campanha' ||
      (this.fluxo.nome && String(this.fluxo.nome).toLowerCase().includes('campanha'));
    const deveFazerHandoff = ehFluxoCampanha && typeof onCampanhaFlowEnd === 'function' && !this.fluxoCompletouCampanha;
    if (deveFazerHandoff) {
      try {
        await onCampanhaFlowEnd(this.client, this.chatId, this.fluxo);
      } catch (err) {
        console.error('❌ Erro no handoff campanha (após fim do fluxo):', err.message);
      }
    }
    
    console.log(`✅ Fluxo "${this.fluxo.nome}" finalizado para ${this.chatId}`);
    sessoesFluxo.delete(this.chatId);
  }

  // Processa contatos (vCard) quando o nó atual é wait_contacts
  async processarContatos(msg) {
    if (!this.aguardandoContatos) return false;
    const currentNode = this.getNode(this.currentNodeId);
    if (!currentNode || currentNode.type !== 'wait_contacts') return false;

    const vCards = msg.vCards && msg.vCards.length ? msg.vCards : (msg.body ? [msg.body] : []);
    if (vCards.length === 0) return false;

    const indicados = indicacaoService.parseVcards(vCards);
    if (indicados.length === 0) {
      if (msg.reply) await msg.reply('Nenhum número válido nesses contatos. Envie usando *Compartilhar contato*.');
      return true;
    }

    try {
      const { qtInseridos, qtTotal, completouMissao } = await indicacaoService.registrarIndicacoes(this.chatId, indicados);
      this.variaveis.qtIndicados = qtTotal;
      this.variaveis.metaIndicados = this.waitContactsMeta;

      const node = currentNode;
      const mensagemProgresso = (node.data.mensagemProgresso || '').trim();

      if (completouMissao) {
        this.aguardandoContatos = false;
        if (mensagemProgresso) {
          const texto = this.substituirVariaveis(mensagemProgresso);
          await this.client.sendMessage(this.chatId, texto);
        }
        const nextNode = this.findNextNode(node.id);
        await this.executeNode(nextNode);
      } else {
        if (qtInseridos > 0 && mensagemProgresso) {
          const texto = this.substituirVariaveis(mensagemProgresso);
          await this.client.sendMessage(this.chatId, texto);
        } else if (qtInseridos > 0 && msg.reply) {
          await msg.reply(`✅ ${qtInseridos} contato(s) recebido(s)! Total: *${qtTotal}/${this.waitContactsMeta}* indicações.`);
        } else if (qtInseridos === 0 && msg.reply) {
          await msg.reply(`Esses contatos já foram contados. Total: *${qtTotal}/${this.waitContactsMeta}*.`);
        }
      }
      return true;
    } catch (err) {
      console.error('❌ Erro ao processar indicações no fluxo:', err);
      if (msg.reply) await msg.reply('Ocorreu um erro ao salvar os contatos. Tente de novo.');
      return true;
    }
  }

  // Processa mensagem do usuário
  async processMessage(message) {
    this.variaveis.ultimaMensagem = message;
    
    if (!this.aguardandoResposta) return false;
    
    const currentNode = this.getNode(this.currentNodeId);
    if (!currentNode) return false;
    
    switch (currentNode.type) {
      case 'wait':
        // Salva resposta na variável configurada
        const varName = this.waitVariableName || 'resposta';
        this.variaveis[varName] = message;
        console.log(`📝 Resposta salva em {{${varName}}}: "${message}"`);
        
        this.aguardandoResposta = false;
        const nextNode = this.findNextNode(currentNode.id);
        await this.executeNode(nextNode);
        return true;
        
      case 'condition':
        await this.executeCondition(currentNode, message);
        return true;
        
      case 'ia':
        await this.executeIA(currentNode, message);
        return true;
        
      default:
        return false;
    }
  }

  // Substitui variáveis no texto
  substituirVariaveis(texto) {
    return texto.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return this.variaveis[key] !== undefined ? this.variaveis[key] : match;
    });
  }
}

// Funções exportadas
async function iniciarFluxo(client, chatId, fluxo) {
  const executor = new FluxoExecutor(client, chatId, fluxo);
  sessoesFluxo.set(chatId, executor);
  await executor.start();
  return executor;
}

async function processarMensagemFluxo(chatId, message) {
  const executor = sessoesFluxo.get(chatId);
  if (!executor) return false;

  // Se o fluxo foi desativado, encerra a sessão e não processa
  const fluxoAtual = await fluxoService.getFluxoPorId(executor.fluxo.id);
  if (!fluxoAtual || !fluxoAtual.ativo) {
    sessoesFluxo.delete(chatId);
    return false;
  }

  return await executor.processMessage(message);
}

async function processarContatosFluxo(chatId, msg) {
  const executor = sessoesFluxo.get(chatId);
  if (!executor) return false;
  const fluxoAtual = await fluxoService.getFluxoPorId(executor.fluxo.id);
  if (!fluxoAtual || !fluxoAtual.ativo) {
    sessoesFluxo.delete(chatId);
    return false;
  }
  return await executor.processarContatos(msg);
}

function estaAguardandoContatos(chatId) {
  const executor = sessoesFluxo.get(chatId);
  return executor ? executor.aguardandoContatos === true : false;
}

function temFluxoAtivo(chatId) {
  return sessoesFluxo.has(chatId);
}

function encerrarFluxo(chatId) {
  sessoesFluxo.delete(chatId);
}

function encerrarSessoesPorFluxoId(fluxoId) {
  const alvo = Number(fluxoId);
  let total = 0;
  for (const [chatId, executor] of sessoesFluxo.entries()) {
    if (Number(executor?.fluxo?.id) === alvo) {
      sessoesFluxo.delete(chatId);
      total++;
    }
  }
  return total;
}

function getSessaoFluxo(chatId) {
  return sessoesFluxo.get(chatId);
}

/** Retorna lista de chatIds que estão com sessão de fluxo ativa (para exibir "em fluxo" na dashboard). */
function getChatIdsEmFluxo() {
  return Array.from(sessoesFluxo.keys());
}

module.exports = {
  FluxoExecutor,
  iniciarFluxo,
  processarMensagemFluxo,
  processarContatosFluxo,
  estaAguardandoContatos,
  temFluxoAtivo,
  encerrarFluxo,
  encerrarSessoesPorFluxoId,
  getSessaoFluxo,
  getChatIdsEmFluxo,
  setOnCampanhaFlowEnd
};
