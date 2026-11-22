import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.env.AR_URL ?? 'http://127.0.0.1:5173', out = resolve('artifacts/live-camera');
await mkdir(out, { recursive: true });
const fixture = join(tmpdir(), 'mira-dynamic-pointing_up.jpg');
try { await readFile(fixture); } catch { const r = await fetch('https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg'); if (!r.ok) throw Error(`Fixture HTTP ${r.status}`); await writeFile(fixture, new Uint8Array(await r.arrayBuffer())); }
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
const report = { scope: 'Real MediaPipe VIDEO inference on a photo/canvas captureStream. NOT a hardware webcam or real 3D hand rotation.', cases: [], errors: [] }, samples = [];
let page;
const check = (ok, why) => { if (!ok) throw Error(why); };
const until = async (predicate, why, timeout = 60000) => { const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw Error(`Timeout: ${why}`); await new Promise(r => setTimeout(r, 100)); } };
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.text().startsWith('[mira-live] ')) { try { samples.push(JSON.parse(m.text().slice(12))); } catch { report.errors.push('Malformed live diagnostic'); } } });
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.evaluate(async bytes => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${bytes}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 720; const ctx = canvas.getContext('2d');
    window.liveTransform = { scale: 1, roll: 0, x: 0, partial: false, hidden: false };
    const draw = () => {
      const t = window.liveTransform;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720);
      if (!t.hidden) { ctx.translate(320 + t.x, 475); ctx.rotate(t.roll); ctx.scale(t.scale * 1.3, t.scale * 1.3); ctx.drawImage(image, -176, -286); }
      if (t.partial) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 460); }
      window.liveAnimation = requestAnimationFrame(draw);
    }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.liveStream = canvas.captureStream(24); return window.liveStream; } });
  }, (await readFile(fixture)).toString('base64'));
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await until(() => samples.some(s => s.live.state === 'TRACKING'), 'initial real Hand + measured fit');
  const first = samples.find(s => s.live.state === 'TRACKING'); check(first.manualFitMultiplier === 1, 'no hidden manual enlargement');
  const settle = async (name, transform) => {
    const start = samples.length;
    await page.evaluate(t => { window.liveTransform = t; }, transform);
    await until(() => samples.length >= start + 14, `${name} frames`);
    const rows = samples.slice(-5).filter(s => s.wristRadius && s.trackingSource === 'Hand Landmarker');
    check(rows.length >= 3, `${name}: actual valid Hand poses`);
    const last = rows.at(-1);
    check(last.finalBraceletWorldScale > 0 && last.wristProxyScale > 0, `${name}: positive independent scales`);
    check(rows.every(s => s.live.sameInferenceFrame && s.live.totalAgeMs <= 1000), `${name}: no stale frame/landmark mixing`);
    const item = { name, state: last.live.state, radius: last.wristRadius, intrinsic: last.calibrationRadiusRatio, distance: last.distanceScale, wristPx: last.wristProjectedWidthPx, braceletPx: last.braceletProjectedWidthPx, observedPx: last.live.measuredWidthPx, manual: last.manualFitMultiplier, maxRotationDelta: Math.max(...rows.map(s => s.live.rotationDeltaRadians)) };
    report.cases.push(item); console.log(`${name}: ${item.wristPx.toFixed(1)}px wrist / ${item.braceletPx.toFixed(1)}px inner`); return item;
  };
  const stationary = await settle('stationary', { scale: 1, roll: 0, x: 0 });
  const stable = samples.slice(-5); check(Math.max(...stable.map(s => s.wristRadius)) / Math.min(...stable.map(s => s.wristRadius)) < 1.07, 'stationary radius stable');
  check(stationary.maxRotationDelta < .02, 'stationary orientation does not pulse on sparse segmentation frames');
  await page.screenshot({ path: join(out, 'stationary-debug.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).uncheck();
  await page.screenshot({ path: join(out, 'stationary.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  const far = await settle('far-image-scale-0.8', { scale: .8, roll: 0, x: 0 });
  const near = await settle('near-image-scale-1.15', { scale: 1.15, roll: 0, x: 0 });
  check(near.braceletPx / far.braceletPx > 1.25, 'near/far projected width follows observed image scale');
  for (const roll of [-.3, .3, 0]) await settle(`observed-image-roll-${roll}`, { scale: 1, roll, x: 0 });
  await page.locator('#size').fill('1.3');
  const manual = await settle('manual-130-independent', { scale: 1, roll: 0, x: 0 });
  check(manual.manual === 1.3 && Math.abs(manual.intrinsic / stationary.intrinsic - 1) < .1, 'manual trim does not alter wrist calibration');
  await page.locator('#size').fill('1');
  const cropStart = samples.length;
  await page.evaluate(() => { window.liveTransform = { scale: 1, roll: 0, x: 3, partial: true }; });
  await until(() => samples.slice(cropStart).some(s => s.trackingSource === 'ROI' || s.live.state === 'LOST'), 'real ROI tracking or explicit rejection after Hand loss', 20000);
  report.partial = samples.slice(cropStart).find(s => s.trackingSource === 'ROI') ?? null;
  if (report.partial) check(report.partial.roi.inliers >= 6 && report.partial.live.state === 'DEGRADED', 'bounded ROI, not invented Hand landmarks');
  else {
    // The fixture's skin sometimes has too few unique surviving patches.
    // This is a negative correspondence test, NOT successful partial tracking.
    report.partialRejected = samples.slice(cropStart).find(s => s.live.roiReason?.startsWith('Không đủ texture/')) ?? null;
    check(report.partialRejected && report.partialRejected.roi.matches < 6, 'unsupported crop needs an explicit insufficient-correspondence reason');
    check(samples.slice(cropStart).some(s => s.trackingSource === 'Grace frame'), 'rejected ROI still has bounded matched-frame grace');
  }
  await page.screenshot({ path: join(out, 'partial-hand.png'), fullPage: true });
  await until(() => samples.slice(cropStart).some(s => s.live.state === 'LOST'), 'ROI/calibration expiration', 20000);
  const lostStart = samples.length;
  await page.evaluate(() => { window.liveTransform = { scale: 1, roll: 0, x: 0, hidden: true }; });
  await until(() => samples.length >= lostStart + 6, 'lost frames');
  check(samples.at(-1).wristRadius === null, 'no ring after true tracking loss');
  const lastHandAt = samples.findLast(s => s.live.landmarks.length > 0)?.timestampMs ?? 0;
  await until(() => samples.at(-1).timestampMs - lastHandAt > 1800, 'actual Hand absence exceeds calibration retention before reacquisition');
  const restart = samples.length;
  await page.evaluate(() => { window.liveTransform = { scale: 1, roll: 0, x: 0 }; });
  await until(() => samples.slice(restart).some(s => s.live.state === 'TRACKING'), 'reacquisition with new measurement');
  report.reacquired = samples.slice(restart).find(s => s.live.state === 'TRACKING');
  check(samples.slice(restart).some(s => s.live.state === 'ACQUIRING' && s.fitStatus === 'provisional' && s.calibrationRadiusRatio === null), 'reappearance starts a fresh, explicitly estimated fit rather than reusing old calibration');
  await page.getByRole('button', { name: 'Chụp & lưu ảnh', exact: true }).click();
  await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  check(await page.evaluate(() => { cancelAnimationFrame(window.liveAnimation); return window.liveStream.getTracks().every(t => t.readyState === 'ended'); }), 'camera stream is released');
  check(!report.errors.length, JSON.stringify(report.errors));
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.cases, null, 2)); console.log(`PASS real VIDEO Hand inference, camera fit, independent manual scale, reacquisition; partial crop: ${report.partial ? 'actual ROI correspondences' : 'explicitly rejected (insufficient correspondences), NOT successful ROI tracking'}`);
} catch (error) {
  report.failure = String(error); if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); throw error;
} finally { await writeFile(join(out, 'debug-log.json'), JSON.stringify({ scope: report.scope, samples }, null, 2)); await browser.close(); }
