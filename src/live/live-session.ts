export type LivePhase='connecting'|'listening'|'thinking'|'speaking';
export type LiveTurn={role:'user'|'model';parts:{text:string}[]};
type Callbacks={phase:(phase:LivePhase)=>void;error:(message:string)=>void;turn:(user:string,model:string)=>void;transcript?:(text:string)=>void};

export function encodePcm(samples:Float32Array,rate:number):string {
  const length=Math.floor(samples.length*16000/rate),bytes=new Uint8Array(length*2),view=new DataView(bytes.buffer);
  for(let i=0;i<length;i++){
    const start=Math.floor(i*rate/16000),end=Math.min(samples.length,Math.floor((i+1)*rate/16000));
    let value=0;for(let j=start;j<end;j++)value+=samples[j];
    value=Math.max(-1,Math.min(1,value/Math.max(1,end-start)));
    view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
}
export function decodePcm(data:string) {
  const bytes=Uint8Array.from(atob(data),char=>char.charCodeAt(0));
  if(bytes.length%2)throw new Error('Áudio recebido em formato inválido.');
  const view=new DataView(bytes.buffer),samples=new Float32Array(bytes.length/2);
  for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
  return samples;
}

export class LiveSession {
  private socket:WebSocket|null=null;
  private context:AudioContext|null=null;
  private media:MediaStream|null=null;
  private input:MediaStreamAudioSourceNode|null=null;
  private capture:AudioWorkletNode|null=null;
  private mute:GainNode|null=null;
  private sources=new Set<AudioBufferSourceNode>();
  private abort=new AbortController();
  private stopped=false;
  private ready=false;
  private microphonePaused=false;
  private enrollmentMode=false;
  private nextTime=0;
  private complete=false;
  private userText='';
  private modelText='';
  private deadline:ReturnType<typeof setTimeout>|undefined;
  constructor(private callbacks:Callbacks,private history:LiveTurn[]=[]){}
  async start() {
    this.callbacks.phase('connecting');
    this.deadline=setTimeout(()=>this.fail('A conexão demorou demais. Clique para tentar novamente.'),25000);
    try {
      // Create and unlock playback during the user's click, before network requests.
      const ctx=new AudioContext({sampleRate:16000,latencyHint:'interactive'});this.context=ctx;
      await ctx.resume();if(this.stopped)return;
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(this.stopped){media.getTracks().forEach(track=>track.stop());return;}this.media=media;
      for(const track of media.getAudioTracks())track.onended=()=>this.fail('O microfone foi desconectado. Clique para conversar novamente.');
      const response=await fetch('/api/live-token',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:this.abort.signal});
      const config=await response.json();if(this.stopped)return;
      if(!response.ok)throw new Error(config.error||'Não foi possível iniciar a conversa em tempo real.');
      await ctx.audioWorklet.addModule(new URL('./pcm-capture.worklet.js',import.meta.url));if(this.stopped)return;
      this.input=ctx.createMediaStreamSource(media);this.capture=new AudioWorkletNode(ctx,'aria-pcm-capture');this.mute=ctx.createGain();this.mute.gain.value=0;
      this.input.connect(this.capture);this.capture.connect(this.mute);this.mute.connect(ctx.destination);
      this.capture.port.onmessage=event=>{
        if(this.microphonePaused||!this.ready||this.stopped||!this.socket||this.socket.readyState!==WebSocket.OPEN)return;
        if(this.socket.bufferedAmount>256000){this.fail('A conexão está lenta demais para áudio em tempo real. Tente novamente.');return;}
        this.send({realtimeInput:{audio:{data:encodePcm(event.data,ctx.sampleRate),mimeType:'audio/pcm;rate=16000'}}});
      };
      const socket=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='+encodeURIComponent(config.token));
      this.socket=socket;socket.binaryType='arraybuffer';
      socket.onopen=()=>{if(!this.stopped)this.send({setup:config.setup});};
      socket.onmessage=event=>{
        if(this.stopped)return;
        try {this.receive(JSON.parse(typeof event.data==='string'?event.data:new TextDecoder().decode(event.data)));}
        catch {this.fail('Não foi possível reproduzir a resposta em tempo real. Tente novamente.');}
      };
      socket.onerror=()=>this.fail('Não foi possível conectar a voz em tempo real. Verifique sua conexão e tente novamente.');
      socket.onclose=event=>{
        if(this.stopped)return;
        const message=event.code===1008?'O Google recusou a sessão de voz. Verifique o acesso da chave ao modelo Gemini Live.':'A conversa foi desconectada. Clique para reconectar e continuar.';
        this.fail(message);
      };
    }catch(error){if(!this.stopped)this.fail(error instanceof DOMException&&error.name==='NotAllowedError'?'Permita o microfone no navegador para conversar.':error instanceof Error?error.message:'Não foi possível iniciar a conversa.');}
  }
  setEnrollmentMode(enabled:boolean){
    this.enrollmentMode=enabled;this.userText='';this.modelText='';
    this.stopPlayback();
  }
  pauseMicrophone(paused:boolean){
    this.microphonePaused=paused;
    if(paused&&this.ready)this.send({realtimeInput:{audioStreamEnd:true}});
  }
  private send(message:unknown){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  private receive(message:any) {
    if(message.error){this.fail('O serviço de voz recusou a solicitação. Verifique o modelo Gemini Live configurado.');return;}
    if(message.setupComplete){
      clearTimeout(this.deadline);
      if(this.history.length)this.send({clientContent:{turns:this.history.slice(-20),turnComplete:false}});
      this.ready=true;this.callbacks.phase('listening');return;
    }
    const content=message.serverContent;if(!content)return;
    // The guided flow owns the prompts. Use finalized user turns and discard model
    // audio so a generated answer cannot impersonate consent or interrupt capture.
    if(this.enrollmentMode){
      if(content.inputTranscription?.text&&!this.microphonePaused)this.userText+=content.inputTranscription.text;
      if(content.turnComplete){
        const text=this.userText.trim();this.userText='';this.modelText='';
        if(text)this.callbacks.transcript?.(text);
      }
      return;
    }
    if(content.interrupted){this.flushTurn();this.stopPlayback();this.callbacks.phase('listening');}
    if(content.inputTranscription?.text){this.userText+=content.inputTranscription.text;if(!this.sources.size)this.callbacks.phase('thinking');}
    if(content.outputTranscription?.text)this.modelText+=content.outputTranscription.text;
    for(const part of content.modelTurn?.parts??[]){
      if(part.inlineData?.data&&part.inlineData.mimeType?.startsWith('audio/pcm'))this.enqueue(part.inlineData.data,part.inlineData.mimeType);
    }
    if(content.turnComplete){this.complete=true;this.flushTurn();if(!this.sources.size)this.callbacks.phase('listening');}
  }
  private flushTurn(){
    if(this.userText.trim()&&this.modelText.trim())this.callbacks.turn(this.userText.trim(),this.modelText.trim());
    this.userText='';this.modelText='';
  }
  private enqueue(data:string,mimeType:string){
    const ctx=this.context;if(!ctx||this.stopped)return;
    const samples=decodePcm(data);if(!samples.length)return;
    const rate=Number(mimeType.match(/rate=(\d+)/)?.[1]??24000);
    if(!Number.isFinite(rate)||rate<8000||rate>96000)throw new Error('Taxa de áudio inválida.');
    const buffer=ctx.createBuffer(1,samples.length,rate);buffer.copyToChannel(samples,0);
    const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);
    const start=Math.max(ctx.currentTime+.025,this.nextTime);this.nextTime=start+buffer.duration;
    this.sources.add(source);this.complete=false;this.callbacks.phase('speaking');
    window.dispatchEvent(new CustomEvent('aria-audio-start',{detail:{text:this.modelText||'Estou respondendo.',duration:Math.max(.2,this.nextTime-ctx.currentTime)}}));
    source.onended=()=>{
      this.sources.delete(source);source.disconnect();
      if(!this.stopped&&!this.sources.size){window.dispatchEvent(new Event('aria-audio-end'));this.callbacks.phase(this.complete?'listening':'thinking');}
    };
    source.start(start);
  }
  private stopPlayback(){
    for(const source of this.sources){source.onended=null;try{source.stop();}catch{}source.disconnect();}
    this.sources.clear();this.nextTime=0;window.dispatchEvent(new Event('aria-audio-end'));
  }
  private fail(message:string){if(this.stopped)return;this.stop();this.callbacks.error(message);}
  stop(){
    if(this.stopped)return;this.stopped=true;this.ready=false;clearTimeout(this.deadline);this.abort.abort();
    if(this.socket){this.socket.onopen=null;this.socket.onmessage=null;this.socket.onerror=null;this.socket.onclose=null;this.socket.close();this.socket=null;}
    if(this.capture){this.capture.port.onmessage=null;this.capture.port.close();this.capture.disconnect();this.capture=null;}
    this.input?.disconnect();this.mute?.disconnect();
    this.media?.getTracks().forEach(track=>{track.onended=null;track.stop();});this.media=null;
    this.stopPlayback();void this.context?.close().catch(()=>{});this.context=null;
  }
}
