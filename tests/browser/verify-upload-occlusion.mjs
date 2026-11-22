import {sourceInitScript} from './support/sourceModules.mjs';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';

const out = resolve('artifacts/upload-occlusion'), base = process.env.AR_URL ?? 'http://127.0.0.1:5173'; await mkdir(out, { recursive: true });
const files = process.env.TRYON_IMAGE ? [resolve(process.env.TRYON_IMAGE)] : ['pointing_up.jpg', 'thumb_up.jpg', 'woman_hands.jpg'].map(name => join(tmpdir(), `mira-dynamic-${name}`));
if (!process.env.TRYON_IMAGE) for (const file of files) {
 try { await readFile(file); } catch {
  const name = basename(file).replace('mira-dynamic-', '');
  const response = await fetch(`https://storage.googleapis.com/mediapipe-assets/${name}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Fixture HTTP ${response.status}: ${name}`);
  await writeFile(file, new Uint8Array(await response.arrayBuffer()));
 }
}
const report = { scope: process.env.TRYON_IMAGE ? 'Image explicitly supplied through TRYON_IMAGE' : 'Official MediaPipe photos; current user photo unavailable', images: [], errors: [] };
const check = (value, why) => { if (!value) throw Error(why); };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
 page.on('pageerror', e => report.errors.push(e.message));
 page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/.test(m.text())) report.errors.push(m.text()); });
 await page.addInitScript(() => { window.occlusionDetections = []; const Original = window.Worker; window.Worker = class extends Original { constructor(...args) { super(...args); this.addEventListener('message', e => { if (e.data.type === 'result') window.occlusionDetections.push(e.data); }); } }; });
 await page.addInitScript({content:sourceInitScript}); await page.goto(base); await page.waitForLoadState('networkidle');
 check(await page.locator('#size').inputValue() === '1', 'Auto Fit starts at 100%, without a hardcoded 120% enlargement');
 await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng', exact: true }).uncheck();
 for (const file of files) {
  const n = await page.evaluate(() => window.occlusionDetections.length);
  await page.locator('input[type=file]').setInputFiles(file);
  await page.waitForFunction(n => window.occlusionDetections.length > n || document.querySelector('.error-message'), n, { timeout: 60000 });
  if (await page.locator('.error-message').count()) throw Error(await page.locator('.error-message').innerText());
  const bytes = await readFile(file), mime = file.toLowerCase().endsWith('.png') ? 'image/png' : file.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const result = await page.evaluate(async ({ bytes, mime }) => {
   const [g, m, sm, sizing, dims, rendering, debug, registration] = await Promise.all([import(window.miraSourceModules["wristGeometry"]), import(window.miraSourceModules["imageWristMeasurement"]), import(window.miraSourceModules["segmentedWristMeasurement"]), import(window.miraSourceModules["braceletSizing"]), import(window.miraSourceModules["braceletDimensions"]), import(window.miraSourceModules["braceletRenderer"]), import(window.miraSourceModules["wristDebug"]), import(window.miraSourceModules["imageWristRegistration"])]);
   const image = new Image(); image.src = `data:${mime};base64,${bytes}`; await image.decode(); const W = image.width, H = image.height;
   const d = window.occlusionDetections.at(-1), analysis = g.analyzeWristForSource(d.points, d.worldPoints, H / W, d.handedness, { input: 'image', mode: 'forearm', armPoints: d.armPoints, armWorldPoints: d.armWorldPoints });
   if (!analysis.pose) throw Error(`No safe wrist pose: ${analysis.reason}`);
   const pose = analysis.pose, region = m.wristImageRoi(pose, W, H, d.points[0]);
   const native = document.createElement('canvas'); native.width = region.width; native.height = region.height; const nc = native.getContext('2d'); nc.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
   const roi = { ...region, data: nc.getImageData(0, 0, region.width, region.height).data };
   const rgb = m.measureImageWrist(roi, pose, d.points[0]), semantic = d.skin ? sm.measureSegmentedWrist(roi, pose, d.skin, d.points[0]) : null;
   const fast = m.measureImageWrist(roi, pose, d.points[0], true, 0, true);
   if (JSON.stringify(fast.measurement) !== JSON.stringify(rgb.measurement) || !!fast.mask !== !!rgb.mask || (fast.mask && fast.mask.data.some((v,i)=>v!==rgb.mask.data[i]))) throw Error('Live fast mask/measurement differs from the original native algorithm');
   const observation = semantic?.measurement.width != null ? semantic : rgb, measurement = observation.measurement.width !== null ? observation.measurement : semantic?.measurement ?? observation.measurement;
   const mask = semantic?.mask ?? observation.mask;
   const registered = registration.registerImageWrist(pose, measurement);
   const fit = new sizing.WristSizer().update(registered, measurement, 0, { input: 'image', policy: 'visual-auto', trackingSource: 'Hand', auto: true });
   if (!fit.pose) throw Error(`No render pose: ${fit.message}`);
   const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d'), renderer = new rendering.BraceletRenderer();
   const views = [];
   for (const manual of [1, .98]) {
    const scale = dims.imageRenderFit(manual, fit.method === 'image'), values = sizing.sizingDebug(fit.pose, manual, W, measurement, fit.method, fit.message, scale);
    const buffers = [], png = {}; let uiComparison = null;
    for (const occlusion of [false, true]) {
     ctx.clearRect(0, 0, W, H); ctx.drawImage(image, 0, 0);
     renderer.draw(ctx, fit.pose, '#c5a15e', scale, { occlusion, imageMask: mask });
     png[occlusion ? 'B' : 'A'] = canvas.toDataURL().split(',')[1];
     if (occlusion && manual === 1) {
      const ui = document.querySelector('canvas.output-canvas');
      if (ui.width === W && ui.height === H) {
       const a = ctx.getImageData(0, 0, W, H).data, b = ui.getContext('2d').getImageData(0, 0, W, H).data;
       let different = 0, maxDifference = 0; for (let i = 0; i < W * H; i++) { let delta = 0; for (let k = 0; k < 3; k++) delta = Math.max(delta, Math.abs(a[i * 4 + k] - b[i * 4 + k])); maxDifference = Math.max(maxDifference, delta); if (delta > 3) different++; }
       uiComparison = { different, maxDifference, fraction: different / (W * H) };
      }
     }
     const layer = renderer.renderLayer(fit.pose, '#c5a15e', scale, W, H, { occlusion, imageMask: mask, shadows: false });
     ctx.clearRect(0, 0, W, H); ctx.drawImage(layer, 0, 0, W, H); buffers.push(ctx.getImageData(0, 0, W, H).data);
    }
    const rawLayer = renderer.renderLayer(fit.pose, '#c5a15e', scale, W, H, { occlusion: true, imageMask: null, shadows: false });
    ctx.clearRect(0, 0, W, H); ctx.drawImage(rawLayer, 0, 0, W, H); const raw = ctx.getImageData(0, 0, W, H).data;
    let fullPixels = 0, visiblePixels = 0, hiddenPixels = 0, hiddenOutsideSkin = 0, unmaskedHiddenOutsideSkin = 0, borderPixels = 0;
    for (let i = 0; i < W * H; i++) {
     if (buffers[0][i * 4 + 3] > 30) { fullPixels++; if (i % W < 2 || i % W > W - 3 || i < W * 2 || i >= W * (H - 2)) borderPixels++; }
     if (buffers[1][i * 4 + 3] > 30) visiblePixels++;
     if (buffers[0][i * 4 + 3] > 100 && buffers[1][i * 4 + 3] < 10) {
      hiddenPixels++;
      if (d.skin && sm.skinProbability(d.skin, { x: (i % W + .5) / W, y: (Math.floor(i / W) + .5) / W }, H / W) < .35) hiddenOutsideSkin++;
     }
     if (d.skin && buffers[0][i * 4 + 3] > 100 && raw[i * 4 + 3] < 10 && sm.skinProbability(d.skin, { x: (i % W + .5) / W, y: (Math.floor(i / W) + .5) / W }, H / W) < .35) unmaskedHiddenOutsideSkin++;
    }
    views.push({ manual, widthPx: values.nativeWristWidthPx, innerPx: values.nativeBraceletWidthPx, ratio: values.fitRatio, baseScale: values.baseScale, finalWorldScale: values.finalWorldScale, fullPixels, visiblePixels, hiddenPixels, hiddenOutsideSkin, unmaskedHiddenOutsideSkin, borderPixels, uiComparison, png });
   }
   ctx.clearRect(0, 0, W, H); ctx.drawImage(image, 0, 0); debug.drawWristMeasurementDebug(ctx, measurement, fit.pose, fit.method, 1, false); const measurementPng = canvas.toDataURL().split(',')[1];
   const center = g.project(fit.pose.center, fit.pose); renderer.clear();
   const originalCenter = g.project(pose.center, pose);
   return { image: { width: W, height: H }, mode: analysis.effectiveMode, segmentation: !!d.skin, method: fit.method, measuredBy: measurement.image?.method, reason: measurement.reason, centerPx: { x: center.x * W, y: center.y * W }, originalCenterPx: {x:originalCenter.x*W,y:originalCenter.y*W}, orientationDelta: g.quaternionAngle(pose.orientation, registered.orientation), rejected: measurement.image?.rejected, slices: measurement.slices, confidence: measurement.confidence, selected: measurement.image?.selected, rgbRejected: rgb.measurement.image?.rejected, rgbReason: rgb.measurement.reason, semanticReason: semantic?.measurement.reason, views, measurementPng };
  }, { bytes: bytes.toString('base64'), mime });
  const name = basename(file).replace(/[^a-zA-Z0-9.-]/g, '-');
  const numericFit = page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true });
  const hasNumericFit = await numericFit.count() > 0;
  if (hasNumericFit) await numericFit.fill('98');
  else await page.locator('#size').fill('0.98');
  result.uiComparison98 = await page.locator('canvas.output-canvas').evaluate(async (canvas, expected) => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const image = new Image(); image.src = `data:image/png;base64,${expected}`; await image.decode();
    if (image.width !== canvas.width || image.height !== canvas.height) return null;
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height; const ctx = copy.getContext('2d'); ctx.drawImage(image, 0, 0);
    const a = ctx.getImageData(0, 0, copy.width, copy.height).data, b = canvas.getContext('2d').getImageData(0, 0, copy.width, copy.height).data;
    let different = 0; for (let i = 0; i < copy.width * copy.height; i++) if (Math.max(...[0, 1, 2].map(k => Math.abs(a[i * 4 + k] - b[i * 4 + k]))) > 3) different++;
    return { different, fraction: different / (copy.width * copy.height) };
  }, result.views[1].png.B);
  check(!result.uiComparison98 || result.uiComparison98.fraction < .001, 'Manual98 is applied exactly once in the actual UI');
  if (hasNumericFit) await numericFit.fill('100');
  else await page.locator('#size').fill('1');
  for (const v of result.views) {
   for (const kind of ['A', 'B']) await writeFile(join(out, `${name}-${Math.round(v.manual * 100)}-${kind}.png`), Buffer.from(v.png[kind], 'base64'));
   delete v.png;
   check(v.fullPixels > 40 && v.visiblePixels > 30 && v.borderPixels === 0, 'full geometry/front surface visible and not viewport-clipped');
   check(!result.segmentation || v.hiddenOutsideSkin < 3, 'depth must not erase bracelet over non-skin pixels');
   check(!v.uiComparison || v.uiComparison.fraction < .001, 'diagnostic B must match the actual application canvas, not just a separate maths demo');
   if (result.method === 'image') check(v.ratio > 1 && v.ratio < 1.3, 'measured wrist / projected inner diameter compared in the same image coordinates');
  }
  await writeFile(join(out, `${name}-measurement.png`), Buffer.from(result.measurementPng, 'base64')); delete result.measurementPng;
  report.images.push({ fixture: name, ...result });
 }
 check(!report.errors.length, JSON.stringify(report.errors));
 await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
 const sections = report.images.map(r => `<section><h2>${r.fixture}</h2><p>Đo: ${r.views[0].widthPx?.toFixed(1) ?? 'chưa có'} px · lỗ vòng: ${r.views[0].innerPx?.toFixed(1)} px · ${r.method} · Manual 100% · tâm (${r.centerPx.x.toFixed(1)}, ${r.centerPx.y.toFixed(1)}) px.</p><div><figure><img src="${r.fixture}-100-A.png"><figcaption>A — tắt occlusion, nguyên vòng 3D</figcaption></figure><figure><img src="${r.fixture}-100-B.png"><figcaption>B — depth + mask da + bóng tiếp xúc</figcaption></figure></div><p>${Object.entries(r.rejected ?? {}).map(([why, n]) => `${why}: ${n}`).join('; ') || 'Các lát cắt đạt kiểm tra'}</p></section>`).join('');
 await writeFile(join(out, 'comparison.html'), `<!doctype html><meta charset="utf-8"><title>A/B Upload occlusion</title><style>body{font:16px system-ui;background:#eee;max-width:1100px;margin:auto;padding:24px}section{padding:20px;background:white;margin:20px 0}section>div{display:flex;gap:20px}figure{margin:0;flex:1}img{max-width:100%;max-height:700px}figcaption{padding:12px}</style><h1>A/B: cùng pose, model, material và kích thước</h1><p>${report.scope}. Chưa có ảnh đang lỗi của người dùng để nghiệm thu. Trong B, phần vòng phía sau da có thể không nhìn thấy; geometry vẫn là torus 360°.</p>${sections}`);
 await page.addInitScript({content:sourceInitScript}); await page.goto(`${base}/artifacts/upload-occlusion/comparison.html`); await page.waitForLoadState('networkidle'); await page.screenshot({ path: join(out, 'comparison.png'), fullPage: true });
 await rm(join(out, 'failure.json'), { force: true });
 console.log(JSON.stringify({ ...report, images: report.images.map(({ slices, ...row }) => row) }, null, 2));
} catch (error) {
 report.failure = String(error); await writeFile(join(out, 'failure.json'), JSON.stringify(report, null, 2)); throw error;
} finally { await browser.close(); }
