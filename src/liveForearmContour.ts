import type { NativeRoi, ImagePoint } from './imageCoordinates';
import type { SkinSegmentation } from './types';
import type { WristPose } from './wristGeometry';
import { imageWristFrame } from './imageWristMeasurement';
import { skinProbability } from './segmentedWristMeasurement';

type Section = { center: ImagePoint; left: ImagePoint; right: ImagePoint; width: number; along: number };
export type ForearmContour = {
  direction: ImagePoint | null; confidence: number; reason: string;
  source: 'contour-rgb' | 'contour-segmentation'; sections: Section[];
  line?: [ImagePoint, ImagePoint]; residualPx?: number; extentPx?: number;
};
const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
const prototype = (a: number[][]) => a[0].map((_, i) => median(a.map(v => v[i])));

/** Independent visible FOREARM centreline, not a direction between finger
 * landmarks. Wide native ROI, many proximal sections, robust line consensus.
 * This observes XY only: it never claims to recover forearm depth/roll. */
export function measureForearmContour(roi: NativeRoi, pose: WristPose, wrist?: { x: number; y: number }, skin?: SkinSegmentation): ForearmContour {
  const W = roi.imageWidth, f = imageWristFrame(pose, wrist), span = f.span * W;
  const source = skin ? 'contour-segmentation' : 'contour-rgb';
  const sections: Section[] = [];
  const fail = (reason: string): ForearmContour => ({ direction: null, confidence: 0, reason, source, sections });
  if (!Number.isFinite(span) || span < 24 || roi.data.length !== roi.width * roi.height * 4) return fail('forearm-roi-invalid');
  const point = (a: number, t: number): ImagePoint => ({ x: f.anchor.x + (f.along.x * a * span + f.transverse.x * t) / W, y: f.anchor.y + (f.along.y * a * span + f.transverse.y * t) / W });
  const rgb = (p: ImagePoint): number[] | null => {
    const x = Math.round(p.x * W) - roi.x, y = Math.round(p.y * W) - roi.y;
    if (x < 1 || y < 1 || x >= roi.width - 1 || y >= roi.height - 1) return null;
    const i = (y * roi.width + x) * 4, r = roi.data[i], g = roi.data[i + 1], b = roi.data[i + 2], sum = Math.max(32, r + g + b);
    return [r / sum * 255, g / sum * 255, b / sum * 255, (.299 * r + .587 * g + .114 * b) * .15];
  };
  const prob = (p: ImagePoint) => skin ? skinProbability(skin, p, pose.aspect) : 0;
  let offset = 0;
  for (let j = 0; j < 19; j++) {
    const a = .08 + j * .06, at = (t: number) => point(a, t + offset);
    const core = [-.025, 0, .025].map(t => rgb(at(t * span)));
    if (core.some(v => !v)) continue;
    const seed = prototype(core as number[][]), noise = median((core as number[][]).map(c => distance(c, seed)));
    if (noise > 5 || (skin && Math.min(...[-.025, 0, .025].map(t => prob(at(t * span)))) < .75)) continue;
    const ends: number[] = [];
    for (const side of [-1, 1]) {
      const collar = [1.15, 1.25, 1.35].map(t => rgb(at(side * span * t)));
      let background: number[] | null = null;
      if (!skin) {
        if (collar.some(v => !v)) continue;
        background = prototype(collar as number[][]);
        if (Math.max(...(collar as number[][]).map(c => distance(c, background!))) > 5 || distance(background, seed) < Math.max(8, noise * 4)) continue;
      }
      const outside = (d: number) => {
        const p = at(side * d), c = rgb(p); if (!c) return false;
        return skin ? prob(p) < .35 : distance(c, background!) + 3 < distance(c, seed) && distance(c, background!) < distance(seed, background!) * .4;
      };
      let edge: number | null = null;
      for (let d = Math.max(4, Math.ceil(span * .1)); d < span * 1.3; d++) {
        if (!outside(d) || ![.02, .05, .09, .13].every(t => outside(d + t * span))) continue;
        // Validate a native transition, independent of a semantic model's
        // blurred boundary. A shadow inside skin is not an exterior collar.
        const inner = rgb(at(side * (d - 3))), outer = rgb(at(side * (d + 3)));
        if (!inner || !outer || distance(inner, outer) < Math.max(2.5, noise * 2)) continue;
        if (skin && prob(at(side * Math.max(0, d - Math.max(3, span * .025)))) < .5) continue;
        edge = d; break;
      }
      if (edge !== null) ends.push(side * edge);
    }
    if (ends.length !== 2) continue;
    const [left, right] = ends, width = right - left;
    if (width < span * .3 || width > span * 1.9 || Math.abs(left + right) > width * .8) continue;
    const middle = (left + right) / 2;
    sections.push({ center: at(middle), left: at(left), right: at(right), width, along: a });
    // Follow the observed arm through the ROI when the hand bends away.
    offset += middle;
  }
  if (sections.length < 6) return fail('forearm-too-few-sections');
  const typical = median(sections.map(s => s.width)), tolerance = Math.max(1.5, typical * .035) / W;
  let inliers: Section[] = [];
  for (let i = 0; i < sections.length; i++) for (let j = i + 1; j < sections.length; j++) {
    const p = sections[i].center, q = sections[j].center, dx = q.x - p.x, dy = q.y - p.y, n = Math.hypot(dx, dy); if (n < f.span * .2) continue;
    const group = sections.filter(s => Math.abs((s.center.x - p.x) * dy - (s.center.y - p.y) * dx) / n < tolerance);
    if (group.length > inliers.length) inliers = group;
  }
  if (inliers.length < 6 || inliers.length / sections.length < .7) return fail('forearm-inconsistent-centerline');
  const mean = inliers.reduce((c, s) => ({ x: c.x + s.center.x / inliers.length, y: c.y + s.center.y / inliers.length }), { x: 0, y: 0 });
  let xx = 0, yy = 0, xy = 0;
  for (const s of inliers) { const x = s.center.x - mean.x, y = s.center.y - mean.y; xx += x * x; yy += y * y; xy += x * y; }
  const angle = .5 * Math.atan2(2 * xy, xx - yy), d = { x: Math.cos(angle), y: Math.sin(angle) };
  if (d.x * f.along.x + d.y * f.along.y < 0) { d.x *= -1; d.y *= -1; }
  const offsets = inliers.map(s => (s.center.x - mean.x) * d.x + (s.center.y - mean.y) * d.y), lo = Math.min(...offsets), hi = Math.max(...offsets), extent = hi - lo;
  const residual = Math.sqrt(inliers.reduce((s, p) => s + ((p.center.x - mean.x) * d.y - (p.center.y - mean.y) * d.x) ** 2, 0) / inliers.length);
  if (extent < f.span * .25 || residual > tolerance || d.x * f.along.x + d.y * f.along.y < .35) return fail('forearm-axis-ambiguous');
  // Reject jagged width changes that can arise at fingers, clothes or clutter.
  const maxWidthJump = Math.max(...inliers.slice(1).map((s, i) => Math.abs(Math.log(s.width / inliers[i].width))));
  if (maxWidthJump > .22) return fail('forearm-width-discontinuity');
  const confidence = Math.min(.98, .75 + .2 * inliers.length / 19 - residual / extent);
  return { direction: d, confidence, source, reason: 'ok', sections: inliers, line: [{ x: mean.x + lo * d.x, y: mean.y + lo * d.y }, { x: mean.x + hi * d.x, y: mean.y + hi * d.y }], residualPx: residual * W, extentPx: extent * W };
}
