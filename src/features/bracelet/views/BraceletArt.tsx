

export function BraceletArt({ color, large = false }: { color: string; large?: boolean }) {
  return <svg viewBox="0 0 320 260" fill="none" className={large ? 'product-art large' : 'product-art'} aria-label="Mẫu vòng tay ánh kim đính đá" role="img">
    <defs><linearGradient id={`metal-${large}`} x1="80" y1="80" x2="240" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor={color}/><stop offset=".25" stopColor="#fff4dd"/><stop offset=".48" stopColor={color}/><stop offset=".7" stopColor="#fff"/><stop offset="1" stopColor={color}/></linearGradient><filter id={`shadow-${large}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter></defs>
    {<g transform="rotate(-24 160 130)"><ellipse cx="160" cy="179" rx="88" ry="17" fill="#665442" opacity=".12" filter={`url(#shadow-${large})`}/><ellipse cx="160" cy="126" rx="90" ry="59" stroke="#9c7953" strokeWidth="16"/><ellipse cx="160" cy="122" rx="90" ry="59" stroke={`url(#metal-${large})`} strokeWidth="13"/><ellipse cx="160" cy="121" rx="90" ry="59" stroke="#fff6" strokeWidth="1"/>{Array.from({ length: 11 }, (_, i) => { const t = (i + 0.5) * Math.PI / 11; return <g key={i} transform={`translate(${160 + Math.cos(t) * 90} ${122 + Math.sin(t) * 59})`}><circle r="4" fill="#9d8e79"/><path d="M0 -3.6 3.6 0 0 3.6 -3.6 0Z" fill="white"/><path d="M-2 0H2M0-2V2" stroke="#cfd7e1" strokeWidth=".6"/></g>; })}</g>}
  </svg>;
}
