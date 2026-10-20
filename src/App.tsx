import { useRef, useState } from 'react';
import CameraTracker from './camera/CameraTracker';
import { idleTracking } from './camera/tracking';
import HologramFace from './components/HologramFace';
export default function App() {
  const tracking=useRef(idleTracking());
  const [formation, setFormation] = useState(0);
  return <main>
    <header><h1>Rosto holográfico</h1><button type="button" onClick={() => setFormation(value => value + 1)}>Repetir formação</button></header>
    <HologramFace key={formation} tracking={tracking} />
    <CameraTracker tracking={tracking} />
  </main>;
}
