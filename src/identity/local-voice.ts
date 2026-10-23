export function localPortugueseVoice(voices:SpeechSynthesisVoice[]):SpeechSynthesisVoice|undefined {
  const local=voices.filter(voice=>voice.localService&&voice.lang.toLowerCase().replace('_','-').startsWith('pt'));
  return local.find(voice=>voice.lang.toLowerCase().replace('_','-')==='pt-br'&&/luciana|female|femin/i.test(voice.name))??local.find(voice=>voice.lang.toLowerCase().replace('_','-')==='pt-br')??local[0];
}
