const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Prompt padrão para estruturar as respostas
const DEFAULT_SYSTEM_PROMPT = `
Você é um assistente de IA que interage via WhatsApp em português do Brasil.
Suas respostas devem ser concisas e baseadas exclusivamente nos dados armazenados no MongoDB.

TAXONOMIA DE CONHECIMENTO:
1. SUJEITO
   - USUÁRIO: Refere-se ao usuário atual ("Meu nome")
   - TERCEIRO: Refere-se a outras pessoas ("Meu amigo")
   - CONCEITO: Refere-se a conceitos ou entidades ("API", "Empresa X")

2. CATEGORIA
   - IDENTIDADE: Nomes, identificadores
   - RELAÇÃO: Conexões entre entidades
   - PROPRIEDADE: Atributos, características
   - DEFINIÇÃO: Significados, explicações

3. REGRA DE APRENDIZADO:
   - APENAS armazene conhecimento quando a mensagem começar com "/aprender"
   - NUNCA extraia conhecimento de perguntas ou conversas normais

4. REGRAS DE ARMAZENAMENTO:
   - Armazene APENAS informação com ALTA certeza (evite ambiguidade)
   - Cada fato deve ter um sujeito, predicado e objeto claramente definidos
   - Evite duplicidade e conflito mantendo categorias e tipos bem definidos
   - Nunca misture informações sobre USUÁRIO e TERCEIROS

Forneça sua resposta no formato JSON minimalista:
{
  "palavras_chave": ["palavra1", "palavra2"],
  "resposta": "Resposta concisa aqui",
  "classificacao": "global|pessoal",
  "analise_taxonomica": {
    "tipo_interacao": "informativa|pergunta|comando",
    "sujeito_principal": "USUÁRIO|TERCEIRO|CONCEITO",
    "categoria_conhecimento": "IDENTIDADE|RELAÇÃO|PROPRIEDADE|DEFINIÇÃO",
    "contexto_aplicacao": "PESSOAL|GLOBAL",
    "nivel_certeza": "ALTA|MÉDIA|BAIXA"
  },
  "conhecimento": {
    "armazenar": false,
    "entradas": []
  }
}

Para comandos /aprender, habilite o armazenamento APENAS se não houver ambiguidade:
{
  "palavras_chave": ["palavra1", "palavra2"],
  "resposta": "Armazenei esta informação",
  "classificacao": "global|pessoal",
  "analise_taxonomica": {
    "tipo_interacao": "informativa",
    "sujeito_principal": "USUÁRIO|TERCEIRO|CONCEITO",
    "categoria_conhecimento": "IDENTIDADE|RELAÇÃO|PROPRIEDADE|DEFINIÇÃO",
    "contexto_aplicacao": "PESSOAL|GLOBAL",
    "nivel_certeza": "ALTA"
  },
  "conhecimento": {
    "armazenar": true,
    "entradas": [
      {
        "id": "entrada_1",
        "tipo": "fato_identidade|fato_relacao|fato_definicao|fato_propriedade",
        "sujeito": {
          "tipo": "USUÁRIO|TERCEIRO|CONCEITO",
          "valor": "valor_específico",
          "id": "id_específico"
        },
        "predicado": {
          "tipo": "nome|amizade|significado|etc",
          "valor": "valor_específico"
        },
        "objeto": {
          "tipo": "USUÁRIO|TERCEIRO|CONCEITO",
          "valor": "valor_específico",
          "id": "id_específico"
        },
        "contexto": {
          "certeza": "ALTA",
          "fonte": "declaração_direta",
          "temporalidade": "atual"
        }
      }
    ]
  }
}

REGRAS ABSOLUTAS:
1. REGRA DE IDENTIFICAÇÃO
   - "Meu X" → USUÁRIO
   - "X do meu Y" → TERCEIRO
   - "X é Y" (sem "meu") → CONCEITO

2. REGRA DE FILTRAGEM
   - Armazene APENAS com nível de certeza ALTA
   - EVITE armazenar informações ambíguas ou conflitantes
   - NÃO armazene conhecimento sem comando explícito "/aprender"

3. REGRA DE RESPOSTA
   - USE APENAS dados do MongoDB para responder
   - NÃO invente informações
   - SEMPRE verifique se os dados solicitados existem

4. REGRA DE SUCINTEZ
   - Respostas DEVEM ser curtas e diretas
   - EVITE explicações desnecessárias
   - PRIORIZE dados estruturados sobre texto corrido

5. REGRA DE ATUALIZAÇÃO
   - Se receber informação conflitante com "/aprender", ATUALIZE o registro
   - MANTENHA apenas a informação mais recente em caso de conflito
   - REGISTRE a fonte e contexto para facilitar a resolução de conflitos

As respostas devem evitar termos ambíguos como "eu", "você", ou expressões que impliquem personalidade.
Foque exclusivamente nos dados solicitados, sem introduções ou conclusões.
`;

// Função para fazer uma requisição à API da OpenAI
async function getOpenAIResponse(userMessage, senderInfo) {
  try {
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;

    // Se temos informação do remetente, personaliza o prompt
    if (senderInfo && senderInfo.name) {
      systemPrompt += `\nO usuário que está enviando esta mensagem se identifica como "${senderInfo.name}".`;
    }

    // Se temos o ID do remetente, adiciona para contextualização
    if (senderInfo && senderInfo.id) {
      systemPrompt += `\nO identificador único do usuário atual é "${senderInfo.id}".`;
      systemPrompt += `\nUse este ID em todos os sujeitos ou objetos de tipo USUÁRIO.`;
    }

    // Verifica se é um comando de aprendizado
    const isLearningCommand = userMessage.startsWith('/aprender ');
    
    // Se for comando de aprendizado, adiciona instrução específica
    if (isLearningCommand) {
      systemPrompt += `\n\nATENÇÃO: Esta mensagem é um comando de aprendizado. VOCÊ DEVE ativar o armazenamento de conhecimento definindo "conhecimento.armazenar" como true e extraindo todos os fatos relevantes. A mensagem a processar é: "${userMessage}"`;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: 0.2, // Reduzido para máxima consistência e precisão
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });
    
    // Tenta fazer o parse do JSON retornado
    try {
      const content = response.choices[0].message.content.trim();
      
      // Garantir que o conteúdo é um JSON válido
      const jsonData = JSON.parse(content);
      
      // Validar se tem todos os campos necessários
      if (!jsonData.palavras_chave || !jsonData.resposta || !jsonData.classificacao || !jsonData.analise_taxonomica) {
        console.error('Resposta da OpenAI não contém todos os campos necessários');
        return {
          success: false,
          error: "A resposta não contém todos os campos necessários",
          rawResponse: content
        };
      }
      
      // Se for comando de aprendizado, forçar o armazenamento
      if (isLearningCommand) {
        // Forçar o armazenamento para comandos de aprendizado
        if (!jsonData.conhecimento || !jsonData.conhecimento.entradas || jsonData.conhecimento.entradas.length === 0) {
          // Se não há entradas, extrai conhecimento básico do comando
          const conteudoAprendizado = userMessage.substring(10).trim();
          
          // Análise simplificada para extrair informações
          let tipo, sujeito, predicado;
          
          if (conteudoAprendizado.toLowerCase().includes('meu nome')) {
            tipo = 'fato_identidade';
            sujeito = { tipo: 'USUÁRIO', valor: senderInfo.id };
            
            // Extrai o nome após "meu nome é" ou similar
            const nomeMatch = conteudoAprendizado.match(/meu nome (?:é|e|seria) ([^.,]+)/i);
            predicado = { tipo: 'nome', valor: nomeMatch ? nomeMatch[1].trim() : conteudoAprendizado };
          } else if (conteudoAprendizado.toLowerCase().includes(' significa ')) {
            tipo = 'fato_definicao';
            
            // Extrai conceito e definição
            const matches = conteudoAprendizado.match(/([^ ]+) significa ([^.]+)/i);
            if (matches) {
              sujeito = { tipo: 'CONCEITO', valor: matches[1].trim() };
              predicado = { tipo: 'significado', valor: matches[2].trim() };
            } else {
              // Fallback
              const partes = conteudoAprendizado.split(' significa ');
              sujeito = { tipo: 'CONCEITO', valor: partes[0].trim() };
              predicado = { tipo: 'significado', valor: partes[1] ? partes[1].trim() : '' };
            }
          } else if (conteudoAprendizado.match(/^[^:]+ é [^:]+$/i)) {
            // Formato simples "X é Y"
            const partes = conteudoAprendizado.split(' é ');
            
            if (partes[0].toLowerCase().startsWith('meu ')) {
              // "Meu X é Y" - fato sobre o usuário
              tipo = 'fato_propriedade';
              sujeito = { tipo: 'USUÁRIO', valor: senderInfo.id };
              predicado = { 
                tipo: partes[0].substring(4).trim().toLowerCase(), 
                valor: partes[1].trim() 
              };
            } else {
              // "X é Y" - definição ou propriedade de conceito
              tipo = 'fato_definicao';
              sujeito = { tipo: 'CONCEITO', valor: partes[0].trim() };
              predicado = { tipo: 'definicao', valor: partes[1].trim() };
            }
          } else {
            // Formato genérico - trata como definição
            tipo = 'fato_definicao';
            sujeito = { tipo: 'CONCEITO', valor: 'termo' };
            predicado = { tipo: 'definicao', valor: conteudoAprendizado };
          }
          
          // Cria entrada para conhecimento
          jsonData.conhecimento = {
            armazenar: true,
            entradas: [{
              id: 'entrada_manual',
              tipo: tipo,
              sujeito: sujeito,
              predicado: predicado,
              contexto: {
                certeza: 'ALTA',
                fonte: 'declaração_direta',
                temporalidade: 'atual'
              }
            }]
          };
          
          console.log(`Comando de aprendizado detectado: "${conteudoAprendizado}"`);
          console.log(`Conhecimento manualmente estruturado:`, JSON.stringify(jsonData.conhecimento));
        } else {
          // Apenas força armazenar = true
          jsonData.conhecimento.armazenar = true;
          
          // Garante que todas as entradas tenham certeza ALTA
          if (jsonData.conhecimento.entradas) {
            jsonData.conhecimento.entradas.forEach(entrada => {
              if (!entrada.contexto) entrada.contexto = {};
              entrada.contexto.certeza = 'ALTA';
            });
          }
        }
      }
      
      return {
        success: true,
        data: jsonData
      };
    } catch (parseError) {
      console.error("Erro ao fazer parse da resposta da OpenAI:", parseError);
      return {
        success: false,
        error: "Erro ao processar a resposta",
        rawResponse: response.choices[0].message.content
      };
    }
  } catch (error) {
    console.error("Erro ao chamar API da OpenAI:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { getOpenAIResponse }; 