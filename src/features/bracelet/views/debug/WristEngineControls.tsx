import type { WristEngineMode } from '../../models/wristEngine.types';

export function WristEngineControls({ mode, onChange }: { mode: WristEngineMode; onChange: (mode: WristEngineMode) => void }) {
  return <label>Tracking POC <select aria-label="Wrist engine debug mode" data-testid="wrist-engine-mode" value={mode} onChange={e => onChange(e.target.value as WristEngineMode)}>
    <option value="v1">V1 — mặc định</option>
    <option value="v2">V2 — debug anchor / axes</option>
    <option value="compare">Compare — V1 + V2 debug</option>
  </select><span>Vòng vẫn do V1 điều khiển. V2 chưa xác nhận fit.</span></label>;
}
