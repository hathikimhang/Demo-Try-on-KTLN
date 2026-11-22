import { WristEngineControls } from '../../features/bracelet/views/debug/WristEngineControls';
import { useState, useRef } from 'react';
import { ArrowRight, ScanLine, ShieldCheck, Camera, Check, ImagePlus, Info, LoaderCircle } from 'lucide-react';
import type { Mode } from '../../shared/types/tryOn';
import { useTryOn } from '../controllers/useTryOnController';
import { HandOutline } from '../../features/bracelet/views/HandOutline';
import { palettes } from '../models/catalog';
import { CameraViewport } from '../../shared/ui/CameraViewport';
import { CameraToolbar } from '../../shared/ui/CameraToolbar';
import { BraceletControls } from '../../features/bracelet/views/BraceletControls';
import { ClothingControls } from '../../features/clothing/views/ClothingControls';
import { TrackingDebugPanel } from '../../features/bracelet/views/debug/TrackingDebugPanel';
import { ClothingArt } from '../../features/clothing/views/ClothingArt';
export function TryOnStudio({ mode, scale, setScale }: { mode: Mode; scale: number; setScale: (value: number) => void }) {
  const [selected, setSelected] = useState(0);
  const [points, setPoints] = useState(false);
  const [debug, setDebug] = useState(false);
  const color = palettes[mode][selected];
  const [closeup, setCloseup] = useState(true);
  const t = useTryOn(mode, color.hex, scale, points, closeup ? 'straight-wrist' : 'forearm', debug);
  const [dragging, setDragging] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const isBracelet = mode === 'bracelet';
  return <div className="studio-grid">
    <section className="camera-panel" aria-label="Khu vực thử sản phẩm">
      <div className="panel-top"><div><span className={t.source === 'camera' ? 'status-dot live' : 'status-dot'}/><span>{t.source === 'camera' ? 'CAMERA TRỰC TIẾP' : t.source === 'image' ? 'ẢNH CỦA BẠN' : 'KHÔNG GIAN THỬ ĐỒ'}</span></div><span className="local-chip"><ShieldCheck size={13}/> Xử lý trên thiết bị</span></div>
      <CameraViewport captureRef={captureRef} className={`viewport ${t.source !== 'empty' ? 'has-source' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void t.upload(e.dataTransfer.files[0]); }} source={t.source} video={t.video} canvas={t.canvas}>
        
        
        {t.source === 'empty' && <div className="empty-state"><div className="view-corner tl"/><div className="view-corner tr"/><div className="view-corner bl"/><div className="view-corner br"/><div className="empty-art">{isBracelet ? <><div className="art-halo"/><HandOutline/><div className="wrist-scan"><span/><ScanLine size={18}/></div><div className="art-sparkle">✧</div></> : <><div className="art-halo"/><ClothingArt color="#c8bdde" large/><div className="art-sparkle">✧</div></>}</div><h2>Phong cách mới bắt đầu từ bạn</h2><p>{isBracelet ? 'Đưa trọn bàn tay và cổ tay vào khung, giữ cổ tay thẳng.' : 'Đứng vào khung hình và thử chiếc áo theo cách của bạn.'}<br/>Bật camera hoặc tải ảnh để bắt đầu.</p><button className="primary-button" onClick={() => void t.startCamera()} disabled={t.busy}><Camera size={18}/>{t.busy ? 'Đang chuẩn bị…' : 'Bật camera để thử'}<ArrowRight size={16}/></button><button className="text-button" disabled={t.busy} onClick={() => t.fileInput.current?.click()}><ImagePlus size={15}/> Hoặc tải ảnh từ thiết bị</button><span className="file-hint">JPG, PNG, WebP · Tối đa 20 MB</span></div>}
        {t.source !== 'empty' && <><div className={`detection-tag ${t.detected ? 'found' : ''}`} role="status">{t.busy ? <LoaderCircle className="spin" size={15}/> : t.detected ? <Check size={15}/> : <ScanLine size={15}/>} {t.busy ? 'Đang khởi tạo mô hình AI…' : t.detected ? `Đã nhận diện ${isBracelet ? 'bàn tay' : 'cơ thể'}` : isBracelet ? t.trackingHint : 'Lùi ra xa để thấy rõ cả hai vai và hông'}</div>{isBracelet && debug && <TrackingDebugPanel tracking={t.tracking} scale={scale}>{t.source === 'camera' && <WristEngineControls mode={t.engineDebugMode} onChange={t.setEngineDebugMode}/>}</TrackingDebugPanel>}{t.latency > 0 && <span className="latency-chip">AI · {t.latency} ms</span>}</>}
        {dragging && <div className="drop-overlay"><ImagePlus size={32}/>Thả ảnh tại đây</div>}
      </CameraViewport>
      {t.error && <div className="error-message" role="alert"><Info size={18}/><span>{t.error}</span></div>}
      <CameraToolbar source={t.source} busy={t.busy} stop={t.stop} startCamera={t.startCamera} save={t.save} onUpload={()=>t.fileInput.current?.click()}/>
      <input ref={t.fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Tải ảnh người hoặc bàn tay" onChange={e => { void t.upload(e.target.files?.[0]); e.target.value = ''; }}/>
      {t.saved && <div className="saved-message" role="status"><Check size={14}/>Ảnh PNG đã được gửi tới trình tải xuống của trình duyệt.</div>}
    </section>
    {isBracelet ? <BraceletControls colors={palettes[mode]} color={color} selected={selected} setSelected={setSelected} scale={scale} setScale={setScale} points={points} setPoints={setPoints} closeup={closeup} setCloseup={setCloseup} debug={debug} setDebug={setDebug}/> : <ClothingControls colors={palettes[mode]} color={color} selected={selected} setSelected={setSelected} scale={scale} setScale={setScale} points={points} setPoints={setPoints}/>} 
  </div>;
}
