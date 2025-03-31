/**
 * Serviço simples para extrair palavras-chave de um texto
 * Em uma implementação completa, poderíamos usar algoritmos como TF-IDF,
 * processamento de linguagem natural ou serviços especializados.
 */

// Lista de palavras comuns (stop words) em português que devem ser ignoradas
const STOP_WORDS = [
  'a', 'ao', 'aos', 'aquela', 'aquelas', 'aquele', 'aqueles', 'aquilo', 'as', 'até',
  'com', 'como', 'da', 'das', 'de', 'dela', 'delas', 'dele', 'deles', 'depois',
  'do', 'dos', 'e', 'ela', 'elas', 'ele', 'eles', 'em', 'entre', 'era',
  'eram', 'éramos', 'essa', 'essas', 'esse', 'esses', 'esta', 'estas', 'este',
  'estou', 'eu', 'foi', 'fomos', 'for', 'foram', 'fosse', 'fossem', 'fui',
  'há', 'isso', 'isto', 'já', 'lhe', 'lhes', 'me', 'mesmo', 'meu', 'meus',
  'minha', 'minhas', 'muito', 'muitos', 'na', 'não', 'nas', 'nem', 'no', 'nos',
  'nós', 'nossa', 'nossas', 'nosso', 'nossos', 'num', 'numa', 'o', 'os', 'ou',
  'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'qual', 'quando', 'que',
  'quem', 'se', 'seja', 'sejam', 'sejamos', 'sem', 'será', 'serão', 'serei',
  'seremos', 'seria', 'seriam', 'seríamos', 'seu', 'seus', 'só', 'somos', 'sou',
  'sua', 'suas', 'também', 'te', 'tem', 'tém', 'temos', 'tenho', 'teu', 'teus',
  'tu', 'tua', 'tuas', 'um', 'uma', 'umas', 'uns', 'você', 'vocês', 'vos'
];

/**
 * Extrai palavras-chave de um texto
 * @param {string} text Texto para extrair palavras-chave
 * @param {number} maxKeywords Número máximo de palavras-chave a retornar
 * @returns {string[]} Array de palavras-chave
 */
function extractKeywords(text, maxKeywords = 10) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Converte para minúsculas e remove caracteres especiais
  const normalizedText = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\s{2,}/g, ' ');

  // Divide o texto em palavras
  const words = normalizedText.split(' ');

  // Remove stop words e palavras muito curtas
  const filteredWords = words.filter(word => 
    word.length > 2 && !STOP_WORDS.includes(word)
  );

  // Conta a frequência de cada palavra
  const wordFrequency = {};
  filteredWords.forEach(word => {
    wordFrequency[word] = (wordFrequency[word] || 0) + 1;
  });

  // Ordena as palavras por frequência
  const sortedWords = Object.keys(wordFrequency)
    .sort((a, b) => wordFrequency[b] - wordFrequency[a]);

  // Retorna as palavras mais frequentes até o limite definido
  return sortedWords.slice(0, maxKeywords);
}

module.exports = { extractKeywords }; 