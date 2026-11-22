import assert from 'node:assert/strict';
import { analyzeWrist, length, cross, dot, rotate, quaternionAngle } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';
import { test } from 'node:test';
import { WristFilter } from '../services/tracking/WristFilter';
import { isFrameUsable } from '../services/tracking/trackingPolicy';
const analysis = (opts = {}) => {
  const f = handFixture(opts);
  return analyzeWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' });
};

test('Phân biệt dữ liệu thiếu, fit lỗi, hướng camera và khuỷu tay thiếu bằng lý do thực', () => {
  assert.equal(analyzeWrist([], [], .75).reason, 'no-hand');
  const partial = handFixture(); partial.points.length = 17; // Thiếu MCP17 bắt buộc, không phải đầu ngón không sử dụng.
  assert.equal(analyzeWrist(partial.points, partial.world, partial.aspect).reason, 'invalid-data');
  const f = handFixture();
  assert.equal(analyzeWrist(f.points, f.world, f.aspect).reason, 'no-forearm');
  const bad = handFixture(); bad.points[9].x += .3;
  assert.equal(analyzeWrist(bad.points, bad.world, bad.aspect, '', { mode: 'straight-wrist' }).reason, 'fit');
  assert.equal(analysis({ tilt: 1.1 }).reason, 'axial-view');
  const good = analysis();
  assert.equal(good.reason, 'ok'); assert.ok(good.metrics.fitResidual! < 1e-6);
  assert.ok(good.metrics.imageScale! > 0); assert.ok(good.metrics.basisCondition! > .9);
});

test('Mặt phẳng vòng trực giao với cẳng tay, basis thuận tay và chuẩn hóa ở mọi góc hỗ trợ', () => {
  for (const mirror of [false, true]) for (const roll of [0, .7, Math.PI / 2]) for (const twist of [0, .7, Math.PI / 2, Math.PI]) {
    const { pose } = analysis({ mirror, roll, twist }); assert.ok(pose);
    const u = rotate(pose.orientation, { x: 1, y: 0, z: 0 });
    const v = rotate(pose.orientation, { x: 0, y: 1, z: 0 });
    const z = rotate(pose.orientation, { x: 0, y: 0, z: 1 });
    assert.ok(Math.abs(dot(u, z)) < 1e-7 && Math.abs(dot(v, z)) < 1e-7);
    assert.ok(Math.abs(length(u) - 1) < 1e-7 && dot(cross(u, v), z) > .999999);
  }
});

test('Basis lật nửa vòng đối xứng không gây mất tracking hoặc xoay 180°', () => {
  const initial = analysis().pose!;
  const q = initial.orientation;
  const flipped = { ...initial, orientation: { x: q.y, y: -q.x, z: q.w, w: -q.z } };
  const filter = new WristFilter(); filter.update(initial, 1000);
  const result = filter.update(flipped, 1033); assert.ok(result);
  assert.ok(quaternionAngle(result.orientation, initial.orientation) < 1e-6);
});

test('Đổi danh tính tay ở vị trí giống nhau cần ba mẫu nhất quán, không blend qua tay cũ', () => {
  const pose = analysis().pose!, next = { ...pose, handedness: 'Left' };
  const filter = new WristFilter(); filter.update(pose, 1000);
  assert.equal(filter.update(next, 1033), null);
  assert.equal(filter.update(next, 1066), null);
  assert.equal(filter.update(next, 1099)?.handedness, 'Left');
});

test('Frame xử lý 650ms vẫn dùng được với ảnh đồng bộ; worker treo và frame quá cũ bị loại', () => {
  assert.equal(isFrameUsable(1000, 1650, 1651), true);
  assert.equal(isFrameUsable(1000, 1650, 2050), false); // Khung chụp cũ hơn một giây.
  assert.equal(isFrameUsable(1000, 1100, 1601), false); // Không có kết quả mới trong 501ms.
  assert.equal(isFrameUsable(0, 0, 10), false);
  assert.equal(isFrameUsable(1000, 990, 1010), false);
});
