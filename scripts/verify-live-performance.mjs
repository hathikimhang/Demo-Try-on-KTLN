import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.env.AR_URL ?? 'http://127.0.0.1:5173';
const tag = process.env.PERF_TAG ?? 'after';
const out = resolve('artifacts/live-performance', tag); await mkdir(out, { recursive: true });
const fixture = join(tmpdir(), 'mira-dynamic-pointing_up.jpg');
try { await readFile(fixture); } catch { const r = await fetch('https://storage.googleapis.com/mediapipe-assets/pointing_up.jpg'); if (!r.ok) throw Error(`Fixture HTTP ${r.status}`); await writeFile(fixture, new Uint8Array(await r.arrayBuffer())); }
const report = { scope: 'Headless Chrome, actual MediaPipe VIDEO on photo captureStream 30fps. NOT hardware webcam, not physical 3D wrist rotation. Same image resolution/material/lighting before and after.', tag, phases: [], errors: [] };
const check = (ok, why) => { if (!ok) throw Error(why); };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true }); let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light' });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(() => {
    window.perfEvents = []; window.perfPose = []; window.perfMetrics = []; window.perfPending = 0; window.perfCommits = 0;
    const record = (type, extra = {}) => window.perfEvents.push({ type, at: performance.now(), ...extra });
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; }, onCommitFiberRoot: () => window.perfCommits++, onCommitFiberUnmount() {}, checkDCE() {} };
    const debug = console.debug.bind(console); console.debug = (...args) => { if (args[0] === '[mira-live]') window.perfPose.push(JSON.parse(args[1])); if (args[0] === '[mira-perf]') window.perfMetrics.push({at:performance.now(),...JSON.parse(args[1])}); debug(...args); };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      set onmessage(fn) { super.onmessage = event => {
        const start = performance.now(); if (event.data.type === 'result') { window.perfPending--; record('result', { capture: event.data.timestamp, duration: event.data.elapsed, timing: event.data.timings, landmarks: event.data.points.length }); }
        fn.call(this, event); if (event.data.type === 'result') record('handler', { duration: performance.now() - start });
      }; }
      postMessage(data, ...rest) { if (data.type === 'frame') { window.perfPending++; record('request', { pending: window.perfPending, capture: data.timestamp, cameraFrame: window.perfCameraFrame ?? -1 }); } return super.postMessage(data, ...rest); }
    };
    const bitmap = window.createImageBitmap; window.createImageBitmap = async (...args) => { const at = performance.now(); const b = await bitmap(...args); if (args[0] instanceof HTMLVideoElement) record('bitmap', { duration: performance.now() - at }); return b; };
    const draw = CanvasRenderingContext2D.prototype.drawImage, ids = new WeakMap(); let nextId = 0;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
      if (this.canvas.classList.contains('output-canvas')) {
        if (args[0] instanceof ImageBitmap || args[0] instanceof HTMLVideoElement || (args[0] instanceof HTMLCanvasElement && !args[0].getContext('webgl2'))) {
          const image = args[0]; if (!ids.has(image)) ids.set(image, ++nextId); record('background', { image: ids.get(image) });
        }
      }
      return draw.apply(this, args);
    };
    new PerformanceObserver(list => { for (const e of list.getEntries()) record('longtask', { duration: e.duration }); }).observe({ type: 'longtask', buffered: false });
    const raf = () => { record('raf'); window.perfAnimation = requestAnimationFrame(raf); }; requestAnimationFrame(raf);
  });
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.evaluate(async bytes => {
    const moduleUrl = name => performance.getEntriesByType('resource').find(e => e.name.includes(`/src/${name}.ts`))?.name ?? `/src/${name}.ts`;
    const record = (type, extra = {}) => window.perfEvents.push({ type, at: performance.now(), ...extra });
    const { BraceletRenderer } = await import(moduleUrl('braceletRenderer')), render = BraceletRenderer.prototype.renderLayer;
    BraceletRenderer.prototype.renderLayer = function(...args) { const start = performance.now(), cache = this.cache, result = render.apply(this, args); if (this.cache !== cache) record('webgl', { duration: performance.now() - start }); return result; };
    for (const [module, cls, method, label] of [['liveWristTracking', 'LiveWristSession', 'update', 'session'], ['wristRoiTracking', 'WristRoiTracker', 'seed', 'seed']]) {
      const c = (await import(moduleUrl(module)))[cls], original = c.prototype[method]; c.prototype[method] = function(...args) { const start = performance.now(), result = original.apply(this, args); record(label, { duration: performance.now() - start }); return result; };
    }
    const image = new Image(); image.src = `data:image/jpeg;base64,${bytes}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 720; const ctx = canvas.getContext('2d');
    window.perfMotion = 'stationary'; window.perfMotionAt = performance.now();
    const draw = () => {
      const t = (performance.now() - window.perfMotionAt) / 1000, mode = window.perfMotion;
      const angle = mode === 'motion' ? .349066 * Math.sin(t * 2) : mode === 'fast-stop' && t < 1 ? .3 * Math.sin(t * 10) : 0;
      const scale = mode === 'distance' ? 1 + .15 * Math.sin(t * 2) : 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#abb0ac'; ctx.fillRect(0, 0, 640, 720);
      if (mode !== 'absent') { ctx.translate(320, 475); ctx.rotate(angle); ctx.scale(1.3 * scale, 1.3 * scale); ctx.drawImage(image, -176, -286); }
      window.perfSourceAnimation = requestAnimationFrame(draw);
    }; draw();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.perfStream = canvas.captureStream(30); return window.perfStream; } });
    const video = document.querySelector('video');
    const onVideo = (now, metadata) => { window.perfCameraFrame = metadata.presentedFrames; record('camera', { frames: metadata.presentedFrames, mediaTime: metadata.mediaTime }); window.perfVideoCallback = video.requestVideoFrameCallback(onVideo); };
    window.perfVideoCallback = video.requestVideoFrameCallback(onVideo);
  }, (await readFile(fixture)).toString('base64'));
  await page.getByRole('button', { name: 'Bật camera', exact: true }).click();
  await page.waitForFunction(() => window.perfPose.some(s => s.live.state === 'TRACKING'), null, { timeout: 60000 });
  const cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable');
  const phase = async (name, ms, debug, profile = false) => {
    await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).setChecked(debug);
    const start = await page.evaluate(name => { window.perfMotion = name; window.perfMotionAt = performance.now(); return { time: performance.now(), commits: window.perfCommits }; }, name);
    if (profile) await cdp.send('Profiler.start');
    await page.waitForTimeout(ms);
    if (profile) {
      const { profile: cpu } = await cdp.send('Profiler.stop'); await writeFile(join(out, 'main-thread.cpuprofile'), JSON.stringify(cpu));
      const hits = new Map(); for (const n of cpu.nodes) { const f = n.callFrame; if (n.hitCount && f.url.includes('/src/')) { const key = `${f.functionName} (${f.url.split('/src/')[1]}:${f.lineNumber + 1})`; hits.set(key, (hits.get(key) ?? 0) + n.hitCount); } }
      report.mainThreadTopSamples = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 18);
    }
    const data = await page.evaluate(start => ({ elapsed: performance.now() - start.time, commits: window.perfCommits - start.commits, events: window.perfEvents.filter(e => e.at >= start.time), poses: window.perfPose.filter(s => s.live.receivedAt >= start.time), telemetry:window.perfMetrics.filter(s=>s.at>=start.time) }), start);
    const events = type => data.events.filter(e => e.type === type), n = type => events(type).length, fps = type => n(type) * 1000 / data.elapsed;
    const summary = values => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return { count: v.length, mean: v.reduce((a, b) => a + b, 0) / (v.length || 1), p50: v[Math.floor(v.length * .5)] ?? null, p95: v[Math.floor(v.length * .95)] ?? null, max: v.at(-1) ?? null }; };
    const results = events('result'), requests = events('request'), camera = events('camera');
    const gaps = results.slice(1).map((e, i) => e.at - results[i].at), rows = data.poses;
    const qangle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)));
    const valid = rows.filter(s => s.live.renderedQuaternion && s.live.renderedCenterImagePx);
    const deltas = valid.slice(1).map((s, i) => ({ angle: qangle(valid[i].live.renderedQuaternion, s.live.renderedQuaternion), center: Math.hypot(s.live.renderedCenterImagePx.x-valid[i].live.renderedCenterImagePx.x,s.live.renderedCenterImagePx.y-valid[i].live.renderedCenterImagePx.y), scale: Math.abs(Math.log(s.finalBraceletWorldScale/valid[i].finalBraceletWorldScale)) }));
    const item = { name, debug, elapsedMs: data.elapsed, cameraFPS: fps('camera'), rafFPS: fps('raf'), inferenceFPS: fps('result'), actualWebGLFPS: fps('webgl'), compositeFPS: fps('background'), uniqueBackgroundImages: new Set(events('background').map(e=>e.image)).size, reactCommitsPerSecond: data.commits * 1000 / data.elapsed, maxPendingRequests: Math.max(0,...requests.map(e=>e.pending)), duplicateCameraFrameRequests: requests.filter((e,i)=>i&&e.cameraFrame===requests[i-1].cameraFrame).length, cameraFramesSkipped: Math.max(0,(camera.at(-1)?.frames??0)-(camera[0]?.frames??0)+1-requests.length), inferenceMs: summary(results.map(e=>e.duration)), captureToResultMs: summary(results.map(e=>e.at-e.capture)), mainHandlerMs: summary(events('handler').map(e=>e.duration)), bitmapMs: summary(events('bitmap').map(e=>e.duration)), sessionMs: summary(events('session').map(e=>e.duration)), seedMs: summary(events('seed').map(e=>e.duration)), webglSubmitMs: summary(events('webgl').map(e=>e.duration)), resultGapMs: summary(gaps), rafGapMs: summary(events('raf').slice(1).map((e,i)=>e.at-events('raf')[i].at)), longTasks: n('longtask'), longTaskTotalMs: events('longtask').reduce((a,e)=>a+e.duration,0), poseAngularDeltaRadians: summary(deltas.map(e=>e.angle)), poseCenterDeltaPx: summary(deltas.map(e=>e.center)), poseLogScaleDelta: summary(deltas.map(e=>e.scale)), trackingTransitions: rows.filter((r,i)=>i&&r.live.state!==rows[i-1].live.state).length, hiddenPoseResults: rows.filter(s=>!s.live.hasRenderPose).length };
    item.startedAt = start.time; item.captureToPoseReadyMs = summary(rows.map(s=>s.live.totalAgeMs)); item.telemetry = data.telemetry;
    item.cameraCallbackFPS = item.cameraFPS;
    item.cameraFPS = camera.length ? (camera.at(-1).frames-camera[0].frames+1)*1000/data.elapsed : 0;
    if(name==='fast-stop') {const tail=valid.filter(s=>s.live.receivedAt>=start.time+2000).map(s=>s.live.renderedCenterImagePx); item.settledCenterRangePx=tail.length?Math.hypot(Math.max(...tail.map(p=>p.x))-Math.min(...tail.map(p=>p.x)),Math.max(...tail.map(p=>p.y))-Math.min(...tail.map(p=>p.y))):null;}
    report.phases.push(item); console.log(JSON.stringify({...item,telemetryCount:item.telemetry.length,telemetry:undefined})); return item;
  };
  await phase('stationary', process.env.PERF_QUICK ? 5000 : 10000, false, true);
  if (!process.env.PERF_QUICK) {
    await phase('motion', 20000, true);
    await phase('fast-stop', 4000, true);
    await phase('distance', 6000, true);
    await phase('absent', 2200, true);
  }
  await page.evaluate(() => { window.perfMotion = 'stationary'; window.perfMotionAt = performance.now(); });
  await page.waitForFunction(() => window.perfPose.at(-1)?.live.state === 'TRACKING', null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Tắt camera', exact: true }).click();
  report.tracksReleased = await page.evaluate(() => { cancelAnimationFrame(window.perfAnimation); cancelAnimationFrame(window.perfSourceAnimation); document.querySelector('video').cancelVideoFrameCallback(window.perfVideoCallback); return window.perfStream.getTracks().every(t=>t.readyState==='ended'); });
  check(report.tracksReleased && !report.errors.length, 'no page error and stopped camera releases tracks');
  check(report.phases.every(p=>p.maxPendingRequests<=1), 'inference queue bounded to one');
  report.events = await page.evaluate(() => window.perfEvents); report.poses = await page.evaluate(() => window.perfPose);
} catch (e) { report.failure = String(e); throw e; }
finally { await writeFile(join(out, 'report.json'), JSON.stringify(report,null,2)); await browser.close(); }
