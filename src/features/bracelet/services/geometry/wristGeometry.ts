import type { V3, Quaternion, WristOptions, WristAnalysis, WristMetrics, WristReason, WristPose, InputWristAnalysis } from '../../models/wrist.types';
import type { Point } from '../../../../shared/types/vision';
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

export function analyzeWrist(points: Point[], world: Point[], aspect: number, handedness = '', options: WristOptions = {}): WristAnalysis {
  const metrics: WristMetrics = {};
  const reject = (reason: WristReason): WristAnalysis => ({ pose: null, reason, metrics });
  if (!points.length) return reject('no-hand');
  if (!Number.isFinite(aspect) || aspect <= 0) return reject('invalid-data');
  const ids = [0, 5, 9, 13, 17];
  if (ids.some(i => !finite(points[i]) || !finite(world[i]))) return reject('invalid-data');
  // Fit cổ tay không dùng ngón tay nhưng cần các mốc lòng bàn tay nhìn thấy;
  // MCP ngoại suy ngoài ảnh phải được thay bằng ROI tracking có kiểm chứng.
  if (ids.some(i => points[i].x < .01 || points[i].x > .99 || points[i].y < .01 || points[i].y > .99)) return reject('cropped');
  const p = points.map(p => ({ x: p.x, y: p.y * aspect, z: p.z ?? 0 }));
  const w = world.map(p => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
  const wrist = p[0];
  if (points[0].x < 0.025 || points[0].x > 0.975 || points[0].y < 0.025 || points[0].y > 0.975) return reject('cropped');
  // Biến đổi đồng dạng bình phương tối thiểu khớp world XY với image XY.
  // Một góc xoay và scale đều giữ tỷ lệ bàn tay 3D, tránh trộn các hệ
  // normalized/world không tương ứng thành một basis bị shear ở mỗi frame.
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
  // Ước lượng scale khoảng cách từ nhiều cặp mốc chiếu lên ảnh; bỏ cặp
  // hướng vào camera vì chia cho chiều dài XY rất nhỏ sẽ khuếch đại nhiễu.
  // Vẫn giữ bề rộng world 3D để lòng bàn tay nhìn cạnh không làm
  // cổ tay co theo khoảng cách MCP 2D đã bị foreshortening.
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
  // Hỗ trợ xoay quanh cẳng tay thẳng, kể cả nhìn cạnh lòng bàn tay,
  // khi world landmark còn dùng được. Góc dọc trục/suy biến bị loại phía trên;
  // không chia size cho palm normal hoặc cos của góc nhìn.
  const offset = palmLength * 0.25;
  const focal = 1.35 * Math.max(1, aspect);
  const center = add({ x: wrist.x - 0.5, y: wrist.y - aspect / 2, z: focal }, mul(axis, offset));
  // Dùng tia nhìn thực qua cổ tay lệch tâm, không dùng trục Z toàn cục.
  metrics.viewAlignment = Math.abs(dot(axis, unit(center)));
  // Live chỉ được hoãn gate trục Hand này tới khi có trục cẳng tay quan sát
  // độc lập; mặc định và Upload vẫn giữ hành vi cũ.
  if (!options.deferAxialCheck && metrics.viewAlignment > (mode === 'forearm' ? 0.86 : 0.72)) return reject('axial-view');
  // Anatomical prior KHÔNG phải phép đo cổ tay tuyệt đối. MCP 5/17 là
  // khoảng cách tâm xương, không phải bề rộng da; kết hợp với giới hạn
  // chiều dài cổ tay → MCP. Thanh fit chỉ hiệu chỉnh ước lượng này bằng mắt.
  const radius = clamp(breadth * 0.44, palmLength * 0.32, palmLength * 0.52);
  const projection = project(center, { focal, aspect });
  if (projection.x - radius * 1.5 < 0 || projection.x + radius * 1.5 > 1 || projection.y - radius * 1.5 < 0 || projection.y + radius * 1.5 > aspect) return reject('bounds');
  return { pose: { center, orientation: fromBasis(u, v, axis), radius, palmLength, distanceScale: length(local[9]), focal, aspect, handedness, source: mode }, reason: 'ok', metrics };
}


export function estimateWrist(points: Point[], world: Point[], aspect: number, handedness = '', options: WristOptions = {}): WristPose | null {
  return analyzeWrist(points, world, aspect, handedness, options).pose;
}

/** Ảnh Upload có thể thiếu khuỷu tay. Chỉ thử lại khi Pose thiếu hoặc không ghép đúng; cả hai lần vẫn giữ các gate Hand/hình học. Worker echo chế độ yêu cầu, không phải chế độ fallback. */
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
