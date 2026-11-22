import { widthAxis, type WidthMeasurement, type MeasurementSlice } from './braceletSizing';
import { add, mul, project, rotate, type WristPose } from './wristGeometry';
import type { ImageMask, ImagePoint, NativeRoi, ImageMeasurementDebug } from './imageCoordinates';
import { liveForeground } from './liveForeground';

const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
const prototype = (a: number[][]) => [0, 1, 2, 3].map(i => median(a.map(v => v[i])));
/** Relative chromaticity tolerates illumination changes within the wrist;
 * luminance has a small weight. No fixed skin-tone threshold or ML claim. */
function feature(r: number, g: number, b: number) {
  const sum = Math.max(32, r + g + b);
  return [255 * r / sum, 255 * g / sum, 255 * b / sum, (.299 * r + .587 * g + .114 * b) * .15];
}
export function imageWristFrame(pose: WristPose, wrist?: { x: number; y: number }, scanAngle = 0) {
  const axis = widthAxis(pose), c = Math.cos(scanAngle), s = Math.sin(scanAngle);
  const transverse = { x: axis.x * c - axis.y * s, y: axis.x * s + axis.y * c }, along = { x: -transverse.y, y: transverse.x };
  const arm = rotate(pose.orientation, { x: 0, y: 0, z: 1 });
  const inferred = project(add(pose.center, mul(arm, -pose.palmLength * .25)), pose);
  const anchor = wrist ? { x: wrist.x, y: wrist.y * pose.aspect } : inferred;
  const span = pose.palmLength * pose.focal / pose.center.z;
  return { transverse, along, anchor, span };
}
export function wristImageRoi(pose: WristPose, imageWidth: number, imageHeight: number, wrist?: { x: number; y: number }) {
  const f = imageWristFrame(pose, wrist);
  // Keep enough native context for a bounded contour-based axis refinement;
  // a tightly cropped strip would incorrectly clip the rotated exterior collar.
  const corners = [-1.6, 1.6].flatMap(t => [-1.05, 1.5].map(a => ({ x: f.anchor.x + f.span * (f.transverse.x * t + f.along.x * a), y: f.anchor.y + f.span * (f.transverse.y * t + f.along.y * a) })));
  const x = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x)) * imageWidth)), y = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y)) * imageWidth));
  const right = Math.min(imageWidth, Math.ceil(Math.max(...corners.map(p => p.x)) * imageWidth)), bottom = Math.min(imageHeight, Math.ceil(Math.max(...corners.map(p => p.y)) * imageWidth));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), imageWidth, imageHeight };
}
// Observation only. Measurement has no authority to return or replace the
// tracked 3D position/quaternion, camera or any renderer/material settings.
export type ImageWristResult = { measurement: WidthMeasurement; mask: ImageMask | null };
/** Still-image branch only: native-pixel, foreground/background profiles from
 * both exterior collars. Multiple parallel sections must agree; ambiguity
 * rejects rather than turning a skin shadow into an automatic calibration. */
export function measureImageWrist(roi: NativeRoi, pose: WristPose, wrist?: { x: number; y: number }, refineAxis = true, scanAngle = 0, liveFastMask = false): ImageWristResult {
  const { imageWidth: W } = roi, f = imageWristFrame(pose, wrist, scanAngle), span = f.span * W;
  const point = (a: number, t: number): ImagePoint => ({ x: f.anchor.x + f.along.x * a * f.span + f.transverse.x * t / W, y: f.anchor.y + f.along.y * a * f.span + f.transverse.y * t / W });
  const { data: _pixels, ...bounds } = roi;
  const metadata: ImageMeasurementDebug = { imageWidth: W, imageHeight: roi.imageHeight, roi: bounds, axis: [point(-.1, 0), point(.65, 0)], cuts: [], method: 'foreground-profile', rejection: null, rejected: {}, separation: 0, angleCorrection: 0 };
  const slices: MeasurementSlice[] = [], backgrounds: number[][] = [];
  const fail = (reason: string): ImageWristResult => { metadata.rejection = reason; return { mask: null, measurement: { width: null, confidence: 0, reason, slices, image: metadata, analysisWidth: W } }; };
  const pixel = (p: ImagePoint): number[] | null => {
    const x = Math.round(p.x * W) - roi.x, y = Math.round(p.y * W) - roi.y;
    if (x < 0 || y < 0 || x >= roi.width || y >= roi.height) return null;
    const i = (y * roi.width + x) * 4;
    return feature(roi.data[i], roi.data[i + 1], roi.data[i + 2]);
  };
  if (!Number.isFinite(span) || span < 20) return fail('native-roi-too-small: vùng cổ tay không đủ pixel');
  type Candidate = { width: number; mid: ImagePoint; slice: MeasurementSlice; left: ImagePoint; right: ImagePoint; a: number; separation: number };
  const candidates: Candidate[] = [];
  const reject = (slice: MeasurementSlice, why: string) => { slice.reason = why; metadata.rejected[why] = (metadata.rejected[why] ?? 0) + 1; };
  for (let j = 0; j < 15; j++) {
    const a = .06 + j * .035, search = Math.ceil(span * 1.30);
    metadata.cuts.push([point(a, -search), point(a, search)]);
    const slice: MeasurementSlice = { center: point(a, 0), candidates: [], accepted: false, reason: '' }; slices.push(slice);
    const profile = Array.from({ length: 2 * search + 1 }, (_, i) => pixel(point(a, i - search)));
    const values = (start: number, end: number) => profile.slice(Math.round(start + search), Math.round(end + search)).filter((v): v is number[] => !!v);
    const core = values(-span * .09, span * .09), leftBg = values(-span * 1.25, -span * 1.08), rightBg = values(span * 1.08, span * 1.25);
    if (Math.min(core.length, leftBg.length, rightBg.length) < 4) { reject(slice, 'roi-clipped: thiếu nền ở hai bên'); continue; }
    const skin = prototype(core), bg = [prototype(leftBg), prototype(rightBg)];
    const noise = median([...leftBg.map(v => distance(v, bg[0])), ...rightBg.map(v => distance(v, bg[1]))]);
    const separation = Math.min(...bg.map(v => distance(v, skin)));
    metadata.separation = Math.max(metadata.separation, separation);
    if (separation < Math.max(8, noise * 4) || distance(bg[0], bg[1]) > separation * .7) { reject(slice, 'foreground-ambiguous: da/nền chưa tách rõ hoặc nền không đồng nhất'); continue; }
    const threshold = Math.max(5, noise * 3, separation * .24);
    const isBackground = (i: number) => { const v = profile[i + search]; return !!v && Math.min(...bg.map(b => distance(v, b))) < threshold; };
    const boundaries: number[] = [];
    for (const side of [-1, 1] as const) {
      // Start in verified skin core. An edge must lead into the observed
      // exterior background for a long interval, not into a local dark stripe.
      let edge: number | null = null;
      const run = Math.max(5, Math.round(span * .06));
      for (let d = Math.round(span * .13); d < span * 1.04; d++) {
        if (!isBackground(side * d)) continue;
        let outside = 0, inside = 0;
        for (let k = 1; k <= run; k++) { if (isBackground(side * (d + k))) outside++; if (!isBackground(side * (d - k))) inside++; }
        if (outside / run < .9 || inside / run < .75) continue;
        let reentry = 0, count = 0;
        for (let k = d + run; k <= span * 1.1; k += 2) { count++; if (!isBackground(side * k)) reentry++; }
        const p = point(a, side * d), rejected = count === 0 || reentry / count > .08;
        slice.candidates.push({ point: p, side, distancePx: d, quality: rejected ? 0 : 1, rejected, reason: rejected ? 'foreground-reentry' : 'silhouette' });
        if (!rejected) { edge = side * (d - .5); break; }
      }
      if (edge !== null) boundaries.push(edge);
    }
    if (boundaries.length !== 2) { reject(slice, 'no-persistent-pair: không có hai mép với nền liên tục'); continue; }
    const [l, r] = boundaries, width = r - l;
    const left = point(a, l), right = point(a, r); slice.left = left; slice.right = right;
    if (width < span * .3 || width > span * 1.9 || Math.abs(l + r) / width > .5) { reject(slice, 'implausible-pair: bề rộng/tâm biên không hợp lý'); continue; }
    backgrounds.push(...bg);
    candidates.push({ width, mid: point(a, (l + r) / 2), slice, left, right, a, separation });
  }
  if (candidates.length < 5) return fail('too-few-slices: cần ít nhất 5 đường cắt có hai biên đáng tin cậy');
  // Select the coherent window nearest the intended wear plane, avoiding
  // palm flare and unrelated objects elsewhere in the ROI.
  let best: Candidate[] = [];
  for (const c of candidates) {
    const group = candidates.filter(v => Math.abs(v.a - c.a) <= .11 && Math.abs(v.width / c.width - 1) < .12);
    if (group.length > best.length) best = group;
  }
  if (best.length < 5) return fail('inconsistent-contour: các đường cắt không thống nhất');
  const width = median(best.map(v => v.width));
  const chosen = [...best].sort((a, b) => Math.abs(a.a - .25) - Math.abs(b.a - .25))[0];
  const meanA = best.reduce((s, c) => s + c.a, 0) / best.length;
  const lateral = (c: Candidate) => ((c.mid.x - f.anchor.x) * f.transverse.x + (c.mid.y - f.anchor.y) * f.transverse.y) / f.span;
  const meanT = best.reduce((s, c) => s + lateral(c), 0) / best.length;
  const slope = best.reduce((s, c) => s + (c.a - meanA) * (lateral(c) - meanT), 0) / best.reduce((s, c) => s + (c.a - meanA) ** 2, 0);
  const centerResidual = Math.max(...best.map(c => Math.abs(lateral(c) - meanT - slope * (c.a - meanA)))) * span;
  const correction = Math.atan(-slope);
  if (centerResidual > Math.max(1.5, width * .035)) return fail('inconsistent-centerline: hai mép không tạo đường cổ tay liên tục');
  // Correct only observed in-plane direction, then MEASURE AGAIN on native
  // pixels perpendicular to that direction. Never multiply width by 1/cos.
  if (Math.abs(correction) > Math.PI / 90 && refineAxis && Math.abs(correction) <= Math.PI / 5) {
    const next = measureImageWrist(roi, pose, wrist, false, scanAngle + correction, liveFastMask);
    if (next.measurement.image) next.measurement.image.angleCorrection = correction * 180 / Math.PI;
    return next;
  }
  if (Math.abs(correction) > Math.PI / 12) return fail('oblique-axis: trục ảnh chưa khớp sau kiểm tra contour; cần chọn hai mép thủ công');
  for (const c of best) { c.slice.accepted = true; c.slice.reason = 'measured'; }
  const residual = Math.max(...best.map(c => Math.abs(c.width - width))) / width;
  if (residual > .12) return fail('contour-outlier: bề rộng bất thường');
  metadata.selected = [chosen.left, chosen.right];
  const measurement: WidthMeasurement = { width: chosen.width / W, rawWidth: chosen.width / W, sampleCenter: chosen.mid, left: chosen.left, right: chosen.right, confidence: Math.max(.65, 1 - residual * 2), reason: 'Đo silhouette trên ROI ảnh gốc', slices, sampleCount: best.length, spread: residual, image: metadata, analysisWidth: W };
  // A screen-space foreground mask limits depth-only geometry to observed
  // pixels. Outside this ROI no synthetic cylinder may occlude the photo.
  const step = Math.max(1, Math.ceil(Math.max(roi.width, roi.height) / 512)), mw = Math.ceil(roi.width / step), mh = Math.ceil(roi.height / step), data = new Uint8Array(mw * mh);
  const bgs = backgrounds, threshold = Math.max(5, median(best.map(c => c.separation)) * .24);
  const classify = liveFastMask ? liveForeground(bgs, threshold) : null;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const p = pixel({ x: (roi.x + Math.min(roi.width - 1, (x + .5) * roi.width / mw)) / W, y: (roi.y + Math.min(roi.height - 1, (y + .5) * roi.height / mh)) / W });
    data[y * mw + x] = classify ? classify(p) : p && Math.min(...bgs.map(b => distance(p, b))) > threshold ? 255 : 0;
  }
  fillMaskHoles(data, mw, mh);
  return { measurement, mask: { width: mw, height: mh, data, roi: { x: roi.x / W, y: roi.y / roi.imageHeight, width: roi.width / W, height: roi.height / roi.imageHeight } } };
}

/** Interior highlights are not holes in the skin. Fill background components
 * completely enclosed by foreground; keep exterior background connected. */
export function fillMaskHoles(data: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(data.length), queue = new Int32Array(data.length); let head = 0, tail = 0;
  const push = (i: number) => { if (!data[i] && !visited[i]) { visited[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x > 0) push(i - 1); if (x < width - 1) push(i + 1); if (y > 0) push(i - width); if (y < height - 1) push(i + width);
  }
  for (let i = 0; i < data.length; i++) if (!data[i] && !visited[i]) data[i] = 255;
}

/** The click segment is itself the observed width, never a hand-size prior. */
export function manualImageWrist(pose: WristPose, points: [ImagePoint, ImagePoint], image: { width: number; height: number }): ImageWristResult {
  const [left, right] = points, axis = widthAxis(pose), dx = right.x - left.x, dy = right.y - left.y, width = Math.hypot(dx, dy);
  const center = project(pose.center, pose), mid = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  let angle = Math.atan2(axis.x * dy - axis.y * dx, axis.x * dx + axis.y * dy);
  if (angle > Math.PI / 2) angle -= Math.PI; if (angle < -Math.PI / 2) angle += Math.PI;
  const inside = points.every(p => Number.isFinite(p.x + p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= image.height / image.width);
  const valid = inside && width * image.width >= 8 && Math.abs(angle) <= Math.PI / 4 && Math.hypot(mid.x - center.x, mid.y - center.y) < pose.palmLength * pose.focal / pose.center.z * .7;
  const reason = valid ? 'Đo thủ công hai mép ảnh gốc' : 'manual-pair-invalid: chọn hai mép cùng một đường ngang cổ tay (lệch trục tối đa 45°), gần vùng vòng';
  return { mask: null, measurement: { width: valid ? width : null, rawWidth: valid ? width : undefined, left, right, sampleCenter: mid, confidence: valid ? 1 : 0, reason, image: { imageWidth: image.width, imageHeight: image.height, roi: { x: 0, y: 0, width: image.width, height: image.height, imageWidth: image.width, imageHeight: image.height }, axis: [center, mid], cuts: [points], selected: valid ? points : undefined, method: 'manual-edges', rejection: valid ? null : reason, rejected: {}, separation: 0, angleCorrection: valid ? angle * 180 / Math.PI : 0 } } };
}
