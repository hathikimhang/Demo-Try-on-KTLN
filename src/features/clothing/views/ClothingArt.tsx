

export function ClothingArt({ color, large = false }: { color: string; large?: boolean }) {
  return <svg viewBox="0 0 320 260" fill="none" className={large ? 'product-art large' : 'product-art'} aria-label="Mẫu áo thun cổ tròn" role="img">
    <defs><linearGradient id={`metal-${large}`} x1="80" y1="80" x2="240" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor={color}/><stop offset=".25" stopColor="#fff4dd"/><stop offset=".48" stopColor={color}/><stop offset=".7" stopColor="#fff"/><stop offset="1" stopColor={color}/></linearGradient><filter id={`shadow-${large}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter></defs>
    {<g><ellipse cx="160" cy="235" rx="77" ry="10" fill="#0001" filter={`url(#shadow-${large})`}/><path d="m110 40-53 27-25 62 47 19 23-38v119q58 12 116 0V110l23 38 47-19-25-62-53-27-24-5q-26 30-52 0Z" fill={color} stroke="#0002" strokeWidth="2"/><path d="M134 35q26 42 52 0M106 221q54 9 108 0M58 119l24 10M238 129l23-10" stroke="#ffffff70" strokeWidth="3"/><path d="m106 101 7 88m97-88-7 88" stroke="#0001" strokeWidth="2"/></g>}
  </svg>;
}
