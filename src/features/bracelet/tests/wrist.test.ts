import assert from 'node:assert/strict';
import { handFixture as fixture } from './fixtures/wristFixtures';
import { estimateWrist, project, rotate, quaternionAngle, sub, length } from '../services/geometry/wristGeometry';
import { test } from 'node:test';
import { WristFilter } from '../services/tracking/WristFilter';
// Fixture camera/landmark tổng hợp chỉ kiểm tra toán; nhận diện ứng dụng
// vẫn dùng output MediaPipe thật, không dùng các fixture này.

function pose(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options); const p = estimateWrist(f.points, f.world, f.aspect, options.mirror ? 'Left' : 'Right', { mode: 'straight-wrist' });
  assert.ok(p, 'fixture must have usable wrist pose'); return p;
}


test('Vòng nằm về phía cẳng tay, bám vị trí và thay đổi tỉ lệ gần/xa', () => {
  const a = pose(), b = pose({ x: 0.63 }), far = pose({ scale: 1 }), near = pose({ scale: 3 });
  assert.ok(project(a.center, a).y > 0.45 * a.aspect);
  assert.ok(Math.abs(project(b.center, b).x - project(a.center, a).x - 0.13 * a.focal / a.center.z) < 1e-5);
  assert.ok(Math.abs(near.radius / far.radius - 3) < 1e-5);
  assert.ok(Math.abs(rotate(a.orientation, { x: 0, y: 0, z: 1 }).y) > 0.9);
});

test('Xoay/nghiêng thay đổi hướng mặt phẳng vòng và phối cảnh, cả hai tay', () => {
  const a = pose(), tilted = pose({ tilt: 0.6 }), rolled = pose({ roll: 0.5 }), turned = pose({ twist: 0.8 });
  assert.ok(quaternionAngle(a.orientation, tilted.orientation) > 0.4);
  assert.ok(quaternionAngle(a.orientation, rolled.orientation) > 0.3);
  assert.ok(Math.abs(rotate(turned.orientation, { x: 1, y: 0, z: 0 }).z) > 0.5);
  assert.ok(pose({ mirror: true }));
  const edge = project({ x: 0.1, y: 0, z: a.focal - 0.2 }, a);
  const back = project({ x: 0.1, y: 0, z: a.focal + 0.2 }, a);
  assert.ok(edge.x > back.x, 'perspective must enlarge closer geometry');
});

test('Dữ liệu thiếu, NaN, quá nhỏ, hướng gần trục camera hoặc cổ tay bị cắt: ẩn vòng', () => {
  const f = fixture();
  assert.equal(estimateWrist([], f.world, f.aspect), null);
  assert.equal(estimateWrist(f.points, [], f.aspect), null);
  f.world[9].z = NaN; assert.equal(estimateWrist(f.points, f.world, f.aspect), null);
  const tiny = fixture({ scale: 0.1 }); assert.equal(estimateWrist(tiny.points, tiny.world, tiny.aspect), null);
  const axial = fixture({ tilt: 1.45 }); assert.equal(estimateWrist(axial.points, axial.world, axial.aspect), null);
  const cropped = fixture({ x: 0.01 }); assert.equal(estimateWrist(cropped.points, cropped.world, cropped.aspect), null);
});

test('Đứng yên: bộ lọc giảm rung vị trí, kích thước và góc', () => {
  const filter = new WristFilter(), centers: number[] = [], radii: number[] = [], angles: number[] = [];
  const raw: number[] = [];
  for (let i = 0; i < 100; i++) {
    const d = i % 2 ? 1 : -1;
    const p = pose({ x: 0.5 + d * 0.002, scale: 2 + d * 0.025, roll: d * 0.015 });
    const out = filter.update(p, 1000 + i * 33)!;
    if (i > 20) { centers.push(out.center.x); radii.push(out.radius); angles.push(quaternionAngle(out.orientation, pose().orientation)); raw.push(p.center.x); }
  }
  const range = (a: number[]) => Math.max(...a) - Math.min(...a);
  assert.ok(range(centers) < range(raw) * 0.7);
  assert.ok(range(radii) < pose({ scale: 2.025 }).radius - pose({ scale: 1.975 }).radius);
  assert.ok(Math.max(...angles) < 0.015);
});

test('Di chuyển trái/phải, tiến gần/xa: độ trễ vị trí và tỉ lệ có giới hạn', () => {
  const filter = new WristFilter();
  for (let i = 0; i < 70; i++) {
    const p = pose({ x: 0.5 + Math.sin(i / 10) * 0.15, scale: 2 + Math.sin(i / 12) * 0.7, roll: Math.sin(i / 15) });
    const out = filter.update(p, 1000 + i * 33)!;
    assert.ok(length(sub(out.center, p.center)) <= p.radius * 0.12001);
    assert.ok(out.radius / p.radius >= 1 / 1.061 && out.radius / p.radius <= 1.061);
    assert.ok(quaternionAngle(out.orientation, p.orientation) <= 0.18001);
  }
});

test('Mất tracking, đổi tay hoặc ngắt lâu: không giữ vòng ở vị trí cũ', () => {
  const filter = new WristFilter(); filter.update(pose(), 1000);
  assert.equal(filter.update(null, 1033), null);
  const next = pose({ x: 0.65 }); assert.equal(filter.update(next, 1066), next);
  const left = pose({ mirror: true });
  assert.equal(filter.update(left, 1099), null); assert.equal(filter.update(left, 1132), null);
  assert.equal(filter.update(left, 1165), left);
  const late = pose({ x: 0.55 }); assert.equal(filter.update(late, 2000), late);
});

test('Quaternion đi đường ngắn qua ±180°, không lật vòng một vòng', () => {
  const filter = new WristFilter(); const a = pose({ roll: Math.PI - 0.02 }), b = pose({ roll: -Math.PI + 0.02 });
  filter.update(a, 1000); const out = filter.update(b, 1033)!;
  assert.ok(quaternionAngle(out.orientation, a.orientation) < 0.05);
});

test('Một frame nhảy hướng lớn phải bị ẩn; chỉ nhận lại sau ba kết quả nhất quán', () => {
  const filter = new WristFilter(), a = pose(), b = pose({ roll: 1.5 });
  filter.update(a, 1000);
  assert.equal(filter.update(b, 1033), null);
  assert.equal(filter.update(b, 1066), null);
  assert.equal(filter.update(b, 1099), b);
});


test('Bán kính 3D không co khi xoay 0/45/90°, ngang/dọc; vẫn đổi theo khoảng cách và từng bàn tay', () => {
  for (const mirror of [false, true]) {
    const reference = pose({ mirror });
    for (const twist of [0, Math.PI / 4, Math.PI / 2]) {
      for (const roll of [0, Math.PI / 2]) {
        for (const scale of [1, 2, 3]) {
          const current = pose({ twist, roll, scale, mirror });
          assert.ok(Math.abs(current.radius / reference.radius - scale / 2) < 1e-6);
          assert.ok(quaternionAngle(current.orientation, reference.orientation) > 0.2 || (twist === 0 && roll === 0));
        }
      }
    }
  }
  // Cùng khoảng cách ảnh, bề rộng bàn tay khác phải dẫn tới Auto Fit khác.
  const wide = fixture();
  wide.world.forEach(p => { p.x *= 1.15; });
  wide.points.forEach(p => { p.x = 0.5 + (p.x - 0.5) * 1.15; });
  const wider = estimateWrist(wide.points, wide.world, wide.aspect, '', { mode: 'straight-wrist' });
  assert.ok(wider && wider.radius > pose().radius * 1.1);
});


test('Một frame sai kích thước không làm vòng co 20%; kích thước mới hội tụ khi giữ gần/xa', () => {
  const filter = new WristFilter(), initial = pose();
  filter.update(initial, 1000);
  // Dưới ngưỡng reject bước nhảy hiện có, smoothing vẫn phải giới hạn nó.
  const smaller = pose({ scale: 1.5 });
  const oneFrame = filter.update(smaller, 1033)!;
  assert.ok(oneFrame.radius >= initial.radius * Math.exp(-1.8 * .033) - 1e-9);
  const recovery = filter.update(initial, 1066)!;
  assert.ok(recovery.radius > initial.radius * .94);
  let settled = recovery;
  for (let i = 1; i <= 45; i++) settled = filter.update(smaller, 1066 + i * 33)!;
  assert.ok(Math.abs(settled.radius / smaller.radius - 1) < .01);
});
