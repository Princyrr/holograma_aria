// Runs off the UI thread so rendering the hologram cannot delay microphone chunks.
class AriaPcmCapture extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Float32Array(Math.round(sampleRate/10));this.offset=0;}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    for(let i=0;i<input.length;i++){
      this.samples[this.offset++]=input[i];
      if(this.offset===this.samples.length){this.port.postMessage(this.samples);this.offset=0;}
    }
    return true;
  }
}
registerProcessor('aria-pcm-capture',AriaPcmCapture);
