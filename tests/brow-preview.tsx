import React from 'react';
import { createRoot } from 'react-dom/client';
import HologramFace from '../src/components/HologramFace';
import { idleTracking } from '../src/camera/tracking';
import '../src/index.css';
const tracking={current:{...idleTracking(),active:true,found:true}};
setInterval(()=>{tracking.current.updatedAt=performance.now();},50);
const pose=(left:number,right:number)=>{tracking.current.browLeft=left;tracking.current.browRight=right;};
createRoot(document.getElementById('root')!).render(<main><header><button onClick={()=>pose(0,0)}>Neutra</button><button onClick={()=>pose(1,1)}>Duas sobrancelhas</button><button onClick={()=>pose(1,0)}>Uma sobrancelha</button></header><HologramFace tracking={tracking}/></main>);
