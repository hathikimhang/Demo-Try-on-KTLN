import {sourceInitScript} from './support/sourceModules.mjs';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve('artifacts'), base = process.env.AR_URL ?? 'http://127.0.0.1:5173';
await mkdir(out, { recursive: true });
const fixture = join(tmpdir(), 'mira-dynamic-pointing_up.jpg');
try { await readFile(fixture); } catch {
  const r = await fetch('https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg');
  if (!r.ok) throw Error(`Fixture HTTP ${r.status}`); await writeFile(fixture, new Uint8Array(await r.arrayBuffer()));
}
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
const check = (value, message) => { if (!value) throw Error(message); };
const report = { scope: 'Real Hand inference on photo replay; 3D rotation is a controlled mathematical fixture, NOT physical webcam', errors: [], camera: [] };
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(() => {
    const Original = window.Worker; window.sessionFrames = 0;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.addEventListener('message', e => { if (e.data.type === 'result') { window.sessionFrames++; window.sessionHandCount = e.data.points.length; } }); }
    };
  });
  await page.addInitScript({content:sourceInitScript}); await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${data}`; await image.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 720; const ctx = c.getContext('2d');
    window.sessionTransform = { scale: 1, roll: 0, x: 0, cropped: false };
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720);
      const t = window.sessionTransform;
      ctx.translate(320 + t.x, 475); ctx.rotate(t.roll); ctx.scale(t.scale * 1.3, t.scale * 1.3); ctx.drawImage(image, -176, -286);
      if (t.cropped) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 460); }
      window.sessionAnimation = requestAnimationFrame(draw);
    }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.sessionStream = c.captureStream(24); return window.sessionStream; } });
  }, (await readFile(fixture)).toString('base64'));
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await page.getByText('Đã nhận diện bàn tay', { exact: true }).waitFor({ timeout: 60000 });
  const read = async () => {
    const text = await page.getByTestId('tracking-debug').innerText();
    const num = r => { const m = text.match(r); return m ? Number(m[1]) : null; };
    return { source: text.match(/Tracking source: ([^·\n]+)/)?.[1].trim(), status: text.match(/Auto Fit: (\w+)/)?.[1],
      wristRadius: num(/Wrist radius: ([\d.]+)/), braceletRadius: num(/Bracelet inner radius: ([\d.]+)/),
      intrinsic: num(/Calibration radius ratio: ([\d.]+)/), distanceScale: num(/Distance scale: ([\d.]+)/),
      manual: num(/Manual fit multiplier: ([\d.]+)/), proxy: num(/Proxy world scale: ([\d.]+)/), final: num(/Final bracelet world scale: ([\d.]+)/),
      wristPx: num(/Estimated wrist width: ([\d.]+)/), braceletPx: num(/Bracelet projected inner diameter \(pixels\): ([\d.]+)/),
      inliers: num(/ROI: (\d+)/), text };
  };
  const settle = async transform => {
    const count = await page.evaluate(t => { window.sessionTransform = t; return window.sessionFrames; }, transform);
    await page.waitForFunction(n => window.sessionFrames >= n + 8, count, { timeout: 60000 });
    await page.getByText('Đã nhận diện bàn tay', { exact: true }).waitFor({ timeout: 10000 });
  };
  for (const manual of [100, 150]) {
    await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).fill(String(manual));
    for (const roll of [0, -.35, .35, 0]) {
      await settle({ scale: 1, roll, x: 0, cropped: false });
      const sample = await read(); check(sample.manual === manual / 100, 'manual persists'); report.camera.push({ test: manual === 100 ? 'A-image-roll' : 'B-image-roll', roll, ...sample });
    }
  }
  const intrinsics = report.camera.map(s => s.intrinsic);
  check(intrinsics.every(r => r > 0 && Math.abs(r / intrinsics[0] - 1) < .001), 'session radius invariant across image roll/manual changes');
  for (const [name, scale] of [['far', .8], ['near', 1.15]]) {
    await settle({ scale, roll: 0, x: 0, cropped: false }); report.camera.push({ test: 'C', name, ...await read() });
  }
  const far = report.camera.find(s => s.name === 'far'), near = report.camera.find(s => s.name === 'near');
  check(near.braceletPx > far.braceletPx * 1.25, 'near/far projection follows distance');
  check(Math.abs(near.intrinsic / far.intrinsic - 1) < .001, 'near/far does not recalibrate anatomy');
  await settle({ scale: 1, roll: 0, x: 0, cropped: false });
  await page.evaluate(() => { window.sessionTransform = { scale: 1, roll: 0, x: 4, cropped: true }; });
  await page.getByTestId('tracking-source').filter({ hasText: 'ROI' }).waitFor({ timeout: 10000 });
  report.partialHand = { ...await read(), handLandmarks: await page.evaluate(() => window.sessionHandCount) };
  check(report.partialHand.source === 'ROI' && report.partialHand.inliers >= 6 && report.partialHand.manual === 1.5, 'D validated ROI with calibration retained');
  await page.screenshot({ path: join(out, 'session-roi.png'), fullPage: true });
  await page.getByTestId('tracking-source').filter({ hasText: 'None' }).waitFor({ timeout: 10000 });
  report.afterRoiExpiry = await read();
  check(report.afterRoiExpiry.wristRadius === null, 'ROI timeout hides ring instead of inventing depth');
  await page.evaluate(() => { window.sessionTransform = { scale: 1, roll: 0, x: 0, cropped: false }; });
  await page.getByText('Đã nhận diện bàn tay', { exact: true }).waitFor({ timeout: 30000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('export-wrist-debug').click(); await (await download).saveAs(join(out, 'session-debug-log.json'));
  const log = JSON.parse(await readFile(join(out, 'session-debug-log.json'), 'utf8'));
  check(log.samples.some(s => s.trackingSource === 'ROI') && log.samples.some(s => s.manualFitMultiplier === 1.5), 'export contains actual ROI/manual samples');
  check(log.samples.every(s => !('image' in s)), 'metrics only, no photos');
  report.logSamples = log.samples.length;
  await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  check(await page.evaluate(() => { cancelAnimationFrame(window.sessionAnimation); return window.sessionStream.getTracks().every(t => t.readyState === 'ended'); }), 'release stream');
  check(report.errors.length === 0, JSON.stringify(report.errors));
  await writeFile(join(out, 'session-fit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ camera: report.camera.map(({ test, roll, name, wristRadius, intrinsic, manual, wristPx, braceletPx }) => ({ test, roll, name, wristRadius, intrinsic, manual, wristPx, braceletPx })), partialHand: report.partialHand, logSamples: report.logSamples, errors: report.errors }, null, 2));
  console.log('PASS session sizing, independent Manual Fit, real Hand replay, bounded ROI and local JSON log');
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(out, 'session-failure.png'), fullPage: true });
    report.failure = { error: String(error), debug: await page.getByTestId('tracking-debug').innerText().catch(() => '') };
    try { const download = page.waitForEvent('download', { timeout: 5000 }); await page.getByTestId('export-wrist-debug').click({ timeout: 5000 }); await (await download).saveAs(join(out, 'session-failure-log.json')); } catch { /* Giữ nguyên lỗi gốc. */ }
    await writeFile(join(out, 'session-failure.json'), JSON.stringify(report, null, 2));
  }
  throw error;
} finally { await browser.close(); }
