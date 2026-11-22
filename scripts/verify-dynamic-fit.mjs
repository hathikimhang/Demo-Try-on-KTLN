import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = process.env.AR_URL ?? 'http://127.0.0.1:5173', out = resolve('artifacts');
await mkdir(out, { recursive: true });
const fixtures = {};
for (const name of ['pointing_up.jpg', 'thumb_up.jpg', 'woman_hands.jpg']) {
  const path = join(tmpdir(), `mira-dynamic-${name}`);
  try { await readFile(path); } catch {
    const response = await fetch(`https://storage.googleapis.com/mediapipe-assets/${name}`);
    if (!response.ok) throw Error(`Fixture HTTP ${response.status}`);
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  }
  fixtures[name] = path;
}
const check = (value, message) => { if (!value) throw Error(message); };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
const report = { images: [], provisionalImages: [], replay: [], errors: [] };
let activePage;
try {
  const p = activePage = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  // Instrument the real measurement call in the test browser only. Keep input
  // pose/endpoints for diagnosing integration differences without app globals.
  await p.route('**/src/braceletSizing.ts*', async route => {
    const response = await route.fetch(), body = await response.text();
    const rewritten = body.replace('export function measureWristWidth(', 'function inspectMeasureWristWidth(');
    await route.fulfill({ response, body: rewritten + '\nexport function measureWristWidth(...args) { const result = inspectMeasureWristWidth(...args); window.dynamicSample = args[0]; window.dynamicMeasurement = { pose: args[1], wrist: args[2], result, image: { width: args[0].width, height: args[0].height } }; return result; }\n' });
  });
  // Upload now measures a native ROI through a separate implementation.
  // Inspect that real call too; don't assume a legacy 640px camera readback.
  await p.route('**/src/imageWristMeasurement.ts*', async route => {
    const response = await route.fetch(), body = await response.text();
    const rewritten = body.replace('export function measureImageWrist(', 'function inspectMeasureImageWrist(');
    await route.fulfill({ response, body: rewritten + '\nexport function measureImageWrist(...args) { const result = inspectMeasureImageWrist(...args); window.dynamicSample = args[0]; window.dynamicMeasurement = { input: "image", pose: args[1], wrist: args[2], result: result.measurement, image: { width: args[0].imageWidth, height: args[0].imageHeight } }; return result; }\n' });
  });
  p.on('pageerror', e => report.errors.push(e.message));
  await p.addInitScript(() => {
    window.dynamicFrames = 0;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.addEventListener('message', e => { if (e.data.type === 'result') { window.dynamicFrames++; window.dynamicLastDetection = e.data; } }); }
      postMessage(data, ...rest) { if (window.dynamicStall && data.type === 'frame') { data.bitmap.close(); return; } return super.postMessage(data, ...rest); }
    };
  });
  await p.goto(base); await p.waitForLoadState('networkidle');
  check(await p.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).isChecked(), 'auto enabled by default');
  await p.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  const readout = async () => {
    const text = await p.getByTestId('tracking-debug').innerText();
    const number = pattern => { const match = text.match(pattern); return match ? Number(match[1]) : null; };
    return { text, status: text.match(/Auto Fit: (measured|provisional|calibrated|predictive|rejected|manual)/)?.[1], rawWidth: number(/Hai mép trên ảnh: ([\d.]+)/), slices: number(/(\d+) lát cắt hợp lệ/), width: number(/Wrist width \(pixels\): ([\d.]+)/), inner: number(/Bracelet projected inner diameter \(pixels\): ([\d.]+)/), ratio: number(/Fit ratio: ([\d.]+)/), scale: number(/Auto scale: ([\d.]+)/), final: number(/Final render scale: ([\d.]+)/), quality: number(/Edge quality: ([\d.]+)/) };
  };
  for (const name of ['pointing_up.jpg', 'thumb_up.jpg']) {
    await p.locator('input[type=file]').setInputFiles(fixtures[name]);
    await p.getByTestId('sizing-status').waitFor({ timeout: 60000 });
    const result = await readout();
    if (result.status !== 'measured') {
      report.actualMeasurement = await p.evaluate(() => window.dynamicMeasurement);
      report.measurementFailure = await p.evaluate(async base64 => {
        const { analyzeWrist } = await import('/src/wristGeometry.ts');
        const { measureWristWidth } = await import('/src/braceletSizing.ts');
        const { measureImageWrist } = await import('/src/imageWristMeasurement.ts');
        const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode();
        const native = window.dynamicMeasurement?.input === 'image';
        const c = document.createElement('canvas'), f = native ? 1 : Math.min(1, 640 / Math.max(image.width, image.height)); c.width = Math.round(image.width * f); c.height = Math.round(image.height * f);
        const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0, c.width, c.height);
        const actual = window.dynamicSample;
        if (!actual) throw Error('Measurement instrumentation did not observe the actual upload pipeline');
        const pixels = native ? ctx.getImageData(actual.x, actual.y, actual.width, actual.height) : ctx.getImageData(0, 0, c.width, c.height); let maxDifference = 0, differenceCount = 0;
        for (let i = 0; i < pixels.data.length; i++) { const delta = Math.abs(pixels.data[i] - actual.data[i]); maxDifference = Math.max(maxDifference, delta); if (delta) differenceCount++; }
        const d = window.dynamicLastDetection, analysis = analyzeWrist(d.points, d.worldPoints, image.height / image.width, d.handedness, { mode: 'straight-wrist' });
        return { native, maxDifference, differenceCount, analysis, measurement: analysis.pose && (native ? measureImageWrist({ ...actual, data: pixels.data }, analysis.pose, d.points[0]).measurement : measureWristWidth(pixels, analysis.pose, d.points[0])) };
      }, (await readFile(fixtures[name])).toString('base64'));
    }
    // thumb_up's contour may remain ambiguous in native-image measurement.
    // A diagnostic rejection must not turn into a forced automatic fit.
    // Upload-only provisional fit keeps the image useful without claiming measurement accuracy.
    if (name === 'thumb_up.jpg' && result.status === 'provisional') {
      check(result.final > 0 && result.width === null && result.ratio === null, 'weak upload boundaries: explicitly provisional, never measured');
      report.provisionalImages.push({ fixture: name, ...result, diagnostic: report.actualMeasurement });
      await p.screenshot({ path: join(out, `dynamic-${name}.png`), fullPage: true });
      await p.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).uncheck();
      await p.getByTestId('upload-status').filter({ hasText: 'Manual Calibration' }).waitFor();
      check((await readout()).status === 'manual' && (await readout()).final > 0, 'manual calibration fallback for weak thumb boundary');
      await p.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).check();
      continue;
    }
    check(result.ratio > 1.05 && result.ratio < 1.4 && result.quality >= 65, 'image auto fit trustworthy: ' + JSON.stringify(result));
    check(result.status === 'measured' && result.rawWidth > 0 && result.slices >= 3, 'observed endpoints and measured status');
    const overlay = await p.locator('canvas.output-canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let edges = 0, diameter = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.abs(pixels[i] - 52) < 3 && Math.abs(pixels[i + 1] - 245) < 3 && Math.abs(pixels[i + 2] - 174) < 3) edges++;
        if (Math.abs(pixels[i] - 240) < 3 && Math.abs(pixels[i + 1] - 147) < 3 && Math.abs(pixels[i + 2] - 255) < 3) diameter++;
      }
      return { edges, diameter };
    });
    check(overlay.edges > 20 && overlay.diameter > 20, 'actual measurement lines and projected diameter on Canvas: ' + JSON.stringify(overlay));
    check(await p.locator('#size').inputValue() === '1', 'no manual adjustment for image');
    report.images.push({ fixture: name, ...result });
    await p.screenshot({ path: join(out, `dynamic-${name}.png`), fullPage: true });
  }
  await p.locator('input[type=file]').setInputFiles(fixtures['woman_hands.jpg']);
  await p.getByTestId('upload-status').filter({ hasText: 'Auto Fit thành công' }).waitFor({ timeout: 60000 });
  check((await readout()).final > 0 && (await readout()).ratio > 1, 'segmentation recovers native wrist width on the formerly rejected photo');
  check((await readout()).status === 'measured' && (await readout()).slices >= 5, 'real segmentation and native edge consensus, not relabelled provisional');
  await p.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).uncheck();
  await p.getByTestId('upload-status').filter({ hasText: 'Manual Calibration' }).waitFor();
  check((await readout()).final > 0, 'explicit manual fallback');
  check((await readout()).status === 'manual', 'manual must not be labelled measured');
  await p.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).check();
  check(await p.locator('#size').inputValue() === '1', 'auto/manual toggle does not rewrite user trim');

  // Replay photo pixels through real Hand inference. These are image-plane
  // transforms, not fabricated landmarks and not a recording of a 3D wrist turn.
  await p.evaluate(async data => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${data}`; await image.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 720; const ctx = c.getContext('2d');
    window.dynamicTransform = { scale: 1, roll: 0, x: 0, blank: false };
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720);
      let t = window.dynamicTransform; if (window.dynamicMoving) { const now = performance.now(); t = { scale: .95 + .25 * Math.sin(now / 800), roll: .20 * Math.sin(now / 900), x: 25 * Math.sin(now / 700) }; }
      if (!t.blank) { ctx.translate(320 + t.x, 475); ctx.rotate(t.roll); ctx.scale(t.scale * 1.3, t.scale * 1.3); ctx.drawImage(image, -176, -286); }
      window.dynamicAnimation = requestAnimationFrame(draw);
    }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.dynamicStream = c.captureStream(24); return window.dynamicStream; } });
  }, (await readFile(fixtures['pointing_up.jpg'])).toString('base64'));
  await p.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await p.getByText('Đã nhận diện bàn tay', { exact: true }).waitFor({ timeout: 60000 });
  for (const [name, transform] of [
    ['standing', { scale: 1, roll: 0, x: 0 }], ['far', { scale: .70, roll: 0, x: 0 }], ['near', { scale: 1.25, roll: 0, x: 0 }],
    ['roll-45', { scale: 1, roll: Math.PI / 4, x: 0 }], ['left', { scale: 1, roll: 0, x: -45 }], ['right', { scale: 1, roll: 0, x: 45 }],
  ]) {
    const start = await p.evaluate(t => { window.dynamicTransform = t; return window.dynamicFrames; }, transform);
    await p.waitForFunction(n => window.dynamicFrames > n + 12, start, { timeout: 60000 });
    await p.getByText('Đã nhận diện bàn tay', { exact: true }).waitFor({ timeout: 15000 });
    const result = await readout();
    check(result.ratio > 1.02 && result.ratio < 1.4, `replay ${name}: ${JSON.stringify(result)}`);
    check(await p.locator('#size').inputValue() === '1', 'no manual changes during replay');
    report.replay.push({ name, ...result });
  }
  check(report.replay.find(x => x.name === 'near').width > report.replay.find(x => x.name === 'far').width * 1.4, 'distance changes observed width, not only the model');

  await p.evaluate(() => { window.dynamicMoving = true; });
  report.continuous = [];
  for (let i = 0; i < 25; i++) {
    const count = await p.evaluate(() => window.dynamicFrames);
    await p.waitForFunction(n => window.dynamicFrames > n, count, { timeout: 15000 });
    const sample = await readout();
    if (sample.ratio !== null && sample.final > 0) report.continuous.push({ width: sample.width, inner: sample.inner, ratio: sample.ratio });
    check(await p.locator('#size').inputValue() === '1', 'manual unchanged during continuous motion');
  }
  check(report.continuous.length >= 15, 'enough valid continuous-motion samples');
  check(report.continuous.every(s => s.ratio > .98 && s.ratio < 1.4), 'continuous fit ratio bounded');
  await p.evaluate(() => { window.dynamicMoving = false; window.dynamicTransform = { blank: true }; });
  await p.getByTestId('tracking-debug').filter({ hasText: 'lost' }).waitFor({ timeout: 15000 });
  await p.evaluate(() => { window.dynamicTransform = { scale: .85, roll: 0, x: 0 }; });
  await p.getByText('Đã nhận diện bàn tay', { exact: true }).waitFor({ timeout: 30000 });
  check((await readout()).final > 0, 'automatic reacquisition after loss');
  await p.getByRole('checkbox', { name: 'Debug Mode', exact: true }).uncheck();
  const png = p.waitForEvent('download'); await p.getByRole('button', { name: 'Chụp & lưu ảnh' }).click(); await (await png).saveAs(join(out, 'dynamic-replay.png'));
  await p.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await p.evaluate(() => { window.dynamicStall = true; });
  await p.getByTestId('tracking-debug').filter({ hasText: 'lost · stale' }).waitFor({ timeout: 10000 });
  await p.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  check(await p.evaluate(() => { cancelAnimationFrame(window.dynamicAnimation); return window.dynamicStream.getTracks().every(t => t.readyState === 'ended'); }), 'stream released');
  check(report.errors.length === 0, JSON.stringify(report.errors));
  await writeFile(join(out, 'dynamic-auto-fit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ images: report.images.map(({ fixture, width, inner, ratio, quality }) => ({ fixture, width, inner, ratio, quality })), provisionalImages: report.provisionalImages.map(({ fixture, status, final }) => ({ fixture, status, final })), replay: report.replay.map(({ name, width, inner, ratio, quality }) => ({ name, width, inner, ratio, quality })), continuous: { count: report.continuous.length, minRatio: Math.min(...report.continuous.map(s => s.ratio)), maxRatio: Math.max(...report.continuous.map(s => s.ratio)) }, errors: report.errors }, null, 2));
  console.log('PASS dynamic auto fit, real MediaPipe photo/replay, 100% manual trim, loss/recovery and PNG');
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: join(out, 'dynamic-failure.png'), fullPage: true });
    report.failure = { error: String(error), readout: await activePage.getByTestId('tracking-debug').innerText().catch(() => '') };
    await writeFile(join(out, 'dynamic-failure.json'), JSON.stringify(report, null, 2));
  }
  throw error;
} finally { await browser.close(); }
