import assert from 'node:assert/strict';
import * as THREE from 'three';
import { test } from 'node:test';
import { createBangleGeometry, createForearmGeometry, createBraceletObjects, disposeObjects, configureCamera, applyCameraPose } from '../views/rendering/braceletModel';
import { project, estimateWrist } from '../services/geometry/wristGeometry';
import type { WristPose } from '../models/wrist.types';
import { handFixture } from './fixtures/wristFixtures';
function closedSurface(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position'), index = geometry.getIndex()!;
  const points = new Map<string, number>(), ids: number[] = [], edges = new Map<string, number>();
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(x => x.toFixed(5).replace('-0.00000', '0.00000')).join(',');
    if (!points.has(key)) points.set(key, points.size);
    ids.push(points.get(key)!);
  }
  for (let i = 0; i < index.count; i += 3) {
    const tri = [0, 1, 2].map(j => ids[index.getX(i + j)]);
    assert.equal(new Set(tri).size, 3, 'non-degenerate triangle');
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.ok([...edges.values()].every(count => count === 2), 'every geometric edge belongs to two faces; no open ends');
}

test('Bangle và proxy là bề mặt khép kín, không có khe seam hoặc đầu mở', () => {
  for (const geometry of [createBangleGeometry(), createForearmGeometry()]) { closedSurface(geometry); geometry.dispose(); }
});

test('Vật liệu PBR, proxy chỉ ghi depth và không tô màu ảnh', () => {
  const model = createBraceletObjects();
  assert.ok(model.metal instanceof THREE.MeshPhysicalMaterial); assert.equal(model.metal.metalness, 1);
  assert.equal(model.occluder.material.colorWrite, false); assert.equal(model.occluder.material.depthWrite, true);
  assert.equal(model.band.material.depthTest, true); assert.equal(model.gems.count, 22);
  disposeObjects(model.group);
});

test('Camera CV → Three.js chiếu cùng vị trí, bao gồm ảnh dọc và ngang', () => {
  for (const aspect of [0.5625, 0.75, 1, 1.5, 1.777]) {
    const camera = new THREE.PerspectiveCamera(); configureCamera(camera, 1.35 * Math.max(1, aspect), aspect);
    const p = { x: 0.2, y: -0.12, z: 1.8 }, expected = project(p, { focal: 1.35 * Math.max(1, aspect), aspect });
    const projected = new THREE.Vector3(p.x, -p.y, -p.z).project(camera);
    assert.ok(Math.abs((projected.x + 1) / 2 - expected.x) < 1e-7);
    assert.ok(Math.abs((1 - projected.y) / 2 * aspect - expected.y) < 1e-7);
  }
});

test('Model giữ nguyên đỉnh và tỷ lệ hình học khi xoay 360°, hiệu chỉnh size chỉ scale đều', () => {
  const model = createBraceletObjects(), initial = Array.from(model.band.geometry.getAttribute('position').array);
  for (let i = 0; i <= 36; i++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(i / 36 * Math.PI * 2, Math.PI / 4, Math.PI / 2));
    const pose: WristPose = { center: { x: 0.1, y: 0.1, z: 1.35 }, radius: 0.04, orientation: q, palmLength: 0.1, aspect: 0.75, focal: 1.35, handedness: 'Right' };
    applyCameraPose(model.group, pose, 0.65 + i / 36 * 0.75);
    assert.equal(model.group.scale.x, model.group.scale.y); assert.equal(model.group.scale.x, model.group.scale.z);
    assert.deepEqual(Array.from(model.band.geometry.getAttribute('position').array), initial);
    assert.ok(Math.abs(model.group.quaternion.length() - 1) < 1e-7);
  }
  disposeObjects(model.group);
});


test('Lỗ vòng có ít nhất 8% khoảng hở so với proxy, cả khi xoay và tăng độ vừa 100–150%', () => {
  const model = createBraceletObjects();
  const vertices = model.band.geometry.getAttribute('position');
  for (const twist of [0, Math.PI / 4, Math.PI / 2]) {
    for (const fit of [1, 1.4, 1.5]) {
      const pose: WristPose = {
        center: { x: .1, y: -.1, z: 1.35 }, radius: .07, palmLength: .15,
        orientation: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, twist, Math.PI / 2)),
        focal: 1.35, aspect: .75, handedness: 'Right',
      };
      applyCameraPose(model.group, pose, fit); model.group.updateMatrixWorld(true);
      for (let i = 0; i < vertices.count; i++) {
        const p = model.occluder.worldToLocal(model.band.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i)));
        const proxyRadius = 1.02 + .02 * p.z;
        const distance = Math.hypot(p.x / proxyRadius, p.y / (proxyRadius * .72));
        assert.ok(distance > 1.08, `band intersects or lacks clearance: ${distance}`);
      }
      assert.equal(model.band.scale.x, model.band.scale.y);
      assert.equal(model.band.scale.x, model.band.scale.z);
      assert.equal(model.band.scale.x, model.gems.scale.x);
    }
  }
  disposeObjects(model.group);
});



test('Xoay bàn tay 90°: bề rộng hình chiếu đổi theo ellipse 3D, không co về bề rộng MCP 2D', () => {
  const model = createBraceletObjects(), camera = new THREE.PerspectiveCamera();
  const widths: number[] = [];
  for (const twist of [0, Math.PI / 2]) {
    const f = handFixture({ twist });
    const pose = estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' });
    assert.ok(pose);
    configureCamera(camera, pose.focal, pose.aspect);
    applyCameraPose(model.group, pose, 1); model.group.updateMatrixWorld(true);
    const vertices = model.band.geometry.getAttribute('position');
    const xs = Array.from({ length: vertices.count }, (_, i) => model.band.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i)).project(camera).x);
    widths.push(Math.max(...xs) - Math.min(...xs));
  }
  assert.ok(widths[1] / widths[0] > .75 && widths[1] / widths[0] < .95, 'oval design foreshortens, physical size stays constant');
  disposeObjects(model.group);
});


test('Scene chỉ có một band; proxy không phủ vào lòng bàn tay và debug mặc định tắt', () => {
  const model = createBraceletObjects();
  assert.equal(model.group.getObjectsByProperty('name', 'closed-bangle').length, 1);
  assert.equal(model.group.getObjectsByProperty('name', 'forearm-depth-only').length, 1);
  assert.equal(model.debugProxy.visible, false);
  assert.equal(model.debugProxy.material.depthWrite, false);
  model.occluder.geometry.computeBoundingBox();
  const bounds = model.occluder.geometry.boundingBox!;
  assert.ok(Math.abs(bounds.min.z + .75) < 1e-6 && Math.abs(bounds.max.z - 3.25) < 1e-6);
  assert.ok(model.occluder.renderOrder < model.band.renderOrder);
  assert.ok(model.band.material.depthTest && model.occluder.material.depthWrite);
  disposeObjects(model.group);
});
