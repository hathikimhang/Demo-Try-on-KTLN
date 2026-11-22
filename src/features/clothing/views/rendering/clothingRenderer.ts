import { shirtPlacement } from '../../models/clothingGeometry';
import type { Mode } from '../../../../shared/types/tryOn';
import type { Point } from '../../../../shared/types/vision';
export function drawProduct(ctx: CanvasRenderingContext2D, points: Point[], mode: Mode, color: string, size = 1) {
  // Vòng do braceletRenderer.ts dựng bằng mesh và depth mask cổ tay.
  if (mode === 'bracelet') return false;
  const place = shirtPlacement(points);
  if (!place) return false;
  ctx.save();
  ctx.translate(place.x, place.y); ctx.rotate(place.angle); ctx.scale(size, size);
  ctx.scale(place.width / 400, place.height / 350);
  const shirt = new Path2D('M -120 -12 L -175 15 L -200 90 L -139 115 L -114 65 L -110 350 Q 0 366 110 350 L 114 65 L 139 115 L 200 90 L 175 15 L 120 -12 L 55 -27 Q 0 30 -55 -27 Z');
  ctx.shadowColor = '#0003'; ctx.shadowBlur = 10;
  ctx.fillStyle = color; ctx.fill(shirt); ctx.shadowBlur = 0;
  ctx.save(); ctx.clip(shirt);
  const shade = ctx.createLinearGradient(-200, 0, 200, 0);
  shade.addColorStop(0, '#0003'); shade.addColorStop(0.22, '#fff2'); shade.addColorStop(0.5, '#fff0'); shade.addColorStop(0.8, '#0001'); shade.addColorStop(1, '#0003');
  ctx.fillStyle = shade; ctx.fillRect(-200, -40, 400, 420); ctx.restore();
  ctx.strokeStyle = '#0002'; ctx.lineWidth = 2; ctx.stroke(shirt);
  ctx.beginPath(); ctx.moveTo(-54, -24); ctx.quadraticCurveTo(0, 40, 54, -24); ctx.stroke();
  ctx.strokeStyle = '#ffffff45'; ctx.beginPath(); ctx.moveTo(-106, 339); ctx.quadraticCurveTo(0, 352, 106, 339); ctx.stroke();
  ctx.restore(); return true;
}
