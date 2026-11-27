import { useEffect, useRef, type CSSProperties } from 'react';

/** Decorative simulated signals over the approved background image. */
export default function AmbientPanels() {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const on=()=>host.current?.classList.add('is-speaking');
    const off=()=>host.current?.classList.remove('is-speaking');
    window.addEventListener('aria-audio-start',on);
    window.addEventListener('aria-audio-end',off);
    window.addEventListener('aria-stop',off);
    return()=>{window.removeEventListener('aria-audio-start',on);window.removeEventListener('aria-audio-end',off);window.removeEventListener('aria-stop',off);};
  },[]);
  return <div className="aria-ambient" ref={host} aria-hidden="true">
    <div className="aria-mist"><i/><i/><i/></div>
    {['left','right'].map((side,index)=>{
      const trend=index===0?'M0 69 C18 69 18 49 38 51 S64 72 84 48 S112 58 132 31 S158 53 180 24 S210 32 232 13 S267 25 288 8 S312 17 330 5':'M0 65 C20 65 24 43 43 49 S67 61 90 35 S119 43 142 22 S174 40 195 17 S220 30 242 12 S278 24 300 7 S319 15 330 4';
      return <div className={`aria-signals aria-signals-${side}`} key={side}>
        <div className="aria-signal-bars">{Array.from({length:20},(_,i)=><i key={i} style={{'--bar':`${30+(i*19+index*17)%65}%`,'--speed':`${5.5+i%5*.7}s`,'--delay':`${-i*.63}s`} as CSSProperties}><b/></i>)}</div>
        <div className="aria-trend-chart"><svg viewBox="0 0 330 90" preserveAspectRatio="none">
          <defs><linearGradient id={`aria-chart-fill-${side}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#81d5ea" stopOpacity=".2"/><stop offset="1" stopColor="#81d5ea" stopOpacity="0"/></linearGradient></defs>
          <g className="aria-chart-grid"><path d="M0 20H330 M0 45H330 M0 70H330 M55 0V90 M110 0V90 M165 0V90 M220 0V90 M275 0V90"/></g>
          <path className="aria-chart-area" d={`${trend} L330 90H0Z`} fill={`url(#aria-chart-fill-${side})`}/>
          <path className="aria-chart-reference" d="M0 75 Q80 65 145 52 T330 22"/>
          <path className="aria-chart-trend" d={trend}/>
          <path className="aria-chart-tracer" d={trend} pathLength="100"/>
        </svg></div>
        <div className="aria-signal-wave"><svg viewBox="0 0 400 80" preserveAspectRatio="none"><path d="M-400 40 Q-375 5 -350 40 T-250 40 T-150 40 T-50 40 T50 40 T150 40 T250 40 T350 40 T450 40 T550 40 T650 40 T750 40 T850 40"/><path d="M-400 40 Q-375 65 -350 40 T-250 40 T-150 40 T-50 40 T50 40 T150 40 T250 40 T350 40 T450 40 T550 40 T650 40 T750 40 T850 40"/></svg></div>
        <div className="aria-panel-corners"/>
      </div>;
    })}
  </div>;
}
