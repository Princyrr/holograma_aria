import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { chatMiddleware } from './server/chat.mjs';
export default defineConfig(({mode}) => {
  const env=loadEnv(mode,process.cwd(),'');
  const install=(server:any)=>{server.middlewares.use(chatMiddleware({key:env.GEMINI_API_KEY,model:env.GEMINI_MODEL||'gemini-3.6-flash',liveModel:env.GEMINI_LIVE_MODEL||'gemini-3.8-live',ttsModel:env.GEMINI_TTS_MODEL||'gemini-3.8-flash-tts',voice:env.GEMINI_VOICE||'Kore'}));};
  return {plugins:[react(),{name:'aria-chat',configureServer:install,configurePreviewServer:install}],worker:{format:'es'}};
});
