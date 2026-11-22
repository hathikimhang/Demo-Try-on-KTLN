import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handFixture } from './testing/wristFixtures';
import { estimateWrist, rotate, unit, dot, type V3 } from './wristGeometry';
import type { Point } from './types';

function armFixture(direction: V3 = { x: 0, y: 0.24, z: 0 }) {
  const hand = handFixture({ y: 0.30 });
  const armPoints: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const armWorldPoints: Point[] = armPoints.map(p => ({ ...p }));
  armPoints[15] = { ...hand.points[0], visibility: 0.95 };
  armPoints[13] = { x: hand.points[0].x + direction.x * 2, y: hand.points[0].y + direction.y * 2 / hand.aspect, z: 0, visibility: 0.95 };
  // Different world origins must not be mixed. Only elbow-wrist vectors align.
  armWorldPoints[15] = { x: 0.12, y: 0.05, z: 0.15, visibility: 0.95 };
  armWorldPoints[13] = { x: 0.12 + direction.x, y: 0.05 + direction.y, z: 0.15 + direction.z, visibility: 0.95 };
  return { ...hand, armPoints, armWorldPoints };
}
test('Chế độ tự động không tự suy ra cẳng tay khi thiếu khuỷu tay', () => {
  const f = handFixture();
  assert.equal(estimateWrist(f.points, f.world, f.aspect), null);
  assert.ok(estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' }));
});
test('Trục vòng theo cẳng tay thực, không theo lòng bàn tay khi hai hướng khác nhau', () => {
  const direction = { x: 0.13, y: 0.22, z: 0.08 }, f = armFixture(direction);
  const pose = estimateWrist(f.points, f.world, f.aspect, '', f); assert.ok(pose);
  assert.equal(pose.source, 'forearm');
  assert.ok(dot(rotate(pose.orientation, { x: 0, y: 0, z: 1 }), unit(direction)) > 0.999);
});
test('Không ghép nhầm tay hoặc dùng khuỷu tay không nhìn rõ', () => {
  const f = armFixture();
  f.armPoints[15].x += 0.3;
  assert.equal(estimateWrist(f.points, f.world, f.aspect, '', f), null);
  const low = armFixture(); low.armPoints[13].visibility = 0.3;
  assert.equal(estimateWrist(low.points, low.world, low.aspect, '', low), null);
  const cropped = armFixture(); cropped.armPoints[13].y = 1.1;
  assert.equal(estimateWrist(cropped.points, cropped.world, cropped.aspect, '', cropped), null);
  const ambiguous = armFixture(); ambiguous.armPoints[16] = { ...ambiguous.armPoints[15] }; ambiguous.armPoints[14] = { ...ambiguous.armPoints[13] };
  ambiguous.armWorldPoints[16] = { ...ambiguous.armWorldPoints[15] }; ambiguous.armWorldPoints[14] = { ...ambiguous.armWorldPoints[13] };
  assert.equal(estimateWrist(ambiguous.points, ambiguous.world, ambiguous.aspect, '', ambiguous), null);
});
test('Cận cảnh: từ chối hướng cẳng tay gần trục camera', () => {
  for (const opts of [{ tilt: 1.1 }, { tilt: 1.45 }]) {
    const f = handFixture(opts);
    assert.equal(estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' }), null);
  }
});
