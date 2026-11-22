import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run Vite first. Chrome channel uses an existing Chrome installation; set
// AR_BROWSER=chromium after `npx playwright install chromium` if needed.
const base = process.env.AR_URL ?? 'http://127.0.0.1:5173';
const output = resolve('artifacts'); await mkdir(output, { recursive: true });
const fixtures = {};
for (const [name, file] of [['hand', 'woman_hands.jpg'], ['pose', 'pose.jpg']]) {
  const path = join(tmpdir(), `mira-ar-${file}`);
  try { await readFile(path); } catch {
    const response = await fetch(`https://storage.googleapis.com/mediapipe-assets/${file}`);
    if (!response.ok) throw Error(`Fixture HTTP ${response.status}`);
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  }
  fixtures[name] = path;
}
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [], report = { geometryViews: [], integration: [], replay: [] };
const check = (value, message) => { if (!value) throw Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.arSamples = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.type === 'result') {
            const { frame, ...data } = event.data;
            window.arSamples.push({ ...data, hasFrame: !!frame });
          }
        });
      }
      postMessage(data, ...rest) {
        if (window.arPause && data.type === 'frame') { data.bitmap.close(); return; }
        return super.postMessage(data, ...rest);
      }
    };
  });
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).uncheck();
  await page.locator('input[type=file]').setInputFiles(fixtures.hand);
  await page.waitForFunction(() => window.arSamples.length > 0, null, { timeout: 60000 });
  check(await page.getByRole('slider', { name: 'Độ vừa vòng tay' }).inputValue() === '1', 'fit defaults to 100%');
  const sample = await page.evaluate(() => window.arSamples.at(-1));
  check(sample.worldPoints.length === 21 && Array.isArray(sample.armPoints), 'Hand + Pose result contract');
  report.integration.push({ name: 'real Hand inference without Pose', armLandmarks: sample.armPoints.length });
  check(await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng' }).isChecked(), 'close-up enabled by default');
  check(sample.armPoints.length === 0, 'close-up skips Pose inference');
  await page.getByTestId('upload-status').filter({ hasText: 'Manual Calibration' }).waitFor();
  for (const color of ['Vàng champagne', 'Bạc ánh kim', 'Vàng hồng']) await page.getByRole('button', { name: color, exact: true }).click();
  for (const value of ['0.7', '1.6', '1']) await page.locator('#size').fill(value);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Chụp & lưu ảnh' }).click();
  await (await download).saveAs(join(output, 'bracelet-photo.png'));
  await page.screenshot({ path: join(output, 'studio-desktop.png'), fullPage: true });
  report.integration.push({ name: 'close-up, colors, size and PNG', passed: true });
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.getByTestId('tracking-debug').filter({ hasText: 'tracking · ok' }).waitFor();
  await page.screenshot({ path: join(output, 'bracelet-debug.png'), fullPage: true });
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).uncheck();
  check(await page.getByTestId('tracking-debug').count() === 0, 'debug can be disabled');
  const beforeForearm = await page.evaluate(() => window.arSamples.length);
  await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng' }).uncheck();
  await page.waitForFunction(n => window.arSamples.length > n, beforeForearm, { timeout: 60000 });
  // A still image may explicitly fall back to a validated Hand-only pose.
  // The strict camera geometry function remains unchanged.
  const strict = await page.evaluate(async () => {
    const { estimateWrist } = await import('/src/wristGeometry.ts');
    const s = window.arSamples.at(-1);
    return !!estimateWrist(s.points, s.worldPoints, 1.5, s.handedness, { armPoints: s.armPoints, armWorldPoints: s.armWorldPoints });
  });
  report.integration.push({ name: 'still image reprocessed after switching to forearm', passed: true });
  if (!strict) {
    await page.getByTestId('upload-status').filter({ hasText: 'Manual Calibration' }).waitFor();
    await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
    await page.getByTestId('upload-modes').filter({ hasText: 'đang dùng: straight-wrist' }).waitFor();
    check((await page.getByTestId('upload-modes').innerText()).includes('fallback:'), 'image fallback is explicit, not silently ignored');
    await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).uncheck();
  }
  report.integration.push({ name: 'strict camera forearm gate / explicit upload fallback', acceptedFixture: strict });
  const previousSamples = await page.evaluate(() => window.arSamples.length);
  await page.locator('input[type=file]').setInputFiles(fixtures.pose);
  await page.waitForFunction(n => window.arSamples.length > n, previousSamples, { timeout: 60000 });
  report.integration.push(await page.evaluate(async () => {
    const { estimateWrist } = await import('/src/wristGeometry.ts'); const s = window.arSamples.at(-1);
    return { name: 'full-body fixture forearm observation', hands: s.points.length, pose: s.armPoints.length, accepted: !!estimateWrist(s.points, s.worldPoints, 2 / 3, s.handedness, { armPoints: s.armPoints, armWorldPoints: s.armWorldPoints }) };
  }));
  await page.getByRole('tab', { name: 'Thử áo' }).click();
  await page.locator('input[type=file]').setInputFiles(fixtures.pose);
  await page.getByText('Đã nhận diện cơ thể', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await page.waitForFunction(() => window.arSamples.some(s => s.hasFrame), null, { timeout: 60000 });
  await page.evaluate(() => { window.arOldStream = document.querySelector('video').srcObject; });
  await page.getByRole('tab', { name: 'Thử vòng tay' }).click();
  check(await page.evaluate(() => window.arOldStream.getTracks().every(t => t.readyState === 'ended')), 'camera released on tab switch');
  await page.setViewportSize({ width: 375, height: 812 });
  check(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'no mobile overflow');
  await page.screenshot({ path: join(output, 'studio-mobile.png'), fullPage: true });
  report.integration.push({ name: 'shirt, camera cleanup, mobile', passed: true });

  // Actual Hand + Pose inference on a replay stream. Only image-plane motion
  // is simulated here; this is explicitly not a real 3D wrist-turn recording.
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).uncheck();
  await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 960;
    const ctx = canvas.getContext('2d'); window.arTransform = { x: 0, angle: 0, scale: 1 };
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#1b1c17'; ctx.fillRect(0, 0, 640, 960);
      const t = window.arTransform; ctx.translate(282 + t.x, 690); ctx.rotate(t.angle); ctx.scale(t.scale, t.scale); ctx.drawImage(image, -282, -690, 640, 960);
      window.arAnimation = requestAnimationFrame(draw);
    }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.arReplayStream = canvas.captureStream(24); return window.arReplayStream; } });
  }, (await readFile(fixtures.hand)).toString('base64'));
  await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng' }).check();
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await page.getByText('Đã nhận diện bàn tay', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole('slider', { name: 'Độ vừa vòng tay' }).fill('1.2');
  await page.getByRole('button', { name: 'Bạc ánh kim', exact: true }).click();
  for (const [name, transform] of [
    ['standing', { x: 0, angle: 0, scale: 1 }], ['left', { x: -30, angle: 0, scale: 1 }], ['right', { x: 30, angle: 0, scale: 1 }],
    ['image-roll-left', { x: 0, angle: -.22, scale: 1 }], ['image-roll-right', { x: 0, angle: .22, scale: 1 }],
    ['far', { x: 0, angle: 0, scale: .85 }], ['near', { x: 0, angle: 0, scale: 1.12 }],
  ]) {
    const start = await page.evaluate(t => { window.arTransform = t; return window.arSamples.length; }, transform);
    await page.waitForFunction(n => window.arSamples.length >= n + 7, start, { timeout: 30000 });
    const data = await page.evaluate(async start => {
      const { estimateWrist, project } = await import('/src/wristGeometry.ts');
      const samples = window.arSamples.slice(start + 3), poses = samples.map(s => estimateWrist(s.points, s.worldPoints, 1.5, s.handedness, { mode: 'straight-wrist' })).filter(Boolean);
      return { count: samples.length, accepted: poses.length, synced: samples.every(s => s.hasFrame), centers: poses.map(p => project(p.center, p)), radii: poses.map(p => p.radius) };
    }, start);
    check(data.accepted >= 3 && data.synced, `replay ${name}: ${JSON.stringify(data)}`);
    check(await page.locator('#size').inputValue() === '1.2', 'fit preserved across webcam frames');
    check(await page.getByRole('button', { name: 'Bạc ánh kim', exact: true }).getAttribute('aria-pressed') === 'true', 'color preserved across frames');
    report.replay.push({ name, ...data });
  }
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  check(mean(report.replay[1].centers.map(p => p.x)) < mean(report.replay[2].centers.map(p => p.x)), 'left/right follows input');
  check(mean(report.replay[5].radii) < mean(report.replay[6].radii), 'distance scale follows input');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.getByTestId('tracking-debug').filter({ hasText: 'tracking · ok' }).waitFor();
  await page.evaluate(() => { window.arPause = true; });
  await page.getByText('Di chuyển chậm và giữ rõ bàn tay, cổ tay trong khung hình', { exact: true }).waitFor({ timeout: 10000 });
  await page.getByTestId('tracking-debug').filter({ hasText: 'lost · stale' }).waitFor();
  await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  check(await page.evaluate(() => { cancelAnimationFrame(window.arAnimation); return window.arReplayStream.getTracks().every(t => t.readyState === 'ended'); }), 'replay stream released');
  report.integration.push({ name: 'debug Tracking, Low Confidence, Lost states, stale frame hidden and replay released', passed: true });
  await page.getByRole('tab', { name: 'Thử áo' }).click();
  check(await page.locator('#size').inputValue() === '1', 'shirt size independent of bracelet fit');
  await page.getByRole('tab', { name: 'Thử vòng tay' }).click();
  check(await page.getByRole('slider', { name: 'Độ vừa vòng tay' }).inputValue() === '1.2', 'fit preserved on product switch');
  await page.getByRole('button', { name: 'Đặt lại', exact: true }).click();
  check(await page.locator('#size').inputValue() === '1', 'explicit fit reset to 100%');
  report.integration.push({ name: 'manual fit persists across frames and products, colors unchanged, reset works', passed: true });

  // Render-only diagnostics use deterministic poses, not simulated AI output.
  const gallery = await browser.newPage({ viewport: { width: 1350, height: 1400 } });
  gallery.on('pageerror', error => errors.push(error.message)); await gallery.goto(base); await gallery.waitForLoadState('networkidle');
  report.geometryViews = await gallery.evaluate(async () => {
    const { renderScenarios } = await import('/src/testing/renderScenarios.ts');
    const { BraceletRenderer } = await import('/src/braceletRenderer.ts');
    const renderer = new BraceletRenderer();
    document.body.innerHTML = '<main style="font:16px Arial;background:#eee;padding:24px"><h1>Kiểm tra hình học WebGL — tư thế tổng hợp</h1><p>Trái: toàn vòng. Phải: bật proxy depth-only. Không phải kết quả nghiệm thu trên tay thật.</p><div id="views" style="display:grid;grid-template-columns:repeat(3,1fr);gap:15px"></div></main>';
    const reports = [];
    for (const { name, pose } of renderScenarios()) {
      const cell = document.createElement('section'); cell.style.cssText = 'background:#ddd;border-radius:8px;padding:12px';
      const title = document.createElement('h3'); title.textContent = name; title.style.fontSize = '14px'; cell.append(title);
      const buffers = [];
      for (const occlusion of [false, true]) {
        const layer = renderer.renderLayer(pose, '#c5a15e', 1, 300, 300, { occlusion, shadows: false });
        const copy = document.createElement('canvas'); copy.width = copy.height = 300; copy.style.width = '50%'; copy.style.display = 'inline-block';
        const context = copy.getContext('2d'); context.drawImage(layer, 0, 0); cell.append(copy);
        buffers.push(context.getImageData(0, 0, 300, 300).data);
      }
      document.querySelector('#views').append(cell);
      let full = 0, visible = 0, hidden = 0, clipped = 0;
      for (let i = 0; i < 90000; i++) {
        if (buffers[0][i * 4 + 3] > 30) { full++; if (i % 300 < 2 || i % 300 > 297 || i < 600 || i >= 89400) clipped++; }
        if (buffers[1][i * 4 + 3] > 30) visible++;
        if (buffers[0][i * 4 + 3] > 100 && buffers[1][i * 4 + 3] < 10) hidden++;
      }
      const debugLayer = renderer.renderLayer(pose, '#c5a15e', 1, 300, 300, { occlusion: true, shadows: false, debugProxy: true });
      const debugCanvas = document.createElement('canvas'); debugCanvas.width = debugCanvas.height = 300;
      const debugCtx = debugCanvas.getContext('2d'); debugCtx.drawImage(debugLayer, 0, 0);
      const debugPixels = debugCtx.getImageData(0, 0, 300, 300).data;
      const restored = renderer.renderLayer(pose, '#c5a15e', 1, 300, 300, { occlusion: true, shadows: false });
      debugCtx.clearRect(0, 0, 300, 300); debugCtx.drawImage(restored, 0, 0);
      const restoredPixels = debugCtx.getImageData(0, 0, 300, 300).data;
      const debugChanged = debugPixels.some((v, i) => v !== buffers[1][i]);
      const cleanRestored = restoredPixels.every((v, i) => v === buffers[1][i]);
      reports.push({ name, full, visible, hidden, clipped, debugChanged, cleanRestored });
    }
    renderer.clear(); return reports;
  });
  await gallery.screenshot({ path: join(output, 'ar-geometry-views.png'), fullPage: true });
  console.log(JSON.stringify(report.geometryViews));
  for (const view of report.geometryViews) {
    check(view.debugChanged && view.cleanRestored, `debug renders once and cleans up: ${view.name}`);
    if (view.name.startsWith('Nhìn dọc trục')) check(view.full > 100 && view.clipped === 0, 'complete model in unsupported axial view');
    else check(view.full > 100 && view.visible > 50 && view.visible <= view.full && view.clipped === 0, `WebGL geometry test: ${JSON.stringify(view)}`);
  }
  check(report.geometryViews.find(v => v.name === 'Nghiêng 45°').hidden > 20, 'tilted rear arc must be hidden by proxy');
  report.poseCoverage = await gallery.evaluate(async () => {
    const { estimateWrist } = await import('/src/wristGeometry.ts');
    const { handFixture } = await import('/src/testing/wristFixtures.ts');
    const { BraceletRenderer } = await import('/src/braceletRenderer.ts');
    const renderer = new BraceletRenderer(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 300;
    const ctx = canvas.getContext('2d');
    let accepted = 0, rejected = 0, minVisible = Infinity;
    const invisible = [];
    // Fit now changes only the bracelet. Test physically fitting/larger rings
    // for visibility; a 65% ring is correctly occluded inside an unchanged wrist.
    for (const mirror of [false, true]) for (const roll of [0, Math.PI / 2]) for (const twist of [0, Math.PI / 4, Math.PI / 2, Math.PI]) for (const tilt of [-.7, 0, .7]) for (const scale of [1, 3]) for (const fit of [1, 1.5]) {
      const f = handFixture({ mirror, roll, twist, tilt, scale });
      const pose = estimateWrist(f.points, f.world, f.aspect, mirror ? 'Left' : 'Right', { mode: 'straight-wrist' });
      if (!pose) { rejected++; continue; }
      accepted++;
      const layer = renderer.renderLayer(pose, '#c5a15e', fit, 300, 300 / f.aspect, { shadows: false });
      // Copy the entire render to a fixed measurement target, same for all poses.
      ctx.clearRect(0, 0, 300, 300); ctx.drawImage(layer, 0, 0, 300, 300);
      const pixels = ctx.getImageData(0, 0, 300, 300).data;
      let visible = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 30) visible++;
      minVisible = Math.min(minVisible, visible);
      if (visible < 5) invisible.push({ mirror, roll, twist, tilt, scale, fit, visible });
    }
    const f = handFixture(), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' });
    const count = occlusion => {
      const layer = renderer.renderLayer(p, '#c5a15e', .65, 300, 300 / f.aspect, { occlusion, shadows: false });
      ctx.clearRect(0, 0, 300, 300); ctx.drawImage(layer, 0, 0, 300, 300);
      const pixels = ctx.getImageData(0, 0, 300, 300).data; let n = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 30) n++; return n;
    };
    const undersized = { fit: .65, full: count(false), visible: count(true) };
    renderer.clear(); return { accepted, rejected, minVisible, invisible, manualFits: [1, 1.5], undersized };
  });
  check(report.poseCoverage.accepted > 100 && report.poseCoverage.invisible.length === 0, `accepted poses must retain a visible ring: ${JSON.stringify(report.poseCoverage)}`);
  check(report.poseCoverage.undersized.visible < report.poseCoverage.undersized.full * .25, 'an undersized bracelet must not shrink the wrist proxy to remain visible');
  check(errors.length === 0, JSON.stringify(errors));
  await writeFile(join(output, 'ar-verification.json'), JSON.stringify({ ...report, errors }, null, 2));
  console.log(JSON.stringify({ ...report, replay: report.replay.map(({ name, count, accepted, synced }) => ({ name, count, accepted, synced })) }, null, 2)); console.log(`PASS — artifacts: ${output}`);
} finally { await browser.close(); }
