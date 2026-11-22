import { project, add, mul, rotate } from '../../services/geometry/wristGeometry';
import type { WristPose, V3 } from '../../models/wrist.types';
import { projectedSpan } from '../../services/fitting/braceletSizing';
import type { WidthMeasurement, FitMethod, MeasurementPoint } from '../../models/fitting.types';
import { BANGLE, BANGLE_INNER_RADIUS, finalWorldScale } from '../../models/braceletDimensions';
import type { Point } from '../../../../shared/types/vision';
/** Bằng chứng vẽ từ cặp biên chọn trên ảnh gốc, không lấy từ proxy. Ứng viên thất bại vẫn thấy khi vòng bị ẩn. */
export function drawWristMeasurementDebug(ctx: CanvasRenderingContext2D, measurement: WidthMeasurement, pose: WristPose | null, method: FitMethod, fit: number, mirrored: boolean) {
  const W = ctx.canvas.width;
  ctx.save(); ctx.lineWidth = Math.max(1.5, W / 450);
  const line = (a: MeasurementPoint, b: MeasurementPoint, color: string, dashed = false) => {
    ctx.strokeStyle = color; ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.beginPath(); ctx.moveTo(a.x * W, a.y * W); ctx.lineTo(b.x * W, b.y * W); ctx.stroke();
  };
  const endpoint = (p: MeasurementPoint, color: string, radius: number) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x * W, p.y * W, radius, 0, Math.PI * 2); ctx.fill();
  };
  const label = (p: MeasurementPoint, text: string, color: string) => {
    ctx.save(); ctx.translate(p.x * W, p.y * W); if (mirrored) ctx.scale(-1, 1);
    ctx.font = `${Math.max(11, W / 65)}px sans-serif`;
    const size = ctx.measureText(text).width;
    ctx.fillStyle = '#111827dd'; ctx.fillRect(-size / 2 - 4, -16, size + 8, 20);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, 0, -2); ctx.restore();
  };
  if (measurement.image) {
    const d = measurement.image, r = d.roi;
    ctx.strokeStyle = '#ffe17b'; ctx.setLineDash([7, 4]);
    ctx.strokeRect(r.x / d.imageWidth * W, r.y / d.imageWidth * W, r.width / d.imageWidth * W, r.height / d.imageWidth * W);
    line(d.axis[0], d.axis[1], '#58baff');
    for (const [a, b] of d.cuts) line(a, b, '#ffe17b55', true);
    if (d.rejection) label({ x: r.x / d.imageWidth + r.width / d.imageWidth / 2, y: r.y / d.imageWidth }, `Reject: ${d.rejection.split(':')[0]}`, '#ff914d');
  }
  for (const slice of measurement.slices ?? []) {
    for (const candidate of slice.candidates) endpoint(candidate.point, candidate.rejected ? '#ff914d' : '#94a3b8', 1.5);
    if (slice.left && slice.right) {
      const color = slice.accepted ? '#34f5ae' : '#ff914d';
      line(slice.left, slice.right, color, !slice.accepted);
      endpoint(slice.left, color, 3); endpoint(slice.right, color, 3);
    }
  }
  if (measurement.left && measurement.right && measurement.sampleCenter && measurement.rawWidth !== undefined) {
    const accepted = measurement.confidence >= .65;
    label({ x: measurement.sampleCenter.x, y: measurement.sampleCenter.y - .025 }, `${accepted ? 'Đo biên' : 'Biên chưa tin cậy'}: ${(measurement.rawWidth * (measurement.image?.imageWidth ?? W)).toFixed(1)} px${measurement.image ? ' gốc' : ''}`, accepted ? '#34f5ae' : '#ff914d');
  }
  if (pose) {
    const center = project(pose.center, pose);
    const span = projectedSpan(pose, finalWorldScale(pose.radius, fit), BANGLE_INNER_RADIUS, BANGLE.oval);
    if (span) {
      line(span.left, span.right, method === 'predictive' ? '#ffd166' : '#f093ff', true);
      endpoint(span.left, '#f093ff', 3); endpoint(span.right, '#f093ff', 3);
      label({ x: center.x, y: center.y + .05 }, `${method === 'predictive' ? 'Dự đoán · ' : ''}Lỗ vòng: ${(span.width * W).toFixed(1)} px`, '#f093ff');
    }
  }
  ctx.restore();
}


// Vẽ trong frame CV chưa mirror giống video/vòng; compositor lật
// mọi thứ một lần, chú giải DOM nằm ngoài transform để vẫn đọc được.
export function drawWristDebug(ctx: CanvasRenderingContext2D, points: Point[], pose: WristPose | null, fit: number) {
  const width = ctx.canvas.width, height = ctx.canvas.height;
  ctx.save(); ctx.lineWidth = Math.max(1.5, width / 450);
  const chains = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];
  ctx.strokeStyle = '#a0ffb7';
  for (const chain of chains) {
    ctx.beginPath();
    chain.forEach((id, i) => {
      const p = points[id]; if (!p) return;
      if (i === 0) ctx.moveTo(p.x * width, p.y * height); else ctx.lineTo(p.x * width, p.y * height);
    });
    ctx.stroke();
  }
  const wrist = points[0];
  if (wrist) {
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(wrist.x * width, wrist.y * height, width * .012, 0, Math.PI * 2); ctx.stroke();
  }
  if (pose) {
    const pixel = (p: V3) => { const q = project(p, pose); return { x: q.x * width, y: q.y * width }; };
    const center = pixel(pose.center);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(center.x, center.y, 4, 0, Math.PI * 2); ctx.fill();
    for (const [vector, color] of [[{ x: 1, y: 0, z: 0 }, '#ff667b'], [{ x: 0, y: 1, z: 0 }, '#89f07a'], [{ x: 0, y: 0, z: 1 }, '#58baff']] as [V3, string][]) {
      const end = pixel(add(pose.center, mul(rotate(pose.orientation, vector), pose.radius * fit * 2)));
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      const angle = Math.atan2(end.y - center.y, end.x - center.x);
      ctx.beginPath(); ctx.moveTo(end.x - 8 * Math.cos(angle - .5), end.y - 8 * Math.sin(angle - .5)); ctx.lineTo(end.x, end.y); ctx.lineTo(end.x - 8 * Math.cos(angle + .5), end.y - 8 * Math.sin(angle + .5)); ctx.stroke();
    }
  }
  ctx.restore();
}
