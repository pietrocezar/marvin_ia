const { getOpenAIResponse } = require('../config/openai');
const ResponseModel = require('../models/Response');
const { extractKeywords } = require('./keywordExtractor');
require('dotenv').config();

/**
 * Extrai o texto da mensagem do WhatsApp
 * @param {Object} message Objeto de mensagem do WhatsApp
 * @returns {String|null} Texto da mensagem ou null se não encontrado
 */
function extractMessageText(message) {
  // Se não há mensagem, retorna null
  if (!message || !message.message) return null;

  // Verifica diferentes tipos de mensagem
  if (message.message.conversation) {
    return message.message.conversation.trim();
  }
  
  if (message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
    return message.message.extendedTextMessage.text.trim();
  }
  
  if (message.message.imageMessage && message.message.imageMessage.caption) {
    return message.message.imageMessage.caption.trim();
  }
  
  return null;
}

/**
 * Extrai informações sobre o remetente
 * @param {Object} message Objeto de mensagem do WhatsApp
 * @returns {Object} Objeto com informações do remetente
 */
function extractSenderInfo(message) {
  const senderInfo = {
    id: message.key.participant || message.key.remoteJid,
    name: message.pushName || null,
    isGroup: message.key.remoteJid.includes('@g.us')
  };
  
  // Remove o sufixo do ID para obter apenas o número
  senderInfo.id = senderInfo.id.split('@')[0];
  
  return senderInfo;
}

/**
 * Analisa a taxonomia da mensagem para determinar o tipo de consulta
 * @param {Object} taxonomia Objeto com a análise taxonômica da mensagem
 * @param {String} mensagemOriginal Texto original da mensagem
 * @returns {Object|null} Objeto com informações da consulta ou null
 */
function analisarTaxonomia(taxonomia, mensagemOriginal) {
  // Se não há taxonomia, retorna null
  if (!taxonomia) return null;
  
  // Se não é uma pergunta, não é uma consulta
  if (taxonomia.tipo_interacao !== 'pergunta') return null;
  
  // Criamos a consulta com base na taxonomia
  const consulta = {
    tipo: null,
    alvo: null,
    parametros: {}
  };
  
  // Determina o tipo de consulta baseado na categoria e sujeito
  switch (taxonomia.categoria_conhecimento) {
    case 'IDENTIDADE':
      consulta.tipo = 'identidade';
      break;
    case 'RELAÇÃO':
      consulta.tipo = 'relacao';
      break;
    case 'DEFINIÇÃO':
      consulta.tipo = 'definicao';
      break;
    case 'PROPRIEDADE':
      consulta.tipo = 'propriedade';
      break;
    default:
      return null;
  }
  
  // Determina o alvo da consulta baseado no sujeito principal
  switch (taxonomia.sujeito_principal) {
    case 'USUÁRIO':
      consulta.alvo = 'usuario';
      consulta.parametros.entidade = 'usuario';
      break;
    case 'TERCEIRO':
      consulta.alvo = 'terceiro';
      // Tenta extrair o nome específico do terceiro da mensagem
      const terceiroMatch = mensagemOriginal.match(/(?:quem é|sobre) ([a-zA-Z]+)/i);
      if (terceiroMatch && terceiroMatch[1]) {
        consulta.parametros.valor = terceiroMatch[1].toLowerCase();
      }
      break;
    case 'CONCEITO':
      consulta.alvo = 'conceito';
      
      // Dependendo do tipo de consulta, extraímos diferentemente
      if (consulta.tipo === 'definicao') {
        // Para definições, buscamos por padrões como "o que é X"
        const conceitoDefinicaoMatch = mensagemOriginal.match(/(?:o que é|significa|significado de) ([a-zA-Z0-9]+)/i);
        if (conceitoDefinicaoMatch && conceitoDefinicaoMatch[1]) {
          consulta.parametros.valor = conceitoDefinicaoMatch[1].toLowerCase();
        }
      } else if (consulta.tipo === 'propriedade') {
        // Para propriedades, buscamos padrões como "quais X da Y" ou "que X tem Y"
        const conceitoPropriedadeMatch = mensagemOriginal.match(/(?:quais|que|quem) (?:s[ãa]o )?(?:as? |os? )?([a-zA-Z]+)(?:s)? (?:da |do |de |)([a-zA-Z0-9 ]+)\??/i);
        
        if (conceitoPropriedadeMatch) {
          consulta.parametros.propriedade = conceitoPropriedadeMatch[1].toLowerCase();
          consulta.parametros.valor = conceitoPropriedadeMatch[2].trim().toLowerCase();
        } else {
          // Tenta outros padrões mais simples
          const conceitoSimples = mensagemOriginal.match(/([a-zA-Z0-9 ]+)(?:\s+tem\s+|\s+possui\s+)(?:quais|que)?\s+([a-zA-Z]+)/i);
          if (conceitoSimples) {
            consulta.parametros.valor = conceitoSimples[1].trim().toLowerCase();
            consulta.parametros.propriedade = conceitoSimples[2].toLowerCase();
          }
        }
      }
      break;
    default:
      return null;
  }
  
  // Se não conseguiu determinar os parâmetros necessários, desiste
  if (consulta.alvo === 'terceiro' && !consulta.parametros.valor) return null;
  if (consulta.alvo === 'conceito' && !consulta.parametros.valor) return null;
  
  return consulta;
}

/**
 * Traduz o formato da nova taxonomia para o formato usado no modelo de dados
 * @param {Object} conhecimento Objeto com o conhecimento extraído
 * @param {String} idUsuario ID do usuário que enviou a mensagem
 * @returns {Array} Array de fatos no formato do modelo de dados
 */
function traduzirParaModeloDados(conhecimento, idUsuario) {
  // Se não há conhecimento a armazenar, retorna array vazio
  if (!conhecimento.armazenar || !Array.isArray(conhecimento.entradas) || conhecimento.entradas.length === 0) {
    console.log("Nenhum conhecimento para armazenar ou formato inválido");
    return [];
  }
  
  // Array para armazenar os fatos traduzidos
  const fatos = [];
  
  // Validar cada entrada antes de processar
  for (const entrada of conhecimento.entradas) {
    // Verificações de segurança para evitar ambiguidade e conflitos
    if (!entrada || !entrada.tipo || !entrada.sujeito || !entrada.predicado) {
      console.log("Entrada ignorada: estrutura incompleta", entrada);
      continue;
    }
    
    // Verificar nível de certeza
    if (entrada.contexto?.certeza !== "ALTA") {
      console.log("Entrada ignorada: certeza não é ALTA", entrada);
      continue;
    }
    
    // Validação adicional de tipos permitidos
    const tiposPermitidos = ['fato_identidade', 'fato_relacao', 'fato_definicao', 'fato_propriedade', 'fato_entidade'];
    if (!tiposPermitidos.includes(entrada.tipo)) {
      console.log(`Entrada ignorada: tipo não permitido "${entrada.tipo}"`, entrada);
      continue;
    }
    
    // Validação adicional de sujeitos permitidos
    const sujeitosPermitidos = ['USUÁRIO', 'TERCEIRO', 'CONCEITO'];
    if (!sujeitosPermitidos.includes(entrada.sujeito.tipo)) {
      console.log(`Entrada ignorada: tipo de sujeito não permitido "${entrada.sujeito.tipo}"`, entrada);
      continue;
    }
    
    // Validar campos obrigatórios específicos por tipo
    switch (entrada.tipo) {
      case 'fato_identidade':
        if (!entrada.sujeito.valor || !entrada.predicado.valor) {
          console.log("Fato identidade ignorado: dados incompletos", entrada);
          continue;
        }
        
        // Validação semântica - valor não pode conter símbolos ou caracteres especiais
        if (/[^\w\s]/i.test(entrada.predicado.valor)) {
          console.log("Fato identidade ignorado: valor contém caracteres inválidos", entrada);
          continue;
        }
        break;
        
      case 'fato_relacao':
        if (!entrada.sujeito.valor || !entrada.predicado.valor || !entrada.objeto || !entrada.objeto.valor) {
          console.log("Fato relação ignorado: dados incompletos", entrada);
          continue;
        }
        
        // Validação semântica - verificar circularidade
        if (entrada.sujeito.tipo === entrada.objeto.tipo && 
            entrada.sujeito.valor === entrada.objeto.valor) {
          console.log("Fato relação ignorado: relação circular", entrada);
          continue;
        }
        break;
        
      case 'fato_definicao':
        if (!entrada.sujeito.valor || !entrada.predicado.valor) {
          console.log("Fato definição ignorado: dados incompletos", entrada);
          continue;
        }
        
        // Validação semântica - definição deve ser substantiva
        if (entrada.predicado.valor.length < 5) {
          console.log("Fato definição ignorado: definição muito curta", entrada);
          continue;
        }
        break;
        
      case 'fato_propriedade':
        if (!entrada.sujeito.valor || !entrada.predicado.valor) {
          console.log("Fato propriedade ignorado: dados incompletos", entrada);
          continue;
        }
        
        // Validação semântica - propriedade deve ter predicado claro
        if (!entrada.predicado.tipo || entrada.predicado.tipo.length < 2) {
          console.log("Fato propriedade ignorado: tipo de predicado inválido", entrada);
          continue;
        }
        break;
        
      case 'fato_entidade':
        if (!entrada.sujeito.valor || !entrada.predicado.valor) {
          console.log("Fato entidade ignorado: dados incompletos", entrada);
          continue;
        }
        break;
    }
    
    // Cria um fato base com os campos comuns
    const fato = {
      tipo: null,
      chave: null,
      entidade: null,
      valor: null,
      relacionamentos: [],
      contexto: {
        certeza: "ALTA",
        fonte: entrada.contexto?.fonte || "api",
        timestamp: new Date().toISOString()
      }
    };
    
    // Normaliza valores antes do processamento para evitar inconsistências
    const normalizarValor = (valor) => {
      if (typeof valor !== 'string') return valor;
      // Remove espaços extras, caracteres especiais no início/fim
      return valor.trim().replace(/^[^\w]+|[^\w]+$/g, '');
    };
    
    // Normaliza os valores no objeto entrada
    if (entrada.sujeito.valor) entrada.sujeito.valor = normalizarValor(entrada.sujeito.valor);
    if (entrada.predicado.valor) entrada.predicado.valor = normalizarValor(entrada.predicado.valor);
    if (entrada.objeto?.valor) entrada.objeto.valor = normalizarValor(entrada.objeto.valor);
    
    // Processa com base no tipo de entrada
    switch (entrada.tipo) {
      case 'fato_identidade':
        fato.tipo = 'nome';
        fato.chave = 'nome';
        
        // Garantir que identidade de usuário use o ID correto
        if (entrada.sujeito.tipo === 'USUÁRIO') {
          fato.entidade = idUsuario;
        } else {
          fato.entidade = entrada.sujeito.valor.toLowerCase();
        }
        
        fato.valor = entrada.predicado.valor;
        break;
      
      case 'fato_relacao':
        fato.tipo = 'relacao';
        fato.chave = entrada.predicado.tipo || 'relacao_generica';
        
        // Garantir que relações de usuário usem o ID correto
        if (entrada.sujeito.tipo === 'USUÁRIO') {
          fato.entidade = idUsuario;
        } else {
          fato.entidade = entrada.sujeito.valor.toLowerCase();
        }
        
        fato.valor = entrada.objeto.valor;
        
        // Adiciona o relacionamento
        if (entrada.objeto) {
          fato.relacionamentos.push({
            tipo: fato.chave,
            entidade: entrada.objeto.valor.toLowerCase(),
            descricao: `${fato.chave} de ${entrada.sujeito.valor}`
          });
        }
        break;
      
      case 'fato_definicao':
        fato.tipo = 'definicao';
        // Normalize a chave para evitar duplicatas
        fato.chave = entrada.sujeito.valor.toLowerCase().trim();
        fato.entidade = 'geral';
        fato.valor = entrada.predicado.valor;
        break;
      
      case 'fato_propriedade':
        fato.tipo = 'propriedade';
        fato.chave = entrada.predicado.tipo || 'caracteristica';
        
        // Determina a entidade com base no tipo de sujeito
        if (entrada.sujeito.tipo === 'USUÁRIO') {
          fato.entidade = idUsuario;
        } else if (entrada.sujeito.tipo === 'CONCEITO') {
          // Para conceitos, usamos 'geral' como entidade
          // e armazenamos o conceito como metadado adicional
          fato.entidade = 'geral';
          fato.conceito = entrada.sujeito.valor.toLowerCase().trim();
        } else {
          fato.entidade = entrada.sujeito.valor.toLowerCase().trim();
        }
        
        fato.valor = entrada.predicado.valor;
        
        // Se for uma propriedade de um conceito, adicionamos ao relacionamento
        if (entrada.sujeito.tipo === 'CONCEITO') {
          fato.relacionamentos.push({
            tipo: 'propriedade_de',
            entidade: entrada.sujeito.valor.toLowerCase().trim(),
            descricao: `${fato.chave} de ${entrada.sujeito.valor}`
          });
        }
        break;
      
      // Tipo para lidar com fatos sobre empresas ou organizações
      case 'fato_entidade':
        fato.tipo = 'entidade';
        fato.chave = entrada.predicado.tipo || 'caracteristica';
        fato.entidade = entrada.sujeito.valor.toLowerCase().trim();
        fato.valor = entrada.predicado.valor;
        fato.categoria = entrada.sujeito.categoria || 'organizacao';
        break;
        
      default:
        // Se não conseguir mapear, pula esta entrada
        console.log("Tipo de entrada desconhecido:", entrada.tipo);
        continue;
    }
    
    // Verificação final de segurança - todos os campos essenciais devem estar presentes
    if (!fato.tipo || !fato.chave || !fato.entidade || !fato.valor) {
      console.log("Fato ignorado: campos obrigatórios ausentes após processamento", fato);
      continue;
    }
    
    // Normalização adicional para evitar inconsistências
    fato.chave = fato.chave.toLowerCase().trim();
    if (typeof fato.valor === 'string') {
      fato.valor = fato.valor.trim();
      
      // Se o valor estiver vazio após normalização, ignorar
      if (fato.valor.length === 0) {
        console.log("Fato ignorado: valor vazio após normalização", fato);
        continue;
      }
      
      // Limitar tamanho do valor para evitar dados muito grandes
      if (fato.valor.length > 500) {
        console.log("Valor truncado por exceder 500 caracteres");
        fato.valor = fato.valor.substring(0, 500) + '...';
      }
    }
    
    // Adiciona o fato ao array
    fatos.push(fato);
  }
  
  // Se não temos fatos após todas as validações, retornamos array vazio
  if (fatos.length === 0) {
    console.log("Nenhum fato válido após processamento");
    return [];
  }
  
  // Faz uma validação final para remover duplicatas
  const fatosUnicos = [];
  const chavesProcessadas = new Set();
  
  for (const fato of fatos) {
    // Cria uma chave única baseada nos campos principais
    const chaveUnica = `${fato.tipo}|${fato.chave}|${fato.entidade}`;
    
    if (!chavesProcessadas.has(chaveUnica)) {
      chavesProcessadas.add(chaveUnica);
      fatosUnicos.push(fato);
    } else {
      console.log(`Fato duplicado ignorado: ${chaveUnica}`);
    }
  }
  
  console.log(`Total de fatos após validação: ${fatosUnicos.length} de ${conhecimento.entradas.length} originais`);
  return fatosUnicos;
}

/**
 * Constrói uma resposta para consultas específicas com base nos fatos encontrados
 * @param {Object} consulta Objeto com informações da consulta
 * @param {Array|Object} resultados Resultados da consulta ao banco de dados
 * @returns {String|null} Resposta formatada ou null se não puder responder
 */
function construirRespostaConsulta(consulta, resultados) {
  // Se não há resultados, não conseguimos responder
  if (!resultados || (Array.isArray(resultados) && resultados.length === 0)) {
    return null;
  }
  
  // Se o resultado é um único fato
  if (resultados.fact) {
    const fato = resultados.fact;
    
    switch (consulta.tipo) {
      case 'identidade':
        if (fato.tipo === 'nome') {
          return `Seu nome é ${fato.valor}.`;
        }
        break;
        
      case 'definicao':
        return `${fato.chave.toUpperCase()} significa ${fato.valor}.`;
        
      default:
        return `${fato.chave}: ${fato.valor}`;
    }
  }
  
  // Se são múltiplos fatos
  if (resultados.facts && Array.isArray(resultados.facts)) {
    const fatos = resultados.facts;
    
    switch (consulta.tipo) {
      case 'relacao':
        if (consulta.alvo === 'terceiro') {
          // Busca específica por um valor de relação
          const fatosEspecificos = fatos.filter(f => 
            f.valor.toLowerCase() === consulta.parametros.valor.toLowerCase()
          );
          
          if (fatosEspecificos.length > 0) {
            const relacoes = fatosEspecificos.map(f => f.chave).join(', ');
            return `${consulta.parametros.valor} é seu ${relacoes}.`;
          } else {
            // Tenta uma correspondência parcial
            const fatosRelacionados = fatos.filter(f => 
              f.valor.toLowerCase().includes(consulta.parametros.valor.toLowerCase())
            );
            
            if (fatosRelacionados.length > 0) {
              const nomes = fatosRelacionados.map(f => f.valor).join(', ');
              return `Encontrei: ${nomes}`;
            }
          }
        } else {
          // Lista todas as relações do mesmo tipo
          const valores = fatos.map(f => f.valor).join(', ');
          if (fatos[0].chave === 'amigo') {
            return fatos.length === 1 
              ? `Seu amigo é ${valores}.` 
              : `Seus amigos são: ${valores}.`;
          } else {
            return `${fatos[0].chave}: ${valores}`;
          }
        }
        break;
        
      case 'propriedade':
        // Formata propriedades de um conceito/empresa
        if (consulta.alvo === 'conceito') {
          // Filtrar apenas as propriedades relevantes, se tivermos um tipo específico
          if (consulta.parametros.propriedade) {
            const propriedadesFiltradas = fatos.filter(f => 
              f.chave.toLowerCase().includes(consulta.parametros.propriedade)
            );
            
            if (propriedadesFiltradas.length > 0) {
              // Formata as propriedades encontradas
              const valores = propriedadesFiltradas.map(f => f.valor).join(', ');
              const nomeConceito = consulta.parametros.valor.charAt(0).toUpperCase() + 
                                   consulta.parametros.valor.slice(1);
              return `As ${consulta.parametros.propriedade} de ${nomeConceito} são: ${valores}`;
            }
          }
          
          // Se não temos filtro ou não encontramos com filtro, lista todas as propriedades
          const propriedades = fatos.map(f => `${f.chave}: ${f.valor}`).join('\n- ');
          const nomeConceito = consulta.parametros.valor.charAt(0).toUpperCase() + 
                               consulta.parametros.valor.slice(1);
          return `Informações sobre ${nomeConceito}:\n- ${propriedades}`;
        }
        break;
        
      default:
        return `Encontrei estas informações: ${fatos.map(f => f.valor).join(', ')}`;
    }
  }
  
  // Se chegou aqui, não conseguimos formatar uma resposta específica
  return null;
}

/**
 * Processa mensagem recebida do WhatsApp
 * @param {Object} message Objeto de mensagem do WhatsApp
 * @param {Object} sock Instância do cliente WhatsApp
 * @param {Object} db Instância do banco de dados MongoDB
 */
async function processMessage(message, sock, db) {
  try {
    // Obtém texto da mensagem
    const messageText = extractMessageText(message);
    if (!messageText) return;

    console.log(`Mensagem recebida: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`);
    
    // Extrai informações da mensagem e remetente
    const { remoteJid } = message.key;
    const senderInfo = extractSenderInfo(message);
    
    try {
      // Envia indicação de que está digitando
      await sock.presenceSubscribe(remoteJid);
      await sock.sendPresenceUpdate('composing', remoteJid);
    } catch (presenceError) {
      // Ignora erros de presença
    }

    // Inicializa modelo de resposta
    const responseModel = new ResponseModel(db);
    
    // Verifica se é um comando de aprendizado
    const isLearningCommand = messageText.startsWith('/aprender ');
    // Remove o prefixo '/aprender ' se for um comando de aprendizado
    const processText = isLearningCommand ? messageText.substring(10).trim() : messageText;
    
    // Extrai palavras-chave da mensagem para busca padrão
    const extractedKeywords = extractKeywords(processText);
    
    // Verifica se já temos uma resposta semelhante no banco
    let existingResponse;
    try {
      existingResponse = await responseModel.findResponseByKeywords(extractedKeywords);
    } catch (dbError) {
      console.error('Erro ao buscar resposta no banco:', dbError.message);
      existingResponse = { success: false };
    }
    
    let finalResponse;
    let consultaProcessada = false;
    
    if (existingResponse.success && !isLearningCommand) {
      console.log("Resposta encontrada no banco de dados");
      finalResponse = existingResponse.response.resposta;
    } else {
      console.log("Solicitando resposta da OpenAI...");
      
      try {
        // Obtém resposta da OpenAI, passando informações do remetente
        const openAIResult = await getOpenAIResponse(processText, senderInfo);
        
        if (openAIResult.success) {
          const { data } = openAIResult;
          
          // Se não é um comando de aprendizado, tenta processar como consulta
          if (!isLearningCommand) {
            // Analisa a taxonomia para verificar se é uma consulta específica
            const analiseConsulta = analisarTaxonomia(data.analise_taxonomica, processText);
            
            // Se identificou uma consulta específica
            if (analiseConsulta) {
              console.log(`Consulta específica identificada: ${analiseConsulta.tipo} -> ${analiseConsulta.alvo}`);
              
              let resultadoConsulta = null;
              
              // Realiza a consulta conforme o tipo identificado
              switch (analiseConsulta.tipo) {
                case 'identidade':
                  if (analiseConsulta.alvo === 'usuario') {
                    // Busca informação de identidade do usuário (ex: nome)
                    resultadoConsulta = await responseModel.findFact('nome', 'nome', senderInfo.id);
                  }
                  break;
                  
                case 'relacao':
                  if (analiseConsulta.alvo === 'usuario') {
                    // Busca todas as relações do usuário
                    resultadoConsulta = await responseModel.findRelationalFacts('relacao', senderInfo.id);
                  } else if (analiseConsulta.alvo === 'terceiro' && analiseConsulta.parametros.valor) {
                    // Busca relações específicas com um terceiro
                    resultadoConsulta = await responseModel.findRelationalFacts(
                      'relacao', 
                      senderInfo.id, 
                      analiseConsulta.parametros.valor
                    );
                  }
                  break;
                  
                case 'definicao':
                  if (analiseConsulta.alvo === 'conceito' && analiseConsulta.parametros.valor) {
                    // Busca definição de um conceito
                    resultadoConsulta = await responseModel.findFact(
                      'definicao', 
                      analiseConsulta.parametros.valor, 
                      'geral'
                    );
                  }
                  break;
                  
                case 'propriedade':
                  if (analiseConsulta.alvo === 'conceito' && analiseConsulta.parametros.valor) {
                    // Busca propriedades de um conceito (ex: uma empresa)
                    resultadoConsulta = await responseModel.findConceptProperties(
                      analiseConsulta.parametros.valor
                    );
                  }
                  break;
              }
              
              // Se encontrou resultados para a consulta
              if (resultadoConsulta && (resultadoConsulta.success || 
                  (resultadoConsulta.facts && resultadoConsulta.facts.length > 0))) {
                
                // Constrói uma resposta específica baseada nos resultados
                const respostaConsulta = construirRespostaConsulta(analiseConsulta, resultadoConsulta);
                
                if (respostaConsulta) {
                  finalResponse = respostaConsulta;
                  consultaProcessada = true;
                  console.log("Consulta processada com sucesso");
                }
              }
            }
          }
          
          // Se não processou como consulta específica ou é um comando de aprendizado
          if (!consultaProcessada || isLearningCommand) {
            // Traduz o conhecimento para o formato do modelo de dados
            const fatos = traduzirParaModeloDados(data.conhecimento, senderInfo.id);
            
            // Adiciona logs de depuração
            console.log("Análise taxonômica:", JSON.stringify(data.analise_taxonomica));
            console.log("Conhecimento recebido:", JSON.stringify(data.conhecimento));
            console.log("Fatos traduzidos:", JSON.stringify(fatos));
            
            // Salva a resposta no banco de dados apenas para comandos de aprendizado
            // ou se for informação relevante e não ambígua
            if (isLearningCommand) {
              try {
                await responseModel.saveResponse({
                  palavras_chave: data.palavras_chave,
                  resposta: data.resposta,
                  classificacao: data.classificacao
                });
                
                // Processa e salva os fatos traduzidos
                if (fatos.length > 0) {
                  console.log(`Conhecimento para armazenar: ${fatos.length} fatos`);
                  
                  for (const fato of fatos) {
                    try {
                      const saveResult = await responseModel.saveFact(fato);
                      console.log(`Fato ${saveResult.updated ? 'atualizado' : 'salvo'}: ${fato.tipo} - ${fato.chave}`);
                    } catch (factError) {
                      console.error('Erro ao salvar fato:', factError.message);
                    }
                  }
                }
                
                // Informa que o aprendizado foi concluído
                finalResponse = `Aprendizado concluído com sucesso. ${fatos.length} fatos foram armazenados.`;
              } catch (saveError) {
                console.error('Erro ao salvar conhecimento:', saveError.message);
                finalResponse = "Houve um erro ao armazenar o conhecimento. Por favor, tente novamente.";
              }
            } else {
              // Se não é comando de aprendizado, apenas usa a resposta
              finalResponse = data.resposta;
            }
          }
        } else {
          console.error('Erro na resposta da OpenAI:', openAIResult.error);
          finalResponse = "Desculpe, não consegui processar sua pergunta. Por favor, tente novamente mais tarde.";
        }
      } catch (openaiError) {
        console.error('Erro ao solicitar resposta da OpenAI:', openaiError.message);
        finalResponse = "Estou com problemas para obter uma resposta no momento. Por favor, tente novamente mais tarde.";
      }
    }
    
    // Formata a resposta para envio
    const formattedResponse = `*${process.env.BOT_NAME || 'Marvin'}*\n\n${finalResponse}`;
    
    // Envia resposta ao WhatsApp
    try {
      await sock.sendMessage(remoteJid, { text: formattedResponse }, { quoted: message });
      console.log('Resposta enviada com sucesso');
    } catch (sendError) {
      console.error('Erro ao enviar resposta:', sendError.message);
      // Tenta enviar sem citação caso falhe
      try {
        await sock.sendMessage(remoteJid, { text: formattedResponse });
      } catch (secondSendError) {
        console.error('Falha ao enviar resposta mesmo sem citação');
      }
    }
    
    // Indica que terminou de digitar
    try {
      await sock.sendPresenceUpdate('paused', remoteJid);
    } catch (presenceError) {
      // Ignora erros de presença
    }
    
  } catch (error) {
    console.error("Erro ao processar mensagem:", error.message);
    try {
      // Tenta enviar mensagem de erro
      await sock.sendMessage(
        message.key.remoteJid, 
        { text: "Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente." }
      );
    } catch (sendError) {
      console.error("Erro ao enviar mensagem de erro");
    }
  }
}

module.exports = { processMessage };