import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BANGLE, BANGLE_CLEARANCE_SCALE, BANGLE_INNER_RADIUS, FOREARM, WRIST_MODEL_RADIUS, finalWorldScale } from './braceletDimensions';
import { applyCameraPose, configureCamera, createBraceletObjects, disposeObjects } from './braceletModel';
import { measureWristWidth, projectedWidth, radiusFromImageWidth, sizingDebug, widthAxis, WristSizer } from './braceletSizing';
import { estimateWrist, project, type WristPose } from './wristGeometry';
import { handFixture } from './testing/wristFixtures';

function pose(options: Parameters<typeof handFixture>[0] = {}) {
  const f = handFixture(options), p = estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' });
  assert.ok(p); return p;
}
function imageWithWrist(p: WristPose, wristWidth: number, skin = [170, 115, 85], bg = [18, 36, 45]) {
  const width = 800, height = Math.round(width * p.aspect), data = new Uint8ClampedArray(width * height * 4);
  const center = project(p.center, p), t = widthAxis(p);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const distance = (x / width - center.x) * t.x + (y / width - center.y) * t.y;
    const color = Math.abs(distance) <= wristWidth / 2 ? skin : bg;
    const i = (y * width + x) * 4; data.set([...color, 255], i);
  }
  return { width, height, data };
}
test('Đo biên ảnh thay vì nhân một hệ số lớn vào prior landmark', () => {
  const p = pose(), knownWidth = 0.20, image = imageWithWrist(p, knownWidth);
  const measurement = measureWristWidth(image, p);
  assert.ok(measurement.width !== null && measurement.confidence >= 0.65);
  assert.ok(Math.abs(measurement.width - knownWidth) < 0.006, 'measured pixel width must match actual synthetic edges');
  const fitted = new WristSizer().update(p, measurement, 1000);
  assert.ok(fitted.pose);
  const result = projectedWidth(fitted.pose, fitted.pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval);
  assert.equal(fitted.method, 'image');
  assert.ok(Math.abs(result - measurement.width) < 1e-8);
  assert.equal(fitted.pose.center, p.center); assert.equal(fitted.pose.orientation, p.orientation);
});
test('Phép đo tương đối màu hỗ trợ nhiều tone da/nền, không dùng ngưỡng skin-color cố định', () => {
  const p = pose();
  for (const [skin, bg] of [[[60, 45, 38], [220, 225, 235]], [[230, 185, 145], [20, 40, 70]], [[170, 115, 85], [18, 36, 45]]]) {
    const measurement = measureWristWidth(imageWithWrist(p, .18, skin, bg), p);
    assert.ok(measurement.width && Math.abs(measurement.width - .18) < .006);
  }
});
test('Ảnh không có hai biên rõ: báo calibration thủ công, không phóng tự động', () => {
  const p = pose(), measurement = measureWristWidth(imageWithWrist(p, .18, [150, 100, 80], [150, 100, 80]), p);
  assert.equal(measurement.width, null);
  const result = new WristSizer().update(p, measurement, 1000, { auto: false });
  assert.ok(result.pose);
  assert.equal(result.method, 'manual'); assert.equal(result.pose.radius, p.radius);
  assert.ok(result.message.toLowerCase().includes('calibration'));
});
test('Fit ngược phối cảnh đúng ở nhiều góc và khoảng cách; không so trực tiếp pixel với 3D', () => {
  for (const options of [{}, { twist: Math.PI / 2 }, { roll: Math.PI / 2 }, { tilt: .55 }, { scale: 1 }, { scale: 3 }]) {
    const p = pose(options), known = p.radius * 1.7;
    const width = projectedWidth(p, known, WRIST_MODEL_RADIUS, FOREARM.oval);
    const r = radiusFromImageWidth(p, width); assert.ok(r);
    assert.ok(Math.abs(r / known - 1) < 1e-7);
  }
});
test('Manual Fit 70/100/160/240/350% hoạt động, chỉ nhân đúng một lần qua mọi frame', () => {
  const p = pose(), model = createBraceletObjects();
  for (const fit of [.7, 1, 1.6, 2.4, 3.5]) {
    for (let frame = 0; frame < 100; frame++) {
      applyCameraPose(model.group, p, fit); model.group.updateMatrixWorld(true);
      assert.equal(model.group.scale.x, 1);
      assert.equal(model.bracelet.scale.x, p.radius * fit);
      assert.equal(model.wrist.scale.x, p.radius);
      assert.equal(model.group.scale.y, model.group.scale.x); assert.equal(model.group.scale.z, model.group.scale.x);
      assert.equal(model.band.scale.x, BANGLE_CLEARANCE_SCALE);
      const bandScale = model.band.getWorldScale(new THREE.Vector3());
      const proxyScale = model.occluder.getWorldScale(new THREE.Vector3());
      const debug = sizingDebug(p, fit, 960, { width: null, confidence: 0, reason: '' }, 'manual', '');
      assert.ok(Math.abs(bandScale.x - p.radius * fit * BANGLE_CLEARANCE_SCALE) < 1e-9);
      assert.ok(Math.abs(proxyScale.x - p.radius) < 1e-9, 'proxy has no second bracelet clearance scale');
      assert.ok(Math.abs(debug.proxyWorldScale - proxyScale.x) < 1e-9);
      assert.ok(Math.abs(debug.braceletWorldScale - bandScale.x) < 1e-9);
    }
  }
  disposeObjects(model.group);
});
test('Độ vừa thay vòng độc lập: proxy cố định, lỗ vòng tăng theo Manual Fit', () => {
  const p = pose();
  for (const fit of [.7, 1, 1.6, 2.4]) {
    const d = sizingDebug(p, fit, 960, { width: null, confidence: 0, reason: '' }, 'manual', '');
    assert.ok(Math.abs(d.braceletInnerDiameter / d.estimatedWristDiameter - BANGLE_INNER_RADIUS * fit / WRIST_MODEL_RADIUS) < 1e-12);
    assert.equal(d.estimatedWristDiameter, 2 * WRIST_MODEL_RADIUS * p.radius);
    if (fit >= 1) assert.ok(d.braceletInnerMinorDiameter > d.wristMinorDiameter * 1.09);
    assert.equal(d.finalWorldScale, d.baseScale * fit);
    if (fit >= 1) assert.ok(d.projectedBraceletDiameterPx > d.estimatedWristWidthPx);
  }
});
test('Debug pixel diameter khớp phép chiếu thực tế của group/child/camera Three.js', () => {
  const p = pose({ tilt: .4, twist: .65 }), model = createBraceletObjects(), camera = new THREE.PerspectiveCamera();
  for (const fit of [1, 1.6, 2.2]) for (const width of [640, 960, 1600]) {
    configureCamera(camera, p.focal, p.aspect); applyCameraPose(model.group, p, fit); model.group.updateMatrixWorld(true);
    const axis = widthAxis(p), positions: number[] = [];
    for (let i = 0; i < 96; i++) {
      const t = i / 96 * Math.PI * 2;
      const v = model.band.localToWorld(new THREE.Vector3((BANGLE.majorRadius - BANGLE.tubeRadius) * Math.cos(t), (BANGLE.majorRadius - BANGLE.tubeRadius) * BANGLE.oval * Math.sin(t), 0)).project(camera);
      positions.push(((v.x + 1) / 2 * axis.x + (1 - v.y) / 2 * p.aspect * axis.y) * width);
    }
    const expected = Math.max(...positions) - Math.min(...positions);
    const actual = sizingDebug(p, fit, width, { width: null, confidence: 0, reason: '' }, 'manual', '').projectedBraceletDiameterPx;
    assert.ok(Math.abs(expected - actual) < 1e-6, `projection mismatch: ${actual} vs ${expected}`);
  }
  disposeObjects(model.group);
});
test('Auto Fit không nhận hoặc ghi đè Manual Fit; đổi khoảng cách không khóa kích thước pixel cũ', () => {
  const sizer = new WristSizer(), fit = 1.6;
  let farPixels = 0, nearPixels = 0;
  for (let i = 0; i < 45; i++) {
    const p = pose({ scale: i < 20 ? 1 : 2 });
    const width = projectedWidth(p, p.radius * 1.4, WRIST_MODEL_RADIUS, FOREARM.oval);
    const fitted = sizer.update(p, { width, confidence: .9, reason: '' }, 1000 + i * 33);
    assert.ok(fitted.pose);
    const debug = sizingDebug(fitted.pose, fit, 960, { width, confidence: .9, reason: '' }, fitted.method, fitted.message);
    assert.equal(debug.manualFitMultiplier, fit);
    assert.equal(debug.finalWorldScale, fitted.pose.radius * fit);
    if (i === 19) farPixels = debug.projectedBraceletDiameterPx;
    if (i === 44) nearPixels = debug.projectedBraceletDiameterPx;
  }
  assert.ok(nearPixels > farPixels * 1.9 && nearPixels < farPixels * 2.1);
});
test('Một frame sai biên không đổi calibration; Hand hợp lệ vẫn giữ kích thước khi mất biên', () => {
  const p = pose(), sizer = new WristSizer();
  const first = sizer.update(p, { width: projectedWidth(p, p.radius, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .9, reason: '' }, 1000);
  assert.ok(first.pose);
  const noisy = sizer.update(p, { width: projectedWidth(p, p.radius * 2, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .9, reason: '' }, 1033);
  assert.ok(noisy.pose); assert.equal(noisy.pose.radius, first.pose.radius); assert.equal(noisy.method, 'calibrated');
  const near = pose({ scale: 3 });
  const fallback = sizer.update(near, { width: null, confidence: 0, reason: 'Không rõ biên' }, 1066);
  assert.equal(fallback.method, 'calibrated'); assert.ok(fallback.pose && fallback.pose.radius > first.pose.radius * 1.45);
  const expired = sizer.update(near, { width: null, confidence: 0, reason: 'Không rõ biên' }, 1400);
  assert.ok(expired.pose); assert.equal(expired.method, 'calibrated');
  sizer.loseTracking();
  assert.equal(sizer.update(near, { width: null, confidence: 0, reason: 'lost' }, 1433).pose, null);
});
test('Không có lỗi đường kính/bán kính hệ số 2; chặn đầu vào không hữu hạn', () => {
  assert.ok(Math.abs(WRIST_MODEL_RADIUS - 1.02) < 1e-12);
  assert.ok(Math.abs(BANGLE_INNER_RADIUS - 1.122) < 1e-12);
  const p = pose(), debug = sizingDebug(p, 1, 800, { width: null, confidence: 0, reason: '' }, 'manual', '');
  assert.equal(debug.estimatedWristDiameter, 2 * 1.02 * p.radius);
  assert.equal(finalWorldScale(p.radius, NaN), p.radius);
  assert.equal(finalWorldScale(p.radius, Infinity), p.radius);
  assert.equal(radiusFromImageWidth(p, NaN), null);
});
