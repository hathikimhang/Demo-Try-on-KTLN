import type { WristEngineMode } from '../../models/wristEngine.types';

export function WristEngineControls({ mode, onChange, onExport }: { mode: WristEngineMode; onChange: (mode: WristEngineMode) => void; onExport: () => void }) {
  return <div><label>Tracking POC <select aria-label="Wrist engine debug mode" data-testid="wrist-engine-mode" value={mode} onChange={e => onChange(e.target.value as WristEngineMode)}>
    <option value="v1">V1 — mặc định</option>
    <option value="v2">V2 — continuity thử nghiệm</option>
    <option value="compare">Compare — V1 + V2 diagnostics</option>
  </select></label><span>V2: geometry/sizing V1 + continuity riêng. Compare: vòng V1. Chưa xác nhận fit.</span><button type="button" onClick={onExport}>Xuất trace JSON</button></div>;
}
