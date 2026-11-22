import type { V3 } from '../wristGeometry';
// Deterministic geometry fixtures, never used by the app's inference pipeline.
export function handFixture({ x = 0.5, y = 0.45, scale = 2, roll = 0, tilt = 0, twist = 0, aspect = 0.75, mirror = false } = {}) {
  const rotatePoint = (p: V3): V3 => {
    if (mirror) p = { ...p, x: -p.x };
    const a = { x: p.x * Math.cos(twist) + p.z * Math.sin(twist), y: p.y, z: -p.x * Math.sin(twist) + p.z * Math.cos(twist) };
    const b = { x: a.x, y: a.y * Math.cos(tilt) - a.z * Math.sin(tilt), z: a.y * Math.sin(tilt) + a.z * Math.cos(tilt) };
    return { x: b.x * Math.cos(roll) - b.y * Math.sin(roll), y: b.x * Math.sin(roll) + b.y * Math.cos(roll), z: b.z };
  };
  const world = Array.from({ length: 21 }, (_, i) => rotatePoint({ x: (i % 4 - 1.5) * 0.01, y: -0.1, z: 0 }));
  for (const [i, p] of [[0, [0, 0, 0]], [5, [-0.032, -0.065, 0]], [9, [-0.008, -0.082, 0.001]], [13, [0.014, -0.074, 0.002]], [17, [0.035, -0.060, 0]]] as [number, number[]][]) world[i] = rotatePoint({ x: p[0], y: p[1], z: p[2] });
  const points = world.map(p => ({ x: x + p.x * scale, y: y + p.y * scale / aspect, z: p.z * scale }));
  return { points, world, aspect };
}
