import { useState } from 'react';
import HologramFace from './components/HologramFace';
export default function App() {
  const [formation, setFormation] = useState(0);
  return <main>
    <header><h1>Rosto holográfico</h1><button type="button" onClick={() => setFormation(value => value + 1)}>Repetir formação</button></header>
    <p className="instructions">Mova o mouse para guiar o olhar. Clique para sorrir e piscar. Dois cliques rápidos para ouvir as boas-vindas ao Observatório das Indústrias da Paraíba.</p>
    <HologramFace key={formation} />
  </main>;
}
