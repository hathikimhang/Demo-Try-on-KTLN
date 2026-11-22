import assert from 'node:assert/strict';
import * as THREE from 'three';
import { estimateWrist } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';
import { test } from 'node:test';
import { braceletRenderFrame, renderPose } from '../models/braceletRenderFrame';
import { applyCameraPose, createBraceletObjects, disposeObjects } from '../views/rendering/braceletModel';
import { WristSizer } from '../services/fitting/braceletSizing';
import { manualImageWrist } from '../services/measurement/imageWristMeasurement';
import { imageOcclusionOptions } from '../views/rendering/imageOcclusion';
function tracked() {
  const f = handFixture({ tilt: .35 });
  const p = estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' }); assert.ok(p);
  Object.freeze(p.center); Object.freeze(p.orientation); return Object.freeze(p);
}

test('Sizing has no authority over detection position, orientation or camera across 100 different fits', () => {
  const p = tracked(), before = JSON.stringify(p), model = createBraceletObjects();
  const vertices = Float32Array.from(model.band.geometry.attributes.position.array);
  const material = { roughness: model.metal.roughness, metalness: model.metal.metalness, env: model.metal.envMapIntensity };
  let root: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  for (let i = 0; i < 100; i++) {
    const radius = p.radius * (.6 + i / 100), manual = .7 + i / 100;
    const frame = braceletRenderFrame(p, radius, manual, '#c5a15e'), pose = renderPose(frame);
    assert.equal(pose.center, p.center); assert.equal(pose.orientation, p.orientation);
    assert.equal(pose.focal, p.focal); assert.equal(pose.aspect, p.aspect);
    applyCameraPose(model.group, pose, manual);
    if (!root) root = { position: model.group.position.clone(), quaternion: model.group.quaternion.clone() };
    assert.deepEqual(model.group.position.toArray(), root.position.toArray()); assert.deepEqual(model.group.quaternion.toArray(), root.quaternion.toArray());
    assert.equal(model.group.scale.x, 1); assert.equal(model.wrist.scale.x, radius); assert.equal(model.bracelet.scale.x, radius * manual);
  }
  assert.equal(JSON.stringify(p), before); assert.deepEqual(model.band.geometry.attributes.position.array, vertices);
  assert.deepEqual({ roughness: model.metal.roughness, metalness: model.metal.metalness, env: model.metal.envMapIntensity }, material);
  disposeObjects(model.group);
});

test('Two manually selected edges provide size only; they cannot rotate or move the bracelet', () => {
  const p = tracked(), before = JSON.stringify(p);
  const observation = manualImageWrist(p, [{ x: .42, y: .405 }, { x: .58, y: .42 }], { width: 1600, height: 1200 });
  assert.ok(observation.measurement.width);
  assert.ok(!('pose' in observation)); assert.ok(!('orientation' in observation));
  const fitted = new WristSizer().update(p, observation.measurement, 100, { input: 'image', auto: false }); assert.ok(fitted.pose);
  assert.equal(fitted.pose.center, p.center); assert.equal(fitted.pose.orientation, p.orientation);
  assert.equal(JSON.stringify(p), before);
});

test('Missing/ambiguous image mask retains geometric depth fallback independently of fit status', () => {
  const options = imageOcclusionOptions(null);
  assert.equal(options.occlusion, true); assert.equal(options.imageMask, null);
  assert.ok(!('fitMethod' in options)); assert.ok(!('radius' in options));
});

test('Renderer boundary rejects invalid size rather than modifying a tracking transform', () => {
  const p = tracked();
  for (const r of [0, -1, NaN, Infinity]) assert.throws(() => braceletRenderFrame(p, r, 1, '#c5a15e'));
  for (const m of [0, -1, NaN, Infinity]) assert.throws(() => braceletRenderFrame(p, p.radius, m, '#c5a15e'));
});
