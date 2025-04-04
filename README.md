# Marvin IA - Chatbot para WhatsApp

Chatbot para WhatsApp que utiliza a API da OpenAI e armazena respostas em MongoDB para consultas futuras.

## Funcionalidades

- Responde a mensagens em grupos de WhatsApp
- Processa perguntas através da API da OpenAI
- Classifica respostas como globais ou pessoais
- Armazena respostas em MongoDB para reutilização futura
- Otimiza tempo de resposta e custos ao reutilizar respostas existentes

## Tecnologias

- Node.js
- Baileys (API não oficial de WhatsApp)
- OpenAI API
- MongoDB
- Express

## Instalação

1. Clone o repositório
2. Instale as dependências: `npm install`
3. Configure as variáveis de ambiente (crie um arquivo `.env`)
4. Execute: `npm run dev`

## Estrutura de Resposta

O chatbot estrutura as respostas da OpenAI nos seguintes componentes:
- Palavras-chave relacionadas à pergunta
- Resposta completa
- Classificação (global ou pessoal)

## Fluxo de Funcionamento

1. Usuário envia mensagem no grupo do WhatsApp
2. Bot envia a mensagem para a API da OpenAI
3. OpenAI processa e retorna resposta estruturada
4. Resposta é armazenada no MongoDB
5. Bot responde ao usuário no WhatsApp
6. Em consultas futuras similares, o bot consulta o MongoDB antes de chamar a API da OpenAI
