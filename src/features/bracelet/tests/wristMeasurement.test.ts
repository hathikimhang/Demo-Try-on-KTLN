import assert from 'node:assert/strict';
import { handFixture } from './fixtures/wristFixtures';
import { estimateWrist, project } from '../services/geometry/wristGeometry';
import type { WristPose } from '../models/wrist.types';
import { widthAxis, projectedWidth, WristSizer } from '../services/fitting/braceletSizing';
import { test } from 'node:test';
import { measureWristWidth } from '../services/measurement/wristBoundaryMeasurement';
import { FOREARM, WRIST_MODEL_RADIUS } from '../models/braceletDimensions';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
function pose(options: Parameters<typeof handFixture>[0] = {}) {
  const f = handFixture(options), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' });
  assert.ok(p); return p;
}

function image(p: WristPose, color: (across: number, along: number) => number[]) {
  const width = 800, height = Math.round(width * p.aspect), data = new Uint8ClampedArray(width * height * 4);
  const center = project(p.center, p), axis = widthAxis(p);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - center.x * width, dy = y - center.y * width;
    data.set([...color(dx * axis.x + dy * axis.y, -dx * axis.y + dy * axis.x), 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

const skin = [175, 118, 87], background = [22, 35, 48];

test('Vệt bóng/texture bên trong da không được nhận thành hai mép cổ tay nhỏ', () => {
  const p = pose();
  const m = measureWristWidth(image(p, x => Math.abs(x) > 80 ? background : Math.abs(x) > 36 && Math.abs(x) < 48 ? [70, 47, 35] : skin), p);
  assert.ok(m.width === null || Math.abs(m.width - .2) < .012, `false inner boundary: ${m.width}, quality ${m.confidence}`);
  assert.ok(m.slices?.some(s => s.candidates.some(c => c.rejected && c.reason.includes('xuất hiện lại'))), 'rejection evidence must be available to the overlay');
});

test('Các lát cắt cùng bề rộng nhưng mép nhảy trái/phải phải bị loại', () => {
  const p = pose();
  const m = measureWristWidth(image(p, (x, y) => Math.abs(x - 12 * Math.sin(y / 4)) < 40 ? skin : background), p);
  assert.ok(m.width === null || m.confidence < .65, `incoherent silhouette accepted: ${m.width}, ${m.confidence}`);
});

test('Chỉ mất biên không xóa calibration; mất tracking thật cần ba frame khởi tạo lại', () => {
  const p = pose(), s = new WristSizer(), m = { width: projectedWidth(p, p.radius * 1.5, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .9, reason: 'fixture' };
  const first = s.update(p, m, 1000); assert.ok(first.pose);
  assert.equal(s.update(p, { width: null, confidence: 0, reason: 'shadow' }, 1300, { video: true }).pose?.radius, first.pose.radius);
  s.loseTracking();
  assert.equal(s.update(p, m, 1333, { video: true }).pose, null);
  assert.equal(s.update(p, m, 1366, { video: true }).pose, null);
  assert.ok(s.update(p, m, 1399, { video: true }).pose);
});

test('Hai mép debug là tọa độ ảnh thật, vuông góc trục tay và có raw width độc lập proxy', () => {
  for (const roll of [0, .7, Math.PI / 2]) {
    const p = pose({ roll }), m = measureWristWidth(image(p, x => Math.abs(x) < 64 ? skin : background), p);
    assert.ok(m.left && m.right && m.rawWidth && m.width);
    const dx = m.right.x - m.left.x, dy = m.right.y - m.left.y, axis = widthAxis(p);
    assert.ok(Math.abs(Math.hypot(dx, dy) - m.rawWidth) < 1e-10);
    assert.ok(Math.abs(-dx * axis.y + dy * axis.x) < 1e-10, 'measurement perpendicular to projected forearm');
    assert.ok(Math.abs(m.rawWidth * 800 - 128) < 6, 'compared to image ground truth, not proxy');
    assert.ok(m.slices!.filter(s => s.accepted).length >= 3);
    const fitted = new WristSizer().update(p, m, 1000); assert.ok(fitted.pose);
    const d = sizingDebug(fitted.pose, 1, 1600, m, fitted.method, fitted.message);
    assert.equal(d.status, 'measured'); assert.equal(d.rawWristWidthPx, m.rawWidth * 1600);
  }
});

test('Nền gần màu da: không gán measured; giữ calibration được đánh dấu riêng và không tạo phép đo mới', () => {
  const p = pose(), s = new WristSizer(), clear = measureWristWidth(image(p, x => Math.abs(x) < 70 ? skin : background), p);
  const ambiguous = measureWristWidth(image(p, x => Math.abs(x) < 70 ? skin : [174, 117, 86]), p);
  assert.equal(ambiguous.width, null);
  const first = s.update(p, clear, 0); assert.ok(first.pose);
  const next = pose({ scale: 2.1 }), predicted = s.update(next, ambiguous, 100, { video: true });
  assert.ok(predicted.pose); assert.equal(predicted.method, 'calibrated');
  const d = sizingDebug(predicted.pose, 1, 800, ambiguous, predicted.method, predicted.message);
  assert.equal(d.status, 'calibrated'); assert.equal(d.fitRatio, null); assert.equal(d.rawWristWidthPx, null);
  assert.ok(s.update(next, ambiguous, 300, { video: true }).pose);
  s.loseTracking(); assert.equal(s.update(next, ambiguous, 333, { video: true }).pose, null);
});

test('Mất biên tạm thời dùng radius đã làm mượt, không nhảy sang raw candidate mới nhất', () => {
  const p = pose(), s = new WristSizer();
  const observation = (radius: number) => ({ width: projectedWidth(p, radius, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .9, reason: 'fixture' });
  s.update(p, observation(p.radius), 1000);
  const smoothed = s.update(p, observation(p.radius * 1.2), 1033, { video: true }); assert.ok(smoothed.pose);
  const predicted = s.update(p, { width: null, confidence: 0, reason: 'shadow' }, 1066, { video: true }); assert.ok(predicted.pose);
  assert.ok(Math.abs(predicted.pose.radius - smoothed.pose.radius) < 1e-12);
});

test('Cổ tay loe dần tự nhiên vẫn có hai mép liên tục, không bị nhầm với nhiễu width', () => {
  const p = pose(), m = measureWristWidth(image(p, (x, y) => Math.abs(x - y * .15) < 60 + y * .2 ? skin : background), p);
  assert.ok(m.width && m.confidence >= .65);
  assert.ok(m.contourResidual !== undefined && m.contourResidual < .045);
});

test('Không dùng trục ngang giả khi cẳng tay hướng thẳng vào camera', () => {
  const p = { ...pose(), center: { x: 0, y: 0, z: 1.35 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const m = measureWristWidth(image(p, x => Math.abs(x) < 60 ? skin : background), p);
  assert.equal(m.width, null); assert.ok(m.reason.includes('Trục cẳng tay'));
});

test('Calibration giữ lại không hiển thị fit ratio từ ứng viên có biên mạnh nhưng không giải được radius', () => {
  const p = pose(), s = new WristSizer();
  s.update(p, { width: .2, confidence: .9, reason: 'valid' }, 1000);
  const invalid = { width: 100, confidence: .9, reason: 'out of camera-safe sizing range' };
  const result = s.update(p, invalid, 1100, { video: true }); assert.ok(result.pose);
  const d = sizingDebug(result.pose, 1, 800, invalid, result.method, result.message);
  assert.equal(d.status, 'calibrated'); assert.equal(d.fitRatio, null);
});
