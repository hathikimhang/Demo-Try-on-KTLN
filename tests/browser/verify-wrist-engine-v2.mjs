import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real MediaPipe on a photograph captureStream. NOT a physical webcam test.
const base = process.env.AR_URL ?? 'http://127.0.0.1:5173';
const out = process.env.MIRA_V2_OUT ?? 'artifacts/wrist-engine-v2-fix';
const fixture = process.env.MIRA_HAND_FIXTURE ?? join(tmpdir(), 'mira-dynamic-pointing_up.jpg');
let fixtureBytes;
try { fixtureBytes = await readFile(fixture); } catch {
  if (process.env.MIRA_HAND_FIXTURE) throw Error(`Cannot read MIRA_HAND_FIXTURE: ${fixture}`);
  const response = await fetch('https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg');
  if (!response.ok) throw Error(`Fixture HTTP ${response.status}`);
  fixtureBytes = Buffer.from(await response.arrayBuffer()); await writeFile(fixture, fixtureBytes);
}
const bytes = fixtureBytes.toString('base64');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
const rows = [], errors = [], stabilityRows = [];
const report = { scope: 'Photo captureStream, real MediaPipe; no hardware webcam accuracy claim', checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.text().startsWith('[mira-live] ')) rows.push(JSON.parse(m.text().slice(12))); if (m.text().startsWith('[mira-stability] ')) stabilityRows.push(JSON.parse(m.text().slice(17))); });
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.evaluate(async bytes => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${bytes}`; await image.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 720; const ctx = c.getContext('2d');
    const draw = () => { ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720); ctx.save(); ctx.translate(320, 475); ctx.scale(1.3, 1.3); ctx.drawImage(image, -176, -286); ctx.restore(); requestAnimationFrame(draw); }; draw();
    window.cameraRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.cameraRequests++; return c.captureStream(24); } });
  }, bytes);
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  const until = async predicate => {
    const deadline = Date.now() + 60000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out waiting for real inference'); await page.waitForTimeout(150); }
  };
  await until(() => rows.some(r => r.live.hasRenderPose));
  const selector = page.getByTestId('wrist-engine-mode');
  assert.equal(await selector.inputValue(), 'v1');
  assert.ok(rows.every(r => r.live.wristEngineV2 == null));
  report.checks.push('PASS default V1, no V2 output');
  await selector.selectOption('compare');
  await until(() => rows.filter(r => r.live.wristEngineV2?.hand0).length >= 5);
  for (const r of rows.filter(r => r.live.wristEngineV2)) {
    const p = r.live.wristEngineV2;
    assert.equal(p.frameId, r.live.observationFrameId);
    assert.equal(p.timestamp, r.live.capturedAt);
    assert.equal(p.width, r.live.frameSize.width);
    assert.equal(p.height, r.live.frameSize.height);
    if (p.hand0) {
      assert.ok(Math.abs(p.hand0.x - r.live.wristLandmark.x) < 1e-12);
      assert.ok(Math.abs(p.hand0.y - r.live.wristLandmark.y * p.height / p.width) < 1e-12);
    }
    assert.equal(p.wearCenter, null);
    assert.deepEqual(p.rawAnchor, p.filteredAnchor);
    assert.equal(p.filterApplied, false);
    assert.deepEqual(p.traceInput.hand, r.live.landmarks);
    assert.equal(p.traceInput.frameId, p.frameId);
    assert.equal(p.traceInput.timestamp, p.timestamp);
    assert.ok(Array.isArray(p.traceInput.pose) && Array.isArray(p.traceInput.poseWorld));
    if (p.orientationState === 'UNCONFIRMED') assert.equal(p.orientation, null);
  }
  report.checks.push('PASS Compare shares actual frame/Hand0; no fabricated wear center');
  await page.screenshot({ path: `${out}/compare.png`, fullPage: true });
  const start = rows.length; await selector.selectOption('v2');
  await until(() => rows.slice(start).some(r => r.live.wristEngineV2 && r.live.hasRenderPose));
  await until(() => stabilityRows.some(r => r.braceletEngine === 'v1-geometry+v2-continuity' && r.braceletVisible));
  const stable = stabilityRows.filter(r => r.braceletEngine === 'v1-geometry+v2-continuity');
  for (const r of stable.filter(r => r.braceletVisible)) {
    assert.equal(r.imageTimestamp, r.poseTimestamp);
    assert.ok(r.poseAgeMs <= 1000);
    assert.equal(typeof r.filterResetCount, 'number');
  }
  report.checks.push('PASS V2 continuity uses matched image/pose and records actual reset counter');
  await page.screenshot({ path: `${out}/v2.png`, fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất trace JSON', exact: true }).click();
  await (await downloadPromise).saveAs(`${out}/trace.json`);
  const exported = JSON.parse(await readFile(`${out}/trace.json`, 'utf8'));
  assert.ok(exported.samples.some(r => r.live?.wristEngineV2?.traceInput?.hand?.length === 21));
  report.checks.push('PASS exported per-frame raw Hand/Pose/contour, anchor/filter/quaternion trace');
  const before = rows.length; await selector.selectOption('v1');
  await until(() => rows.slice(before + 1).some(r => r.live.wristEngineV2 == null && r.live.hasRenderPose));
  assert.equal(await page.evaluate(() => window.cameraRequests), 1);
  report.checks.push('PASS V1 rollback without reopening camera');

  // Deterministic pipeline parity, separate from real inference above. Same bitmap,
  // raw Hand/Pose and timestamp; compare every V1 output field, including pixels.
  report.parity = await page.evaluate(async () => {
    const { LiveVision } = await import('/src/features/bracelet/services/live/liveVision.ts');
    const { handFixture } = await import('/src/features/bracelet/tests/fixtures/wristFixtures.ts');
    const { points, world } = handFixture();
    const c = new OffscreenCanvas(640, 480), ctx = c.getContext('2d'); ctx.fillStyle = '#aaa'; ctx.fillRect(0, 0, 640, 480);
    const bitmap = await createImageBitmap(c), a = new LiveVision(), b = new LiveVision();
    try {
      for (let i = 1; i <= 8; i++) {
        const input = { points: i === 5 ? [] : points, worldPoints: world, armPoints: [], armWorldPoints: [], handedness: 'Right', timestamp: i * 100, frameId: i, mode: 'straight-wrist' };
        const normal = a.observe(bitmap, input), debug = b.observe(bitmap, { ...input, pocEnabled: i % 3 !== 0 });
        const { poc, ...v1Fields } = debug;
        if (JSON.stringify(normal) !== JSON.stringify(v1Fields)) throw Error(`V1 parity failed at frame ${i}`);
      }
      return 'PASS all V1 output fields identical with V2 on/off across Hand loss';
    } finally { bitmap.close(); }
  });
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: /Tắt camera/ }).click();
  report.checks.push('PASS camera cleanup, no page errors');
  report.result = 'PASS';
} catch (e) {
  report.result = 'FAIL'; report.error = String(e); process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ ...report, errors, samples: rows.length }, null, 2));
  await browser.close(); console.log(JSON.stringify(report, null, 2));
}
