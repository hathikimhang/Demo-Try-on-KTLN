import assert from 'node:assert/strict';
import { handFixture } from './fixtures/wristFixtures';
import { estimateWrist, project } from '../services/geometry/wristGeometry';
import type { WristPose } from '../models/wrist.types';
import { projectedWidth, widthAxis, WristSizer } from '../services/fitting/braceletSizing';
import type { WidthMeasurement } from '../models/fitting.types';
import { FOREARM, WRIST_MODEL_RADIUS } from '../models/braceletDimensions';
import { test } from 'node:test';
import { measureWristWidth } from '../services/measurement/wristBoundaryMeasurement';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
function pose(options: Parameters<typeof handFixture>[0] = {}) {
  const f = handFixture(options), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' });
  assert.ok(p); return p;
}

const observation = (p: WristPose, r: number): WidthMeasurement => ({ width: projectedWidth(p, r, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .9, reason: 'Known projected cross-section fixture' });

function silhouette(p: WristPose, width: number, contrast = true) {
  const W = 800, H = Math.round(W * p.aspect), data = new Uint8ClampedArray(W * H * 4), center = project(p.center, p), axis = widthAxis(p);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = (x / W - center.x) * axis.x + (y / W - center.y) * axis.y;
    const foreground = Math.abs(d) < width / 2 || !contrast;
    data.set(foreground ? [175, 118, 87, 255] : [22, 35, 48, 255], (y * W + x) * 4);
  }
  return { width: W, height: H, data };
}

test('Cổ tay nhỏ/lớn: cùng hand prior vẫn đo hai kích thước ảnh khác nhau và auto fit theo da', () => {
  const p = pose(); const radii: number[] = [];
  for (const width of [.10, .24]) {
    const m = measureWristWidth(silhouette(p, width), p);
    assert.ok(m.width && m.confidence >= .65);
    assert.ok(Math.abs(m.width - width) < .008);
    const result = new WristSizer().update(p, m, 1000); assert.ok(result.pose);
    radii.push(result.pose.radius);
    const debug = sizingDebug(result.pose, 1, 800, m, result.method, result.message);
    assert.ok(debug.fitRatio && debug.fitRatio > 1.05 && debug.fitRatio < 1.35);
  }
  assert.ok(radii[1] / radii[0] > 2.2, 'not a universal wrist factor');
});

test('Prior rất nhỏ không giới hạn vùng dò biên hoặc cản nghiệm fit ngược', () => {
  const p = { ...pose(), radius: .014 };
  const m = measureWristWidth(silhouette(p, .22), p);
  assert.ok(m.width && m.width > .21, 'search comes from wrist axis/palm length, not tiny prior radius');
  const result = new WristSizer().update(p, m, 1000); assert.ok(result.pose);
  assert.ok(result.pose.radius > p.radius * 5, 'solver is not capped at four times the underestimated prior');
});

test('Video cần ba frame rõ lúc đầu; ảnh biên mờ không được render vòng nhỏ theo prior', () => {
  const p = pose(), m = observation(p, p.radius * 1.5), s = new WristSizer();
  assert.equal(s.update(p, { width: null, confidence: 0, reason: 'occluded' }, 900, { video: true }).pose, null);
  assert.equal(s.update(p, m, 1000, { video: true }).pose, null);
  assert.equal(s.update(p, m, 1033, { video: true }).pose, null);
  assert.ok(s.update(p, m, 1066, { video: true }).pose);
});

test('Liên tục gần/xa, ngang/dọc và xoay: fit ratio ổn định, không cần sửa Manual Fit', () => {
  for (const twist of [0, Math.PI / 4, Math.PI / 2]) for (const roll of [0, Math.PI / 2]) {
    const s = new WristSizer(); let maxError = 0;
    for (let i = 0; i < 100; i++) {
      const p = pose({ scale: 2 + .6 * Math.sin(i / 23), twist, roll });
      const radius = p.radius * 1.5, m = observation(p, radius);
      const result = s.update(p, m, 1000 + i * 40, { video: true });
      if (i < 2) continue;
      assert.ok(result.pose); assert.equal(result.pose.center, p.center); assert.equal(result.pose.orientation, p.orientation);
      const actualWidth = projectedWidth(result.pose, result.pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval);
      maxError = Math.max(maxError, Math.abs(actualWidth / m.width! - 1));
      const d = sizingDebug(result.pose, 1, 960, m, result.method, result.message);
      assert.equal(d.manualFitMultiplier, 1);
    }
    assert.ok(maxError < .08, `distance/rotation sequence error ${maxError}`);
  }
});

test('Mất tracking/đổi người cùng nhãn Right: không mang scale cũ sang người mới', () => {
  const p = pose(), s = new WristSizer();
  s.update(p, observation(p, p.radius * 2), 1000);
  s.loseTracking();
  const unknown = s.update(p, { width: null, confidence: 0, reason: 'unknown person' }, 1100, { video: true });
  assert.equal(unknown.pose, null);
  let next = unknown;
  for (let i = 0; i < 4; i++) next = s.update(p, observation(p, p.radius * .8), 1133 + i * 33, { video: true });
  assert.ok(next.pose && Math.abs(next.pose.radius / p.radius - .8) < .01);
});

test('Biên lớn khi chưa mất tracking không đổi intrinsic; đổi người cần khởi tạo lại', () => {
  const p = pose(), s = new WristSizer();
  s.update(p, observation(p, p.radius), 1000);
  const held = s.update(p, observation(p, p.radius * 1.9), 1033, { video: true });
  assert.ok(held.pose); assert.ok(Math.abs(held.pose.radius / p.radius - 1) < 1e-7);
  assert.equal(held.method, 'calibrated');
  s.loseTracking();
  let result;
  for (let i = 0; i < 8; i++) result = s.update(p, observation(p, p.radius * 1.9), 1066 + i * 33, { video: true });
  assert.ok(result?.pose && Math.abs(result.pose.radius / p.radius - 1.9) < .02);
});

test('Biên bị che nhưng Hand hợp lệ: giữ calibration; biên rõ trở lại kiểm tra được', () => {
  const p = pose(), s = new WristSizer(), m = observation(p, p.radius * 1.6);
  s.update(p, m, 1000);
  assert.equal(s.update(p, { width: null, confidence: 0, reason: 'blocked' }, 1100, { video: true }).method, 'calibrated');
  assert.ok(s.update(p, { width: null, confidence: 0, reason: 'blocked' }, 1300, { video: true }).pose);
  let result;
  for (let i = 0; i < 4; i++) result = s.update(p, m, 1333 + i * 33, { video: true });
  assert.ok(result?.pose && result.method === 'image');
});

test('Không resize asset fixed-size; Visual Auto Fit không giả vờ đo được mm', () => {
  const p = pose(), result = new WristSizer().update(p, observation(p, p.radius * 2), 1000, { policy: 'fixed-size' });
  assert.equal(result.pose, null); assert.equal(result.method, 'blocked'); assert.ok(result.message.includes('True-to-Size'));
});

test('Nền không phân biệt được không được gắn confidence cao; chưa fit thì final render scale bằng 0', () => {
  const p = pose(), m = measureWristWidth(silhouette(p, .2, false), p);
  assert.equal(m.width, null); assert.equal(m.confidence, 0);
  const result = new WristSizer().update(p, m, 1000);
  assert.equal(result.pose, null);
  const debug = sizingDebug(p, 1, 800, m, result.method, result.message);
  assert.equal(debug.finalRenderScale, 0); assert.equal(debug.projectedBraceletDiameterPx, 0); assert.equal(debug.fitRatio, null);
});

test('Frame đồng bộ xử lý chậm 650ms vẫn thu thập đủ ba phép đo, không reset vô hạn', () => {
  const p = pose(), s = new WristSizer(), m = observation(p, p.radius * 1.4);
  assert.equal(s.update(p, m, 1000, { video: true }).pose, null);
  assert.equal(s.update(p, m, 1650, { video: true }).pose, null);
  assert.ok(s.update(p, m, 2300, { video: true }).pose);
});
