import VoiceChat from './LiveVoiceChat';
import logoUrl from './assets/logoazul.png';
import backgroundUrl from './assets/aria-side-panels.png';
import { useRef } from 'react';
import CameraTracker from './camera/CameraTracker';
import { idleTracking } from './camera/tracking';
import HologramFace from './components/HologramFace';
import AmbientPanels from './components/AmbientPanels';
export default function App() {
  const tracking=useRef(idleTracking());
  const home=import.meta.env.BASE_URL;
  const registrationUrl=home+'cadastro';
  const registrationPage=window.location.pathname.replace(/\/+$/,'')===new URL(registrationUrl,window.location.origin).pathname.replace(/\/+$/,'');
  if(registrationPage)return <main className="registration-page">
    <header><a href={home} className="registration-back">← Voltar para a Aria</a></header>
    <h1>Cadastro de rosto</h1>
    <p className="registration-intro">Ative a câmera e cadastre seu rosto para a Aria cumprimentar você pelo nome.</p>
    <CameraTracker tracking={tracking} registrationPage />
  </main>;
  return <main className="aria-with-panels">
    <div className="aria-panel-background" aria-hidden="true"><img src={backgroundUrl} alt="" /><AmbientPanels /></div>
    <header><h1 className="brand"><img className="brand-logo" src={logoUrl} alt="Observatório da Indústria" width="7716" height="3058" /></h1></header>
    <aside className="aria-controls" aria-label="Controles da Aria">
      <CameraTracker tracking={tracking} />
      <VoiceChat />
    </aside>
    <HologramFace tracking={tracking} />
  </main>;
}
