import type { Point, TrackingMode } from './types';

export type V3 = { x: number; y: number; z: number };
export type Quaternion = { x: number; y: number; z: number; w: number };
export type WristPose = {
  center: V3; orientation: Quaternion; radius: number; palmLength: number;
  // radius is an estimated wrist half-width in image-width units, not metres.
  focal: number; aspect: number; handedness: string;
  source?: TrackingMode;
  // Projected rigid wrist->middle-MCP span, before bracelet fitting. It carries
  // distance independently of the anatomical radius/ellipse and is NOT metres.
  distanceScale?: number;
  calibrationRadius?: number;
};
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: V3, n: number): V3 => ({ x: a.x * n, y: a.y * n, z: a.z * n });
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const unit = (a: V3): V3 => mul(a, 1 / Math.max(1e-10, length(a)));
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: V3, b: V3, t: number) => add(mul(a, 1 - t), mul(b, t));
const finite = (p: Point | undefined) => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const mean = (p: V3[]) => mul(p.reduce(add, { x: 0, y: 0, z: 0 }), 1 / p.length);

function fromBasis(u: V3, v: V3, a: V3): Quaternion {
  const trace = u.x + v.y + a.z;
  let q: Quaternion;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = { w: s / 4, x: (v.z - a.y) / s, y: (a.x - u.z) / s, z: (u.y - v.x) / s };
  } else if (u.x > v.y && u.x > a.z) {
    const s = Math.sqrt(1 + u.x - v.y - a.z) * 2;
    q = { w: (v.z - a.y) / s, x: s / 4, y: (v.x + u.y) / s, z: (a.x + u.z) / s };
  } else if (v.y > a.z) {
    const s = Math.sqrt(1 + v.y - u.x - a.z) * 2;
    q = { w: (a.x - u.z) / s, x: (v.x + u.y) / s, y: s / 4, z: (a.y + v.z) / s };
  } else {
    const s = Math.sqrt(1 + a.z - u.x - v.y) * 2;
    q = { w: (u.y - v.x) / s, x: (a.x + u.z) / s, y: (a.y + v.z) / s, z: s / 4 };
  }
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
export function rotate(q: Quaternion, v: V3): V3 {
  const t = mul(cross(q, v), 2);
  return add(v, add(mul(t, q.w), cross(q, t)));
}
export function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (cos < 0) { b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; cos = -cos; }
  let x = 1 - t, y = t;
  if (cos < 0.9995) { const angle = Math.acos(clamp(cos, -1, 1)); x = Math.sin((1 - t) * angle) / Math.sin(angle); y = Math.sin(t * angle) / Math.sin(angle); }
  const q = { x: a.x * x + b.x * y, y: a.y * x + b.y * y, z: a.z * x + b.z * y, w: a.w * x + b.w * y };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
export function quaternionAngle(a: Quaternion, b: Quaternion) {
  return 2 * Math.acos(clamp(Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w), 0, 1));
}

/** Camera axes: +x right, +y down, +z away. Lengths in image-width units.
 * No camera calibration or actual forearm measurement is claimed here. */
export type WristOptions = { mode?: TrackingMode; armPoints?: Point[]; armWorldPoints?: Point[]; deferAxialCheck?: boolean };
export type WristReason = 'ok' | 'no-hand' | 'invalid-data' | 'cropped' | 'scale' | 'fit' | 'no-forearm' | 'arm-match' | 'arm-direction' | 'axial-view' | 'degenerate' | 'bounds';
export type WristMetrics = { fitResidual?: number; imageScale?: number; scaleSpread?: number; basisCondition?: number; viewAlignment?: number; armVisibility?: number };
export type WristAnalysis = { pose: WristPose | null; reason: WristReason; metrics: WristMetrics };
export function analyzeWrist(points: Point[], world: Point[], aspect: number, handedness = '', options: WristOptions = {}): WristAnalysis {
  const metrics: WristMetrics = {};
  const reject = (reason: WristReason): WristAnalysis => ({ pose: null, reason, metrics });
  if (!points.length) return reject('no-hand');
  if (!Number.isFinite(aspect) || aspect <= 0) return reject('invalid-data');
  const ids = [0, 5, 9, 13, 17];
  if (ids.some(i => !finite(points[i]) || !finite(world[i]))) return reject('invalid-data');
  // Fingers are not used by wrist fitting. Require observed palm anchors;
  // extrapolated off-screen MCPs must use validated ROI tracking instead.
  if (ids.some(i => points[i].x < .01 || points[i].x > .99 || points[i].y < .01 || points[i].y > .99)) return reject('cropped');
  const p = points.map(p => ({ x: p.x, y: p.y * aspect, z: p.z ?? 0 }));
  const w = world.map(p => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
  const wrist = p[0];
  if (points[0].x < 0.025 || points[0].x > 0.975 || points[0].y < 0.025 || points[0].y > 0.975) return reject('cropped');
  // Least-squares similarity aligns world XY with observed image XY. A single
  // rotation + uniform scale preserves 3D hand proportions, unlike mixing
  // unrelated normalized/world coordinates into a sheared basis each frame.
  let a = 0, b = 0, denominator = 0;
  for (const i of ids.slice(1)) {
    const x = w[i].x - w[0].x, y = w[i].y - w[0].y;
    const u = p[i].x - wrist.x, v = p[i].y - wrist.y;
    a += x * u + y * v; b += x * v - y * u; denominator += x * x + y * y;
  }
  if (denominator < 1e-5) return reject('degenerate');
  a /= denominator; b /= denominator;
  const rotationScale = Math.hypot(a, b);
  if (rotationScale < 0.1) return reject('scale');
  // Estimate distance scale from multiple projected anchors. Ignore pairs
  // pointing into the camera: dividing their tiny XY length amplifies noise.
  // World breadth is retained in 3D below, so an edge-on palm does not shrink
  // the wrist to its foreshortened 2D MCP distance.
  const ratios = [[0, 5], [0, 9], [0, 13], [0, 17], [5, 17]].flatMap(([i, j]) => {
    const d = sub(w[i], w[j]), xy = Math.hypot(d.x, d.y);
    if (xy < 0.015 || xy < length(d) * 0.4) return [];
    return [Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) / xy];
  }).sort((x, y) => x - y);
  if (ratios.length < 2) return reject('scale');
  const mid = Math.floor(ratios.length / 2);
  const scale = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  if (scale < 0.1 || scale > 25) return reject('scale');
  metrics.imageScale = scale;
  metrics.scaleSpread = Math.max(...ratios.map(r => Math.abs(r / scale - 1)));
  a *= scale / rotationScale; b *= scale / rotationScale;
  const local = w.map(q => { const d = sub(q, w[0]); return { x: a * d.x - b * d.y, y: b * d.x + a * d.y, z: scale * d.z }; });
  const palm = mean([5, 9, 13, 17].map(i => local[i]));
  const palmLength = length(palm), handAxis = unit(mul(palm, -1));
  const projectedLength = Math.hypot(palm.x, palm.y);
  if (projectedLength < 0.025 || palmLength < 0.03 || palmLength > 0.65) return reject('scale');
  const error = Math.sqrt(ids.slice(1).reduce((sum, i) => sum + (local[i].x - (p[i].x - wrist.x)) ** 2 + (local[i].y - (p[i].y - wrist.y)) ** 2, 0) / 4);
  metrics.fitResidual = error / palmLength;
  if (metrics.fitResidual > 0.24 || metrics.scaleSpread! > 0.65) return reject('fit');
  const mode = options.mode ?? 'forearm';
  let axis = handAxis;
  if (mode === 'forearm') {
    const arm = options.armPoints ?? [], armWorld = options.armWorldPoints ?? [];
    if (arm.length < 33 || armWorld.length < 33) return reject('no-forearm');
    const candidates = [[13, 15], [14, 16]].flatMap(([elbow, hand]) => {
      if ([elbow, hand].some(i => !finite(arm[i]) || !finite(armWorld[i]) || arm[i].x < 0.01 || arm[i].x > 0.99 || arm[i].y < 0.01 || arm[i].y > 0.99 || (arm[i].visibility ?? 0) < 0.7 || (armWorld[i].visibility ?? 0) < 0.7)) return [];
      const gap = Math.hypot(arm[hand].x - wrist.x, arm[hand].y * aspect - wrist.y);
      return gap < palmLength * 0.65 ? [{ elbow, hand, gap }] : [];
    }).sort((a, b) => a.gap - b.gap);
    if (!candidates.length || (candidates.length > 1 && candidates[1].gap - candidates[0].gap < palmLength * 0.25)) return reject('arm-match');
    const { elbow, hand } = candidates[0];
    metrics.armVisibility = Math.min(...[elbow, hand].flatMap(i => [arm[i].visibility ?? 0, armWorld[i].visibility ?? 0]));
    const dx = arm[elbow].x - arm[hand].x, dy = (arm[elbow].y - arm[hand].y) * aspect;
    const worldDirection = sub(armWorld[elbow] as V3, armWorld[hand] as V3);
    const worldXY = Math.hypot(worldDirection.x, worldDirection.y), screenLength = Math.hypot(dx, dy);
    if (worldXY < 0.045 || length(worldDirection) < 0.10 || length(worldDirection) > 0.55 || screenLength < palmLength * 0.8) return reject('arm-direction');
    axis = unit({ x: dx, y: dy, z: worldDirection.z * screenLength / worldXY });
    if (dot(axis, handAxis) < 0.25) return reject('arm-direction');
  }
  const across = sub(local[5], local[17]);
  const transverse = sub(across, mul(axis, dot(across, axis)));
  const breadth = length(sub(across, mul(handAxis, dot(across, handAxis))));
  metrics.basisCondition = length(transverse) / Math.max(breadth, 1e-10);
  if (breadth < 0.018 || breadth / palmLength < 0.35 || breadth / palmLength > 1.9 || length(transverse) < breadth * 0.45) return reject('degenerate');
  const u = unit(transverse), v = unit(cross(axis, u));
  // Rotation about a straight forearm is supported, including edge-on palms
  // when world landmarks remain usable. Axial/degenerate views are rejected
  // above; no size division by the palm normal or by cos(view angle).
  const offset = palmLength * 0.25;
  const focal = 1.35 * Math.max(1, aspect);
  const center = add({ x: wrist.x - 0.5, y: wrist.y - aspect / 2, z: focal }, mul(axis, offset));
  // Use the actual viewing ray, including off-centre wrists, not global Z.
  metrics.viewAlignment = Math.abs(dot(axis, unit(center)));
  // Live can defer ONLY this Hand-axis gate until an independently observed
  // forearm axis is available. Default/Upload behavior is exactly unchanged.
  if (!options.deferAxialCheck && metrics.viewAlignment > (mode === 'forearm' ? 0.86 : 0.72)) return reject('axial-view');
  // Anatomical prior, NOT an absolute wrist measurement. MCP 5/17 breadth
  // is bone-centre spacing, not skin width. Combine it with wrist->MCP palm
  // length bounds; users calibrate this estimate with the fit slider.
  const radius = clamp(breadth * 0.44, palmLength * 0.32, palmLength * 0.52);
  const projection = project(center, { focal, aspect });
  if (projection.x - radius * 1.5 < 0 || projection.x + radius * 1.5 > 1 || projection.y - radius * 1.5 < 0 || projection.y + radius * 1.5 > aspect) return reject('bounds');
  return { pose: { center, orientation: fromBasis(u, v, axis), radius, palmLength, distanceScale: length(local[9]), focal, aspect, handedness, source: mode }, reason: 'ok', metrics };
}

export function estimateWrist(points: Point[], world: Point[], aspect: number, handedness = '', options: WristOptions = {}): WristPose | null {
  return analyzeWrist(points, world, aspect, handedness, options).pose;
}

export type InputWristAnalysis = WristAnalysis & {
  requestedMode: TrackingMode; effectiveMode: TrackingMode; fallbackReason?: WristReason;
};
/** Uploads may lack an elbow. Retry only missing/unmatched Pose observations;
 * both attempts retain the exact same Hand and geometry validation gates.
 * The worker still echoes the requested mode, not this local effective mode. */
export function analyzeWristForSource(points: Point[], world: Point[], aspect: number, handedness: string, options: WristOptions & { input: 'image' | 'camera' }): InputWristAnalysis {
  const requestedMode = options.mode ?? 'forearm';
  const first = analyzeWrist(points, world, aspect, handedness, { ...options, mode: requestedMode });
  if (options.input === 'image' && requestedMode === 'forearm' && (first.reason === 'no-forearm' || first.reason === 'arm-match')) {
    const fallback = analyzeWrist(points, world, aspect, handedness, { ...options, mode: 'straight-wrist' });
    return { ...fallback, requestedMode, effectiveMode: 'straight-wrist', fallbackReason: first.reason };
  }
  return { ...first, requestedMode, effectiveMode: requestedMode };
}

export function project(p: V3, camera: { focal: number; aspect: number }): V3 {
  return { x: 0.5 + p.x * camera.focal / p.z, y: camera.aspect / 2 + p.y * camera.focal / p.z, z: p.z };
}

/** Time-aware filtering of placement, log-scale and quaternion (not Euler angles).
 * Adaptive cutoffs and a lag bound prevent slow smoothing from trailing the skin. */
export class WristFilter {
  private pose: WristPose | null = null;
  private timestamp = 0;
  private candidate: WristPose | null = null;
  private confirmations = 0;
  private distanceSamples: number[] = [];
  private primeDistance(pose: WristPose) { this.distanceSamples = pose.distanceScale ? Array(3).fill(pose.distanceScale) : []; }
  reset() { this.pose = null; this.timestamp = 0; this.candidate = null; this.confirmations = 0; this.distanceSamples = []; }
  update(target: WristPose | null, now: number): WristPose | null {
    if (!target) { this.reset(); return null; }
    const previous = this.pose, dt = (now - this.timestamp) / 1000;
    if (previous && dt > 0 && dt <= .25 && previous.source === target.source && previous.handedness === target.handedness) {
      const q = target.orientation;
      const equivalent = { x: q.y, y: -q.x, z: q.w, w: -q.z }; // q * local-Z half turn
      if (quaternionAngle(previous.orientation, equivalent) < quaternionAngle(previous.orientation, q)) target = { ...target, orientation: equivalent };
    }
    this.timestamp = now;
    if (!previous || dt <= 0 || dt > 0.25 || previous.source !== target.source || Math.abs(previous.aspect - target.aspect) > 0.001) {
      this.candidate = null; this.confirmations = 0;
      this.primeDistance(target);
      this.pose = target; return target;
    }
    const handChanged = !!previous.handedness && !!target.handedness && previous.handedness !== target.handedness;
    const jump = handChanged || length(sub(target.center, previous.center)) > target.radius * 3 || quaternionAngle(previous.orientation, target.orientation) > 1.1;
    if (jump) {
      const coherent = this.candidate && this.candidate.handedness === target.handedness && length(sub(this.candidate.center, target.center)) < target.radius && quaternionAngle(this.candidate.orientation, target.orientation) < 0.35;
      this.confirmations = coherent ? this.confirmations + 1 : 1;
      this.candidate = target;
      if (this.confirmations < 3) return null; // hide an unverified jump, never snap
      this.pose = target; this.primeDistance(target); this.candidate = null; this.confirmations = 0; return target;
    }
    this.candidate = null; this.confirmations = 0;
    const alpha = (cutoff: number) => 1 - Math.exp(-2 * Math.PI * cutoff * dt);
    const speed = length(sub(target.center, previous.center)) / target.radius / dt;
    let center = mix(previous.center, target.center, alpha(1.6 + Math.min(14, speed * 0.22)));
    const lag = sub(center, target.center), maxLag = target.radius * 0.12;
    if (length(lag) > maxLag) center = add(target.center, mul(unit(lag), maxLag));
    const scaleSpeed = Math.abs(Math.log(target.radius / previous.radius)) / dt;
    const a = alpha(1.4 + Math.min(10, scaleSpeed));
    // Bound change relative to the previous rendered size, not the new target.
    // Clamping to target ±6% used to pass most of a noisy size jump through.
    const logStep = clamp(Math.log(target.radius / previous.radius) * a, -1.8 * dt, 1.8 * dt);
    const radius = previous.radius * Math.exp(logStep);
    const angle = quaternionAngle(previous.orientation, target.orientation);
    let orientation = slerp(previous.orientation, target.orientation, alpha(1.7 + Math.min(12, angle / dt)));
    const rotationLag = quaternionAngle(orientation, target.orientation);
    if (rotationLag > 0.18) orientation = slerp(orientation, target.orientation, 1 - 0.18 / rotationLag);
    let distanceScale: number | undefined;
    if (target.distanceScale !== undefined) {
      this.distanceSamples.push(target.distanceScale); if (this.distanceSamples.length > 3) this.distanceSamples.shift();
      const sorted = [...this.distanceSamples].sort((x, y) => x - y), targetDistance = sorted[Math.floor(sorted.length / 2)];
      const before = previous.distanceScale ?? targetDistance;
      const speed = Math.abs(Math.log(targetDistance / before)) / dt;
      const step = clamp(Math.log(targetDistance / before) * alpha(3 + Math.min(8, speed)), -1.8 * dt, 1.8 * dt);
      distanceScale = before * Math.exp(step);
    }
    this.pose = { ...target, center, radius, distanceScale, palmLength: previous.palmLength * (1 - a) + target.palmLength * a, orientation };
    return this.pose;
  }
}
