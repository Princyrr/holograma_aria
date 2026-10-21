# Holograma Aria

Assistente virtual do Observatório da Indústria com rosto holográfico em partículas, desenvolvida com React, TypeScript e Three.js. A Aria acompanha expressões pela câmera e conversa por voz com o Google Gemini.

## Executar localmente

Requer Node.js 20 ou superior.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Antes de iniciar, configure sua chave em `.env.local`:

```dotenv
GEMINI_API_KEY=cole_sua_chave_aqui
GEMINI_MODEL=gemini-3.6-flash
GEMINI_TTS_MODEL=gemini-3.8-flash-tts
GEMINI_VOICE=Kore
```

Abra o endereço informado no terminal. Reinicie o servidor após alterar as variáveis. Os arquivos `.env` e `.env.local` são ignorados pelo Git; `.env.example` contém somente exemplos, sem credenciais.

## Interação

- Mova o mouse para acompanhar o olhar ou ative a câmera para acompanhar seu rosto e expressões.
- Clique no holograma para sorrir e piscar. Dois cliques reproduzem as boas-vindas com voz natural e movimento da boca.
- Acene lateralmente ou movimente os dedos para a Aria dar tchau. Faça bico de beijo para ela retribuir.
- Use “Repetir formação” para reiniciar o efeito de partículas.
- Os botões “Repetir formação”, “Ativar câmera” e “Falar com a Aria” ficam agrupados na lateral, ao lado do holograma. A logo do Observatório aparece no cabeçalho.

## Conversa por voz

Clique em “Falar com a Aria” e permita o microfone. Fale e faça uma pausa para enviar automaticamente ou clique em “Enviar pergunta”. Cada gravação tem limite de 30 segundos. Após a resposta, clique novamente para fazer outra pergunta.

O servidor envia o áudio ao Gemini para transcrição, gera uma resposta e solicita a voz natural ao Gemini TTS. A Aria responde por áudio, sem exibir perguntas, respostas ou histórico na interface. As últimas dez trocas ficam em memória para dar contexto à conversa; atualizar a página limpa esse contexto.

Prefira Chrome ou Edge em localhost ou HTTPS. Se o navegador bloquear a reprodução automática, clique em “Ouvir resposta”. É possível interromper a resposta pelo botão lateral.

Seu áudio e o contexto da conversa são enviados ao Google. O servidor local não salva gravações em disco. A chave é utilizada somente no servidor e não é enviada ao navegador. A geração ocorre em etapas, por isso pode haver espera entre a pergunta e o início da voz.

## Verificação

```sh
npm run typecheck
npm test
npm run build
```

Os testes cobrem reconhecimento de gestos, integração com o Gemini, transcrição e formato do áudio. A versão de produção é gerada em `dist`.

## Publicação

![Holograma Aria](src/assets/holograma.png)
