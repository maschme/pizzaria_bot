'use strict';

// Clientes de IA legados (fallback quando não há provedor configurado no banco).
// Chaves vêm do .env: QWEN_API_KEY (Alibaba/DashScope) e OPENROUTER_API_KEY.

require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const QWEN_API_KEY = (process.env.QWEN_API_KEY || '').trim();

const openai = new OpenAI({
  apiKey: QWEN_API_KEY || 'nao-configurada',
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
});

async function enviarParaQwen3(historico) {
  try {
    if (!QWEN_API_KEY) throw new Error('QWEN_API_KEY não configurada no .env');
    const start = Date.now();

    const completion = await openai.chat.completions.create({
      model: 'qwen-plus',
      messages: historico,
    });

    const duration = Date.now() - start;
    const usage = completion.usage;

    // Extrair métricas do cache
    const cachedTokens = usage?.prompt_tokens_details?.cached_tokens || 0;
    const promptTokens = usage?.prompt_tokens || 0;
    const newTokens = promptTokens - cachedTokens;
    const cacheHitPercentage = promptTokens > 0
      ? ((cachedTokens / promptTokens) * 100).toFixed(1) + '%'
      : '0%';

    console.log({
      modelo: 'qwen-plus',
      tokens_prompt: promptTokens,
      tokens_resposta: usage?.completion_tokens,
      tokens_total: usage?.total_tokens,
      cached_tokens: cachedTokens,
      new_tokens: newTokens,
      cache_hit_rate: cacheHitPercentage,
      tempo_ms: duration
    });

    return completion.choices[0].message.content;

  } catch (error) {
    console.error('❌ Erro ao chamar Qwen3:', error);
    return '⚠️ Erro ao gerar resposta com o modelo Qwen3.';
  }
}

async function enviarParaClaude(historico) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY não configurada no .env');
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'anthropic/claude-3-sonnet-20240229',
      messages: historico,
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data.choices[0].message.content;
}

module.exports = { enviarParaClaude, enviarParaQwen3 };
