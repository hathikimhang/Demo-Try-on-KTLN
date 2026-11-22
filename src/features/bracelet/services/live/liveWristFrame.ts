import { length, unit, clamp, dot, cross, mul, rotate, sub, add } from '../geometry/wristGeometry';
import type { V3, Quaternion, WristPose } from '../../models/wrist.types';
const valid = (v: V3) => [v.x, v.y, v.z].every(Number.isFinite) && length(v) > 1e-8;

export function normalized(v: V3): V3 | null { return valid(v) ? unit(v) : null; }

export function axisAngle(a: V3, b: V3) { return Math.acos(clamp(dot(unit(a), unit(b)), -1, 1)); }


/** Các cột basis là X, Y, Z của vòng trong hệ CV phải/xuống/ra xa. Thứ tự tích có hướng bảo đảm X × Y = Z và determinant +1. */
export function wristFrame(axis: V3, across: V3, previous?: Quaternion) {
  const z = normalized(axis); if (!z || !valid(across)) return null;
  let transverse = sub(across, mul(z, dot(across, z)));
  const condition = length(transverse) / length(across);
  let transported = false;
  if (condition < .25) {
    if (!previous) return null;
    const old = rotate(previous, { x: 1, y: 0, z: 0 });
    transverse = sub(old, mul(z, dot(old, z))); transported = true;
    if (length(transverse) < .25) return null;
  }
  let x = unit(transverse);
  if (previous && dot(x, rotate(previous, { x: 1, y: 0, z: 0 })) < 0) x = mul(x, -1); // Lumière local-Z pi symmetry
  const y = unit(cross(z, x)); x = unit(cross(y, z));
  const trace = x.x + y.y + z.z; let q: Quaternion;
  if (trace > 0) { const s = 2 * Math.sqrt(1 + trace); q = { x: (y.z - z.y) / s, y: (z.x - x.z) / s, z: (x.y - y.x) / s, w: s / 4 }; }
  else if (x.x > y.y && x.x > z.z) { const s = 2 * Math.sqrt(1 + x.x - y.y - z.z); q = { x: s / 4, y: (y.x + x.y) / s, z: (z.x + x.z) / s, w: (y.z - z.y) / s }; }
  else if (y.y > z.z) { const s = 2 * Math.sqrt(1 + y.y - x.x - z.z); q = { x: (y.x + x.y) / s, y: s / 4, z: (z.y + y.z) / s, w: (z.x - x.z) / s }; }
  else { const s = 2 * Math.sqrt(1 + z.z - x.x - y.y); q = { x: (z.x + x.z) / s, y: (z.y + y.z) / s, z: s / 4, w: (x.y - y.x) / s }; }
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  const sign = previous && dot(previous, q) + previous.w * q.w < 0 ? -1 : 1;
  q = { x: q.x / n * sign, y: q.y / n * sign, z: q.z / n * sign, w: q.w / n * sign };
  return { orientation: q, x, y, z, condition, transported };
}


/** Suy hướng 3D từ hướng ảnh với giả định depth TƯỜNG MINH: d_xy tỷ lệ với a_xy − C_xy*a_z/C_z. Không chia cos(view), không đổi focal hay đơn vị scene. */
export function axisFromScreen(direction: { x: number; y: number }, az: number, center: V3) {
  const size = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(size + az + center.z) || size < 1e-8 || Math.abs(az) >= .9 || center.z <= .02) return null;
  const d = { x: direction.x / size, y: direction.y / size }, bx = center.x / center.z * az, by = center.y / center.z * az;
  const b = bx * d.x + by * d.y, discriminant = b * b + 1 - az * az - bx * bx - by * by;
  if (discriminant <= 0) return null;
  const t = -b + Math.sqrt(discriminant); if (t <= 0) return null;
  return normalized({ x: bx + d.x * t, y: by + d.y * t, z: az });
}


export function wristAnchor(pose: WristPose) {
  return sub(pose.center, mul(rotate(pose.orientation, { x: 0, y: 0, z: 1 }), pose.palmLength * .25));
}

export function placeOnForearm(hand: WristPose, axis: V3, orientation: Quaternion): WristPose {
  return { ...hand, center: add(wristAnchor(hand), mul(axis, hand.palmLength * .25)), orientation };
}


/** Tách swing theo hướng cẳng tay và twist theo roll để roll thiếu chắc chắn không kéo mặt phẳng vòng sang trục khác khi smoothing quaternion. */
export function filterWristOrientation(before: Quaternion, target: Quaternion, swingAlpha: number, twistAlpha: number) {
  const a = rotate(before, { x: 0, y: 0, z: 1 }), b = rotate(target, { x: 0, y: 0, z: 1 });
  const angle = axisAngle(a, b), t = angle > 1e-8 ? Math.max(swingAlpha, 1 - .08 / angle) : 1;
  let z: V3;
  if (angle < 1e-6) z = b;
  else if (angle > Math.PI - .001) return null;
  else z = unit(add(mul(a, Math.sin((1 - t) * angle) / Math.sin(angle)), mul(b, Math.sin(t * angle) / Math.sin(angle))));
  const c = cross(a, z), w = 1 + dot(a, z), n = Math.hypot(c.x, c.y, c.z, w);
  if (n < 1e-8) return null;
  const transported = rotate({ x: c.x / n, y: c.y / n, z: c.z / n, w: w / n }, rotate(before, { x: 1, y: 0, z: 0 }));
  const raw = rotate(target, { x: 1, y: 0, z: 0 }), observed = normalized(sub(raw, mul(z, dot(raw, z))));
  if (!observed) return null;
  let twist = Math.atan2(dot(cross(transported, observed), z), dot(transported, observed));
  if (twist > Math.PI / 2) twist -= Math.PI; else if (twist < -Math.PI / 2) twist += Math.PI;
  const f = Math.max(twistAlpha, Math.abs(twist) > .15 ? 1 - .15 / Math.abs(twist) : 0), turn = twist * f;
  const x = add(mul(transported, Math.cos(turn)), mul(cross(z, transported), Math.sin(turn)));
  return wristFrame(z, x, before)?.orientation ?? null;
}
