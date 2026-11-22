import { BANGLE, BANGLE_CLEARANCE_SCALE, BANGLE_INNER_RADIUS, FOREARM, WRIST_MODEL_RADIUS, finalWorldScale, manualFit } from './braceletDimensions';
import { add, clamp, dot, mul, project, rotate, sub, type WristPose } from './wristGeometry';
import type { ImageMeasurementDebug } from './imageCoordinates';

/** Image points use image WIDTH on both axes, exactly like project(). */
export type MeasurementPoint = { x: number; y: number };
export type EdgeCandidate = {
  point: MeasurementPoint; side: -1 | 1; distancePx: number; quality: number;
  rejected: boolean; reason: string;
};
export type MeasurementSlice = {
  center: MeasurementPoint; candidates: EdgeCandidate[];
  left?: MeasurementPoint; right?: MeasurementPoint;
  accepted: boolean; reason: string;
};
export type WidthMeasurement = {
  width: number | null; confidence: number; reason: string;
  rawWidth?: number; sampleCenter?: { x: number; y: number };
  sampleCount?: number; spread?: number; contrast?: number; contourResidual?: number;
  left?: MeasurementPoint; right?: MeasurementPoint;
  slices?: MeasurementSlice[]; analysisWidth?: number;
  image?: ImageMeasurementDebug;
};
export type FitMethod = 'image' | 'manual-edges' | 'provisional' | 'calibrated' | 'predictive' | 'manual' | 'measuring' | 'blocked';
export type SizingDebug = {
  method: FitMethod; message: string; confidence: number;
  estimatedWristDiameter: number; wristMinorDiameter: number;
  braceletInnerDiameter: number; braceletInnerMinorDiameter: number;
  baseScale: number; manualFitMultiplier: number; finalWorldScale: number;
  projectedBraceletDiameterPx: number; estimatedWristWidthPx: number;
  observedWristWidthPx: number | null; baseWristWidthPx: number;
  frameWidth: number;
  fitRatio: number | null; autoScale: number; finalRenderScale: number;
  fitMode: 'Visual Auto Fit';
  status: 'measured' | 'provisional' | 'calibrated' | 'predictive' | 'rejected' | 'manual';
  rawWristWidthPx: number | null;
  acceptedSlices: number; rejectedCandidates: number;
  proxyWorldScale: number; braceletWorldScale: number;
  calibrationRadius: number | null; distanceScale: number;
  wristRadius: number; braceletRadius: number;
  effectiveFitMultiplier: number; collisionLimited: boolean;
  imageMeasurement?: ImageMeasurementDebug;
  nativeWristWidthPx: number | null; nativeBraceletWidthPx: number | null;
};

export function widthAxis(pose: WristPose) {
  const axis = rotate(pose.orientation, { x: 0, y: 0, z: 1 });
  const x = axis.x * pose.center.z - pose.center.x * axis.z;
  const y = axis.y * pose.center.z - pose.center.y * axis.z;
  const n = Math.hypot(x, y);
  return n > 1e-8 ? { x: y / n, y: -x / n } : { x: 1, y: 0 };
}
/** Exact perspective projection of the band-plane cross section, in the same
 * image-width coordinate system as CV and the Three.js camera. */
export function projectedSpan(pose: WristPose, radius: number, modelRadius: number, oval: number) {
  const axis = widthAxis(pose); let min = Infinity, max = -Infinity;
  for (let i = 0; i < 96; i++) {
    const theta = i / 96 * Math.PI * 2;
    const p = add(pose.center, rotate(pose.orientation, { x: radius * modelRadius * Math.cos(theta), y: radius * modelRadius * oval * Math.sin(theta), z: 0 }));
    if (p.z <= 0.01) return null;
    const screen = project(p, pose), t = screen.x * axis.x + screen.y * axis.y;
    min = Math.min(min, t); max = Math.max(max, t);
  }
  const center = project(pose.center, pose), origin = center.x * axis.x + center.y * axis.y;
  return {
    width: max - min,
    left: { x: center.x + axis.x * (min - origin), y: center.y + axis.y * (min - origin) },
    right: { x: center.x + axis.x * (max - origin), y: center.y + axis.y * (max - origin) },
  };
}
export function projectedWidth(pose: WristPose, radius: number, modelRadius: number, oval: number) {
  return projectedSpan(pose, radius, modelRadius, oval)?.width ?? NaN;
}
export function radiusFromImageWidth(pose: WristPose, width: number) {
  if (!(width > 0) || !Number.isFinite(width) || !(pose.radius > 0) || !(pose.palmLength > 0) || !Number.isFinite(pose.radius + pose.palmLength + pose.center.z)) return null;
  const arm = rotate(pose.orientation, { x: 0, y: 0, z: 1 });
  const view = Math.abs(dot(arm, pose.center)) / Math.hypot(pose.center.x, pose.center.y, pose.center.z);
  if (view > .85) return null; // no inverse fit from an axial/ambiguous wrist slice
  const u = rotate(pose.orientation, { x: 1, y: 0, z: 0 }), v = rotate(pose.orientation, { x: 0, y: 1, z: 0 });
  const depthExtent = WRIST_MODEL_RADIUS * Math.hypot(u.z, v.z * FOREARM.oval);
  // Broad anatomy plausibility bound, never a size multiplier. Keep a wrist
  // far from the projection singularity (old bound allowed 80% depth extent).
  const safeMax = Math.min(pose.palmLength * 1.25, (pose.center.z - 0.02) / Math.max(0.01, depthExtent) * 0.2);
  if (!(safeMax > 0)) return null;
  let lo = 0, hi = Math.min(pose.radius, safeMax);
  // Expand the search to the measured width, rather than imposing an anatomy
  // correction ceiling of four times an already underestimated hand prior.
  while (hi < safeMax && projectedWidth(pose, hi, WRIST_MODEL_RADIUS, FOREARM.oval) < width) hi = Math.min(safeMax, hi * 1.6);
  const upperWidth = projectedWidth(pose, hi, WRIST_MODEL_RADIUS, FOREARM.oval);
  if (!Number.isFinite(upperWidth) || upperWidth < width) return null;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (projectedWidth(pose, mid, WRIST_MODEL_RADIUS, FOREARM.oval) < width) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** Multi-slice boundary analysis. A local luminance/chroma profile is seeded
 * at Hand[0], not the hand bounding box and not a fixed skin-color threshold.
 * Returns a width at the wear plane; weak/ambiguous edges are rejected. */
export function measureWristWidth(image: { width: number; height: number; data: Uint8ClampedArray }, pose: WristPose, wrist?: { x: number; y: number }): WidthMeasurement {
  const diagnostics: MeasurementSlice[] = [];
  const reject = (reason: string): WidthMeasurement => {
    for (const slice of diagnostics) {
      for (const c of slice.candidates) if (c.point === slice.left || c.point === slice.right) { c.rejected = true; c.reason = slice.reason; }
    }
    return { width: null, confidence: 0, reason, slices: diagnostics, analysisWidth: image.width };
  };
  const W = image.width, H = image.height, center = project(pose.center, pose), transverse = widthAxis(pose);
  const longitudinal = { x: -transverse.y, y: transverse.x };
  const arm = rotate(pose.orientation, { x: 0, y: 0, z: 1 });
  if (Math.hypot(arm.x * pose.center.z - pose.center.x * arm.z, arm.y * pose.center.z - pose.center.y * arm.z) < 1e-5) return reject('Trục cẳng tay hướng vào camera; chưa xác định được hướng đo ngang');
  const inferredWrist = project(add(pose.center, mul(arm, -pose.palmLength * .25)), pose);
  const anchor = wrist ? { x: wrist.x, y: wrist.y * pose.aspect } : inferredWrist;
  const handSpan = pose.palmLength * pose.focal / pose.center.z * W;
  if (!Number.isFinite(handSpan) || handSpan < 16) return reject('Cổ tay quá nhỏ hoặc ảnh mờ để đo biên');
  const rgb = (x: number, y: number): number[] | null => {
    const ix = Math.round(x), iy = Math.round(y / pose.aspect * H / W);
    if (ix < 1 || iy < 1 || ix >= W - 1 || iy >= H - 1) return null;
    const result = [0, 0, 0];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const i = ((iy + dy) * W + ix + dx) * 4;
      for (let c = 0; c < 3; c++) result[c] += image.data[i + c] / 9;
    }
    const [r, g, b] = result;
    return [.299 * r + .587 * g + .114 * b, -.168736 * r - .331264 * g + .5 * b, .5 * r - .418688 * g - .081312 * b];
  };
  const distance = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * .5, a[1] - b[1], a[2] - b[2]);
  const mean = (values: number[][]) => [0, 1, 2].map(c => values.reduce((sum, v) => sum + v[c], 0) / values.length);
  const search = Math.ceil(Math.min(handSpan * 1.35, W * .45));
  const minimum = Math.max(3, Math.floor(handSpan * .12));
  type Slice = { width: number; rawWidth: number; center: MeasurementPoint; quality: number; contrast: number; debug: MeasurementSlice; leftDistance: number; rightDistance: number; along: number };
  const slices: Slice[] = [];
  // Sample the forearm side of Hand[0], around the wear plane. Slices at or
  // distal to Hand[0] can cross the flared palm instead of the wrist silhouette.
  for (const along of [.10, .14, .18, .22, .26, .30, .34, .38, .42]) {
    const cx = anchor.x * W + longitudinal.x * handSpan * along;
    const cy = anchor.y * W + longitudinal.y * handSpan * along;
    const debug: MeasurementSlice = { center: { x: cx / W, y: cy / W }, candidates: [], accepted: false, reason: 'Không đủ hai biên rõ' };
    diagnostics.push(debug);
    const pointAt = (distance: number): MeasurementPoint => ({ x: (cx + transverse.x * distance) / W, y: (cy + transverse.y * distance) / W });
    const profile = Array.from({ length: search * 2 + 1 }, (_, i) => rgb(cx + transverse.x * (i - search), cy + transverse.y * (i - search)));
    const coreRadius = Math.max(2, Math.round(handSpan * .055));
    const core = profile.slice(search - coreRadius, search + coreRadius + 1);
    if (core.some(v => !v)) { debug.reason = 'Tâm đo ngoài ảnh'; continue; }
    const seed = [0, 1, 2].map(c => median(core.map(v => v![c])));
    const noise = median(core.map(v => distance(v!, seed)));
    if (noise > 10) { debug.reason = 'Texture ở tâm đo quá mạnh'; continue; }
    const tolerance = Math.min(22, Math.max(10, noise * 3 + 8));
    type Edge = { distance: number; quality: number; contrast: number; candidate: EdgeCandidate };
    const sides: Edge[][] = [];
    for (const side of [-1, 1]) {
      const edges: Edge[] = [];
      let covered = 0, total = 0;
      for (let d = 1; d < search - 5; d++) {
        const p = profile[search + side * d]; if (!p) break;
        total++; if (distance(p, seed) <= tolerance + 5) covered++;
        if (d < minimum || d < 5) continue;
        const inside = [1, 2, 3, 4].map(k => profile[search + side * (d - k)]);
        const outside = [1, 2, 3, 4].map(k => profile[search + side * (d + k)]);
        if ([...inside, ...outside].some(v => !v)) break;
        const inner = mean(inside as number[][]), outer = mean(outside as number[][]);
        const contrast = distance(inner, outer), innerDistance = distance(inner, seed), outerDistance = distance(outer, seed);
        // A shadow/texture transition does not terminate the whole scan. It is
        // accepted only if a persistent outside region and a coherent interior agree.
        if (contrast < Math.max(6, noise * 2 + 4) || innerDistance > tolerance + 3 || outerDistance < tolerance || outerDistance < innerDistance + 5 || covered / total < .80) continue;
        if (outside.filter(v => distance(v!, seed) > tolerance).length < 3) continue;
        const quality = clamp(.48 + Math.min(.26, contrast / 100) + (covered / total - .8) * .7 - noise / 80, 0, 1);
        // A short dark stripe can satisfy the four-pixel outside test. A true
        // silhouette should not return to the seeded interior immediately after
        // it. Conservatively reject re-entry; background ambiguity is not a size.
        let run = 0, reentry = false;
        for (let k = d + 7; k <= Math.min(search, d + Math.max(16, handSpan * .32)); k++) {
          const next = profile[search + side * k];
          if (!next) break;
          run = distance(next, seed) <= tolerance ? run + 1 : 0;
          if (run >= 4) { reentry = true; break; }
        }
        const candidate: EdgeCandidate = { point: pointAt(side * d), side: side as -1 | 1, distancePx: d, quality, rejected: reentry, reason: reentry ? 'Màu da xuất hiện lại phía ngoài: bóng/texture hoặc nền mơ hồ' : 'Ứng viên biên' };
        debug.candidates.push(candidate);
        if (!reentry) edges.push({ distance: d, quality, contrast, candidate });
      }
      // Nonmaximum suppression prevents five neighbouring pixels from filling
      // the entire candidate list while hiding an independent silhouette edge.
      const peaks: Edge[] = [];
      for (const edge of edges.sort((a, b) => b.quality - a.quality || b.contrast - a.contrast)) {
        if (peaks.every(p => Math.abs(p.distance - edge.distance) > 4)) peaks.push(edge);
      }
      sides.push(peaks.slice(0, 8));
    }
    let pair: { width: number; quality: number; contrast: number; left: Edge; right: Edge } | null = null;
    for (const left of sides[0]) for (const right of sides[1]) {
      const width = left.distance + right.distance, asymmetry = Math.abs(left.distance - right.distance) / width;
      if (width < handSpan * .25 || width > handSpan * 2.1 || asymmetry > .32) continue;
      const quality = Math.min(left.quality, right.quality) - asymmetry * .12;
      if (!pair || quality > pair.quality) pair = { width, quality, contrast: Math.min(left.contrast, right.contrast), left, right };
    }
    if (!pair) continue;
    debug.left = pair.left.candidate.point; debug.right = pair.right.candidate.point;
    debug.reason = 'Chờ kiểm tra hình dạng nhiều lát cắt';
    // Map a nearby wrist slice to the wear plane using its viewing ray. This
    // corrects foreshortening/distance; a raw pixel width is never used as 3D units.
    const sampleCenter = { x: cx / W, y: cy / W };
    const ray = { x: (sampleCenter.x - .5) / pose.focal, y: (sampleCenter.y - pose.aspect / 2) / pose.focal, z: 1 };
    const d = dot(ray, ray), b = dot(arm, ray), denominator = d - b * b;
    if (denominator < 1e-5) continue;
    const t = (b * dot(pose.center, ray) - d * dot(arm, pose.center)) / denominator;
    const samplePose = { ...pose, center: add(pose.center, mul(arm, t)) };
    // Transfer local pixel width by depth once. Do not use an assumed radius
    // and oval/view compensation here and then invert that oval a second time.
    const depthRatio = samplePose.center.z / pose.center.z;
    if (depthRatio < .75 || depthRatio > 1.33) continue;
    const width = pair.width / W * depthRatio;
    if (!Number.isFinite(width) || width <= 0) continue;
    slices.push({ width, rawWidth: pair.width / W, center: sampleCenter, quality: pair.quality, contrast: pair.contrast, debug, leftDistance: -pair.left.distance, rightDistance: pair.right.distance, along: along * handSpan });
  }
  if (slices.length < 3) return reject('Chưa thấy đủ hai biên cổ tay; đổi nền/ánh sáng hoặc dùng Manual Calibration');
  // Similar widths alone cannot validate edges: alternating left/right texture
  // can have the same width. Both contours must form locally smooth outlines.
  const meanAlong = slices.reduce((a, s) => a + s.along, 0) / slices.length;
  const variance = slices.reduce((a, s) => a + (s.along - meanAlong) ** 2, 0);
  let contourResidual = 0;
  for (const side of ['leftDistance', 'rightDistance'] as const) {
    const average = slices.reduce((a, s) => a + s[side], 0) / slices.length;
    const slope = slices.reduce((a, s) => a + (s.along - meanAlong) * (s[side] - average), 0) / Math.max(variance, 1e-9);
    const residual = Math.max(...slices.map(s => Math.abs(s[side] - average - slope * (s.along - meanAlong))));
    contourResidual = Math.max(contourResidual, residual / (median(slices.map(s => s.rawWidth)) * W));
    if (Math.abs(slope) > .65 || residual > Math.max(2.5, median(slices.map(s => s.rawWidth)) * W * .045)) {
      for (const s of slices) s.debug.reason = 'Mép không liên tục hoặc không theo hướng cẳng tay';
      return reject('Đường biên không phù hợp hình dạng cổ tay; không cập nhật scale');
    }
  }
  let cluster: Slice[] = [];
  for (const seed of slices) {
    const candidates = slices.filter(s => Math.abs(s.width / seed.width - 1) < .13);
    if (candidates.length > cluster.length || (candidates.length === cluster.length && candidates.reduce((a, s) => a + s.quality, 0) > cluster.reduce((a, s) => a + s.quality, 0))) cluster = candidates;
  }
  if (cluster.length < 3) return reject('Các lát cắt cổ tay không nhất quán; không dùng phép đo này');
  const width = median(cluster.map(s => s.width));
  const spread = Math.max(...cluster.map(s => Math.abs(s.width / width - 1)));
  const chosen = cluster.reduce((a, b) => Math.abs(a.width - width) < Math.abs(b.width - width) ? a : b);
  // A smoothly tapering wrist legitimately changes width between slices. Score
  // deviation from smooth contours, rather than labelling that taper as noise.
  const confidence = clamp(median(cluster.map(s => s.quality)) + Math.min(.1, (cluster.length - 3) * .025) - contourResidual * 1.5, 0, 1);
  for (const s of slices) {
    s.debug.accepted = confidence >= .65 && cluster.includes(s);
    s.debug.reason = s.debug.accepted ? 'Hai mép qua kiểm tra hình dạng' : 'Lát cắt không nhất quán hoặc chất lượng thấp';
    for (const c of s.debug.candidates) if (c.point === s.debug.left || c.point === s.debug.right) { c.rejected = !s.debug.accepted; c.reason = s.debug.reason; }
  }
  return { width, rawWidth: chosen.rawWidth, sampleCenter: chosen.center, left: chosen.debug.left, right: chosen.debug.right, slices: diagnostics, analysisWidth: W, confidence, sampleCount: cluster.length, spread, contourResidual, contrast: median(cluster.map(s => s.contrast)), reason: 'Đo biên cổ tay nhiều lát cắt, quy về mặt phẳng đeo vòng' };
}

export type AutoFitOptions = { auto?: boolean; video?: boolean; policy?: 'visual-auto' | 'fixed-size'; trackingSource?: 'Hand' | 'ROI'; input?: 'image' | 'camera' };
export type AutoFitResult = { pose: WristPose | null; method: FitMethod; message: string; quality: number };

/** This checks renderability, not measurement accuracy. Only a validated
 * uploaded Hand pose may use the prior, with an explicit provisional label. */
export function canRenderProvisional(pose: WristPose) {
  const values = [...Object.values(pose.center), ...Object.values(pose.orientation), pose.radius, pose.palmLength, pose.focal, pose.aspect];
  if (!values.every(Number.isFinite) || pose.radius <= 0 || pose.palmLength <= 0 || pose.focal <= 0 || pose.aspect <= 0 || pose.center.z <= .02) return false;
  if (Math.abs(Math.hypot(...Object.values(pose.orientation)) - 1) > .01) return false;
  const span = projectedSpan(pose, pose.radius, BANGLE_INNER_RADIUS, BANGLE.oval), center = project(pose.center, pose);
  return !!span && Number.isFinite(span.width) && span.width > 0 && center.x > 0 && center.x < 1 && center.y > 0 && center.y < pose.aspect &&
    [span.left, span.right].every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= pose.aspect);
}

/** A session stores one intrinsic radius relative to a rigid palm span.
 * Distance changes scene scale; rotation changes projection, not calibration.
 * Hand model lengths are not a calibrated metric ruler. */
export function distanceReference(pose: WristPose) {
  const scale = pose.distanceScale ?? pose.palmLength;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}
export class WristSizer {
  private intrinsic: number | null = null;
  private previous: WristPose | null = null;
  private lastTime = 0;
  private samples: number[] = [];
  reset() { this.intrinsic = null; this.previous = null; this.lastTime = 0; this.samples = []; }
  loseTracking() { this.reset(); }
  // Keep only the scalar calibration through a brief detection blink. No pose
  // is returned/rendered here. A longer loss or a different hand starts fresh.
  missing(time: number) {
    this.samples = [];
    if (time - this.lastTime > 1500 || time < this.lastTime) this.reset();
  }
  update(pose: WristPose, measurement: WidthMeasurement, time: number, options: AutoFitOptions = {}): AutoFitResult {
    if (options.policy === 'fixed-size') return { pose: null, method: 'blocked', quality: 0, message: 'True-to-Size cần size sản phẩm và hiệu chuẩn mm; không tự phóng mẫu vòng fixed-size.' };
    // A still image has a fresh measured/manual width, not a temporal camera
    // calibration. A failed remeasurement must not inherit a stale success.
    if (options.input === 'image') this.reset();
    const scale = distanceReference(pose), previous = this.previous;
    const changed = previous && ((previous.handedness && pose.handedness && previous.handedness !== pose.handedness) || previous.source !== pose.source || Math.hypot(previous.center.x - pose.center.x, previous.center.y - pose.center.y) > pose.palmLength * 1.8 || time - this.lastTime > 1500 || time < this.lastTime);
    if (changed) this.reset();
    this.previous = pose; this.lastTime = time;
    const waiting = (message: string): AutoFitResult => ({ pose: null, method: 'measuring', quality: 0, message });
    if (!scale) return waiting(options.input === 'image' ? 'Đã xác định cổ tay nhưng chuẩn tỷ lệ landmark không hợp lệ để dựng vòng an toàn (invalid-scale).' : 'Không có dữ liệu khoảng cách đáng tin cậy; đưa bàn tay trở lại khung hình.');
    const output = (): WristPose => ({ ...pose, radius: this.intrinsic! * scale, calibrationRadius: this.intrinsic!, distanceScale: scale });
    if (options.input === 'image' && measurement.image?.method === 'manual-edges' && measurement.width !== null) {
      const radius = radiusFromImageWidth(pose, measurement.width);
      if (!radius) return waiting('Hai mép đã chọn cho kích thước ngoài miền hình học an toàn (manual-width-out-of-range).');
      this.intrinsic = radius / scale;
      return { pose: output(), method: 'manual-edges', quality: 1, message: 'Đã hiệu chuẩn bề rộng từ hai mép bạn chọn trên ảnh gốc. Đây là calibration thủ công, không phải Auto Fit hay số đo mm.' };
    }
    if (options.auto === false) {
      this.intrinsic ??= pose.radius / scale;
      return { pose: output(), method: 'manual', quality: 0, message: 'Manual Calibration: giữ kích thước cơ sở trong phiên; Manual Fit chỉ thay vòng, không thay proxy hoặc tracking.' };
    }
    // ROI can propagate an established fit but cannot invent a 3D calibration.
    const measured = options.trackingSource !== 'ROI' && measurement.width !== null && measurement.confidence >= .65 ? radiusFromImageWidth(pose, measurement.width) : null;
    if (options.input === 'image' && measured) {
      this.intrinsic = measured / scale;
      return { pose: output(), method: 'image', quality: measurement.confidence, message: 'Visual Auto Fit: dùng bề rộng đo trên ROI ảnh gốc; chưa phải True-to-Size theo mm.' };
    }
    if (this.intrinsic !== null) {
      const fitted = output();
      const agrees = measured !== null && Math.abs(Math.log(measured / fitted.radius)) < .12;
      return {
        pose: fitted, method: agrees ? 'image' : 'calibrated', quality: agrees ? measurement.confidence : 0,
        message: agrees ? 'Biên phù hợp calibration. Giữ bán kính phiên; chỉ cập nhật tỷ lệ theo khoảng cách.' : 'Giữ calibration trong phiên; không đổi bán kính theo biên yếu/góc xoay. Đưa bàn tay trở lại nếu tracking mất.',
      };
    }
    if (!measured) {
      this.samples = [];
      if (options.input === 'image' && options.trackingSource !== 'ROI') {
        const reason = measurement.width !== null && measurement.confidence >= .65 ? 'Phép đo biên cho bán kính ngoài miền hình học an toàn.' : measurement.reason;
        if (!canRenderProvisional(pose)) return waiting(`Đã xác định cổ tay nhưng chưa đo được kích thước. Kích thước ban đầu không thể chiếu an toàn lên ảnh (unsafe-provisional). ${reason}`);
        // Do not commit an intrinsic calibration from the anatomical prior.
        // A subsequent valid measurement must still be able to replace it.
        return { pose: { ...pose, calibrationRadius: undefined }, method: 'provisional', quality: 0,
          message: `Đã hiển thị vòng với kích thước tạm tính (Provisional Fit), chưa đo được biên cổ tay. ${reason} Có thể điều chỉnh Manual Fit; đây chưa phải Auto Fit chính xác.` };
      }
      return waiting(`${measurement.reason}. Auto Fit đang chờ biên rõ để hiệu chuẩn; có thể tắt Dynamic Auto Fit để dùng Manual Calibration.`);
    }
    const candidate = measured / scale;
    if (this.samples.length && Math.abs(Math.log(candidate / median(this.samples))) > .12) this.samples = [];
    this.samples.push(candidate); if (this.samples.length > 3) this.samples.shift();
    if (options.video && this.samples.length < 3) return waiting('Khởi tạo: giữ bàn tay và cổ tay trong khung, chờ ba frame biên rõ để hiệu chuẩn.');
    this.intrinsic = median(this.samples);
    return { pose: output(), method: 'image', quality: measurement.confidence, message: 'Đã hiệu chuẩn Visual Auto Fit; kích thước cơ sở được giữ trong phiên, không phải số đo mm.' };
  }
}

export function sizingDebug(pose: WristPose, multiplier: number, frameWidth: number, measurement: WidthMeasurement, method: FitMethod, message: string, renderFit = multiplier): SizingDebug {
  const fit = manualFit(renderFit), ready = ['image', 'manual-edges', 'provisional', 'calibrated', 'manual', 'predictive'].includes(method);
  const final = ready ? finalWorldScale(pose.radius, fit) : 0;
  const innerPixels = ready ? projectedWidth(pose, final, BANGLE_INNER_RADIUS, BANGLE.oval) * frameWidth : 0;
  return {
    method, message, confidence: measurement.confidence, frameWidth, fitMode: 'Visual Auto Fit',
    status: method === 'image' ? 'measured' : method === 'provisional' ? 'provisional' : method === 'calibrated' ? 'calibrated' : method === 'predictive' ? 'predictive' : method === 'manual' || method === 'manual-edges' ? 'manual' : 'rejected',
    effectiveFitMultiplier: fit, collisionLimited: fit > manualFit(multiplier) + 1e-8,
    imageMeasurement: measurement.image,
    nativeWristWidthPx: measurement.image && measurement.width !== null ? measurement.width * measurement.image.imageWidth : null,
    nativeBraceletWidthPx: measurement.image ? innerPixels / frameWidth * measurement.image.imageWidth : null,
    rawWristWidthPx: measurement.rawWidth === undefined ? null : measurement.rawWidth * frameWidth,
    acceptedSlices: measurement.slices?.filter(s => s.accepted).length ?? 0,
    rejectedCandidates: measurement.slices?.reduce((n, s) => n + s.candidates.filter(c => c.rejected).length, 0) ?? 0,
    proxyWorldScale: ready ? pose.radius : 0, braceletWorldScale: final * BANGLE_CLEARANCE_SCALE,
    calibrationRadius: pose.calibrationRadius ?? null, distanceScale: distanceReference(pose) ?? 0,
    wristRadius: ready ? WRIST_MODEL_RADIUS * pose.radius : 0, braceletRadius: BANGLE_INNER_RADIUS * final,
    autoScale: ready ? pose.radius : 0, finalRenderScale: final,
    fitRatio: measurement.width !== null && measurement.confidence >= .65 && (method === 'image' || method === 'manual' || method === 'manual-edges') ? innerPixels / (measurement.width * frameWidth) : null,
    // Skin/proxy estimate is independent of manual bracelet fit.
    estimatedWristDiameter: !ready ? 0 : 2 * WRIST_MODEL_RADIUS * pose.radius,
    wristMinorDiameter: !ready ? 0 : 2 * WRIST_MODEL_RADIUS * FOREARM.oval * pose.radius,
    braceletInnerDiameter: 2 * BANGLE_INNER_RADIUS * final,
    braceletInnerMinorDiameter: 2 * BANGLE_INNER_RADIUS * BANGLE.oval * final,
    baseScale: pose.radius, manualFitMultiplier: manualFit(multiplier), finalWorldScale: final,
    projectedBraceletDiameterPx: innerPixels,
    estimatedWristWidthPx: ready ? projectedWidth(pose, pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) * frameWidth : 0,
    baseWristWidthPx: projectedWidth(pose, pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) * frameWidth,
    observedWristWidthPx: measurement.width === null ? null : measurement.width * frameWidth,
  };
}
