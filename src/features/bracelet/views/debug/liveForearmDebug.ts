import type { LiveOrientation, ForearmContour, V3, WristPose } from '../../models/wrist.types';
import { add, mul, project, rotate } from '../../services/geometry/wristGeometry';
/** Chỉ trong Debug Mode hiện có, dùng cùng hệ CV/bề rộng ảnh với render. Caller mirror toàn composition một lần, gồm cả các trục này. */
export function drawLiveForearmDebug(ctx: CanvasRenderingContext2D, o: LiveOrientation | null, rendered: WristPose | null, contour: ForearmContour | null) {
  const camera = rendered ?? o?.pose; if (!camera) return;
  const W = ctx.canvas.width, pixel = (v: V3) => { const p = project(v, camera); return { x: p.x * W, y: p.y * W }; };
  ctx.save(); ctx.lineWidth = Math.max(2, W / 350);
  const axis = (origin: V3, direction: V3, color: string, dashed = false) => {
    const a = pixel(origin), b = pixel(add(origin, mul(direction, camera.palmLength * .65)));
    ctx.strokeStyle = color; ctx.setLineDash(dashed ? [7, 4] : []); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  if (o) {
    axis(o.wristAnchor, o.handAxis, '#ffb34d', true);
    if (o.forearmAxis && o.pose) axis(o.pose.center, o.forearmAxis, '#42ef99');
  }
  if (rendered) {
    axis(rendered.center, rotate(rendered.orientation, { x: 0, y: 0, z: 1 }), '#56a9ff', true);
    const c = pixel(rendered.center); ctx.fillStyle = '#f38cff'; ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, 2 * Math.PI); ctx.fill();
  }
  if (contour?.line) {
    ctx.setLineDash([]); ctx.strokeStyle = '#00eeee'; ctx.beginPath(); ctx.moveTo(contour.line[0].x * W, contour.line[0].y * W); ctx.lineTo(contour.line[1].x * W, contour.line[1].y * W); ctx.stroke();
  }
  // Chỉ bỏ mirror của chữ; điểm và trục vẫn theo composition chung.
  ctx.translate(W - 12, 24); ctx.scale(-1, 1); ctx.setLineDash([]); ctx.font = `${Math.max(11, W / 75)}px sans-serif`;
  const label = `Hand: cam · Cẳng tay: xanh lá · Vòng: xanh dương · ${o?.source ?? 'ROI'} · q ${(o?.confidence ?? 0).toFixed(2)}`;
  ctx.fillStyle = '#111827dd'; ctx.fillRect(-5, -16, ctx.measureText(label).width + 10, 23); ctx.fillStyle = '#fff'; ctx.fillText(label, 0, 0); ctx.restore();
}
