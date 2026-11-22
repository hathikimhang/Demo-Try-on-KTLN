import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shirtPlacement, smoothPoints } from './geometry';
import type { Point } from './types';
test('Áo dùng vai và hông, từ chối landmark bị che hoặc thiếu', () => {
  const p: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.9 }));
  p[11] = { x: 200, y: 100, visibility: 0.9 }; p[12] = { x: 100, y: 100, visibility: 0.9 };
  p[23] = { x: 180, y: 260, visibility: 0.9 }; p[24] = { x: 120, y: 260, visibility: 0.9 };
  const a = shirtPlacement(p)!; assert.equal(a.x, 150); assert.equal(a.angle, 0); assert.equal(a.width, 170);
  p[11].y = 120; assert.ok(shirtPlacement(p)!.angle > 0);
  p[24].visibility = 0.1; assert.equal(shirtPlacement(p), null);
  assert.equal(shirtPlacement([]), null);
});
test('Bộ lọc làm mượt không giữ lại landmark khi mất nhận diện', () => {
  assert.deepEqual(smoothPoints([{ x: 1, y: 1 }], []), []);
  const result = smoothPoints([{ x: 0, y: 0 }], [{ x: 100, y: 100 }]);
  assert.equal(result[0].x, 65);
});
