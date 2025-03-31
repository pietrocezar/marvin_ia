const express = require('express');
const { connectToDatabase, client } = require('./config/database');
const { startWhatsAppConnection } = require('./services/whatsappService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Rota básica para verificar se o servidor está rodando
app.get('/', (req, res) => {
  res.json({ status: 'online', message: 'Marvin IA WhatsApp Bot' });
});

// Função para iniciar a aplicação
async function startApp() {
  try {
    // Conecta ao MongoDB
    const db = await connectToDatabase();
    console.log('Conexão com MongoDB estabelecida.');
    
    // Inicia a conexão com o WhatsApp
    await startWhatsAppConnection(db);
    
    // Inicia o servidor Express
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
    
    // Manipula o encerramento da aplicação
    process.on('SIGINT', async () => {
      console.log('Encerrando aplicação...');
      await client.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Erro ao iniciar aplicação:', error.message);
    process.exit(1);
  }
}

// Suprime mensagens de erro detalhadas do baileys e outras bibliotecas
process.on('unhandledRejection', (reason) => {
  // Converte o erro para string para verificação
  const errorString = String(reason);
  
  // Lista de padrões de erro para ignorar
  const ignorePatterns = [
    /connection closed/i,
    /stream ended/i,
    /rate limits/i,
    /stale session/i,
    /socket closed/i,
    /timed out/i,
    /connection terminated/i,
    /network_error/i,
    /baileys/i,
    /\[@whiskeysockets\/baileys\]/i,
    /connection replaced/i,
    /polling failed/i,
    /session expired/i,
    /lost connection/i,
    /receiver error/i,
    /\bwrote\b.*\bauth credentials\b/i,
    /\bunable to identify the device\b/i,
    /\bcannot read properties\b/i
  ];
  
  // Verifica se o erro está na lista para ignorar
  const shouldIgnore = ignorePatterns.some(pattern => pattern.test(errorString));
  
  // Se não deve ignorar, exibe o erro
  if (!shouldIgnore) {
    console.log('Erro não tratado:', typeof reason === 'object' ? reason.message || reason : reason);
  }
});

// Suprime erros não capturados
process.on('uncaughtException', (error) => {
  // Converte o erro para string para verificação
  const errorString = String(error);
  
  // Lista de padrões de erro para ignorar
  const ignorePatterns = [
    /connection closed/i,
    /stream ended/i,
    /socket hang up/i,
    /ECONNRESET/i,
    /baileys/i,
    /\[@whiskeysockets\/baileys\]/i,
  ];
  
  // Verifica se o erro está na lista para ignorar
  const shouldIgnore = ignorePatterns.some(pattern => pattern.test(errorString));
  
  // Se não deve ignorar, exibe o erro
  if (!shouldIgnore) {
    console.error('Erro não capturado:', error.message || error);
  }
});

// Inicia a aplicação
startApp(); 