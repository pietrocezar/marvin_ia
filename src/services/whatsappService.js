const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Processador de mensagens
const messageProcessor = require('./messageProcessor');

// Diretório para armazenar os dados de autenticação
const AUTH_FOLDER = path.join(__dirname, '../../auth_info_baileys');

// Garante que o diretório auth existe
if (!fs.existsSync(AUTH_FOLDER)) {
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}

// Estado da conexão
let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Suprime logs do Baileys
const suppressBaileysLogs = () => {
  // Salva os métodos originais
  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleDebug = console.debug;
  
  // Define uma função para filtrar logs
  const filterBaileysLogs = (originalFn) => {
    return function() {
      // Converte os argumentos para string para verificar se é um log do Baileys
      const logMessage = Array.from(arguments).join(' ');
      
      // Lista de padrões a ignorar (logs do Baileys)
      const ignorePatterns = [
        /\[@whiskeysockets\/baileys\]/i,
        /\[baileys\]/i,
        /\bconnection\b/i,
        /\bcreds\b/i,
        /\bhistory\b/i,
        /\bstream\b/i,
        /\bsocket\b/i,
        /\bephemeral\b/i,
        /\bnode_modules\b.*\bBaileys\b/i,
        /\bauth\b/i,
        /\bsyncing\b/i,
        /\brateLimitExceeded\b/i,
        /\berror in WhatsApp status check\b/i,
        /\bentity has a newer version stored\b/i,
        /\bSet presence\b/i,
        /\bupdate check\b/i,
        /\bKEY BUNDLE TYPE\b/i,
        /\breconnecting\b/i,
        /\battempting\b.*\bconnect\b/i,
      ];
      
      // Verifica se deve filtrar o log
      const shouldFilter = ignorePatterns.some(pattern => pattern.test(logMessage));
      
      // Se não deve filtrar, exibe o log
      if (!shouldFilter) {
        originalFn.apply(console, arguments);
      }
    };
  };
  
  // Substitui os métodos para filtrar logs
  console.log = filterBaileysLogs(originalConsoleLog);
  console.info = filterBaileysLogs(originalConsoleInfo);
  console.debug = filterBaileysLogs(originalConsoleDebug);
};

// Ativa o filtro de logs
suppressBaileysLogs();

/**
 * Inicia a conexão com o WhatsApp
 * @param {Object} db Instância do banco de dados MongoDB
 */
async function startWhatsAppConnection(db) {
  try {
    // Carrega o estado da autenticação
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    // Cria uma nova conexão WhatsApp com logs desativados
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      defaultQueryTimeoutMs: 60000,
      getMessage: async () => {
        return { conversation: 'mensagem de recuperação' };
      }
    });

    // Salva as credenciais quando necessário
    sock.ev.on('creds.update', saveCreds);

    // Manipulador de conexão
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // Exibe o código QR quando disponível
      if (qr) {
        console.log('QR Code recebido, escaneie para autenticar:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`Tentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          setTimeout(() => startWhatsAppConnection(db), 5000); // Espera 5 segundos antes de tentar reconectar
        } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.log('Número máximo de tentativas de reconexão atingido.');
        } else {
          console.log('Desconectado do WhatsApp por logout.');
        }
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        console.log('Conexão com WhatsApp estabelecida!');
      }
    });

    // Manipulador de mensagens
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return; // Ignora se não for uma notificação
      
      for (const message of messages) {
        // Verifica se a mensagem tem um remoteJid válido
        if (!message.key || !message.key.remoteJid) {
          continue;
        }
        
        // Processa apenas mensagens de grupo se a configuração BOT_GROUP_ONLY estiver ativa
        const isGroup = message.key.remoteJid.endsWith('@g.us');
        const shouldProcess = 
          process.env.BOT_GROUP_ONLY === 'true' ? isGroup : true;

        if (message.key.fromMe) {
          continue;
        }

        if (!message.message) {
          continue;
        }

        if (shouldProcess) {
          await messageProcessor.processMessage(message, sock, db);
        }
      }
    });

  } catch (error) {
    console.error('Erro ao iniciar conexão com WhatsApp:', error.message);
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`Erro na conexão. Tentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(() => startWhatsAppConnection(db), 5000);
    } else {
      console.log('Número máximo de tentativas de reconexão atingido após erro.');
    }
  }
}

module.exports = { startWhatsAppConnection }; 