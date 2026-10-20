# Holograma

Projeto independente com o rosto holográfico em partículas, criado com React, TypeScript e Three.js.

## Executar

```sh
npm install
npm run dev
```

Abra o endereço informado no terminal.

- Mova o mouse para acompanhar o olhar.
- Clique para sorrir e piscar.
- Dê dois cliques rápidos para reproduzir as boas-vindas com movimento da boca e áudio. A voz usa a síntese de fala e as vozes disponíveis no navegador/sistema.
- Use “Repetir formação” para reiniciar o efeito.

`npm run typecheck` verifica os tipos e `npm run build` gera a versão de produção em `dist`.
# holograma_ARIA

A imagem atual é `src/assets/hologram-face-current.png`, fornecida pelo usuário. O retrato é formado por partículas a partir das cores e transparência originais, sem modelagem ou controles de ângulos.

## Acompanhamento pela câmera

Clique em **Ativar câmera** e autorize a webcam. A personagem acompanha o rosto e sorri ao detectar a mão aberta balançando duas vezes. **Desligar câmera** encerra as trilhas de vídeo e devolve o controle ao mouse. A câmera também é desligada quando a página fica oculta. O microfone não é solicitado.

O MediaPipe Tasks Vision roda em um worker do próprio navegador; modelos e WASM ficam em `public/vision/`. Não há gravação nem envio de vídeo a um servidor. A prévia é espelhada. Use HTTPS ou localhost e um navegador atual. O reconhecimento depende de iluminação, enquadramento e visibilidade do rosto e da mão.

Modelos oficiais: BlazeFace short range v1 e Hand Landmarker float16 v1, distribuídos em https://storage.googleapis.com/mediapipe-models/. Biblioteca @mediapipe/tasks-vision 1.1.1.

Testes: `npm test` verifica mão aberta, rejeição de mão parada, movimento de ida, tchau, intervalo entre reações e coordenadas do olhar. Em desenvolvimento, `/tests/vision-smoke.html` verifica o carregamento dos modelos e o processamento de um quadro vazio sem usar a webcam.

### Beijo e mão de partículas

Com a câmera ativa, faça bico de beijo por cerca de meio segundo: a personagem levanta uma mão 3D feita de partículas e acena. O botão **Ver tchau** permite conferir a animação sem ligar a webcam. A mão sobe da borda inferior, acena e recolhe automaticamente.

O Face Landmarker v1 substitui o detector simples para obter a expressão `mouthPucker`; a confirmação exige boca pouco aberta, duração mínima e intervalo entre ativações. O vídeo continua local. Os testes automatizados incluem confirmação, rejeição e intervalo do beijo; a precisão com webcam depende da iluminação e do rosto enquadrado.
