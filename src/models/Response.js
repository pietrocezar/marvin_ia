/**
 * Modelo para armazenar respostas no MongoDB
 */
class ResponseModel {
  constructor(db) {
    this.db = db;
    this.collection = db.collection('responses');
    this.factsCollection = db.collection('facts');
    this.entitiesCollection = db.collection('entities');
    // Criando índice para palavras-chave para melhorar performance de busca
    this.collection.createIndex({ palavras_chave: 1 });
    
    // Índices para busca eficiente de fatos
    this.factsCollection.createIndex({ tipo: 1 });
    this.factsCollection.createIndex({ chave: 1 });
    this.factsCollection.createIndex({ entidade: 1 });
    this.factsCollection.createIndex({ "relacionamentos.entidade": 1 });
    this.factsCollection.createIndex({ valor: "text" }); // Índice de texto para busca semântica
    
    // Coleção para entidades
    this.entitiesCollection.createIndex({ nome: 1 });
    this.entitiesCollection.createIndex({ alias: 1 });
    this.entitiesCollection.createIndex({ tipo: 1 });
  }

  /**
   * Salva uma resposta no banco de dados
   * @param {Object} responseData Dados da resposta a ser salva
   * @returns {Promise<Object>} Resultado da operação
   */
  async saveResponse(responseData) {
    try {
      // Verifica se já existe uma resposta com palavras-chave semelhantes
      const existingResponse = await this.findResponseByKeywords(responseData.palavras_chave);
      
      if (existingResponse.success) {
        // Atualiza a resposta existente
        const result = await this.collection.updateOne(
          { _id: existingResponse.response._id },
          { $set: { 
            resposta: responseData.resposta,
            classificacao: responseData.classificacao,
            last_updated: new Date()
          }}
        );
        
        return { success: true, updated: true, result };
      } else {
        // Insere uma nova resposta
        const result = await this.collection.insertOne({
          palavras_chave: responseData.palavras_chave,
          resposta: responseData.resposta,
          classificacao: responseData.classificacao,
          created_at: new Date(),
          last_updated: new Date()
        });
        
        return { success: true, updated: false, result };
      }
    } catch (error) {
      console.error('Erro ao salvar resposta:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Encontra uma resposta com base nas palavras-chave
   * @param {Array} keywords Array de palavras-chave
   * @returns {Promise<Object>} Resultado da busca
   */
  async findResponseByKeywords(keywords) {
    try {
      // Limita a 10 palavras-chave para a busca
      const searchKeywords = keywords.slice(0, Math.min(keywords.length, 10));
      
      // Busca por respostas que contenham pelo menos 60% das palavras-chave
      const minKeywordsMatch = Math.ceil(searchKeywords.length * 0.6);
      
      // Constrói a consulta para buscar documentos com correspondência de palavras-chave
      const query = {
        palavras_chave: { $in: searchKeywords }
      };
      
      // Realiza a busca
      const responses = await this.collection.find(query).toArray();
      
      // Filtra para respostas com pelo menos o mínimo de correspondências
      const filteredResponses = responses.filter(response => {
        const matchCount = response.palavras_chave.filter(kw => 
          searchKeywords.includes(kw)
        ).length;
        
        return matchCount >= minKeywordsMatch;
      });
      
      // Retorna a primeira resposta correspondente, se houver
      if (filteredResponses.length > 0) {
        return { success: true, response: filteredResponses[0] };
      } else {
        return { success: false, message: 'Nenhuma resposta encontrada' };
      }
    } catch (error) {
      console.error('Erro ao buscar resposta por palavras-chave:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Salva um fato no banco de dados
   * @param {Object} factData Dados do fato a ser salvo
   * @returns {Promise<Object>} Resultado da operação
   */
  async saveFact(factData) {
    try {
      // Verificações básicas de segurança
      if (!factData.tipo || !factData.chave || !factData.entidade || !factData.valor) {
        console.error('Dado incompleto. Todos os campos essenciais devem estar presentes:', factData);
        return { success: false, error: 'Dados incompletos' };
      }
      
      // Normalização dos campos-chave para evitar inconsistências
      const normalizedFact = {
        ...factData,
        tipo: factData.tipo.toLowerCase().trim(),
        chave: factData.chave.toLowerCase().trim(),
        entidade: factData.entidade.toString().toLowerCase().trim()
      };
      
      // Verifica se já existe um fato semelhante
      const query = {
        tipo: normalizedFact.tipo,
        chave: normalizedFact.chave,
        entidade: normalizedFact.entidade
      };
      
      // Em caso de propriedade de conceito, incluir o conceito na busca 
      // para evitar conflitos entre diferentes conceitos
      if (normalizedFact.tipo === 'propriedade' && normalizedFact.conceito) {
        query.conceito = normalizedFact.conceito;
      }
      
      const existingFact = await this.factsCollection.findOne(query);
      
      // Metadados de atualização
      const now = new Date();
      const updateData = { 
        valor: normalizedFact.valor,
        last_updated: now
      };
      
      // Se tiver relacionamentos, atualiza também
      if (normalizedFact.relacionamentos && normalizedFact.relacionamentos.length > 0) {
        updateData.relacionamentos = normalizedFact.relacionamentos.map(rel => ({
          ...rel,
          entidade: rel.entidade.toString().toLowerCase().trim()
        }));
      }
      
      // Se tiver contexto, atualiza ou mantém a certeza como ALTA
      if (normalizedFact.contexto) {
        updateData.contexto = {
          ...normalizedFact.contexto,
          certeza: 'ALTA',
          timestamp: normalizedFact.contexto.timestamp || now.toISOString()
        };
      }
      
      if (existingFact) {
        // Preserva informações importantes do registro existente
        // e apenas atualiza o que realmente mudou
        const result = await this.factsCollection.updateOne(
          { _id: existingFact._id },
          { 
            $set: updateData,
            $currentDate: { last_updated: true }
          }
        );
        
        // Log para depuração
        console.log(`Fato atualizado: ${normalizedFact.tipo}/${normalizedFact.chave} para entidade ${normalizedFact.entidade}`);
        
        return { success: true, updated: true, result };
      } else {
        // Insere um novo fato com todos os dados normalizados
        const result = await this.factsCollection.insertOne({
          ...normalizedFact,
          created_at: now,
          last_updated: now
        });
        
        // Log para depuração
        console.log(`Novo fato registrado: ${normalizedFact.tipo}/${normalizedFact.chave} para entidade ${normalizedFact.entidade}`);
        
        return { success: true, updated: false, result };
      }
    } catch (error) {
      console.error('Erro ao salvar fato:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Encontra um fato específico
   * @param {String} tipo Tipo do fato (nome, definicao, etc)
   * @param {String} chave Chave do fato
   * @param {String} entidade Entidade a qual o fato pertence
   * @returns {Promise<Object>} Resultado da busca
   */
  async findFact(tipo, chave, entidade) {
    try {
      const query = { tipo, chave, entidade };
      
      // Se a entidade for 'usuário', converte para minúsculas para padronização
      if (entidade === 'usuário') {
        query.entidade = entidade.toLowerCase();
      }
      
      const fact = await this.factsCollection.findOne(query);
      
      if (fact) {
        return { success: true, fact };
      } else {
        return { success: false, message: 'Fato não encontrado' };
      }
    } catch (error) {
      console.error('Erro ao buscar fato:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Encontra fatos relacionais de uma entidade
   * @param {String} tipo Tipo do fato (geralmente 'relacao')
   * @param {String} entidade Entidade principal (usuário)
   * @param {String} valor Valor específico a ser encontrado (opcional)
   * @returns {Promise<Object>} Resultado da busca
   */
  async findRelationalFacts(tipo, entidade, valor = null) {
    try {
      // Constrói a query básica
      const query = { 
        tipo: tipo,
        entidade: entidade
      };
      
      // Se foi especificado um valor, adiciona à query
      if (valor) {
        const valorLowerCase = valor.toLowerCase();
        
        // Query que busca por valor exato ou por entidade nos relacionamentos
        query.$or = [
          { valor: { $regex: new RegExp(`^${valorLowerCase}$`, 'i') } },
          { 'relacionamentos.entidade': valorLowerCase }
        ];
      }
      
      const facts = await this.factsCollection.find(query).toArray();
      
      if (facts && facts.length > 0) {
        return { success: true, facts: facts };
      } else {
        return { success: false, message: 'Fatos não encontrados' };
      }
    } catch (error) {
      console.error('Erro ao buscar fatos relacionais:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Salva uma entidade no banco de dados
   * @param {Object} entityData Dados da entidade a ser salva
   * @returns {Promise<Object>} Resultado da operação
   */
  async saveEntity(entityData) {
    try {
      // Verifica se já existe uma entidade com o mesmo nome
      const query = { nome: entityData.nome };
      
      const existingEntity = await this.entitiesCollection.findOne(query);
      
      if (existingEntity) {
        // Atualiza a entidade existente, combinando aliases
        const combinedAliases = [...new Set([
          ...(existingEntity.alias || []), 
          ...(entityData.alias || [])
        ])];
        
        const result = await this.entitiesCollection.updateOne(
          { _id: existingEntity._id },
          { 
            $set: { 
              tipo: entityData.tipo,
              alias: combinedAliases,
              last_updated: new Date()
            }
          }
        );
        
        return { success: true, updated: true, result };
      } else {
        // Insere uma nova entidade
        const result = await this.entitiesCollection.insertOne({
          ...entityData,
          nome_normalizado: entityData.nome.toLowerCase(),
          created_at: new Date(),
          last_updated: new Date()
        });
        
        return { success: true, updated: false, result };
      }
    } catch (error) {
      console.error('Erro ao salvar entidade:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Busca entidades por nome ou alias
   * @param {String} name Nome ou alias para busca
   * @returns {Promise<Object>} Resultado da busca
   */
  async findEntityByName(name) {
    try {
      const nameLowerCase = name.toLowerCase();
      
      const query = {
        $or: [
          { nome_normalizado: nameLowerCase },
          { alias: nameLowerCase }
        ]
      };
      
      const entity = await this.entitiesCollection.findOne(query);
      
      if (entity) {
        return { success: true, entity };
      } else {
        return { success: false, message: 'Entidade não encontrada' };
      }
    } catch (error) {
      console.error('Erro ao buscar entidade:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Busca todos os fatos de uma categoria específica
   * @param {String} tipo Tipo de fato a ser buscado
   * @returns {Promise<Object>} Resultado da busca
   */
  async findFactsByType(tipo) {
    try {
      const facts = await this.factsCollection.find({ tipo }).toArray();
      
      if (facts && facts.length > 0) {
        return { success: true, facts };
      } else {
        return { success: false, message: 'Nenhum fato encontrado para este tipo' };
      }
    } catch (error) {
      console.error(`Erro ao buscar fatos do tipo ${tipo}:`, error.message);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Busca fatos por correspondência parcial no valor
   * @param {String} valor Valor parcial para busca
   * @returns {Promise<Object>} Resultado da busca
   */
  async findFactsByPartialValue(valor) {
    try {
      const valorLowerCase = valor.toLowerCase();
      const facts = await this.factsCollection.find({ 
        valor: { $regex: new RegExp(valorLowerCase, 'i') } 
      }).toArray();
      
      if (facts && facts.length > 0) {
        return { success: true, facts };
      } else {
        return { success: false, message: 'Nenhum fato encontrado com este valor' };
      }
    } catch (error) {
      console.error(`Erro ao buscar fatos com valor parcial ${valor}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Busca propriedades de um conceito específico (ex: empresa)
   * @param {String} conceito O nome do conceito/empresa
   * @returns {Promise<Object>} Resultado da busca
   */
  async findConceptProperties(conceito) {
    try {
      const conceitoLowerCase = conceito.toLowerCase();
      
      // Busca tanto nas propriedades diretas quanto nos relacionamentos
      const query = {
        $or: [
          // Busca por entidade direta (fato_entidade)
          { 
            tipo: 'entidade',
            entidade: conceitoLowerCase
          },
          // Busca por propriedades de conceitos 
          { 
            tipo: 'propriedade',
            entidade: 'geral',
            conceito: conceitoLowerCase
          },
          // Busca por relacionamentos
          { 
            'relacionamentos.tipo': 'propriedade_de',
            'relacionamentos.entidade': conceitoLowerCase
          }
        ]
      };
      
      const facts = await this.factsCollection.find(query).toArray();
      
      if (facts && facts.length > 0) {
        return { success: true, facts };
      } else {
        // Tenta uma definição em último caso
        const definicao = await this.findFact('definicao', conceitoLowerCase, 'geral');
        if (definicao.success) {
          return { success: true, facts: [definicao.fact] };
        }
        
        return { success: false, message: 'Nenhuma propriedade encontrada para este conceito' };
      }
    } catch (error) {
      console.error(`Erro ao buscar propriedades do conceito ${conceito}:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ResponseModel; 