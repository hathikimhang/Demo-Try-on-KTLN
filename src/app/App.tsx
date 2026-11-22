import { useState } from 'react';
import { ChevronRight, Hand, ScanLine, ShieldCheck, Shirt, Sparkles } from 'lucide-react';
import type { Mode } from '../shared/types/tryOn';
import { useTheme } from './controllers/useTheme';
import { AppHeader } from './views/AppHeader';
import { HelpDialog } from './views/HelpDialog';
import { TryOnStudio } from './views/TryOnStudio';
export default function App() {
  const {theme,setTheme,themeAction}=useTheme();
  const [mode, setMode] = useState<Mode>('bracelet');
  const [help, setHelp] = useState(false);
  const [fits, setFits] = useState<Record<Mode, number>>({ bracelet: 1, shirt: 1 });
  return <div className="app-shell">
    <AppHeader theme={theme} setTheme={setTheme} themeAction={themeAction} setHelp={setHelp}/>
    <main><div className="page-heading"><div><div className="eyebrow"><Sparkles size={14}/> PHONG CÁCH CỦA BẠN, CÔNG NGHỆ CỦA MIRA</div><h1>Thử một chút. <span>Thích thật nhiều.</span></h1><p>Khám phá diện mạo mới với AI. Ngay trên màn hình của bạn.</p></div><div className="demo-tag">BẢN TRẢI NGHIỆM <span>01</span></div></div>
      <div className="mode-tabs" role="tablist" aria-label="Loại sản phẩm"><button role="tab" aria-selected={mode === 'bracelet'} onClick={() => setMode('bracelet')} className={mode === 'bracelet' ? 'active' : ''}><Hand size={18}/>Thử vòng tay<span>01</span></button><button role="tab" aria-selected={mode === 'shirt'} onClick={() => setMode('shirt')} className={mode === 'shirt' ? 'active' : ''}><Shirt size={18}/>Thử áo<span>02</span></button><div className="tab-hint"><ScanLine size={15}/> Nhận diện chuyển động theo thời gian thực</div></div>
      <TryOnStudio key={mode} mode={mode} scale={fits[mode]} setScale={value => setFits(previous => ({ ...previous, [mode]: value }))}/>
      <section className="steps" aria-label="Các bước sử dụng"><div><span className="step-num">01</span><div><h3>Chọn cách trải nghiệm</h3><p>Bật camera hoặc tải ảnh yêu thích.</p></div></div><ChevronRight/><div><span className="step-num">02</span><div><h3>Để AI tìm đúng vị trí</h3><p>Giữ rõ {mode === 'bracelet' ? 'bàn tay và cổ tay' : 'vai và phần thân trên'} trong khung hình.</p></div></div><ChevronRight/><div><span className="step-num">03</span><div><h3>Lưu diện mạo của bạn</h3><p>Chọn màu, chụp lại và khám phá.</p></div></div></section>
      <footer><span>mira studio <i>·</i> Một cách mới để thử phong cách.</span><span><ShieldCheck size={14}/> Ảnh của bạn chỉ ở trên thiết bị của bạn.</span></footer>
    </main>
    {help && <HelpDialog setHelp={setHelp}/>}
  </div>;
}
