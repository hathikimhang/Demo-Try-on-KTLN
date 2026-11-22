import type { Point } from './types';
export type Placement = { x: number; y: number; width: number; height: number; angle: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function shirtPlacement(p: Point[]): Placement | null {
  if (p.length < 25 || [11, 12, 23, 24].some(i => (p[i].visibility ?? 1) < 0.45)) return null;
  const a = p[11], b = p[12];
  const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a;
  const shoulder = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const hip = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
  const width = distance(a, b);
  if (width < 12 || distance(shoulder, hip) < 12) return null;
  return { ...shoulder, width: width * 1.7, height: distance(shoulder, hip) * 1.08, angle: Math.atan2(right.y - left.y, right.x - left.x) };
}
export function smoothPoints(previous: Point[], next: Point[]): Point[] {
  if (previous.length !== next.length) return next;
  return next.map((p, i) => ({ ...p, x: previous[i].x * 0.35 + p.x * 0.65, y: previous[i].y * 0.35 + p.y * 0.65 }));
}
