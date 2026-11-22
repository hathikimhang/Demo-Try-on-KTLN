import {sourceInitScript} from './support/sourceModules.mjs';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const out = resolve('artifacts/live-axis'), base = process.env.AR_URL ?? 'http://127.0.0.1:5173'; await mkdir(out, { recursive: true });
const fixture = join(tmpdir(), 'mira-dynamic-pointing_up.jpg');
try { await readFile(fixture); } catch { const r = await fetch('https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg'); if (!r.ok) throw Error(`Fixture HTTP ${r.status}`); await writeFile(fixture, new Uint8Array(await r.arrayBuffer())); }
const samples = [], report = { scope: 'Real Hand/Pose/segmentation inference on a photo captureStream; observed image rotations, NOT physical wrist pronation/supination or hardware webcam.', cases: [], errors: [] };
const check = (ok, why) => { if (!ok) throw Error(why); };
const until = async (fn, why) => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 60000) throw Error(`Timeout: ${why}`); await new Promise(r => setTimeout(r, 100)); } };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true }); let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.text().startsWith('[mira-live] ')) samples.push(JSON.parse(m.text().slice(12))); });
  await page.addInitScript({content:sourceInitScript}); await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.evaluate(async bytes => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${bytes}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 720; const ctx = canvas.getContext('2d');
    window.axisInput = { angle: 0, scale: 1 };
    const draw = () => { const t = window.axisInput; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720); ctx.translate(320, 365); ctx.rotate(t.angle * Math.PI / 180); ctx.scale(1.15 * t.scale, 1.15 * t.scale); ctx.drawImage(image, -176, -286); window.axisAnimation = requestAnimationFrame(draw); }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.axisStream = canvas.captureStream(24); return window.axisStream; } });
    // Instrument đúng class đang được ứng dụng dùng; Vite có thể thêm ?t=.
    const rendererUrl = performance.getEntriesByType('resource').find(e=>e.name.includes(window.miraSourceModules["braceletRenderer"]))?.name ?? window.miraSourceModules["braceletRenderer"];
    const { BraceletRenderer } = await import(rendererUrl), original = BraceletRenderer.prototype.drawFrame;
    BraceletRenderer.prototype.drawFrame = function(ctx, frame, options) {
      if (window.axisCaptureNext && !options.debugProxy) {
        window.axisCaptureNext = false;
        window.axisCapture = { background: ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), frame, options };
      }
      return original.call(this, ctx, frame, options);
    };
  }, (await readFile(fixture)).toString('base64'));
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await until(() => samples.some(s => s.live.state === 'TRACKING'), 'initial independent forearm observation');
  const stationary = async (angle, required) => {
    const start = samples.length;
    await page.evaluate(angle => { window.axisInput = { angle, scale: 1 }; }, angle);
    await until(() => samples.length >= start + 18, `${angle} degrees observations`);
    const rows = samples.slice(-5), valid = rows.filter(s => s.wristRadius > 0 && s.live.estimatedForearmAxis && s.live.forearmAxis);
    if (required) check(valid.length >= 3, `priority ${angle}° must retain a valid observed forearm`);
    const last = valid.at(-1) ?? rows.at(-1), a = last.live.estimatedForearmAxis, b = last.live.forearmAxis;
    const alignment = a && b ? Math.acos(Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / Math.hypot(a.x, a.y, a.z) / Math.hypot(b.x, b.y, b.z)))) * 180 / Math.PI : null;
    const p = last.live.braceletCenter, center = p ? { x: (p.x * 1.51875 / p.z + .5) * 640, y: (p.y * 1.51875 / p.z + .5625) * 640 } : null;
    const item = { imageRotationDegrees: angle, validFrames: valid.length, state: last.live.state, forearmSource: last.live.forearmSource, depthSource: last.live.depthSource, orientationConfidence: last.live.orientationConfidence, orientationReason: last.live.orientationReason, centreImagePx: center, normalAlignmentDegrees: alignment, intrinsic: last.calibrationRadiusRatio, wristWidthPx: last.wristProjectedWidthPx, observedWidthPx: last.live.measuredWidthPx, braceletWidthPx: last.braceletProjectedWidthPx, axis: a };
    if (valid.length) check(alignment < 3, `${angle}° filtered bracelet normal follows independent forearm direction`);
    else check(rows.every(s => !s.wristRadius && ['ACQUIRING', 'DEGRADED', 'LOST'].includes(s.live.state)), `${angle}° unsupported pose must not render an invented orientation`);
    report.cases.push(item); console.log(JSON.stringify(item)); return item;
  };
  const zero = await stationary(0, true), twenty = await stationary(20, true);
  check(zero.forearmSource.startsWith('contour') || zero.forearmSource === 'Pose', 'baseline observes forearm independently of fingers');
  check(Math.abs(twenty.intrinsic / zero.intrinsic - 1) < .08, '20° image tilt does not re-size wrist anatomy');
  const projected = a => { const x = a.x - ((twenty.centreImagePx?.x ?? 320) / 640 - .5) / 1.51875 * a.z, y = a.y - ((twenty.centreImagePx?.y ?? 360) / 640 - .5625) / 1.51875 * a.z; return Math.atan2(y, x); };
  report.twentyObservedAxisRotationDegrees = (projected(twenty.axis) - projected(zero.axis)) * 180 / Math.PI;
  check(Math.abs(report.twentyObservedAxisRotationDegrees - 20) < 4, 'independent contour direction follows the known 20° input image rotation');
  const c = zero.centreImagePx, t = 20 * Math.PI / 180, expected = { x: 320 + (c.x - 320) * Math.cos(t) - (c.y - 365) * Math.sin(t), y: 365 + (c.x - 320) * Math.sin(t) + (c.y - 365) * Math.cos(t) };
  report.twentyCentreRotationResidualPx = Math.hypot(twenty.centreImagePx.x - expected.x, twenty.centreImagePx.y - expected.y);
  check(report.twentyCentreRotationResidualPx < 10, '20° centre follows the same observed wear region, not a separately rotated offset');
  await page.screenshot({ path: join(out, '20-debug.png'), fullPage: true });
  await page.evaluate(() => { window.axisCaptureNext = true; });
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).uncheck();
  await page.waitForFunction(() => !!window.axisCapture);
  const ab = await page.evaluate(async () => {
    const { BraceletRenderer } = await import(window.miraSourceModules["braceletRenderer"]);
    const { background, frame, options } = window.axisCapture, W = background.width, H = background.height;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d'), renderer = new BraceletRenderer(), result = { png: {}, maskPresent: !!options.imageMask }, buffers = [];
    for (const occlusion of [false, true]) {
      ctx.putImageData(background, 0, 0); ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); renderer.drawFrame(ctx, frame, { ...options, occlusion, debugProxy: false }); ctx.restore();
      result.png[occlusion ? 'B' : 'A'] = canvas.toDataURL().split(',')[1];
      const pose = { ...frame.tracking, radius: frame.sizing.wristRadius }, layer = renderer.renderLayer(pose, frame.color, frame.sizing.manualFitMultiplier, W, H, { ...options, occlusion, shadows: false, debugProxy: false });
      ctx.clearRect(0, 0, W, H); ctx.drawImage(layer, 0, 0, W, H); buffers.push(ctx.getImageData(0, 0, W, H).data);
    }
    // Đối chứng proxy không mask ở đúng pose/scale để tách nguyên nhân;
    // không thay model hoặc orientation cho phép thử này.
    ctx.putImageData(background, 0, 0); ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); renderer.drawFrame(ctx, frame, { ...options, imageMask: null, occlusion: true, debugProxy: false }); ctx.restore();
    result.png.C = canvas.toDataURL().split(',')[1];
    const pose = { ...frame.tracking, radius: frame.sizing.wristRadius }, rawLayer = renderer.renderLayer(pose, frame.color, frame.sizing.manualFitMultiplier, W, H, { ...options, imageMask: null, occlusion: true, shadows: false, debugProxy: false });
    ctx.clearRect(0, 0, W, H); ctx.drawImage(rawLayer, 0, 0, W, H); const raw = ctx.getImageData(0, 0, W, H).data;
    let fullPixels = 0, visiblePixels = 0, hiddenPixels = 0, hiddenOutsideForeground = 0, unmaskedHiddenOutsideForeground = 0;
    for (let i = 0; i < W * H; i++) {
      const a = buffers[0][i * 4 + 3], b = buffers[1][i * 4 + 3]; if (a > 30) fullPixels++; if (b > 30) visiblePixels++;
      const mask = options.imageMask;
      let outside = false;
      if (mask) { const u = ((i % W + .5) / W - mask.roi.x) / mask.roi.width, v = ((Math.floor(i / W) + .5) / H - mask.roi.y) / mask.roi.height;
        outside = u < 0 || u >= 1 || v < 0 || v >= 1 || mask.data[Math.floor(v * mask.height) * mask.width + Math.floor(u * mask.width)] < 64;
      }
      if (a > 100 && b < 10) { hiddenPixels++; if (outside) hiddenOutsideForeground++; }
      if (a > 100 && raw[i * 4 + 3] < 10 && outside) unmaskedHiddenOutsideForeground++;
    }
    renderer.clear(); return { ...result, fullPixels, visiblePixels, hiddenPixels, hiddenOutsideForeground, unmaskedHiddenOutsideForeground, radius: frame.sizing.wristRadius, manual: frame.sizing.manualFitMultiplier, quaternion: frame.tracking.orientation };
  });
  for (const view of ['A', 'B', 'C']) await writeFile(join(out, `20-${view}.png`), Buffer.from(ab.png[view], 'base64')); delete ab.png;
  check(ab.fullPixels > 100 && ab.visiblePixels > ab.fullPixels * .25 && ab.hiddenPixels > 20, 'A full closed model / B visible front and hidden rear');
  check(!ab.maskPresent || ab.hiddenOutsideForeground < ab.fullPixels * .02, 'occlusion must not erase ring beyond observed foreground'); report.occlusion = ab;
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  for (const angle of [45, 90, 180]) await stationary(angle, false);
  check(!report.errors.length, JSON.stringify(report.errors));
  await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  check(await page.evaluate(() => { cancelAnimationFrame(window.axisAnimation); return window.axisStream.getTracks().every(t => t.readyState === 'ended'); }), 'release camera resources');
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log('PASS observed 0→20 image tilt, independent forearm axis, centre, scale and A/B occlusion; higher angles validated or safely rejected');
} catch (error) { report.failure = String(error); if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); throw error; }
finally { await writeFile(join(out, 'debug-log.json'), JSON.stringify({ scope: report.scope, samples }, null, 2)); await browser.close(); }
