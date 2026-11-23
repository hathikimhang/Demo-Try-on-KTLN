import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Photo captureStream and IMAGE rotation/translation, NOT real wrist 3D rotation.
const out = `artifacts/live-stability-${process.env.MIRA_STABILITY_LABEL ?? 'baseline'}`;
await mkdir(out, { recursive: true });
const bytes = (await readFile(join(tmpdir(), 'mira-dynamic-pointing_up.jpg'))).toString('base64');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const samples = [], errors = [], results = [];
let active = 'warmup';
const percentile = (list, q) => { const a = list.filter(Number.isFinite).sort((a, b) => a - b); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.text().startsWith('[mira-stability] ')) samples.push({ scenario: active, ...JSON.parse(m.text().slice(17)) });
  });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext, seen = new WeakSet(); window.webglCanvasCount = 0;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const result = original.call(this, type, ...args);
      if ((type === 'webgl' || type === 'webgl2') && result && !seen.has(this)) { seen.add(this); window.webglCanvasCount++; }
      return result;
    };
  });
  await page.goto(process.env.AR_URL ?? 'http://127.0.0.1:5173'); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.evaluate(async bytes => {
    const im = new Image(); im.src = `data:image/jpeg;base64,${bytes}`; await im.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 720; const ctx = c.getContext('2d');
    window.stabilityInput = { motion: 'stationary', since: performance.now() };
    const draw = () => {
      const { motion, since } = window.stabilityInput, t = (performance.now() - since) / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720);
      ctx.translate(320, 475);
      if (motion === 'slow-image-rotation') ctx.rotate(Math.min(1, t / 10) * Math.PI / 2);
      if (motion === 'back-forth') ctx.rotate(Math.sin(t * Math.PI / 3) * .35);
      const scale = motion === 'near-far' ? 1 + Math.sin(t * Math.PI / 3) * .15 : 1;
      ctx.scale(scale * 1.3, scale * 1.3);
      if (!(motion === 'leave-return' && t > 2 && t < 4)) ctx.drawImage(im, -176, -286);
      requestAnimationFrame(draw);
    }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => c.captureStream(24) });
  }, bytes);
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="wrist-engine-mode"]'));
  await page.waitForTimeout(4000);
  const cases = process.env.MIRA_STABILITY_CASES?.split(',') ?? (process.env.MIRA_STABILITY_FULL ? ['stationary', 'slow-image-rotation', 'back-forth', 'near-far', 'leave-return'] : ['stationary', 'leave-return']);
  for (const mode of process.env.MIRA_STABILITY_MODES?.split(',') ?? ['v1', 'v2', 'compare']) {
    active = `warmup/${mode}`;
    await page.getByTestId('wrist-engine-mode').selectOption(mode);
    await page.waitForTimeout(1000);
    for (const motion of cases) {
      active = `${mode}/${motion}`;
      await page.evaluate(motion => { window.stabilityInput = { motion, since: performance.now() }; }, motion);
      await page.waitForTimeout(10000);
      const rows = samples.filter(s => s.scenario === active);
      if (!rows.length) throw Error(`No telemetry for ${active}; measurement invalid`);
      const visible = rows.filter(s => s.braceletVisible);
      const current = rows.filter(r => r.braceletVisible && ['current-observation', 'current-frame-pose'].includes(r.visibilityChangeReason));
      const fresh = [...new Map(current.map(r => [r.frameId, r])).values()];
      let transitions = 0; rows.forEach((r, i) => { if (i && r.braceletVisible !== rows[i - 1].braceletVisible) transitions++; });
      const hiddenReasons = {};
      rows.filter(r => !r.braceletVisible).forEach(r => { hiddenReasons[r.visibilityChangeReason] = (hiddenReasons[r.visibilityChangeReason] ?? 0) + 1; });
      const result = { scenario: active, samples: rows.length, visibleSamples: visible.length, freshSamples: fresh.length, transitions, hiddenReasons, metricsScope: 'latency/deltas from unique current presented frames; held frames excluded',
        cameraFPSMedian: percentile(rows.map(r => r.cameraFPS), .5), inferenceFPSMedian: percentile(rows.map(r => r.inferenceFPS), .5), renderFPSMedian: percentile(rows.map(r => r.renderFPS), .5),
        inferenceLatencyP95Ms: percentile(fresh.map(r => r.inferenceLatencyMs), .95), poseAgeP95Ms: percentile(fresh.map(r => r.poseAgeMs), .95),
        rawDeltaP95ImageWidth: percentile(fresh.map(r => r.rawPositionDeltaImageWidth), .95), filteredDeltaP95ImageWidth: percentile(fresh.map(r => r.filteredPositionDeltaImageWidth), .95),
        maxPendingRequests: Math.max(0, ...rows.map(r => r.maxPendingRequests ?? 0)) };
      results.push(result); console.log(JSON.stringify(result));
    }
  }
  results.push({ webglCanvasCount: await page.evaluate(() => window.webglCanvasCount), scope: 'unique WebGL canvas count across mode switches' });
  if (errors.length) throw Error(errors.join(' | '));
  await page.getByRole('button', { name: /Tắt camera/ }).click();
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ scope: 'photo captureStream, input image motions only; NO webcam anatomical benchmark', errors, results }, null, 2));
  await writeFile(`${out}/trace.json`, JSON.stringify(samples)); await browser.close();
}
