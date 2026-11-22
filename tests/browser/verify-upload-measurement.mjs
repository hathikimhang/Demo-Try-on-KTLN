import {sourceInitScript} from './support/sourceModules.mjs';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Hand suy luận thật trên ảnh chính thức; upsample chỉ kiểm tra
// mapping tọa độ, không tạo thêm chi tiết ảnh gốc tần số cao.
const out = resolve('artifacts'); await mkdir(out, { recursive: true });
const file = join(tmpdir(), 'mira-dynamic-pointing_up.jpg');
try { await readFile(file); } catch {
  const r = await fetch('https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg');
  if (!r.ok) throw Error(`Fixture HTTP ${r.status}`); await writeFile(file, new Uint8Array(await r.arrayBuffer()));
}
const check = (ok, message) => { if (!ok) throw Error(message); };
const report = { scope: 'Actual image inference plus synthetic GPU masks; no user photo or physical webcam', measurements: [], errors: [], shaderErrors: [] };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/.test(m.text())) report.shaderErrors.push(m.text()); });
  await page.addInitScript(() => {
    const WorkerBase = window.Worker; window.measureReplies = [];
    window.Worker = class extends WorkerBase {
      constructor(...a) { super(...a); this.addEventListener('message', e => { if (e.data.type === 'result') { const { frame, ...data } = e.data; window.measureReplies.push(data); } }); }
    };
  });
  await page.addInitScript({content:sourceInitScript}); await page.goto(process.env.AR_URL ?? 'http://127.0.0.1:5173'); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  const getLog = async name => {
    const pending = page.waitForEvent('download'); await page.getByTestId('export-wrist-debug').click();
    const download = await pending, path = join(out, name); await download.saveAs(path);
    return JSON.parse(await readFile(path, 'utf8')).samples.at(-1);
  };
  const source = (await readFile(file)).toString('base64');
  let original;
  for (const factor of [1, 4, 8]) {
    const png = await page.evaluate(async ({ source, factor }) => {
      const image = new Image(); image.src = `data:image/jpeg;base64,${source}`; await image.decode();
      const c = document.createElement('canvas'); c.width = image.naturalWidth * factor; c.height = image.naturalHeight * factor;
      c.getContext('2d').drawImage(image, 0, 0, c.width, c.height); return c.toDataURL('image/png').split(',')[1];
    }, { source, factor });
    await page.locator('input[type=file]').setInputFiles({ name: `original-resolution-${factor}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.getByTestId('upload-status').filter({ hasText: 'Auto Fit thành công' }).waitFor({ timeout: 60000 });
    let row = await getLog(`upload-native-${factor}.json`);
    check(row.fitStatus === 'measured' && row.imageMeasurement.selected.length === 2, 'actual image must have two observed edges');
    check(row.imageMeasurement.imageWidth === 358 * factor, 'native width independent of 960px inference / 1600px output caps');
    check(row.nativeBraceletWidthPx / row.nativeWristWidthPx > 1 && row.nativeBraceletWidthPx / row.nativeWristWidthPx < 1.2, 'projected bracelet has plausible image-space clearance');
    if (factor === 1) original = row;
    else check(Math.abs(row.nativeWristWidthPx / original.nativeWristWidthPx / factor - 1) < .08, 'upscaled same photo uses proportional pixel measurement');
    report.measurements.push({ factor, wristPx: row.nativeWristWidthPx, innerPx: row.nativeBraceletWidthPx, fitRatio: row.nativeBraceletWidthPx / row.nativeWristWidthPx });
    await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).fill('85');
    await page.getByTestId('collision-limit').waitFor();
    row = await getLog(`upload-fit85-${factor}.json`);
    check(row.manualFitMultiplier === .85 && row.effectiveFitMultiplier > .85 && row.effectiveFitMultiplier < 1, 'collision floor is explicit, user input preserved');
    check(row.nativeBraceletWidthPx > row.nativeWristWidthPx, '85% must not shrink jewellery inside measured skin');
    await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).uncheck();
    const pngDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Chụp & lưu ảnh', exact: true }).click();
    const pngPath = join(out, `upload-clean85-${factor}.png`); await (await pngDownload).saveAs(pngPath);
    const pngBytes = await readFile(pngPath);
    const outputRatio = Math.min(1, 1600 / (376 * factor));
    check(pngBytes.readUInt32BE(16) === Math.round(358 * factor * outputRatio) && pngBytes.readUInt32BE(20) === Math.round(376 * factor * outputRatio), 'saved PNG uses capped canvas pixels and excludes CSS/debug overlays');
    await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
    await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).fill('100');
    // Chọn đúng cặp biên đã xác nhận bằng pointer event DOM thật.
    const pair = row.imageMeasurement.selected;
    await page.getByRole('button', { name: 'Chọn hai mép cổ tay', exact: true }).click();
    check(await page.getByRole('button', { name: 'Chụp & lưu ảnh', exact: true }).isDisabled(), 'unfinished calibration is not saved');
    const rect = await page.locator('canvas.output-canvas').boundingBox();
    const aspect = row.imageMeasurement.imageHeight / row.imageMeasurement.imageWidth;
    for (const p of pair) await page.mouse.click(rect.x + p.x * rect.width, rect.y + p.y / aspect * rect.height);
    await page.getByTestId('upload-status').filter({ hasText: 'calibration thủ công' }).waitFor();
    const manual = await getLog(`upload-manual-edges-${factor}.json`);
    check(manual.fitStatus === 'manual' && manual.measurementConfidence === 1, 'two clicks are explicitly manual calibration, not auto');
    check(Math.abs(manual.nativeWristWidthPx / row.nativeWristWidthPx - 1) < .015, 'CSS/native coordinates of the two clicked edges agree');
    await page.getByRole('button', { name: 'Đo lại tự động', exact: true }).click();
    await page.getByTestId('upload-status').filter({ hasText: 'Auto Fit thành công' }).waitFor();
    await page.getByTestId('tracking-debug').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: join(out, `upload-native-debug-${factor}.png`), fullPage: true });
  }
  // Ảnh thật có biên mơ hồ phải bị Auto Fit từ chối; calibration hai mép
  // do người đánh dấu vẫn hoạt động mà không nhận nhầm thành đo tự động.
  const fallbackFile = join(tmpdir(), 'mira-dynamic-woman_hands.jpg');
  try { await readFile(fallbackFile); } catch {
    const r = await fetch('https://storage.googleapis.com/mediapipe-assets/woman_hands.jpg');
    if (!r.ok) throw Error(`Fallback fixture HTTP ${r.status}`); await writeFile(fallbackFile, new Uint8Array(await r.arrayBuffer()));
  }
  // Kiểm tra thiếu model thật: Hand vẫn tiếp tục suy luận bình thường.
  await page.route('**/models/skin.tflite', route => route.abort());
  await page.locator('input[type=file]').setInputFiles(fallbackFile);
  await page.getByTestId('upload-status').filter({ hasText: 'Provisional Fit' }).waitFor({ timeout: 60000 });
  const rejected = await getLog('upload-rejected-measurement.json');
  check(rejected.fitStatus === 'provisional' && rejected.nativeWristWidthPx === null && !!rejected.imageMeasurement.rejection, 'failed real measurement remains transparent');
  await page.getByRole('button', { name: 'Chọn hai mép cổ tay', exact: true }).click();
  await page.locator('canvas.output-canvas').scrollIntoViewIfNeeded();
  const fallbackRect = await page.locator('canvas.output-canvas').boundingBox();
  const annotatedEdges = [{ x: 280, y: 620 }, { x: 286, y: 707 }];
  for (const p of annotatedEdges) await page.mouse.click(fallbackRect.x + p.x / 640 * fallbackRect.width, fallbackRect.y + p.y / 960 * fallbackRect.height);
  await page.getByTestId('upload-status').filter({ hasText: 'calibration thủ công' }).waitFor();
  const fallback = await getLog('upload-fallback-manual.json');
  check(fallback.fitStatus === 'manual' && !fallback.imageMeasurement.maskAvailable, 'no mask is invented from manual edge selection');
  check(Math.abs(fallback.nativeWristWidthPx - Math.hypot(6, 87)) < 1, 'actual pointer span in native pixels');
  report.manualFallback = { fixture: 'woman_hands.jpg', rejectedReason: rejected.imageMeasurement.rejection, annotations: annotatedEdges, wristPx: fallback.nativeWristWidthPx, innerPx: fallback.nativeBraceletWidthPx, occlusion: 'geometric proxy fallback: no trusted foreground mask', status: fallback.fitStatus };
  // Kiểm tra shader clipping bằng mask bất đối xứng để lỗi lật Y
  // hoặc cache render không vượt test nhờ đối xứng; so pixel GPU, không chỉ so shader text.
  report.occlusion = await page.evaluate(async () => {
    const { BraceletRenderer } = await import(window.miraSourceModules["braceletRenderer"]);
    const { handFixture } = await import(window.miraSourceModules["testing/wristFixtures"]);
    const { estimateWrist } = await import(window.miraSourceModules["wristGeometry"]);
    const { imageRenderFit } = await import(window.miraSourceModules["braceletDimensions"]);
    const renderer = new BraceletRenderer(), f = handFixture({ tilt: .55, aspect: 1 });
    const pose = estimateWrist(f.points, f.world, f.aspect, '', { mode: 'straight-wrist' });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 400;
    const ctx = canvas.getContext('2d');
    const render = options => { ctx.clearRect(0, 0, 400, 400); ctx.drawImage(renderer.renderLayer(pose, '#c5a15e', imageRenderFit(.85, true), 400, 400, { shadows: false, ...options }), 0, 0); return ctx.getImageData(0, 0, 400, 400).data; };
    const makeMask = data => ({ width: 2, height: 2, data: new Uint8Array(data), roi: { x: 0, y: 0, width: 1, height: 1 } });
    const full = render({ occlusion: false }), unmasked = render({ occlusion: true }), zero = render({ imageMask: makeMask([0, 0, 0, 0]) }), white = render({ imageMask: makeMask([255, 255, 255, 255]) }), top = render({ imageMask: makeMask([255, 255, 0, 0]) });
    let fullPixels = 0, hidden = 0, topChanges = 0, bottomChanges = 0, zeroDiff = 0, whiteDiff = 0;
    for (let i = 0; i < full.length; i += 4) {
      if (full[i + 3] > 30) fullPixels++;
      if (full[i + 3] > 100 && unmasked[i + 3] < 10) hidden++;
      if (Math.abs(full[i + 3] - top[i + 3]) > 30) { if (Math.floor(i / 4 / 400) < 200) topChanges++; else bottomChanges++; }
      if (Math.abs(full[i + 3] - zero[i + 3]) > 10) zeroDiff++;
      if (Math.abs(unmasked[i + 3] - white[i + 3]) > 10) whiteDiff++;
    }
    const restored = render({ occlusion: true }); let restoreDiff = 0;
    for (let i = 3; i < restored.length; i += 4) if (restored[i] !== unmasked[i]) restoreDiff++;
    renderer.clear(); return { fullPixels, hidden, topChanges, bottomChanges, zeroDiff, whiteDiff, restoreDiff };
  });
  check(report.occlusion.fullPixels > 100 && report.occlusion.hidden > 10, 'closed 3D ring and depth testing really rendered');
  check(report.occlusion.zeroDiff === 0 && report.occlusion.whiteDiff === 0, 'mask clips the actual depth pass');
  check(report.occlusion.topChanges > 10 && report.occlusion.bottomChanges === 0, 'top-left image mask correctly maps bottom-left WebGL origin');
  check(report.occlusion.restoreDiff === 0, 'camera unmasked depth behavior restored after image mask');
  check(!report.errors.length && !report.shaderErrors.length, JSON.stringify(report));
  await writeFile(join(out, 'upload-measurement.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); console.log('PASS native measurements, Manual85 safety, two-edge pointer calibration, PNG and GPU mask');
} catch (e) {
  report.failure = String(e); if (page) await page.screenshot({ path: join(out, 'upload-measurement-failure.png'), fullPage: true });
  await writeFile(join(out, 'upload-measurement-failure.json'), JSON.stringify(report, null, 2)); throw e;
} finally { await browser.close(); }
