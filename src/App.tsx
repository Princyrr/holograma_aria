import VoiceChat from './VoiceChat';
import logoUrl from './assets/logoazul.png';
import { useRef, useState } from 'react';
import CameraTracker from './camera/CameraTracker';
import { idleTracking } from './camera/tracking';
import HologramFace from './components/HologramFace';
export default function App() {
  const tracking=useRef(idleTracking());
  const [formation, setFormation] = useState(0);
  return <main>
    <header><h1 className="brand"><img className="brand-logo" src={logoUrl} alt="Observatório da Indústria" width="7716" height="3058" /></h1></header>
    <aside className="aria-controls" aria-label="Controles da Aria">
      <button className="aria-control-button" type="button" onClick={() => setFormation(value => value + 1)}>Repetir formação</button>
      <CameraTracker tracking={tracking} />
      <VoiceChat />
    </aside>
    <HologramFace key={formation} tracking={tracking} />
  </main>;
}
