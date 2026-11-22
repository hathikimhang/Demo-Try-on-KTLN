import assert from 'node:assert/strict';
import * as THREE from 'three';
import { handFixture } from './fixtures/wristFixtures';
import { estimateWrist, analyzeWrist, project } from '../services/geometry/wristGeometry';
import type { WristPose } from '../models/wrist.types';
import { projectedWidth, radiusFromImageWidth, WristSizer } from '../services/fitting/braceletSizing';
import { FOREARM, WRIST_MODEL_RADIUS } from '../models/braceletDimensions';
import { test } from 'node:test';
import { applyCameraPose, createBraceletObjects, disposeObjects } from '../views/rendering/braceletModel';
import { WristFilter } from '../services/tracking/WristFilter';
import { fitSimilarity, mapSimilarity, applyImageSimilarity, WristRoiTracker, ROI_MAX_AGE_MS } from '../services/tracking/wristRoiTracking';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
import { debugSample, WristDebugLog } from '../services/diagnostics/wristDiagnostics';
import { emptyTracking } from '../models/tracking.types';
function pose(options: Parameters<typeof handFixture>[0] = {}) {
  const f = handFixture(options), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' });
  assert.ok(p); return p;
}

const known = (p: WristPose, radius = p.radius * 1.4) => ({ width: projectedWidth(p, radius, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .95, reason: 'controlled observation' });

test('Test A/B: quay 360° với biên 2D lệch ellipse không thay size vật thể ở Manual 100% và 150%', () => {
  const first = pose(), measurement = known(first), model = createBraceletObjects();
  for (const manual of [1, 1.5]) {
    const s = new WristSizer(), calibrated = s.update(first, measurement, 1000); assert.ok(calibrated.pose);
    const intrinsic = calibrated.pose.calibrationRadius!, expected = calibrated.pose.radius;
    let independentRefitPeak = expected;
    for (let i = 1; i <= 144; i++) {
      // Cổ tay tròn hơn hoặc contour lệch so với proxy không được diễn giải
      // thành giải phẫu thay đổi khi ellipse ước lượng quay.
      const p = pose({ twist: i * Math.PI / 72 });
      independentRefitPeak = Math.max(independentRefitPeak, radiusFromImageWidth(p, measurement.width!) ?? 0);
      const result = s.update(p, measurement, 1000 + i * 33, { video: true }); assert.ok(result.pose);
      assert.ok(Math.abs(result.pose.calibrationRadius! - intrinsic) < 1e-12);
      assert.ok(Math.abs(result.pose.radius / expected - 1) < 1e-6);
      applyCameraPose(model.group, result.pose, manual); model.group.updateMatrixWorld(true);
      const wrist = model.occluder.getWorldScale(new THREE.Vector3()).x, ring = model.band.getWorldScale(new THREE.Vector3()).x;
      assert.ok(Math.abs(wrist / expected - 1) < 1e-6);
      assert.ok(Math.abs(ring / (expected * manual * 1.1) - 1) < 1e-6);
      assert.equal(model.group.scale.x, 1);
    }
    assert.ok(independentRefitPeak > expected * 1.3, 'fixture reproduces why independently refitting an assumed ellipse at each angle inflates size');
  }
  disposeObjects(model.group);
});

test('Manual 150% không đổi proxy, vị trí, quaternion hoặc camera; không tích lũy qua 200 frame', () => {
  const p = pose(), model = createBraceletObjects(); applyCameraPose(model.group, p, 1); model.group.updateMatrixWorld(true);
  const proxy = model.occluder.matrixWorld.clone(), position = model.group.position.clone(), rotation = model.group.quaternion.clone();
  for (let i = 0; i < 200; i++) { applyCameraPose(model.group, p, 1.5); model.group.updateMatrixWorld(true); }
  assert.deepEqual(model.occluder.matrixWorld.elements, proxy.elements);
  assert.ok(model.group.position.equals(position) && model.group.quaternion.equals(rotation));
  assert.equal(model.bracelet.scale.x, p.radius * 1.5); disposeObjects(model.group);
});

test('Một frame distance scale nhiễu không phóng vòng; distance observer hội tụ độc lập anatomical prior', () => {
  const p = pose(), filter = new WristFilter(); filter.update(p, 1000);
  const noise = filter.update({ ...p, distanceScale: p.distanceScale! * 3 }, 1033); assert.ok(noise);
  assert.ok(Math.abs(noise.distanceScale! / p.distanceScale! - 1) < .01, 'one raw distance outlier must be rejected');
  let next = noise;
  for (let i = 0; i < 24; i++) next = filter.update({ ...p, distanceScale: p.distanceScale! * 1.5, radius: p.radius * (i % 2 ? 1.3 : .8) }, 1066 + i * 33)!;
  assert.ok(Math.abs(next.distanceScale! / p.distanceScale! - 1.5) < .025);
});

test('Similarity xác định được từ các điểm nếp cổ tay thẳng hàng, không cần affine rank hai', () => {
  const transform = { a: .98, b: .05, tx: 3, ty: -2 };
  const matches = [0, 10, 20, 30, 40, 50].map(x => ({ from: { x, y: 12 }, to: mapSimilarity({ x, y: 12 }, transform) }));
  const fit = fitSimilarity(matches); assert.ok(fit);
  for (const m of matches) assert.ok(Math.hypot(mapSimilarity(m.from, fit).x - m.to.x, mapSimilarity(m.from, fit).y - m.to.y) < 1e-10);
});

test('Test C: giữ intrinsic radius khi đổi khoảng cách, projection được nhân đúng một lần', () => {
  const s = new WristSizer(), first = pose(), measurement = known(first);
  const calibrated = s.update(first, measurement, 1000); assert.ok(calibrated.pose);
  const widths: number[] = [];
  for (const [i, scale] of [1, 2, 3].entries()) {
    const p = pose({ scale }), result = s.update(p, { width: null, confidence: 0, reason: 'boundary temporarily unavailable' }, 1033 + i * 33); assert.ok(result.pose);
    assert.equal(result.pose.calibrationRadius, calibrated.pose.calibrationRadius);
    const d = sizingDebug(result.pose, 1.5, 800, measurement, result.method, result.message); widths.push(d.projectedBraceletDiameterPx);
    assert.equal(d.finalWorldScale, result.pose.radius * 1.5);
  }
  assert.ok(widths[1] / widths[0] > 1.97 && widths[1] / widths[0] < 2.04);
  assert.ok(widths[2] / widths[0] > 2.9 && widths[2] / widths[0] < 3.1);
});

test('Anatomical prior/biên sai không ghi đè intrinsic; mất tracking thật mới yêu cầu calibration lại', () => {
  const p = pose(), s = new WristSizer(), first = s.update(p, known(p), 1000); assert.ok(first.pose);
  const noisy = { ...p, radius: p.radius * 3 };
  for (let i = 0; i < 20; i++) { const r = s.update(noisy, known(p, p.radius * 2), 1033 + i * 33, { video: true }); assert.ok(r.pose); assert.equal(r.pose.radius, first.pose.radius); }
  s.loseTracking(); assert.equal(s.update(p, { width: null, confidence: 0, reason: 'no observation' }, 1800, { video: true }).pose, null);
});

test('Inverse fit chặn bán kính gần camera/không hữu hạn và hướng axial, không tăng vô hạn', () => {
  const p = pose();
  assert.equal(radiusFromImageWidth(p, 100), null); assert.equal(radiusFromImageWidth({ ...p, radius: 0 }, .2), null);
  assert.equal(radiusFromImageWidth({ ...p, center: { x: 0, y: 0, z: 1.35 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }, .2), null);
});

test('Mất Hand ngắn không vẽ pose giả và không đổi calibration khi nhận lại ở góc khác; mất lâu phải đo lại', () => {
  const first = pose(), s = new WristSizer(), m = known(first), calibrated = s.update(first, m, 1000); assert.ok(calibrated.pose);
  s.missing(1100);
  const inside = pose({ twist: Math.PI / 2 }), restored = s.update(inside, m, 1200, { video: true }); assert.ok(restored.pose);
  assert.equal(restored.pose.calibrationRadius, calibrated.pose.calibrationRadius);
  assert.ok(Math.abs(restored.pose.radius / calibrated.pose.radius - 1) < 1e-6);
  s.missing(2800);
  assert.equal(s.update(inside, { width: null, confidence: 0, reason: 'requires a new observed boundary' }, 2833, { video: true }).pose, null);
});

test('Không cần đầu ngón tay, nhưng không coi MCP ngoài ảnh là quan sát hợp lệ', () => {
  const f = handFixture(), options = { mode: 'straight-wrist' as const };
  assert.ok(analyzeWrist(f.points.slice(0, 18), f.world.slice(0, 18), f.aspect, 'Right', options).pose);
  const cropped = f.points.map(p => ({ ...p })); cropped[17].x = -.2;
  assert.equal(analyzeWrist(cropped, f.world, f.aspect, 'Right', options).pose, null);
});

test('Similarity đo từ correspondences chiếu đúng tâm và đổi orientation trong mặt phẳng; intrinsic bất biến', () => {
  const p = pose(), angle = .1, scale = 1.05, t = { a: Math.cos(angle) * scale, b: Math.sin(angle) * scale, tx: 4, ty: -3 };
  const points = [{ x: 10, y: 20 }, { x: 20, y: 10 }, { x: 40, y: 30 }, { x: 30, y: 50 }];
  const fitted = fitSimilarity(points.map(from => ({ from, to: mapSimilarity(from, t) }))); assert.ok(fitted);
  for (const key of ['a', 'b', 'tx', 'ty'] as const) assert.ok(Math.abs(fitted[key] - t[key]) < 1e-10);
  const next = applyImageSimilarity(p, fitted, 400), before = project(p.center, p), after = project(next.center, next), expected = mapSimilarity({ x: before.x * 400, y: before.y * 400 }, t);
  assert.ok(Math.hypot(after.x * 400 - expected.x, after.y * 400 - expected.y) < 1e-9);
  assert.ok(Math.abs(next.radius / next.distanceScale! - p.radius / p.distanceScale!) < 1e-12);
});

function texturedFrame(p: WristPose, dx = 0, dy = 0, erasedHand = false, uniform = false) {
  const width = 400, height = 300, data = new Uint8ClampedArray(width * height * 4), c = project(p.center, p);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const X = x - dx, Y = y - dy;
    const n = ((Math.imul(X, 73856093) ^ Math.imul(Y, 19349663)) >>> 0) % 60;
    const visible = !erasedHand || Y > c.y * width - 7;
    const v = uniform ? 130 : visible ? 100 + n : 220;
    data.set([v, v * .8, v * .65, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

test('Test D: ROI tiếp tục bằng pixel cổ tay khi ảnh phần bàn tay bị loại, không cần landmarks giả', () => {
  const p = pose(), roi = new WristRoiTracker(); assert.ok(roi.seed(texturedFrame(p), p, 1000));
  for (let i = 1; i <= 6; i++) {
    const r = roi.track(texturedFrame(p, i * 2, i, true), 1000 + i * 50); assert.ok(r.pose, r.reason);
    const initial = project(p.center, p), current = project(r.pose.center, r.pose);
    assert.ok(Math.abs((current.x - initial.x) * 400 - i * 2) < 1.5);
    assert.ok(r.inliers >= 6 && r.quality > .5);
  }
});

test('ROI từ chối da trơn, ảnh bị che, frame trễ và vượt tuổi mốc 3D, không đứng yên giả', () => {
  const p = pose(), roi = new WristRoiTracker();
  assert.equal(roi.seed(texturedFrame(p, 0, 0, false, true), p, 1000), false);
  assert.ok(roi.seed(texturedFrame(p), p, 1000)); assert.equal(roi.track(texturedFrame(p, 0, 0, false, true), 1050).pose, null);
  assert.ok(roi.seed(texturedFrame(p), p, 1000)); assert.equal(roi.track(texturedFrame(p), 1300).pose, null);
  assert.ok(roi.seed(texturedFrame(p), p, 1000));
  for (let time = 1100; time <= 1000 + ROI_MAX_AGE_MS; time += 100) assert.ok(roi.track(texturedFrame(p), time).pose);
  assert.equal(roi.track(texturedFrame(p), 1100 + ROI_MAX_AGE_MS).pose, null);
});

test('Log so sánh A/B giữ Manual Fit/radius và nguồn thực, không lưu ảnh', () => {
  const p = pose(), s = new WristSizer(), m = known(p), result = s.update(p, m, 1000); assert.ok(result.pose);
  const log = new WristDebugLog();
  for (const manual of [1, 1.5]) {
    const d = sizingDebug(result.pose, manual, 800, m, result.method, result.message);
    log.append(debugSample(1000, { ...emptyTracking(), state: 'tracking', source: 'Hand Landmarker', phase: 'continuous' }, d, manual));
  }
  const rows = JSON.parse(log.serialize()).samples;
  assert.equal(rows[0].wristProxyScale, rows[1].wristProxyScale);
  assert.ok(Math.abs(rows[1].finalBraceletWorldScale / rows[0].finalBraceletWorldScale - 1.5) < 1e-12);
  assert.ok(!log.serialize().includes('imageData'));
});
