import { add, clamp, dot, mul, project, rotate } from '../geometry/wristGeometry';
import type { WristPose } from '../../models/wrist.types';
import type { WidthMeasurement, MeasurementSlice, MeasurementPoint, EdgeCandidate } from '../../models/fitting.types';
import { widthAxis } from '../fitting/braceletSizing';
/** Phân tích biên nhiều lát cắt, khởi tạo luminance/chroma tại Hand[0], không lấy bounding box bàn tay hoặc ngưỡng màu da cố định. Bề rộng quy về mặt phẳng đeo; biên yếu/mơ hồ bị loại. */
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
  // Lấy mẫu phía cẳng tay gần mặt phẳng đeo tính từ Hand[0]; lát cắt ngay
  // Hand[0] hoặc phía xa có thể đi qua lòng bàn tay loe thay vì cổ tay.
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
        // Bóng/texture không kết thúc toàn bộ phép quét; chỉ chấp nhận
        // khi vùng ngoài liên tục và phần trong nhất quán cùng xác nhận.
        if (contrast < Math.max(6, noise * 2 + 4) || innerDistance > tolerance + 3 || outerDistance < tolerance || outerDistance < innerDistance + 5 || covered / total < .80) continue;
        if (outside.filter(v => distance(v!, seed) > tolerance).length < 3) continue;
        const quality = clamp(.48 + Math.min(.26, contrast / 100) + (covered / total - .8) * .7 - noise / 80, 0, 1);
        // Sọc tối ngắn có thể qua kiểm tra ngoài bốn pixel. Silhouette thật
        // không nên quay lại màu lõi ngay sau biên; chủ động loại
        // foreground re-entry, không coi nền mơ hồ là số đo kích thước.
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
      // Nonmaximum suppression tránh để các pixel cạnh nhau lấp hết danh sách
      // ứng viên, khiến biên silhouette độc lập không được xét.
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
    // Quy lát cắt gần cổ tay về mặt phẳng đeo theo tia nhìn;
    // chỉ sửa foreshortening/khoảng cách, không dùng pixel như đơn vị 3D.
    const sampleCenter = { x: cx / W, y: cy / W };
    const ray = { x: (sampleCenter.x - .5) / pose.focal, y: (sampleCenter.y - pose.aspect / 2) / pose.focal, z: 1 };
    const d = dot(ray, ray), b = dot(arm, ray), denominator = d - b * b;
    if (denominator < 1e-5) continue;
    const t = (b * dot(pose.center, ray) - d * dot(arm, pose.center)) / denominator;
    const samplePose = { ...pose, center: add(pose.center, mul(arm, t)) };
    // Chuyển bề rộng pixel theo depth đúng một lần. Không bù radius/oval/view
    // ở bước này rồi lại đảo phép chiếu ellipse lần thứ hai.
    const depthRatio = samplePose.center.z / pose.center.z;
    if (depthRatio < .75 || depthRatio > 1.33) continue;
    const width = pair.width / W * depthRatio;
    if (!Number.isFinite(width) || width <= 0) continue;
    slices.push({ width, rawWidth: pair.width / W, center: sampleCenter, quality: pair.quality, contrast: pair.contrast, debug, leftDistance: -pair.left.distance, rightDistance: pair.right.distance, along: along * handSpan });
  }
  if (slices.length < 3) return reject('Chưa thấy đủ hai biên cổ tay; đổi nền/ánh sáng hoặc dùng Manual Calibration');
  // Bề rộng giống nhau chưa xác nhận được biên: texture trái/phải xen kẽ
  // có thể cùng bề rộng. Cả hai contour phải tạo đường bao cục bộ mượt.
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
  // Cổ tay thuôn mượt có thể đổi bề rộng giữa các lát cắt; chấm điểm
  // độ lệch so với contour mượt thay vì coi độ thuôn tự nhiên là nhiễu.
  const confidence = clamp(median(cluster.map(s => s.quality)) + Math.min(.1, (cluster.length - 3) * .025) - contourResidual * 1.5, 0, 1);
  for (const s of slices) {
    s.debug.accepted = confidence >= .65 && cluster.includes(s);
    s.debug.reason = s.debug.accepted ? 'Hai mép qua kiểm tra hình dạng' : 'Lát cắt không nhất quán hoặc chất lượng thấp';
    for (const c of s.debug.candidates) if (c.point === s.debug.left || c.point === s.debug.right) { c.rejected = !s.debug.accepted; c.reason = s.debug.reason; }
  }
  return { width, rawWidth: chosen.rawWidth, sampleCenter: chosen.center, left: chosen.debug.left, right: chosen.debug.right, slices: diagnostics, analysisWidth: W, confidence, sampleCount: cluster.length, spread, contourResidual, contrast: median(cluster.map(s => s.contrast)), reason: 'Đo biên cổ tay nhiều lát cắt, quy về mặt phẳng đeo vòng' };
}

const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
