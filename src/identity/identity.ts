export type FaceProfile={id:string;name:string;descriptors:number[][];consentedAt:string};
export const STORAGE_KEY='aria:consented-face-profiles:v1';
export const SAMPLE_COUNT=6;
export function normalizeName(value:string){return value.trim().replace(/\s+/g,' ');}
export function validName(value:string){return value.length>=2&&value.length<=40&&/^[\p{L}\p{M}][\p{L}\p{M} '\u2019-]+$/u.test(value);}
export function validDescriptor(value:unknown):value is number[]{return Array.isArray(value)&&value.length===128&&value.every(item=>typeof item==='number'&&Number.isFinite(item)&&Math.abs(item)<=10);}
export function validateProfiles(value:unknown):FaceProfile[]{
  if(!Array.isArray(value))throw new Error('Cadastro local inválido. Exclua os cadastros para começar novamente.');
  const ids=new Set();
  for(const item of value){
    if(!item||typeof item.id!=='string'||ids.has(item.id)||typeof item.name!=='string'||!validName(item.name)||!Array.isArray(item.descriptors)||item.descriptors.length!==SAMPLE_COUNT||!item.descriptors.every(validDescriptor)||typeof item.consentedAt!=='string'||!Number.isFinite(Date.parse(item.consentedAt)))throw new Error('Cadastro local inválido. Exclua os cadastros para começar novamente.');
    ids.add(item.id);
  }
  return value;
}
export function distance(a:ArrayLike<number>,b:ArrayLike<number>){if(a.length!==128||b.length!==128)return Infinity;let sum=0;for(let i=0;i<128;i++){if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))return Infinity;sum+=(a[i]-b[i])**2;}return Math.sqrt(sum);}
export function matchProfile(descriptor:Float32Array,profiles:FaceProfile[]):FaceProfile|null {
  const scores=profiles.map(profile=>({profile,score:profile.descriptors.map(sample=>distance(descriptor,sample)).sort((a,b)=>a-b).slice(0,3).reduce((a,b)=>a+b,0)/3})).sort((a,b)=>a.score-b.score);
  if(!scores.length||scores[0].score>.45||(scores[1]&&scores[1].score-scores[0].score<.08))return null;
  return scores[0].profile;
}
export class IdentityGreeting {
  private candidate='';private count=0;private greeted='';private missingSince:number|null=null;
  private lastGreeting=new Map<string,number>();
  update(profile:FaceProfile|null,facePresent:boolean,now:number):string|null {
    if(!facePresent){this.candidate='';this.count=0;this.missingSince??=now;if(now-this.missingSince>3500)this.greeted='';return null;}
    this.missingSince=null;const id=profile?.id??'unknown';
    if(this.candidate!==id){this.candidate=id;this.count=1;}else this.count++;
    if(this.count<3||this.greeted===id||now-(this.lastGreeting.get(id)??-Infinity)<30000)return null;
    this.greeted=id;this.lastGreeting.set(id,now);return profile?`Oi, ${profile.name}!`:'Olá! Tudo bem?';
  }
}

export function saveProfiles(profiles:FaceProfile[],storage:Pick<Storage,'setItem'>=localStorage){
  validateProfiles(profiles);
  try{storage.setItem(STORAGE_KEY,JSON.stringify(profiles));}
  catch{throw new Error('Não foi possível salvar o cadastro. O armazenamento do navegador pode estar cheio ou bloqueado. Os cadastros anteriores foram mantidos.');}
}
