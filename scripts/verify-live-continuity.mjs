import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.env.AR_URL ?? 'http://127.0.0.1:5173', out = resolve('artifacts/live-continuity'); await mkdir(out, { recursive: true });
const path = join(tmpdir(), 'mira-dynamic-pointing_up.jpg');
try { await readFile(path); } catch { const r = await fetch('https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg'); if (!r.ok) throw Error(`Fixture HTTP${r.status}`); await writeFile(path, new Uint8Array(await r.arrayBuffer())); }
const report = { scope: 'Actual MediaPipe Hand VIDEO on photo captureStream. Optional Pose model intentionally unavailable. Blank input frames are processed by the real detector. NOT hardware webcam or physical palm/back rotation.', checks: [], errors: [] }, samples = [];
const check = (v, why) => { if (!v) throw Error(why); };
const until = async (fn, why, ms = 60000) => { const start = Date.now(); while (!await fn()) { if (Date.now() - start > ms) throw Error(`Timeout: ${why}`); await new Promise(r => setTimeout(r, 75)); } };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true }); let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light' });
  let blockedPose = 0;
  await context.route('**/models/pose.task', route => { blockedPose++; return route.abort(); });
  page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.text().startsWith('[mira-live] ')) samples.push(JSON.parse(m.text().slice(12))); });
  await page.addInitScript(() => {
    window.continuityRows = []; window.controllerIds = new Set(); window.engineCount = 0; window.workerCount = 0; window.blankInputs = 0; window.blankResults = 0; window.blankRemaining = 0; window.holdPixelChecks = [];
    const debug = console.debug.bind(console); console.debug = (...args) => { if (args[0] === '[mira-live]') window.continuityRows.push(JSON.parse(args[1])); debug(...args); };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args); window.workerCount++; window.activeVisionWorker = this;
        this.addEventListener('message', e => {
          if (e.data.type !== 'result') return;
          const { frame, ...bare } = e.data; window.lastBareDetection = bare;
          if (!e.data.points.length) window.blankResults++;
          // A microtask may run BETWEEN event listeners, before the app's
          // onmessage handler paints. Sample on the next task instead.
          setTimeout(() => {
            const row = window.continuityRows.at(-1), c = document.querySelector('canvas.output-canvas');
            if (row?.live?.presentation === 'hold' && c) {
              const pixel = [...c.getContext('2d').getImageData(c.width - 2, 2, 1, 1).data];
              window.holdPixelChecks.push({ pixel, inputTimestamp: row.timestampMs, renderTimestamp: row.live.renderFrameTimestamp, heldMs: row.live.frameHeldMs, visible: row.live.hasRenderPose });
            }
          }, 0);
        });
      }
      postMessage(data, ...args) {
        if (data.type === 'frame' && window.blankRemaining > 0) {
          window.blankRemaining--; window.blankInputs++;
          const c = window.blankCanvas ?? (window.blankCanvas = document.createElement('canvas'));
          c.width = data.bitmap.width; c.height = data.bitmap.height; const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
          data.bitmap.close(); createImageBitmap(c).then(bitmap => super.postMessage({ ...data, bitmap }, [bitmap])); return;
        }
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng', exact: true }).uncheck();
  await page.evaluate(async bytes => {
    const loadedModule = name => performance.getEntriesByType('resource').find(e => e.name.includes(`/src/${name}.ts`))?.name ?? `/src/${name}.ts`;
    // Patch the exact module URL already used by the app, including Vite's
    // HMR timestamp. Importing a bare second URL measures another class.
    const { BraceletRenderer } = await import(loadedModule('braceletRenderer')), create = BraceletRenderer.prototype.createEngine;
    BraceletRenderer.prototype.createEngine = function(...args) { window.engineCount++; return create.apply(this, args); };
    const { LiveWristSession } = await import(loadedModule('liveWristTracking')), update = LiveWristSession.prototype.update;
    LiveWristSession.prototype.update = function(...args) { window.controllerIds.add(this); return update.apply(this, args); };
    const image = new Image(); image.src = `data:image/jpeg;base64,${bytes}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 720; const ctx = canvas.getContext('2d');
    window.continuousMotion = false; window.motionStart = 0;
    const draw = () => {
      const angle = window.continuousMotion ? .349066 * Math.sin((performance.now() - window.motionStart) / 1300) : 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720); ctx.fillStyle = 'rgb(42,81,123)'; ctx.fillRect(0, 0, 12, 12);
      ctx.translate(320, 475); ctx.rotate(angle); ctx.scale(1.3, 1.3); ctx.drawImage(image, -176, -286); window.continuityAnimation = requestAnimationFrame(draw);
    }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.continuityStream = canvas.captureStream(24); return window.continuityStream; } });
  }, (await readFile(path)).toString('base64'));
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await until(() => samples.some(s => s.live.hasRenderPose), 'Hand-first visible fit without Pose');
  report.first = samples.find(s => s.live.hasRenderPose); check(report.first.fitStatus === 'provisional', 'initial fit must disclose estimation');
  await until(() => samples.some(s => s.live.state === 'TRACKING'), 'measured tracking with optional Pose unavailable');
  await until(() => blockedPose > 0 && samples.some(s => s.live.optionalPoseStatus === 'unavailable'), 'optional Pose failure was actually observed');
  check(!await page.locator('.error-message').count(), 'optional Pose cannot stop the camera'); report.checks.push('Hand-first startup even in forearm mode with Pose model blocked');
  const stableStart = samples.length, stableAt = Date.now();
  await until(() => Date.now() - stableAt >= 10000, 'ten seconds stationary', 12000);
  const stable = samples.slice(stableStart); check(stable.length >= 20, 'enough real inference observations during stationary interval');
  check(stable.every(s => s.live.hasRenderPose), 'stationary input must not blink'); report.stationary = { durationMs: Date.now() - stableAt, frames: stable.length, hiddenFrames: stable.filter(s => !s.live.hasRenderPose).length }; console.log('PASS stationary 10 seconds');
  await page.screenshot({ path: join(out, 'stationary.png'), fullPage: true });
  report.referencePixel = await page.evaluate(() => { const c = document.querySelector('canvas.output-canvas'); return [...c.getContext('2d').getImageData(c.width - 2, 2, 1, 1).data]; });
  check(report.referencePixel.slice(0, 3).some(v => v > 20), 'reference background differs from injected black input');
  const missStart = samples.length;
  await page.evaluate(() => { window.blankRemaining = 1; });
  await until(() => samples.slice(missStart).some(s => s.live.presentation === 'hold' && s.live.hasRenderPose), 'isolated blank frame grace');
  await until(() => samples.slice(missStart).some(s => s.live.presentation === 'current' && s.live.hasRenderPose), 'immediate current-frame recovery');
  const held = await page.evaluate(() => window.holdPixelChecks);
  report.hold = held;
  check(held.some(p => p.visible && p.renderTimestamp < p.inputTimestamp && p.heldMs <= 300 && p.pixel.every((v, i) => Math.abs(v - report.referencePixel[i]) <= 1)), `hold old image + matching old pose, never old ring over new black input: ${JSON.stringify(held)}, reference ${report.referencePixel}`);
  report.checks.push('isolated blank input holds matching raw image and pose for bounded grace');
  const n = samples.length;
  await page.evaluate(() => { const old = { ...window.lastBareDetection, timestamp: window.lastBareDetection.timestamp - 10000 }; window.activeVisionWorker.dispatchEvent(new MessageEvent('message', { data: old })); });
  await until(() => samples.length >= n + 4, 'continued inference after an old replayed message');
  check(samples.slice(n).every(s => s.timestampMs > samples[n - 1].timestampMs), 'old result cannot overwrite current pose'); report.checks.push('out-of-order result ignored');
  await page.locator('.theme-button').click();
  await until(() => samples.length >= n + 7, 'React theme rerender keeps camera alive');
  report.afterTheme = await page.evaluate(() => ({ engines: window.engineCount, controllers: window.controllerIds.size, workers: window.workerCount, liveTracks: window.continuityStream.getTracks().every(t => t.readyState === 'live') }));
  check(report.afterTheme.engines === 1 && report.afterTheme.controllers === 1 && report.afterTheme.workers === 1 && report.afterTheme.liveTracks, `one mesh engine/controller/worker across React renders: ${JSON.stringify(report.afterTheme)}`); report.checks.push('theme rerender preserves engine, controller and camera');
  const motionStart = samples.length, motionAt = Date.now();
  await page.evaluate(() => { window.continuousMotion = true; window.motionStart = performance.now(); });
  await until(() => Date.now() - motionAt >= 20000, 'twenty seconds continuous observed image motion', 23000);
  const motion = samples.slice(motionStart), hidden = motion.filter(s => !s.live.hasRenderPose);
  check(motion.length >= 40, 'enough actual frames in continuous motion');
  check(hidden.length === 0, 'supported continuous input cannot repeatedly hide the ring');
  const ks = motion.map(s => s.calibrationRadiusRatio).filter(k => k > 0); check(Math.max(...ks) / Math.min(...ks) < 1.1, 'motion does not refit physical size at every angle');
  report.motion = { durationMs: Date.now() - motionAt, frames: motion.length, hiddenFrames: hidden.length, heldFrames: motion.filter(s => s.live.presentation === 'hold').length, calibrationRange: [Math.min(...ks), Math.max(...ks)] }; console.log('PASS continuous image motion 20 seconds');
  await page.evaluate(() => { window.continuousMotion = false; });
  const lossStart = samples.length;
  await page.evaluate(() => { window.blankRemaining = 140; });
  await until(() => samples.slice(lossStart).some(s => s.live.state === 'LOST' && !s.live.hasRenderPose), 'true loss expires grace and hides');
  const lostAt = samples.slice(lossStart).find(s => s.live.state === 'LOST').timestampMs;
  await until(() => samples.at(-1)?.timestampMs > lostAt && samples.at(-1)?.live.state === 'TRACKING', 'camera reacquires after long loss');
  const losses = samples.slice(lossStart).filter(s => s.live.orientationReason === 'no-hand');
  check(losses.at(-1).timestampMs - losses[0].timestampMs > 1500, 'actual missing-Hand interval exceeds calibration TTL');
  check(samples.slice(lossStart).some(s => s.live.state === 'ACQUIRING' && s.fitStatus === 'provisional' && s.calibrationRadiusRatio === null), 'new appearance starts fresh fit after TTL'); report.checks.push('prolonged loss hides, then fresh measured acquisition');
  report.lifecycle = await page.evaluate(() => ({ engines: window.engineCount, workers: window.workerCount, controllers: window.controllerIds.size, blankInputs: window.blankInputs, actualBlankDetections: window.blankResults }));
  check(report.lifecycle.actualBlankDetections > 0, 'real detector processed blank inputs');
  await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  check(await page.evaluate(() => { cancelAnimationFrame(window.continuityAnimation); return window.continuityStream.getTracks().every(t => t.readyState === 'ended'); }), 'stop releases all camera tracks');
  check(!report.errors.length, JSON.stringify(report.errors)); await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log('PASS optional Pose failure, actual blank-frame grace, timestamps, lifecycle, 10s stationary and 20s motion');
} catch (error) { report.failure = String(error); if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); throw error; }
finally { await writeFile(join(out, 'debug-log.json'), JSON.stringify({ scope: report.scope, samples }, null, 2)); await browser.close(); }
