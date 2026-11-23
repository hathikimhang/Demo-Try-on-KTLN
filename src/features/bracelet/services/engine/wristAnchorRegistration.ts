import type { ImagePoint } from '../../models/imageCoordinates';
import type { ForearmContour } from '../../models/wrist.types';

const finite = (p: ImagePoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
const dot = (a: ImagePoint, b: ImagePoint) => a.x * b.x + a.y * b.y;
const sub = (a: ImagePoint, b: ImagePoint) => ({ x: a.x - b.x, y: a.y - b.y });

/** Intersect BOTH local skin boundaries with the Hand0 cross-section.
 * Never project onto a distant global line or extrapolate beyond measured edges. */
export function registerWristAnchor(hand0: ImagePoint, c: ForearmContour | null) {
  const fallback = (reason: string) => ({ anchor: hand0, observed: false, reason, direction: null as ImagePoint | null, edges: null as [ImagePoint, ImagePoint] | null });
  if (!c?.direction || c.confidence < .75 || !finite(c.direction) || c.sections.length < 6) return fallback('Hand0-reference-only');
  const norm = Math.hypot(c.direction.x, c.direction.y);
  if (norm < 1e-8) return fallback('contour-direction-degenerate');
  const d = { x: c.direction.x / norm, y: c.direction.y / norm };
  const sections = c.sections.filter(s => [s.center, s.left, s.right].every(finite)).map(s => ({ ...s, station: dot(sub(s.center, hand0), d) })).sort((a, b) => a.station - b.station);
  if (sections.length < 2) return fallback('wrist-plane-not-bracketed');
  // Spatial fit around the wrist, not a temporal smoother or whole-arm fit.
  const nearest = [...sections].sort((a, b) => Math.abs(a.station) - Math.abs(b.station));
  const localWidth = Math.hypot(nearest[0].right.x - nearest[0].left.x, nearest[0].right.y - nearest[0].left.y);
  const near = sections.filter(s => Math.abs(s.station) <= localWidth / 2);
  if (near.length < 2) return fallback('wrist-plane-not-bracketed');
  const mean = near.reduce((p, s) => ({ x: p.x + s.center.x / near.length, y: p.y + s.center.y / near.length }), { x: 0, y: 0 });
  let xx = 0, xy = 0, yy = 0;
  for (const s of near) { const v = sub(s.center, mean); xx += v.x * v.x; xy += v.x * v.y; yy += v.y * v.y; }
  if (xx + yy < 1e-10) return fallback('local-centerline-degenerate');
  const angle = .5 * Math.atan2(2 * xy, xx - yy);
  const local = { x: Math.cos(angle), y: Math.sin(angle) };
  if (dot(local, d) < 0) { local.x *= -1; local.y *= -1; }
  const localSections = near.map(s => ({ ...s, station: dot(sub(s.center, hand0), local) })).sort((a, b) => a.station - b.station);
  // Both boundary polylines must bracket the same cross-section. A center sample
  // alone at t=0 is insufficient when pixel quantization tilts the fitted axis.
  const pairs = localSections.flatMap((a, i) => localSections.slice(i + 1).map(b => ({ a, b, gap: b.station - a.station }))).sort((a, b) => a.gap - b.gap);
  for (const { a, b, gap } of pairs) {
    if (a.station > 1e-8 || b.station < -1e-8) continue;
    const widths = [a, b].map(s => Math.hypot(s.right.x - s.left.x, s.right.y - s.left.y));
    if (gap <= 1e-8 || gap > Math.min(...widths) || Math.abs(Math.log(widths[0] / widths[1])) > .22) continue;
    const intersection = (left: boolean) => {
      const p = left ? a.left : a.right, q = left ? b.left : b.right, v = sub(q, p), den = dot(v, local);
      if (Math.abs(den) < 1e-10) return null;
      const t = -dot(sub(p, hand0), local) / den;
      if (t < -1e-8 || t > 1 + 1e-8) return null;
      return { x: p.x + t * v.x, y: p.y + t * v.y };
    };
    const left = intersection(true), right = intersection(false);
    if (!left || !right) continue;
    const across = { x: local.y, y: -local.x };
    if (dot(sub(left, hand0), across) * dot(sub(right, hand0), across) >= 0) continue;
    return { anchor: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }, observed: true,
      reason: 'local-skin-boundaries-at-Hand0-plane', direction: local, edges: [left, right] as [ImagePoint, ImagePoint] };
  }
  return fallback('wrist-plane-not-bracketed');
}
