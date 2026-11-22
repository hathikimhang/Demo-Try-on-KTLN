import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// The before modules are extracted verbatim from the ZIP taken BEFORE this
// recovery. Reference renderer is an earlier captured complete source, never
// a reconstructed model or an asserted user-approved visual baseline.
const backup = process.env.RECOVERY_BACKUP ?? 'backups/pre-3d-recovery-20261121T055941Z';
const out = resolve('artifacts/recovery-3d'); await mkdir(out, { recursive: true });
const fixtures = {};
for (const name of ['pointing_up.jpg', 'thumb_up.jpg', 'woman_hands.jpg']) {
  const path = join(tmpdir(), `mira-dynamic-${name}`);
  try { await readFile(path); } catch { const r = await fetch(`https://storage.googleapis.com/mediapipe-assets/${name}`); if (!r.ok) throw Error(`Fixture ${r.status}`); await writeFile(path, new Uint8Array(await r.arrayBuffer())); }
  fixtures[name] = path;
}
const check = (ok, why) => { if (!ok) throw Error(why); };
const report = { reference: 'Exact captured pre-native-upload source; not a user-approved known-good version', backup, images: [], errors: [] };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/.test(m.text())) report.errors.push(m.text()); });
  await page.addInitScript(() => { const Original = window.Worker; window.recoveryDetections = []; window.Worker = class extends Original { constructor(...args) { super(...args); this.addEventListener('message', e => { if (e.data.type === 'result') { const { frame, ...d } = e.data; window.recoveryDetections.push(d); } }); } }; });
  await page.goto(process.env.AR_URL ?? 'http://127.0.0.1:5173'); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng', exact: true }).uncheck();
  for (const name of Object.keys(fixtures)) {
    const n = await page.evaluate(() => window.recoveryDetections.length);
    await page.locator('input[type=file]').setInputFiles(fixtures[name]);
    await page.waitForFunction(n => window.recoveryDetections.length > n, n, { timeout: 60000 });
    await page.getByTestId('upload-status').filter({ hasText: /Auto Fit thành công|Đã hiển thị vòng/ }).waitFor();
    const result = await page.evaluate(async ({ backup, base64 }) => {
      const beforeBase = `/${backup}/before-src`, refBase = `/${backup}/reference-before-native-upload`;
      const [geometry, bm, bs, bd, br, am, as, ar, af, ao, rr] = await Promise.all([
        import(`${beforeBase}/wristGeometry.ts`), import(`${beforeBase}/imageWristMeasurement.ts`), import(`${beforeBase}/braceletSizing.ts`), import(`${beforeBase}/braceletDimensions.ts`), import(`${beforeBase}/braceletRenderer.ts`),
        import('/src/imageWristMeasurement.ts'), import('/src/braceletSizing.ts'), import('/src/braceletRenderer.ts'), import('/src/braceletRenderFrame.ts'), import('/src/imageOcclusion.ts'), import(`${refBase}/braceletRenderer.ts`),
      ]);
      const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode();
      const W = image.naturalWidth, H = image.naturalHeight, d = window.recoveryDetections.at(-1);
      const analyzed = geometry.analyzeWristForSource(d.points, d.worldPoints, H / W, d.handedness, { input: 'image', mode: 'forearm', armPoints: d.armPoints, armWorldPoints: d.armWorldPoints });
      if (!analyzed.pose) throw Error(`No observed pose: ${analyzed.reason}`);
      const pose = analyzed.pose, original = JSON.stringify(pose), region = bm.wristImageRoi(pose, W, H, d.points[0]);
      const sample = document.createElement('canvas'); sample.width = region.width; sample.height = region.height;
      const sc = sample.getContext('2d'); sc.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
      const roi = { ...region, data: sc.getImageData(0, 0, region.width, region.height).data };
      const beforeMeasure = bm.measureImageWrist(roi, pose, d.points[0]), afterMeasure = am.measureImageWrist(roi, pose, d.points[0]);
      const options = { input: 'image', auto: true, trackingSource: 'Hand', policy: 'visual-auto' };
      const beforeFit = new bs.WristSizer().update(beforeMeasure.pose, beforeMeasure.measurement, 0, options), afterFit = new as.WristSizer().update(pose, afterMeasure.measurement, 0, options);
      if (!beforeFit.pose || !afterFit.pose) throw Error('Fixture did not yield a safe render pose');
      const beforeRenderer = new br.BraceletRenderer(), afterRenderer = new ar.BraceletRenderer(), referenceRenderer = new rr.BraceletRenderer();
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
      const beforeOptions = { occlusion: !!beforeMeasure.mask && ['image', 'manual-edges'].includes(beforeFit.method), imageMask: beforeMeasure.mask };
      const beforeScale = bd.imageRenderFit(1, ['image', 'manual-edges'].includes(beforeFit.method)), afterScale = bd.imageRenderFit(1, ['image', 'manual-edges'].includes(afterFit.method));
      const afterOptions = ao.imageOcclusionOptions(afterMeasure.mask);
      ctx.drawImage(image, 0, 0); beforeRenderer.draw(ctx, beforeFit.pose, '#c5a15e', beforeScale, beforeOptions); const beforePng = canvas.toDataURL().split(',')[1];
      ctx.clearRect(0, 0, W, H); ctx.drawImage(image, 0, 0); afterRenderer.drawFrame(ctx, af.braceletRenderFrame(pose, afterFit.pose.radius, afterScale, '#c5a15e'), afterOptions); const afterPng = canvas.toDataURL().split(',')[1];
      // Same pose/radius/manual/color/occlusion: compare current render core
      // against exact historical source to isolate PBR/camera regressions.
      const pixels = layer => { ctx.clearRect(0, 0, W, H); ctx.drawImage(layer, 0, 0, W, H); return ctx.getImageData(0, 0, W, H).data; };
      const comparisons = [];
      for (const color of ['#c5a15e', '#aeb8c5', '#cc9587']) {
        const old = pixels(referenceRenderer.renderLayer(afterFit.pose, color, 1, W, H, { shadows: true }));
        const now = pixels(afterRenderer.renderLayer(afterFit.pose, color, 1, W, H, { shadows: true }));
        let maxDifference = 0, totalDifference = 0, visible = 0;
        for (let i = 0; i < old.length; i++) { const delta = Math.abs(old[i] - now[i]); maxDifference = Math.max(maxDifference, delta); totalDifference += delta; }
        for (let i = 3; i < now.length; i += 4) if (now[i] > 30) visible++;
        comparisons.push({ color, maxDifference, meanDifference: totalDifference / old.length, visible });
      }
      const full = pixels(afterRenderer.renderLayer(afterFit.pose, '#c5a15e', afterScale, W, H, { occlusion: false, shadows: false }));
      const depth = pixels(afterRenderer.renderLayer(afterFit.pose, '#c5a15e', afterScale, W, H, { ...afterOptions, shadows: false }));
      let hidden = 0, visible = 0; for (let i = 3; i < full.length; i += 4) { if (full[i] > 100 && depth[i] < 10) hidden++; if (depth[i] > 30) visible++; }
      const angle = geometry.quaternionAngle(pose.orientation, beforeFit.pose.orientation) * 180 / Math.PI;
      const afterAngle = geometry.quaternionAngle(pose.orientation, afterFit.pose.orientation) * 180 / Math.PI;
      const beforeCenter = geometry.project(beforeFit.pose.center, pose), trackedCenter = geometry.project(pose.center, pose);
      const beforeShift = Math.hypot(beforeCenter.x - trackedCenter.x, beforeCenter.y - trackedCenter.y) * W;
      beforeRenderer.clear(); afterRenderer.clear(); referenceRenderer.clear();
      return { beforePng, afterPng, mode: analyzed.effectiveMode, fallback: analyzed.fallbackReason, before: { method: beforeFit.method, radius: beforeFit.pose.radius, angleFromTracking: angle, centerShiftPx: beforeShift, occlusion: beforeOptions.occlusion }, after: { method: afterFit.method, radius: afterFit.pose.radius, angleFromTracking: afterAngle, centerPreserved: JSON.stringify(afterFit.pose.center) === JSON.stringify(pose.center), occlusion: afterOptions.occlusion, mask: !!afterMeasure.mask, measuredWidthPx: afterMeasure.measurement.width === null ? null : afterMeasure.measurement.width * W }, trackingInputUnmodified: JSON.stringify(pose) === original, measurementReturnsPose: 'pose' in afterMeasure, comparisons, depth: { hidden, visible } };
    }, { backup, base64: (await readFile(fixtures[name])).toString('base64') });
    await writeFile(join(out, `before-${name}.png`), Buffer.from(result.beforePng, 'base64'));
    await writeFile(join(out, `after-${name}.png`), Buffer.from(result.afterPng, 'base64'));
    delete result.beforePng; delete result.afterPng;
    check(result.trackingInputUnmodified && !result.measurementReturnsPose, 'measurement cannot modify or return tracking pose');
    check(result.after.centerPreserved && result.after.angleFromTracking < .00001, 'after: original tracking transform preserved');
    check(result.after.occlusion && result.depth.visible > 20, 'depth fallback enabled and front bracelet visible');
    check(result.comparisons.every(c => c.maxDifference <= 2 && c.meanDifference < .01 && c.visible > 20), 'PBR/camera/lighting must match historical render core');
    if (result.before.method === 'provisional') check(!result.before.occlusion && result.after.occlusion && result.depth.hidden > 10, 'provisional regression reproduced and depth restored');
    report.images.push({ fixture: name, ...result });
  }
  check(report.images.some(i => i.before.angleFromTracking > 1 || i.before.centerShiftPx > 1), 'must actually reproduce the measurement-to-pose regression');
  check(!report.errors.length, JSON.stringify(report.errors));
  const cells = report.images.map(r => `<section><h2>${r.fixture}</h2><p>Trước sửa: lệch tracking ${r.before.angleFromTracking.toFixed(2)}°, tâm ${r.before.centerShiftPx.toFixed(1)} px, occlusion ${r.before.occlusion}. Sau sửa: giữ pose tracking, occlusion ${r.after.occlusion}. ${r.after.method}.</p><div><figure><img src="before-${r.fixture}.png"><figcaption>Trước khôi phục — ZIP gốc</figcaption></figure><figure><img src="after-${r.fixture}.png"><figcaption>Sau khôi phục có chọn lọc</figcaption></figure></div></section>`).join('');
  await writeFile(join(out, 'comparison.html'), `<!doctype html><meta charset="utf-8"><title>Đối chiếu phục hồi 3D</title><style>body{font:16px system-ui;background:#eee;max-width:1100px;margin:auto;padding:24px}section{background:white;padding:20px;margin-bottom:20px}section>div{display:flex;gap:16px}figure{margin:0;flex:1}img{max-width:100%;max-height:650px}figcaption{padding:12px}</style><h1>Đối chiếu source và pixel trước/sau</h1><p>Ảnh mẫu MediaPipe, inference thật. Source tham chiếu là bản đã đọc trước sửa Upload; chưa có bản được người dùng xác nhận là đẹp. Không thay model/PBR hoặc tuyên bố nghiệm thu trên ảnh người dùng.</p>${cells}`);
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  await page.goto(`${process.env.AR_URL ?? 'http://127.0.0.1:5173'}/artifacts/recovery-3d/comparison.html`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(out, 'comparison.png'), fullPage: true });
} finally { await browser.close(); }
