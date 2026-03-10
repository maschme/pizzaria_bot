
const axios = require("axios");
const OpenAI = require("openai");

const OPENROUTER_API_KEY = "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"; // insira sua key do OpenRouter
 const alibabaapiKey = 'sk-1cdd7bc8a08f46b7b283e2d996303bfb';


const openai = new OpenAI({
  apiKey: alibabaapiKey, // Ou substitua com sua chave diretamente
  baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
});

async function enviarParaQwen3(historico) {
  try {
    const start = Date.now();

    const completion = await openai.chat.completions.create({
      model: "qwen-plus",
      messages: historico,
    });

    const duration = Date.now() - start;
    const usage = completion.usage;

    // Extrair métricas do cache
    const cachedTokens = usage?.prompt_tokens_details?.cached_tokens || 0;
    const promptTokens = usage?.prompt_tokens || 0;
    const newTokens = promptTokens - cachedTokens;
    const cacheHitPercentage = promptTokens > 0 
      ? ((cachedTokens / promptTokens) * 100).toFixed(1) + "%" 
      : "0%";

    console.log({
      modelo: "qwen-plus",
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
    console.error("❌ Erro ao chamar Qwen3:", error);
    return "⚠️ Erro ao gerar resposta com o modelo Qwen3.";
  }
}




async function enviarParaClaude(historico) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "anthropic/claude-3-sonnet-20240229",
      messages: historico,
    },
    {
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices[0].message.content;
}

async function enviarParaQwen31(historico) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "mistralai/mistral-small-3.1-24b-instruct",
      messages: historico,
    },
    {
      headers: {
        "Authorization": `Bearer sk-1cdd7bc8a08f46b7b283e2d996303bfb`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices[0].message.content;
}

async function enviarParaQwen33(historico) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "qwen/qwen3-235b-a22b",
      messages: historico,
      "temperature": 0.7
      
    },
    {
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices[0].message.content;
}

async function enviarParaQwen34(historico) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "qwen/qwen3-235b-a22b",
      messages: historico,
      "temperature": 0.7,
        "provider": {
            "order": ["Together", "Parasail", "Kluster"]
        }
    },
    {
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data.choices[0].message.content;
}



module.exports = { enviarParaClaude, enviarParaQwen3 };

