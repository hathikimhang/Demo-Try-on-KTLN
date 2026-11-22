import assert from 'node:assert/strict';
import * as THREE from 'three';
import { imageWristFrame, wristImageRoi } from '../services/measurement/imageWristMeasurement';
import { estimateWrist, project } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';
import { test } from 'node:test';
import { measureSegmentedWrist, skinProbability } from '../services/measurement/segmentedWristMeasurement';
import { registerImageWrist } from '../services/fitting/imageWristRegistration';
import { WristSizer, projectedWidth } from '../services/fitting/braceletSizing';
import { FOREARM, WRIST_MODEL_RADIUS } from '../models/braceletDimensions';
import { ImageOcclusion } from '../views/rendering/imageOcclusion';
// Xác suất tổng hợp chỉ kiểm tra phép toán; runtime lấy xác suất
// từ MediaPipe thật, được kiểm tra inference ảnh bằng browser tests.
function scene(W = 960, options: { ambiguous?: boolean; shadow?: boolean; weakModel?: boolean; roll?: number } = {}) {
  const f = handFixture({ roll: options.roll ?? 0 }), pose = estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' }); assert.ok(pose);
  const H = Math.round(W * f.aspect), region = wristImageRoi(pose, W, H, f.points[0]), frame = imageWristFrame(pose, f.points[0]);
  const data = new Uint8ClampedArray(region.width * region.height * 4), sw = 320, sh = 240, confidence = new Float32Array(sw * sh);
  const lateral = (x: number, y: number) => (x - frame.anchor.x) * frame.transverse.x + (y - frame.anchor.y) * frame.transverse.y;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) confidence[y * sw + x] = options.weakModel ? .4 : 1 / (1 + Math.exp((Math.abs(lateral((x + .5) / sw, (y + .5) / sh * f.aspect)) - .09) / .002));
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const t = lateral((region.x + x) / W, (region.y + y) / W), inside = Math.abs(t) < .09;
    // Màu nền mặt/áo khác nhau ở hai phía; một prototype nền dùng chung
    // có thể loại sai các biên cổ tay vốn hợp lệ.
    let color = inside || options.ambiguous ? [185, 132, 100] : t < 0 ? [90, 55, 40] : [238, 240, 235];
    if (inside && options.shadow && Math.abs(t) < .025) color = color.map(v => v * .4);
    data.set([...color, 255], (y * region.width + x) * 4);
  }
  return { pose, wrist: f.points[0], roi: { ...region, data }, skin: { width: sw, height: sh, confidence } };
}

test('Semantic guidance supports different backgrounds on each side without a fixed skin color', () => {
  const s = scene(), before = JSON.stringify(s.pose), r = measureSegmentedWrist(s.roi, s.pose, s.skin, s.wrist);
  assert.ok(r.measurement.width && Math.abs(r.measurement.width - .18) < .004, r.measurement.reason);
  assert.ok(r.measurement.confidence >= .75 && r.measurement.sampleCount! >= 5 && r.mask);
  assert.equal(r.measurement.image?.method, 'semantic-body'); assert.equal(JSON.stringify(s.pose), before); assert.ok(!('pose' in r));
});

test('Model alone cannot invent precise edges on a native image without contrast', () => {
  const s = scene(960, { ambiguous: true }), r = measureSegmentedWrist(s.roi, s.pose, s.skin, s.wrist);
  assert.equal(r.measurement.width, null); assert.equal(r.measurement.confidence, 0);
  assert.ok(r.measurement.image!.rejected['no-native-pair: không có đủ hai biên RGB được segmentation xác nhận'] > 0);
  assert.ok(r.mask, 'occlusion evidence is independent of accepted sizing');
});

test('Uncertain semantic core rejects measurement and mask rather than scaling from guessed width', () => {
  const s = scene(960, { weakModel: true }), r = measureSegmentedWrist(s.roi, s.pose, s.skin, s.wrist);
  assert.equal(r.measurement.width, null); assert.equal(r.mask, null);
});

test('Interior shadow cannot replace the model-supported skin silhouette', () => {
  const s = scene(1400, { shadow: true }), r = measureSegmentedWrist(s.roi, s.pose, s.skin, s.wrist);
  assert.ok(r.measurement.width && Math.abs(r.measurement.width - .18) < .003, r.measurement.reason);
});

test('Native 480/960/1920px and rotated wrists preserve width units and camera inverse', () => {
  for (const W of [480, 960, 1920]) for (const roll of [0, .4]) {
    const s = scene(W, { roll }), r = measureSegmentedWrist(s.roi, s.pose, s.skin, s.wrist);
    assert.ok(r.measurement.width && Math.abs(r.measurement.width - .18) < .005, r.measurement.reason);
    const registered = registerImageWrist(s.pose, r.measurement), fitted = new WristSizer().update(registered, r.measurement, 0, { input: 'image' }); assert.ok(fitted.pose);
    assert.ok(Math.abs(projectedWidth(fitted.pose, fitted.pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) - r.measurement.width) < 1e-8);
  }
});

test('Registration uses verified midpoint only, preserving quaternion, radius, Z and input objects', () => {
  const s = scene(), observation = measureSegmentedWrist(s.roi, s.pose, s.skin, s.wrist), before = JSON.stringify(s.pose);
  const registered = registerImageWrist(s.pose, observation.measurement); assert.notEqual(registered, s.pose);
  assert.equal(JSON.stringify(s.pose), before); assert.equal(registered.orientation, s.pose.orientation); assert.equal(registered.center.z, s.pose.center.z); assert.equal(registered.radius, s.pose.radius);
  const p = project(registered.center, registered), m = observation.measurement;
  assert.ok(Math.abs(p.x - (m.left!.x + m.right!.x) / 2) < 1e-9 && Math.abs(p.y - (m.left!.y + m.right!.y) / 2) < 1e-9);
  for (const bad of [{ ...m, confidence: .5 }, { ...m, width: null }, { ...m, sampleCount: 2 }, { ...m, left: { x: .01, y: .01 }, right: { x: .1, y: .01 } }]) assert.equal(registerImageWrist(s.pose, bad), s.pose);
});

test('Probability maps use x/W,y/H while measurements use image width on both axes', () => {
  const skin = { width: 2, height: 2, confidence: new Float32Array([1, 0, 0, 0]) };
  assert.equal(skinProbability(skin, { x: .25, y: .5 }, 2), 1);
  assert.equal(skinProbability(skin, { x: .75, y: .5 }, 2), 0);
  assert.equal(skinProbability(skin, { x: .25, y: 1.5 }, 2), 0);
  assert.equal(skinProbability({ ...skin, confidence: new Float32Array([NaN, 0, 0, 0]) }, { x: .25, y: .5 }, 2), 0);
});

test('Contact restriction affects only proxy shadow when an image mask is enabled', () => {
  const clip = new ImageOcclusion(), material = new THREE.ShadowMaterial(); clip.install(material, true);
  const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: 'void main() {\n#include <tonemapping_fragment>\n}' } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.match(shader.vertexShader, /imageProxyZ = position.z/);
  assert.match(shader.fragmentShader, /if \(imageMaskEnabled\) gl_FragColor.a/);
  assert.match(shader.fragmentShader, /smoothstep\(0.110000, 0.220000/);
  assert.equal(clip.uniforms.imageMaskEnabled.value, false, 'webcam retains original shadow behavior'); clip.dispose(); material.dispose();
});
