import assert from 'node:assert/strict';
import * as THREE from 'three';
import { estimateWrist, project } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';
import type { NativeRoi } from '../models/imageCoordinates';
import { imageWristFrame, wristImageRoi, measureImageWrist, manualImageWrist, fillMaskHoles } from '../services/measurement/imageWristMeasurement';
import type { WristPose } from '../models/wrist.types';
import { test } from 'node:test';
import { WristSizer, projectedWidth } from '../services/fitting/braceletSizing';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
import { WRIST_MODEL_RADIUS, FOREARM, imageRenderFit, BANGLE_INNER_RADIUS, BANGLE } from '../models/braceletDimensions';
import { createBraceletObjects, applyCameraPose, disposeObjects } from '../views/rendering/braceletModel';
import { clientToImagePoint } from '../models/imageCoordinates';
import { ImageOcclusion } from '../views/rendering/imageOcclusion';
function fixture(options: Parameters<typeof handFixture>[0] = {}) {
  const f = handFixture(options), pose = estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' }); assert.ok(pose); return { ...f, pose };
}

function raster(pose: WristPose, wrist: { x: number; y: number }, width = 1200, wristWidth = .18, options: { shadow?: boolean; highlight?: boolean; ambiguous?: boolean; contourNoise?: boolean } = {}): NativeRoi {
  const height = Math.round(width * pose.aspect), region = wristImageRoi(pose, width, height, wrist);
  const data = new Uint8ClampedArray(region.width * region.height * 4), f = imageWristFrame(pose, wrist);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const px = (region.x + x) / width - f.anchor.x, py = (region.y + y) / width - f.anchor.y;
    const lateral = px * f.transverse.x + py * f.transverse.y, along = px * f.along.x + py * f.along.y;
    const shift = options.contourNoise ? .03 * Math.sin(along * 600) : 0;
    const skin = Math.abs(lateral - shift) <= wristWidth / 2;
    let color = skin ? [185, 132, 100] : [246, 247, 249];
    if (options.ambiguous) color = [185, 132, 100];
    if (skin && options.shadow && lateral > -.025 && lateral < .03) color = color.map(v => v * .4);
    if (skin && options.highlight && Math.abs(lateral - .045) < .006) color = [246, 247, 249];
    data.set([...color, 255], (y * region.width + x) * 4);
  }
  return { ...region, data };
}


test('Upload: đo trên ROI pixel gốc, cổ tay nhỏ/lớn độc lập anatomical prior', () => {
  const f = fixture();
  for (const width of [.12, .20, .26]) {
    const r = measureImageWrist(raster(f.pose, f.points[0], 1200, width), f.pose, f.points[0]);
    assert.ok(r.measurement.width, r.measurement.reason);
    assert.ok(Math.abs(r.measurement.width - width) < 2 / 1200);
    assert.ok(r.measurement.sampleCount! >= 5 && r.mask);
    assert.equal(r.measurement.image?.imageWidth, 1200);
    assert.ok(!JSON.stringify(r.measurement.image).includes('"data"'), 'debug must not retain pixels');
  }
});

test('Native crop origin, portrait/landscape and roll do not change coordinate units', () => {
  for (const opts of [{ aspect: 1.4, roll: .4 }, { aspect: .6, roll: -.3 }, { x: .58, y: .38, roll: Math.PI / 2 }]) {
    const f = fixture(opts), r = measureImageWrist(raster(f.pose, f.points[0], 1600, .18), f.pose, f.points[0]);
    assert.ok(r.measurement.width && Math.abs(r.measurement.width - .18) < .002, r.measurement.reason);
    assert.ok(r.measurement.left && r.measurement.right);
    assert.ok(Math.abs(Math.hypot(r.measurement.left.x - r.measurement.right.x, r.measurement.left.y - r.measurement.right.y) - r.measurement.width) < 1e-8);
  }
});

test('Shadow and interior highlight do not become false, narrower wrist boundaries', () => {
  const f = fixture();
  for (const options of [{ shadow: true }, { highlight: true }, { shadow: true, highlight: true }]) {
    const r = measureImageWrist(raster(f.pose, f.points[0], 1400, .20, options), f.pose, f.points[0]);
    assert.ok(r.measurement.width && Math.abs(r.measurement.width - .20) < .002, r.measurement.reason);
  }
});

test('Foreground/background overlap rejects measurement and never invents successful Auto Fit', () => {
  const f = fixture(), r = measureImageWrist(raster(f.pose, f.points[0], 1000, .18, { ambiguous: true }), f.pose, f.points[0]);
  assert.equal(r.measurement.width, null); assert.equal(r.mask, null);
  assert.match(r.measurement.image!.rejection!, /too-few-slices/);
  assert.ok(Object.keys(r.measurement.image!.rejected).some(s => s.includes('foreground-ambiguous')));
  const fit = new WristSizer().update(f.pose, r.measurement, 0, { input: 'image' });
  assert.equal(fit.method, 'provisional'); assert.equal(fit.pose?.calibrationRadius, undefined);
});

test('Live mask optimization preserves full native measurement, refinement, reject reasons and mask bytes', () => {
  for(const options of [{},{shadow:true},{highlight:true},{ambiguous:true},{contourNoise:true}]) {
    const f=fixture({roll:.17}), image=raster(f.pose,f.points[0],800,.20,options);
    assert.deepEqual(measureImageWrist(image,f.pose,f.points[0],true,0,true),measureImageWrist(image,f.pose,f.points[0]));
  }
});

test('Contour with repeated lateral jumps rejects even when every cut has similar width', () => {
  const f = fixture(), r = measureImageWrist(raster(f.pose, f.points[0], 1400, .20, { contourNoise: true }), f.pose, f.points[0]);
  assert.equal(r.measurement.width, null); assert.match(r.measurement.reason, /centerline|contour/);
});

test('Contour-based image axis refinement remeasures perpendicular sections, not 1/cos sizing', () => {
  const f = fixture(), image = raster(f.pose, f.points[0], 1800, .18);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .17).multiply(new THREE.Quaternion(f.pose.orientation.x, f.pose.orientation.y, f.pose.orientation.z, f.pose.orientation.w));
  const guessed = { ...f.pose, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } }, original = JSON.stringify(guessed);
  const r = measureImageWrist(image, guessed, f.points[0]);
  assert.equal(JSON.stringify(guessed), original); assert.ok(!('pose' in r), 'image-axis refinement must not supply a render pose');
  assert.ok(r.measurement.width, r.measurement.reason);
  assert.ok(Math.abs(r.measurement.width - .18) < .003);
  assert.ok(Math.abs(r.measurement.image!.angleCorrection) > 5);
});

test('Native 600/1200/2400 px measurements scale linearly; scene radius and fit ratio stay constant', () => {
  const f = fixture(), values: number[] = [];
  for (const W of [600, 1200, 2400]) {
    const r = measureImageWrist(raster(f.pose, f.points[0], W, .18), f.pose, f.points[0]);
    const fit = new WristSizer().update(f.pose, r.measurement, 0, { input: 'image' }); assert.ok(fit.pose);
    assert.equal(fit.method, 'image'); values.push(fit.pose.radius);
    const d = sizingDebug(fit.pose, 1, 800, r.measurement, fit.method, '');
    assert.ok(Math.abs(d.nativeWristWidthPx! - W * .18) < 2);
    assert.ok(d.fitRatio! > 1 && d.fitRatio! < 1.2);
  }
  assert.ok(Math.max(...values) / Math.min(...values) < 1.01);
});

test('Manual edge pair sets width and preserves tracking transform; remains distinct from Auto Fit even with auto disabled', () => {
  const f = fixture(), center = project(f.pose.center, f.pose), axis = imageWristFrame(f.pose).transverse;
  const pair = [-1, 1].map(s => ({ x: center.x + axis.x * .10 * s, y: center.y + axis.y * .10 * s })) as [{ x: number; y: number }, { x: number; y: number }];
  const r = manualImageWrist(f.pose, pair, { width: 1600, height: 1200 });
  const fit = new WristSizer().update(f.pose, r.measurement, 0, { input: 'image', auto: false }); assert.ok(fit.pose);
  assert.equal(fit.method, 'manual-edges'); assert.equal(r.mask, null);
  assert.ok(Math.abs(projectedWidth(fit.pose, fit.pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) - .20) < 1e-8);
  assert.deepEqual(project(fit.pose.center, fit.pose), project(f.pose.center, f.pose));
  const blocked = new WristSizer().update(f.pose, r.measurement, 0, { input: 'image', policy: 'fixed-size' });
  assert.equal(blocked.method, 'blocked');
});

test('Bad manual pair along the forearm, remote pair, zero width cannot calibrate', () => {
  const f = fixture(), c = project(f.pose.center, f.pose), frame = imageWristFrame(f.pose);
  for (const pair of [[c, c], [c, { x: c.x + frame.along.x * .2, y: c.y + frame.along.y * .2 }], [{ x: .01, y: .01 }, { x: .05, y: .01 }]] as [{ x: number; y: number }, { x: number; y: number }][]) {
    const r = manualImageWrist(f.pose, pair, { width: 1200, height: 900 }); assert.equal(r.measurement.width, null); assert.match(r.measurement.reason, /manual-pair-invalid/);
  }
});

test('Manual 85% collision limit derives from geometry and never scales the proxy or tracking transform', () => {
  const f = fixture(), model = createBraceletObjects(), effective = imageRenderFit(.85, true);
  assert.ok(effective > .85 && effective < 1);
  assert.equal(imageRenderFit(.85, false), .85, 'camera/provisional behavior unchanged');
  assert.equal(imageRenderFit(1.5, true), 1.5);
  for (let i = 0; i < 25; i++) {
    applyCameraPose(model.group, f.pose, effective);
    assert.equal(model.wrist.scale.x, f.pose.radius);
    assert.equal(model.bracelet.scale.x, f.pose.radius * effective); assert.equal(model.group.scale.x, 1);
    assert.ok(BANGLE_INNER_RADIUS * effective > WRIST_MODEL_RADIUS);
  }
  disposeObjects(model.group);
});

test('Click mapping handles contain letterbox, portrait, CSS scaling and canvas pixels independent of DPR', () => {
  assert.deepEqual(clientToImagePoint({ left: 20, top: 10, width: 800, height: 600 }, { width: 400, height: 800 }, { width: 1000, height: 2000 }, 420, 310), { x: .5, y: 1 });
  assert.equal(clientToImagePoint({ left: 20, top: 10, width: 800, height: 600 }, { width: 400, height: 800 }, { width: 1000, height: 2000 }, 40, 310), null);
  assert.deepEqual(clientToImagePoint({ left: 0, top: 0, width: 600, height: 300 }, { width: 1600, height: 800 }, { width: 4000, height: 2000 }, 300, 150), { x: .5, y: .25 });
  assert.equal(clientToImagePoint({ left: 0, top: 0, width: 0, height: 0 }, { width: 1, height: 1 }, { width: 1, height: 1 }, 0, 0), null);
});

test('Foreground mask fills enclosed highlight holes but preserves exterior background', () => {
  const data = new Uint8Array(49);
  for (let y = 1; y < 6; y++) for (let x = 2; x < 5; x++) data[y * 7 + x] = 255;
  data[3 * 7 + 3] = 0; fillMaskHoles(data, 7, 7);
  assert.equal(data[3 * 7 + 3], 255); assert.equal(data[3 * 7], 0); assert.equal(data[0], 0);
});

test('Mask uses original photo UV and clips only depth/shadow passes; disabled for webcam', () => {
  const f = fixture(), r = measureImageWrist(raster(f.pose, f.points[0]), f.pose, f.points[0]); assert.ok(r.mask);
  const clip = new ImageOcclusion(), material = new THREE.MeshBasicMaterial(); clip.install(material);
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.match(shader.fragmentShader, /1.0 - gl_FragCoord.y/); assert.match(shader.fragmentShader, /discard/);
  clip.update(r.mask, 1200, 900); assert.equal(clip.uniforms.imageMaskEnabled.value, true);
  assert.equal(clip.uniforms.imageMask.value?.flipY, false);
  clip.update(null, 1200, 900); assert.equal(clip.uniforms.imageMaskEnabled.value, false);
  assert.equal(clip.uniforms.imageMask.value, null); clip.dispose(); material.dispose();
});

test('Image remeasure uses latest trusted edges without frozen prior or cumulative Manual Fit', () => {
  const f = fixture(), sizer = new WristSizer();
  for (const width of [.14, .24, .18]) {
    const r = measureImageWrist(raster(f.pose, f.points[0], 1000, width), f.pose, f.points[0]), fit = sizer.update(f.pose, r.measurement, 100, { input: 'image' }); assert.ok(fit.pose);
    assert.equal(fit.method, 'image');
    assert.ok(Math.abs(projectedWidth(fit.pose, fit.pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) - width) < .002);
    for (const multiplier of [1, 1.5]) {
      const d = sizingDebug(fit.pose, multiplier, 1000, r.measurement, fit.method, '');
      assert.equal(d.finalWorldScale, fit.pose.radius * multiplier);
      assert.ok(d.braceletInnerDiameter / d.estimatedWristDiameter > multiplier);
      assert.ok(d.braceletInnerMinorDiameter > d.wristMinorDiameter);
    }
  }
  assert.ok(BANGLE.oval > FOREARM.oval);
});

test('A failed image remeasurement clears old measured success, while manual edge pairs remain explicit', () => {
  const f = fixture(), sizer = new WristSizer(), good = measureImageWrist(raster(f.pose, f.points[0]), f.pose, f.points[0]);
  assert.equal(sizer.update(f.pose, good.measurement, 0, { input: 'image' }).method, 'image');
  const bad = measureImageWrist(raster(f.pose, f.points[0], 1200, .18, { ambiguous: true }), f.pose, f.points[0]);
  const fit = sizer.update(f.pose, bad.measurement, 100, { input: 'image' });
  assert.equal(fit.method, 'provisional'); assert.equal(fit.pose?.calibrationRadius, undefined);
});
