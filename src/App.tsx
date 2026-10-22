import VoiceChat from './LiveVoiceChat';
import logoUrl from './assets/logoazul.png';
import { useRef } from 'react';
import CameraTracker from './camera/CameraTracker';
import { idleTracking } from './camera/tracking';
import HologramFace from './components/HologramFace';
export default function App() {
  const tracking=useRef(idleTracking());
  return <main>
    <header><h1 className="brand"><img className="brand-logo" src={logoUrl} alt="Observatório da Indústria" width="7716" height="3058" /></h1></header>
    <aside className="aria-controls" aria-label="Controles da Aria">
      <CameraTracker tracking={tracking} />
      <VoiceChat />
    </aside>
    <HologramFace tracking={tracking} />
  </main>;
}
