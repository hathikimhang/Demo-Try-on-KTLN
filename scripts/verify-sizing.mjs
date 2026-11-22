import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = process.env.AR_URL ?? 'http://127.0.0.1:5173', output = resolve('artifacts');
await mkdir(output, { recursive: true });
const fixture = join(tmpdir(), 'mira-ar-woman_hands.jpg');
try { await readFile(fixture); } catch {
  const response = await fetch('https://storage.googleapis.com/mediapipe-assets/woman_hands.jpg');
  if (!response.ok) throw Error(`Fixture HTTP ${response.status}`);
  await writeFile(fixture, new Uint8Array(await response.arrayBuffer()));
}
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
const check = (condition, message) => { if (!condition) throw Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.addEventListener('message', e => { if (e.data.type === 'result') { const { frame, ...data } = e.data; window.sizingDetection = data; window.sizingSamples = (window.sizingSamples ?? 0) + 1; } }); }
    };
  });
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).uncheck();
  await page.locator('input[type=file]').setInputFiles(fixture);
  await page.getByTestId('upload-status').filter({ hasText: 'Manual Calibration' }).waitFor({ timeout: 60000 });
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  const debug = page.getByTestId('tracking-debug');
  for (const label of ['Estimated wrist diameter', 'Bracelet inner diameter', 'Base scale', 'Manual fit multiplier', 'Final world scale', 'Projected bracelet diameter', 'Estimated wrist width']) await debug.getByText(label, { exact: false }).waitFor();
  const report = { initialDebug: await debug.innerText(), fits: [] };
  for (const percent of [70, 100, 160, 240, 350, 100]) {
    await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).fill(String(percent));
    await debug.getByText(`Manual fit multiplier: ${(percent / 100).toFixed(3)}×`, { exact: true }).waitFor();
    const values = await debug.innerText();
    const baseScale = Number(values.match(/Base scale: ([\d.]+)/)[1]);
    const finalScale = Number(values.match(/Final world scale: ([\d.]+)/)[1]);
    check(Math.abs(finalScale - baseScale * percent / 100) < 0.000003, 'Manual Fit applied exactly once');
    report.fits.push({ percent, baseScale, finalScale });
  }
  await page.screenshot({ path: join(output, 'sizing-debug.png'), fullPage: true });
  const imageDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Chụp & lưu ảnh' }).click();
  await (await imageDownload).saveAs(join(output, 'sizing-photo.png'));

  report.beforeAfter = await page.evaluate(async base64 => {
    const { estimateWrist } = await import('/src/wristGeometry.ts');
    const { measureWristWidth, WristSizer, sizingDebug } = await import('/src/braceletSizing.ts');
    const s = window.sizingDetection, pose = estimateWrist(s.points, s.worldPoints, 1.5, s.handedness, { mode: 'straight-wrist' });
    const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode();
    const c = document.createElement('canvas'); c.width = 427; c.height = 640;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, c.width, c.height);
    const measurement = measureWristWidth(ctx.getImageData(0, 0, c.width, c.height), pose);
    const fitted = new WristSizer().update(pose, measurement, 1000);
    const controlled = { width: 100 / 640, confidence: .9, reason: 'Controlled formula test, not actual skin measurement' };
    const controlledFit = new WristSizer().update(pose, controlled, 1000);
    return { measurement, before: sizingDebug(pose, 1, 640, measurement, 'manual', 'old landmark prior'), after: sizingDebug(fitted.pose ?? pose, 1, 640, measurement, fitted.method, fitted.message),
      legacyRequested240: sizingDebug(pose, 1.4, 640, measurement, 'manual', 'old clamp 240% -> 140%'),
      fixedRequested240: sizingDebug(pose, 2.4, 640, measurement, 'manual', 'no renderer clamp'),
      controlled100px: sizingDebug(controlledFit.pose, 1, 640, controlled, controlledFit.method, controlled.reason),
    };
  }, (await readFile(fixture)).toString('base64'));

  // Low confidence must be explicit, not a silently invented large scale.

  report.lowConfidence = await page.evaluate(async () => {
    const { handFixture } = await import('/src/testing/wristFixtures.ts'); const { estimateWrist } = await import('/src/wristGeometry.ts');
    const { measureWristWidth, WristSizer } = await import('/src/braceletSizing.ts');
    const f = handFixture(), p = estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' });
    const data = new Uint8ClampedArray(800 * 600 * 4).fill(150), measurement = measureWristWidth({ width: 800, height: 600, data }, p);
    const fitted = new WristSizer().update(p, measurement, 1000);
    return { method: fitted.method, message: fitted.message, rendered: fitted.pose !== null };
  });
  check(report.lowConfidence.method === 'measuring' && !report.lowConfidence.rendered, 'manual calibration on ambiguous image');

  // The camera is a replay stream, never the user's physical camera.
  await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${data}`; await image.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 960;
    const ctx = c.getContext('2d'); const draw = () => { ctx.drawImage(image, 0, 0, 640, 960); window.sizingAnimation = requestAnimationFrame(draw); }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { window.testSizingStream = c.captureStream(20); return window.testSizingStream; }, configurable: true });
  }, (await readFile(fixture)).toString('base64'));
  await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).fill('240');
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  const count = await page.evaluate(() => window.sizingSamples);
  await page.waitForFunction(n => window.sizingSamples >= n + 12, count, { timeout: 60000 });
  await debug.getByText('Manual fit multiplier: 2.400×', { exact: true }).waitFor();
  check(await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).inputValue() === '240', 'fit preserved through camera startup and auto frames');
  await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  check(await page.evaluate(() => (cancelAnimationFrame(window.sizingAnimation), window.testSizingStream.getTracks().every(t => t.readyState === 'ended'))), 'replay released');
  await page.setViewportSize({ width: 375, height: 812 });
  check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'sizing UI does not overflow mobile');
  check(!errors.length, JSON.stringify(errors));
  report.errors = errors; report.replayManualFit = 2.4;
  await writeFile(join(output, 'sizing-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ beforeAfter: report.beforeAfter, fits: report.fits, lowConfidence: report.lowConfidence, errors }, null, 2));
  console.log('PASS sizing controls, actual MediaPipe image, replay manual fit, debug projection, PNG and mobile');
} finally { await browser.close(); }
