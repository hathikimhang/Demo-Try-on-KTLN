import type { SkinSegmentation } from './types';
import type { NativeRoi, ImagePoint, ImageMeasurementDebug, ImageMask } from './imageCoordinates';
import { imageWristFrame, type ImageWristResult } from './imageWristMeasurement';
import type { WristPose } from './wristGeometry';
import type { MeasurementSlice } from './braceletSizing';

const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
/** A probability in image-width coordinates. The segmentation was inferred on
 * the entire image, never an unrelated crop; its resize changes resolution only. */
export function skinProbability(skin: SkinSegmentation, p: ImagePoint, aspect: number) {
  const x = p.x * skin.width - .5, y = p.y / aspect * skin.height - .5;
  if (x < 0 || y < 0 || x > skin.width - 1 || y > skin.height - 1) return 0;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (a: number, b: number) => skin.confidence[Math.min(skin.height - 1, b) * skin.width + Math.min(skin.width - 1, a)];
  const value = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Skin probabilities guide candidate selection; native RGB checks determine
 * edge locations. Face/clothes on opposite sides need not share a background
 * color. A rejected measurement cannot return a different 3D pose. */
export function measureSegmentedWrist(roi: NativeRoi, pose: WristPose, skin: SkinSegmentation, wrist?: { x: number; y: number }): ImageWristResult {
  const W = roi.imageWidth, aspect = roi.imageHeight / W, f = imageWristFrame(pose, wrist), span = f.span * W;
  const { data: _pixels, ...bounds } = roi;
  const point = (a: number, t: number) => ({ x: f.anchor.x + (f.along.x * a * span + f.transverse.x * t) / W, y: f.anchor.y + (f.along.y * a * span + f.transverse.y * t) / W });
  const debug: ImageMeasurementDebug = { imageWidth: W, imageHeight: roi.imageHeight, roi: bounds, axis: [point(-.1, 0), point(.65, 0)], cuts: [], method: 'semantic-body', rejection: null, rejected: {}, separation: 0, angleCorrection: 0 };
  const slices: MeasurementSlice[] = [];
  let mask: ImageMask | null = null;
  const fail = (reason: string): ImageWristResult => {
    debug.rejection = reason;
    for (const s of slices) if (!s.reason) { s.reason = reason; debug.rejected[reason] = (debug.rejected[reason] ?? 0) + 1; }
    return { mask, measurement: { width: null, confidence: 0, reason, slices, image: debug, analysisWidth: W } };
  };
  if (skin.confidence.length !== skin.width * skin.height || !skin.width || !skin.height || !Number.isFinite(span) || span < 20) return fail('segmentation-invalid: không có dữ liệu mask phù hợp');
  const prob = (p: ImagePoint) => skinProbability(skin, p, aspect);
  const rgb = (p: ImagePoint) => {
    const x = Math.round(p.x * W) - roi.x, y = Math.round(p.y * W) - roi.y;
    if (x < 0 || y < 0 || x >= roi.width || y >= roi.height) return null;
    const i = (y * roi.width + x) * 4, r = roi.data[i], g = roi.data[i + 1], b = roi.data[i + 2], sum = Math.max(32, r + g + b);
    return [r / sum * 255, g / sum * 255, b / sum * 255, (.299 * r + .587 * g + .114 * b) * .15];
  };
  // Occlusion evidence is separate from sizing success. Require observed skin
  // at the band region; never fall back to an unrestricted synthetic cylinder.
  const center = point(.25, 0);
  if (prob(center) > .75) {
    const factor = Math.max(1, Math.ceil(Math.max(roi.width, roi.height) / 512));
    const width = Math.ceil(roi.width / factor), height = Math.ceil(roi.height / factor), data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = { x: (roi.x + (x + .5) * roi.width / width) / W, y: (roi.y + (y + .5) * roi.height / height) / W };
      // Conservatively include only confident body skin. Do not treat a face
      // or a sleeve behind the wrist as the same depth surface.
      data[y * width + x] = Math.round(Math.max(0, Math.min(1, (prob(p) - .35) / .3)) * 255);
    }
    mask = { width, height, data, roi: { x: roi.x / W, y: roi.y / roi.imageHeight, width: roi.width / W, height: roi.height / roi.imageHeight } };
  }
  type Candidate = { a: number; width: number; center: ImagePoint; left: ImagePoint; right: ImagePoint; core: number; edge: number; slice: MeasurementSlice };
  const candidates: Candidate[] = [];
  const reject = (s: MeasurementSlice, reason: string) => { s.reason = reason; debug.rejected[reason] = (debug.rejected[reason] ?? 0) + 1; };
  // The effective model input is 256px. Native refinement must remain inside
  // the observed probability transition, not jump to an unrelated skin stripe.
  const refinement = Math.max(3, Math.ceil(Math.max(roi.imageWidth, roi.imageHeight) / 256 * 2));
  for (let j = 0; j < 15; j++) {
    const a = .06 + .035 * j, search = Math.ceil(span * 1.3), at = (t: number) => point(a, t);
    debug.cuts.push([at(-search), at(search)]);
    const slice: MeasurementSlice = { center: at(0), candidates: [], accepted: false, reason: '' }; slices.push(slice);
    const core = [-.06, -.03, 0, .03, .06].map(v => prob(at(v * span)));
    if (Math.min(...core) < .75) { reject(slice, 'skin-core-uncertain: tâm lát cắt không đủ tin cậy là da tay'); continue; }
    const edges: { distance: number; quality: number }[] = [];
    for (const side of [-1, 1] as const) {
      let edge: number | null = null;
      for (let d = Math.ceil(span * .13); d < search - refinement; d++) {
        const here = prob(at(side * d));
        if (here > .5) continue;
        const outside = [1, 2, 3].map(k => prob(at(side * (d + k * refinement))));
        if (Math.max(...outside) > .35) continue;
        edge = d; break;
      }
      if (edge === null) continue;
      let best: { distance: number; score: number; quality: number } | null = null;
      for (let d = Math.max(span * .12, edge - refinement); d <= edge + refinement; d++) {
        const p = at(side * d), confidence = prob(p);
        if (confidence < .25 || confidence > .75) continue;
        const inside = rgb(at(side * (d - 2))), outside = rgb(at(side * (d + 2)));
        if (!inside || !outside) continue;
        const gradient = Math.hypot(...inside.map((v, k) => v - outside[k]));
        const signed = prob(at(side * (d - refinement))) - prob(at(side * (d + refinement)));
        const quality = Math.min(1, gradient / 8) * Math.min(1, signed / .5);
        const score = gradient * Math.exp(-Math.abs(confidence - .5) * 3);
        const rejected = gradient < 2.5 || signed < .25;
        slice.candidates.push({ point: p, side, distancePx: d, quality, rejected, reason: rejected ? 'native-edge-weak: RGB/semantic không cùng xác nhận biên' : 'semantic-native-edge' });
        if (!rejected && (!best || score > best.score)) best = { distance: d, score, quality };
      }
      if (best) edges.push(best);
    }
    if (edges.length !== 2) { reject(slice, 'no-native-pair: không có đủ hai biên RGB được segmentation xác nhận'); continue; }
    const [leftEdge, rightEdge] = edges, width = leftEdge.distance + rightEdge.distance;
    slice.left = at(-leftEdge.distance); slice.right = at(rightEdge.distance);
    if (width < span * .3 || width > span * 1.9 || Math.abs(leftEdge.distance - rightEdge.distance) / width > .5) { reject(slice, 'implausible-pair: tâm/bề rộng không hợp lý'); continue; }
    candidates.push({ a, width, center: at((rightEdge.distance - leftEdge.distance) / 2), left: slice.left, right: slice.right, core: Math.min(...core), edge: Math.min(leftEdge.quality, rightEdge.quality), slice });
  }
  if (candidates.length < 5) return fail('too-few-slices: chưa đủ 5 lát cắt được cả segmentation và pixel gốc xác nhận');
  const nominal = median(candidates.map(c => c.width));
  const valid = candidates.filter(c => Math.abs(c.width / nominal - 1) < .12);
  for (const c of candidates) if (!valid.includes(c)) reject(c.slice, 'contour-width-outlier: độ rộng khác nhóm biên nhất quán');
  if (valid.length < 5) return fail('inconsistent-contour: các cặp biên không thống nhất');
  const meanA = valid.reduce((s, c) => s + c.a, 0) / valid.length;
  const lateral = (c: Candidate) => (c.center.x - f.anchor.x) * f.transverse.x + (c.center.y - f.anchor.y) * f.transverse.y;
  const meanT = valid.reduce((s, c) => s + lateral(c), 0) / valid.length;
  const slope = valid.reduce((s, c) => s + (c.a - meanA) * (lateral(c) - meanT), 0) / valid.reduce((s, c) => s + (c.a - meanA) ** 2, 0);
  const residual = Math.max(...valid.map(c => Math.abs(lateral(c) - meanT - slope * (c.a - meanA)))) * W;
  if (residual > Math.max(2, nominal * .04)) return fail('inconsistent-centerline: biên không tạo vùng cổ tay liên tục');
  const selected = [...valid].sort((a, b) => Math.abs(a.a - .25) - Math.abs(b.a - .25))[0];
  const spread = Math.max(...valid.map(c => Math.abs(c.width / nominal - 1)));
  const confidence = Math.min(1, .45 + .4 * selected.core + .15 * selected.edge - spread * 2);
  if (confidence < .75) return fail('semantic-quality-low: chất lượng cặp biên chưa đủ để Auto Fit');
  for (const c of valid) { c.slice.accepted = true; c.slice.reason = 'measured'; }
  debug.selected = [selected.left, selected.right];
  return { mask, measurement: { width: selected.width / W, rawWidth: selected.width / W, left: selected.left, right: selected.right, sampleCenter: selected.center, confidence, reason: 'Biên da tay được segmentation và pixel ảnh gốc xác nhận', slices, image: debug, sampleCount: valid.length, spread, analysisWidth: W } };
}
