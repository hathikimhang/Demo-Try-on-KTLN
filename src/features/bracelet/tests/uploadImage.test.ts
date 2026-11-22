import assert from 'node:assert/strict';
import type { Point } from '../../../shared/types/vision';
import { handFixture } from './fixtures/wristFixtures';
import { analyzeWristForSource } from '../services/geometry/wristGeometry';
import type { WristPose } from '../models/wrist.types';
import { test } from 'node:test';
import { uploadTrackingMessage } from '../views/trackingMessages';
import { canRenderProvisional, WristSizer, projectedWidth } from '../services/fitting/braceletSizing';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
import { FOREARM, WRIST_MODEL_RADIUS } from '../models/braceletDimensions';
const missingEdges = { width: null, confidence: 0, reason: 'Không thấy đủ hai biên cổ tay' };

function armFixture(x = .5) {
  const hand = handFixture({ x, y: .30 });
  const armPoints: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const armWorldPoints = armPoints.map(p => ({ ...p }));
  armPoints[15] = { ...hand.points[0], visibility: .95 };
  armPoints[13] = { x, y: .30 + .22 * 2 / hand.aspect, z: 0, visibility: .95 };
  armWorldPoints[15] = { x: .12, y: .05, z: .15, visibility: .95 };
  armWorldPoints[13] = { x: .12, y: .27, z: .15, visibility: .95 };
  return { ...hand, armPoints, armWorldPoints };
}

function uploadedPose(): WristPose {
  const f = handFixture(), result = analyzeWristForSource(f.points, f.world, f.aspect, 'Right', { input: 'image', mode: 'forearm' });
  assert.ok(result.pose); return result.pose;
}

test('Upload có bàn tay/cổ tay, không có khuỷu: tự fallback và giữ nguyên mode yêu cầu cho worker', () => {
  const f = handFixture(), result = analyzeWristForSource(f.points, f.world, f.aspect, 'Right', { input: 'image', mode: 'forearm' });
  assert.ok(result.pose); assert.equal(result.reason, 'ok');
  assert.equal(result.fallbackReason, 'no-forearm'); assert.equal(result.requestedMode, 'forearm');
  assert.equal(result.effectiveMode, 'straight-wrist'); assert.equal(result.pose.source, 'straight-wrist');
});

test('Upload có elbow/wrist Pose khớp: dùng forearm, không fallback vô điều kiện', () => {
  const f = armFixture(), result = analyzeWristForSource(f.points, f.world, f.aspect, 'Right', { ...f, input: 'image', mode: 'forearm' });
  assert.ok(result.pose); assert.equal(result.pose.source, 'forearm'); assert.equal(result.fallbackReason, undefined);
});

test('Upload arm-match không đáng tin: fallback Hand; camera vẫn từ chối như trước', () => {
  const f = armFixture(); f.armPoints[15].x += .3;
  const uploaded = analyzeWristForSource(f.points, f.world, f.aspect, 'Right', { ...f, input: 'image', mode: 'forearm' });
  assert.ok(uploaded.pose); assert.equal(uploaded.fallbackReason, 'arm-match'); assert.equal(uploaded.effectiveMode, 'straight-wrist');
  const live = analyzeWristForSource(f.points, f.world, f.aspect, 'Right', { ...f, input: 'camera', mode: 'forearm' });
  assert.equal(live.pose, null); assert.equal(live.reason, 'arm-match'); assert.equal(live.fallbackReason, undefined);
});

test('Upload không có Hand: không tạo pose/vòng từ Pose hoặc prior', () => {
  const result = analyzeWristForSource([], [], .75, '', { input: 'image', mode: 'forearm' });
  assert.equal(result.pose, null); assert.equal(result.reason, 'no-hand'); assert.equal(result.fallbackReason, undefined);
  assert.match(uploadTrackingMessage(result.reason, false), /^Không phát hiện bàn tay/);
});

test('Fallback không bỏ qua invalid-data, bounds hoặc arm-direction', () => {
  const f = armFixture(); f.world[9].x = NaN;
  const bad = analyzeWristForSource(f.points, f.world, f.aspect, 'Right', { ...f, input: 'image', mode: 'forearm' });
  assert.equal(bad.pose, null); assert.equal(bad.reason, 'invalid-data'); assert.equal(bad.fallbackReason, undefined);
  const nearEdge = armFixture(.914);
  const bounds = analyzeWristForSource(nearEdge.points, nearEdge.world, nearEdge.aspect, 'Right', { ...nearEdge, input: 'image', mode: 'forearm' });
  assert.equal(bounds.pose, null); assert.equal(bounds.reason, 'bounds'); assert.equal(bounds.fallbackReason, undefined);
  const contrary = armFixture(); contrary.armPoints[13] = { x: .7, y: .2, z: 0, visibility: .95 };
  contrary.armWorldPoints[13] = { x: .30, y: 0, z: .15, visibility: .95 };
  const direction = analyzeWristForSource(contrary.points, contrary.world, contrary.aspect, 'Right', { ...contrary, input: 'image', mode: 'forearm' });
  assert.equal(direction.pose, null); assert.equal(direction.reason, 'arm-direction'); assert.equal(direction.fallbackReason, undefined);
});

test('Thiếu elbow có thể thử fallback, nhưng basis degenerate vẫn phải bị từ chối', () => {
  const f = handFixture();
  for (const i of [5, 9, 13, 17]) { f.world[i] = { x: 0, y: -.07, z: 0 }; f.points[i] = { x: .5, y: .45 - .14 / f.aspect, z: 0 }; }
  const result = analyzeWristForSource(f.points, f.world, f.aspect, 'Right', { input: 'image', mode: 'forearm' });
  assert.equal(result.pose, null); assert.equal(result.reason, 'degenerate'); assert.equal(result.fallbackReason, 'no-forearm');
  assert.match(uploadTrackingMessage(result.reason, true), /không xác định được tư thế cổ tay.*degenerate/);
});

test('Pose hợp lệ, mất biên: Upload render Provisional Fit, camera vẫn chờ đo', () => {
  const p = uploadedPose(); assert.equal(canRenderProvisional(p), true);
  const upload = new WristSizer().update(p, missingEdges, 1000, { input: 'image' });
  assert.ok(upload.pose); assert.equal(upload.method, 'provisional'); assert.equal(upload.pose.radius, p.radius);
  assert.equal(upload.pose.calibrationRadius, undefined); assert.equal(upload.quality, 0);
  const live = new WristSizer().update(p, missingEdges, 1000, { input: 'camera', video: true });
  assert.equal(live.pose, null); assert.equal(live.method, 'measuring');
  const debug = sizingDebug(upload.pose, 1.5, 800, missingEdges, upload.method, upload.message);
  assert.equal(debug.status, 'provisional'); assert.equal(debug.fitRatio, null); assert.equal(debug.calibrationRadius, null);
  assert.equal(debug.finalWorldScale, p.radius * 1.5); assert.ok(debug.projectedBraceletDiameterPx > 0);
});

test('Provisional không khóa prior thành calibration và không chặn phép đo thật sau đó', () => {
  const p = uploadedPose(), s = new WristSizer();
  assert.equal(s.update(p, missingEdges, 1000, { input: 'image' }).method, 'provisional');
  const observed = { width: projectedWidth(p, p.radius * 1.5, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .9, reason: 'known skin edges' };
  const measured = s.update(p, observed, 1033, { input: 'image' }); assert.ok(measured.pose);
  assert.equal(measured.method, 'image'); assert.ok(Math.abs(measured.pose.radius / p.radius - 1.5) < 1e-7);
});

test('Provisional cho phép Manual Calibration; fixed-size hoặc projection không an toàn vẫn bị chặn', () => {
  const p = uploadedPose(), s = new WristSizer(); s.update(p, missingEdges, 1000, { input: 'image' });
  const manual = s.update(p, missingEdges, 1033, { input: 'image', auto: false });
  assert.ok(manual.pose); assert.equal(manual.method, 'manual');
  assert.equal(new WristSizer().update(p, missingEdges, 1000, { input: 'image', policy: 'fixed-size' }).method, 'blocked');
  const invalid = { ...p, center: { x: 5, y: 0, z: .01 } };
  const rejected = new WristSizer().update(invalid, missingEdges, 1000, { input: 'image' });
  assert.equal(rejected.pose, null); assert.match(rejected.message, /unsafe-provisional/);
});

test('Thông báo ảnh phân biệt từng giai đoạn, không yêu cầu khuỷu tay cho lỗi hình học', () => {
  assert.match(uploadTrackingMessage('invalid-data', true), /Phát hiện bàn tay nhưng không xác định được tư thế cổ tay.*invalid-data/);
  assert.match(uploadTrackingMessage('sizing', true, { method: 'measuring', message: 'unsafe-provisional' }), /Đã xác định cổ tay nhưng chưa đo được kích thước/);
  const p = uploadedPose(), provisional = new WristSizer().update(p, missingEdges, 1000, { input: 'image' });
  assert.match(uploadTrackingMessage('ok', true, provisional), /Đã hiển thị vòng với kích thước tạm tính \(Provisional Fit\)/);
  assert.match(uploadTrackingMessage('ok', true, { method: 'image', message: 'measured' }), /^Auto Fit thành công/);
});
