import { project, type WristPose } from './wristGeometry';
import { projectedWidth, widthAxis } from './braceletSizing';
import { FOREARM, WRIST_MODEL_RADIUS } from './braceletDimensions';
import type { ImageMask } from './imageCoordinates';

export type PixelFrame = { width: number; height: number; data: Uint8ClampedArray };
type P = { x: number; y: number };
type Gray = { width: number; height: number; data: Float32Array };
export type Match = { from: P; to: P };
export type Similarity = { a: number; b: number; tx: number; ty: number };
export type RoiResult = { pose: WristPose | null; quality: number; matches: number; inliers: number; rms: number | null; ageMs: number; reason: string };
export const ROI_MAX_AGE_MS = 2000;
const PATCH = 3, SEARCH = 12;
const distance = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
export const mapSimilarity = (p: P, t: Similarity): P => ({ x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty });

export function fitSimilarity(matches: Match[]): Similarity | null {
  if (matches.length < 2) return null;
  const center = (key: 'from' | 'to') => matches.reduce((s, m) => ({ x: s.x + m[key].x / matches.length, y: s.y + m[key].y / matches.length }), { x: 0, y: 0 });
  const u = center('from'), v = center('to'); let den = 0, aa = 0, bb = 0;
  for (const m of matches) {
    const x = m.from.x - u.x, y = m.from.y - u.y, X = m.to.x - v.x, Y = m.to.y - v.y;
    den += x * x + y * y; aa += x * X + y * Y; bb += x * Y - y * X;
  }
  if (den < 1e-6) return null;
  const a = aa / den, b = bb / den;
  return { a, b, tx: v.x - a * u.x + b * u.y, ty: v.y - b * u.x - a * u.y };
}
/** Actual image evidence supplies translation, in-plane rotation and scale.
 * Unobservable out-of-plane pose is retained only for the bounded ROI interval. */
export function applyImageSimilarity(pose: WristPose, t: Similarity, width: number): WristPose {
  const screen = project(pose.center, pose), moved = mapSimilarity({ x: screen.x * width, y: screen.y * width }, t);
  const scale = Math.hypot(t.a, t.b), angle = Math.atan2(t.b, t.a) / 2, z = Math.sin(angle), w = Math.cos(angle), q = pose.orientation;
  return { ...pose,
    center: { x: (moved.x / width - .5) * pose.center.z / pose.focal, y: (moved.y / width - pose.aspect / 2) * pose.center.z / pose.focal, z: pose.center.z },
    orientation: { x: w * q.x - z * q.y, y: w * q.y + z * q.x, z: w * q.z + z * q.w, w: w * q.w - z * q.z },
    radius: pose.radius * scale, palmLength: pose.palmLength * scale, distanceScale: (pose.distanceScale ?? pose.palmLength) * scale,
  };
}
const gray = (image: PixelFrame): Gray => {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) data[i] = .299 * image.data[i * 4] + .587 * image.data[i * 4 + 1] + .114 * image.data[i * 4 + 2];
  return { width: image.width, height: image.height, data };
};
function patch(image: Gray, p: P) {
  const x = Math.round(p.x), y = Math.round(p.y), values: number[] = [];
  if (x < PATCH + 1 || y < PATCH + 1 || x >= image.width - PATCH - 1 || y >= image.height - PATCH - 1) return null;
  let mean = 0;
  for (let dy = -PATCH; dy <= PATCH; dy++) for (let dx = -PATCH; dx <= PATCH; dx++) { const v = image.data[(y + dy) * image.width + x + dx]; values.push(v); mean += v / 49; }
  const centered = values.map(v => v - mean), energy = centered.reduce((s, v) => s + v * v, 0);
  return energy / 49 >= 9 ? { centered, energy } : null;
}
function matchPatch(template: Gray, target: Gray, point: P, around: P) {
  const initial = patch(template, point); if (!initial) return null;
  const costs: { p: P; cost: number }[] = [];
  const costAt = (p: P) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (x < PATCH + 1 || y < PATCH + 1 || x >= target.width - PATCH - 1 || y >= target.height - PATCH - 1) return;
    let sum = 0, square = 0, cov = 0, k = 0;
    for (let dy = -PATCH; dy <= PATCH; dy++) for (let dx = -PATCH; dx <= PATCH; dx++) {
      const v = target.data[(y + dy) * target.width + x + dx]; sum += v; square += v * v; cov += initial.centered[k++] * v;
    }
    const energy = square - sum * sum / 49;
    if (energy / 49 >= 9) costs.push({ p, cost: 1 - cov / Math.sqrt(initial.energy * energy) });
  };
  for (let y = -SEARCH; y <= SEARCH; y++) for (let x = -SEARCH; x <= SEARCH; x++) costAt({ x: Math.round(around.x) + x, y: Math.round(around.y) + y });
  costs.sort((a, b) => a.cost - b.cost); if (!costs.length) return null;
  const best = costs[0], alternative = costs.find(c => distance(c.p, best.p) >= 4);
  if (best.cost > .1 || (alternative && alternative.cost - best.cost < .025)) return null;
  return best.p;
}
function distributed(points: P[], width: number) {
  if (points.length < 6) return false;
  const mx = points.reduce((s, p) => s + p.x / points.length, 0), my = points.reduce((s, p) => s + p.y / points.length, 0);
  let xx = 0, yy = 0, xy = 0;
  for (const p of points) { xx += (p.x - mx) ** 2 / points.length; yy += (p.y - my) ** 2 / points.length; xy += (p.x - mx) * (p.y - my) / points.length; }
  // A four-DOF similarity is identifiable from separated collinear points
  // (e.g. real wrist creases). Requiring rank two is appropriate for an affine
  // model, and incorrectly rejects those valid correspondences here.
  const span = Math.max(...points.flatMap(a => points.map(b => distance(a, b))));
  return xx + yy > (width * .18) ** 2 && span > width * .4;
}
function features(image: Gray, pose: WristPose, includeCreases = false, foreground?: ImageMask, validateDistinct = false) {
  const center = project(pose.center, pose), axis = widthAxis(pose), W = image.width;
  const width = projectedWidth(pose, pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) * W;
  const candidates: (P & { score: number })[] = [];
  const extent = includeCreases ? .52 : .4;
  for (let along = -.1 * width; along < width * 1.4; along += 3) for (let across = -extent * width; across < extent * width; across += 3) {
    const x = Math.round(center.x * W - axis.y * along + axis.x * across), y = Math.round(center.y * W + axis.x * along + axis.y * across);
    if (foreground) {
      const r = foreground.roi, u = (x / W - r.x) / r.width, v = (y / image.height - r.y) / r.height;
      if (u < 0 || v < 0 || u >= 1 || v >= 1 || foreground.data[Math.floor(v * foreground.height) * foreground.width + Math.floor(u * foreground.width)] < 180) continue;
    }
    if (!patch(image, { x, y })) continue;
    let xx = 0, yy = 0, xy = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (y + dy) * W + x + dx, gx = (image.data[i + 1] - image.data[i - 1]) / 2, gy = (image.data[i + W] - image.data[i - W]) / 2;
      xx += gx * gx / 9; yy += gy * gy / 9; xy += gx * gy / 9;
    }
    const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 2;
    if (score >= 6) candidates.push({ x, y, score });
    // Skin often has creases/silhouette transitions rather than corners.
    // Propose their patches as well; the existing NCC uniqueness and reverse
    // correspondence gates must still reject ambiguous aperture matches.
    else if (includeCreases && xx + yy >= 24) candidates.push({ x, y, score: Math.min(5.9, (xx + yy) / 100) });
  }
  const points: P[] = [];
  let rejectedAmbiguous = 0;
  for (const p of candidates.sort((a, b) => b.score - a.score)) {
    if (points.every(other => distance(p, other) >= 6)) {
      // A corner/crease score does not imply a distinctive NCC patch. Do not
      // fill all slots with edges that already fail identity matching; keep
      // searching for independently matchable patches in the same skin ROI.
      if (validateDistinct && !matchPatch(image, image, p, p)) { rejectedAmbiguous++; continue; }
      points.push({ x: p.x, y: p.y });
    }
    if (points.length >= 24) break;
  }
  return { points, width, distributed: distributed(points, width), candidates: candidates.length, rejectedAmbiguous };
}

/** Local patch correspondences + forward/backward check + robust similarity.
 * No velocity-only propagation, no MediaPipe confidence threshold reduction. */
export class WristRoiTracker {
  // Existing/image callers retain the 250ms contract. Live may allow a slow
  // inference interval, still requiring NCC + forward/backward + RANSAC and
  // the unchanged 12px search, two-second anchor and deformation limits.
  constructor(private readonly maxFrameGapMs = 250, private readonly includeCreases = false, private readonly allowPartial = false) {}
  seedEvidence = { ready: false, points: 0, candidates: 0, distributed: false, rejectedAmbiguous: 0 };
  private frame: Gray | null = null;
  private pose: WristPose | null = null;
  private points: P[] = [];
  private seededAt = 0;
  private lastTime = 0;
  private wristWidth = 0;
  private cumulativeAngle = 0;
  private cumulativeScale = 1;
  reset() { this.frame = null; this.pose = null; this.points = []; this.seededAt = this.lastTime = 0; this.cumulativeAngle = 0; this.cumulativeScale = 1; this.seedEvidence = { ready: false, points: 0, candidates: 0, distributed: false, rejectedAmbiguous: 0 }; }
  seed(image: PixelFrame, pose: WristPose, time: number, foreground?: ImageMask) {
    this.reset(); const g = gray(image), selected = features(g, pose, this.includeCreases, foreground, this.allowPartial);
    this.seedEvidence = { ready: selected.points.length >= 6 && selected.distributed, points: selected.points.length, candidates: selected.candidates, distributed: selected.distributed, rejectedAmbiguous: selected.rejectedAmbiguous };
    if (!this.seedEvidence.ready) return false;
    this.frame = g; this.pose = pose; this.points = selected.points; this.wristWidth = selected.width; this.seededAt = this.lastTime = time;
    return true;
  }
  track(image: PixelFrame, time: number): RoiResult {
    const ageMs = this.frame ? time - this.seededAt : 0;
    const fail = (reason: string, matches = 0): RoiResult => { this.reset(); return { pose: null, quality: 0, matches, inliers: 0, rms: null, ageMs, reason }; };
    if (!this.frame || !this.pose || time - this.lastTime > Math.min(500, this.maxFrameGapMs) || time <= this.lastTime || ageMs > ROI_MAX_AGE_MS || this.frame.width !== image.width || this.frame.height !== image.height) return fail('ROI hết hạn/không có mốc 3D; đưa bàn tay trở lại để nhận diện.');
    const next = gray(image), matches: Match[] = [];
    for (const p of this.points) {
      const q = matchPatch(this.frame, next, p, p); if (!q) continue;
      const back = matchPatch(next, this.frame, q, p);
      if (back && distance(back, p) <= 1.5) matches.push({ from: p, to: q });
    }
    if (matches.length < 6) return fail('Không đủ texture/correspondence cổ tay; đưa bàn tay trở lại.', matches.length);
    let inliers: Match[] = [];
    for (let i = 0; i < matches.length; i++) for (let j = i + 1; j < matches.length; j++) {
      const t = fitSimilarity([matches[i], matches[j]]); if (!t) continue;
      const good = matches.filter(m => distance(mapSimilarity(m.from, t), m.to) < 1.8);
      if (good.length > inliers.length) inliers = good;
    }
    // Occluded features are not mismatched correspondences. With partial
    // Live tracking require a STRONGER consensus of surviving actual matches,
    // plus unchanged absolute count/spatial support/forward-backward checks.
    const support = this.allowPartial ? inliers.length / matches.length >= .75 : inliers.length / this.points.length >= .55;
    if (inliers.length < 6 || !support || !distributed(inliers.map(m => m.to), this.wristWidth)) return fail('ROI không nhất quán; không giữ vòng bằng vị trí dự đoán.', matches.length);
    const transform = fitSimilarity(inliers)!;
    const scale = Math.hypot(transform.a, transform.b), angle = Math.atan2(transform.b, transform.a);
    const rms = Math.sqrt(inliers.reduce((s, m) => s + distance(mapSimilarity(m.from, transform), m.to) ** 2, 0) / inliers.length);
    if (scale < .85 || scale > 1.18 || Math.abs(angle) > .21 || Math.abs(this.cumulativeAngle + angle) > Math.PI / 6 || rms > 1.5) return fail('Biến dạng/góc xoay ROI vượt phạm vi 2D; cần bàn tay để xác nhận 3D.', matches.length);
    // A 2D patch scale cannot distinguish depth motion from forearm twist.
    // Never reinterpret it as a new physical wrist size. A material change
    // needs Hand/Pose 3D re-observation instead of enlarging the bracelet.
    this.cumulativeScale *= scale;
    if (Math.abs(Math.log(this.cumulativeScale)) > .05) return fail('ROI đổi tỷ lệ/foreshortening; đưa bàn tay trở lại để đo khoảng cách 3D.', matches.length);
    const moved = applyImageSimilarity(this.pose, transform, image.width);
    this.pose = { ...moved, radius: this.pose.radius, palmLength: this.pose.palmLength, distanceScale: this.pose.distanceScale };
    this.frame = next; this.points = inliers.map(m => m.to);
    this.cumulativeAngle += angle; this.lastTime = time;
    return { pose: this.pose, quality: inliers.length / matches.length * Math.max(0, 1 - rms / 3), matches: matches.length, inliers: inliers.length, rms, ageMs, reason: 'ROI đo vị trí từ pixel cổ tay; giữ scale/hướng 3D từ Hand gần nhất, tối đa 2 giây.' };
  }
}
