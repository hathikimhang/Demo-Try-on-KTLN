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
    const r = await fetch(`https://storage.googleapis.com/mediapipe-assets/${name}`);
    if (!r.ok) throw Error(`Fixture HTTP ${r.status}`); await writeFile(path, new Uint8Array(await r.arrayBuffer()));
  }
  fixtures[name] = path;
}
const check = (value, reason) => { if (!value) throw Error(reason); };
const browser = await chromium.launch({ channel: process.env.AR_BROWSER ?? 'chrome', headless: true });
const report = { scope: 'Upload with real MediaPipe Hand/Pose inference; no physical webcam', images: [], errors: [] };
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(() => {
    window.uploadRequests = []; window.uploadReplies = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); this.addEventListener('message', e => { if (e.data.type === 'result') window.uploadReplies.push({ mode: e.data.trackingMode, hands: e.data.points.length, arm: e.data.armPoints.length, segmentation: !!e.data.skin }); }); }
      postMessage(data, ...rest) { if (data.type === 'frame') window.uploadRequests.push({ needArm: data.needArm, video: data.video }); return super.postMessage(data, ...rest); }
    };
  });
  await page.goto(base); await page.waitForLoadState('networkidle');
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng', exact: true }).uncheck();
  const read = async () => {
    const text = await page.getByTestId('tracking-debug').innerText(), message = await page.getByTestId('upload-status').innerText();
    const number = pattern => { const m = text.match(pattern); return m ? Number(m[1]) : null; };
    return { message, modes: await page.getByTestId('upload-modes').innerText(),
      method: text.match(/Auto Fit: (\w+)/)?.[1], scale: number(/Final world scale: ([\d.]+)/),
      proxy: number(/Proxy world scale: ([\d.]+)/), inner: number(/Bracelet projected inner diameter \(pixels\): ([\d.]+)/),
      slices: number(/(\d+) lát cắt hợp lệ/), intrinsic: number(/Calibration radius ratio: ([\d.]+)/), ratio: number(/Fit ratio: ([\d.]+)/),
      source: text.match(/Tracking source: ([^·\n]+)/)?.[1].trim(), text };
  };
  for (const name of ['pointing_up.jpg', 'thumb_up.jpg', 'woman_hands.jpg']) {
    const before = await page.evaluate(() => window.uploadRequests.length);
    await page.locator('input[type=file]').setInputFiles(fixtures[name]);
    await page.getByTestId('upload-status').filter({ hasText: /Auto Fit thành công|Đã hiển thị vòng/ }).waitFor({ timeout: 60000 });
    const result = await read();
    check(result.modes.includes('Yêu cầu: forearm') && result.modes.includes('worker: forearm'), 'worker requested mode preserved');
    check(!result.text.includes('mode-switch'), 'valid fallback must not be rejected as mode-switch');
    check(result.scale > 0, 'upload produces a rendered bracelet');
    check(!result.message.includes('để lộ cả khuỷu tay'), 'no unnecessary elbow prompt for uploads');
    if (result.modes.includes('fallback:')) {
      check(result.modes.includes('đang dùng: straight-wrist') && result.source === 'Hand Landmarker', 'effective fallback/source shown truthfully');
    }
    if (name === 'pointing_up.jpg') check(result.method === 'measured', 'good observed edges still Auto Fit');
    if (name === 'woman_hands.jpg') check(result.method === 'measured' && result.ratio > 1 && result.ratio < 1.3 && result.intrinsic > 0 && result.slices >= 5, 'semantic segmentation and native edges validate formerly rejected wrist');
    if (result.method === 'provisional') {
      check(result.ratio === null && result.intrinsic === null, 'provisional is not a successful measurement');
      await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).fill('150');
      const adjusted = await read();
      check(Math.abs(adjusted.scale / result.scale - 1.5) < .001 && adjusted.proxy === result.proxy, 'manual trim works once, independent of proxy');
      await page.getByRole('spinbutton', { name: 'Manual Fit (%)', exact: true }).fill('100');
    }
    // Repeated rendering must not resubmit forever because effective mode differs.
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.uploadRequests.length);
    check(after - before === 1, 'one inference request per ordinary upload; no fallback retry loop');
    report.images.push({ fixture: name, ...result, requests: after - before });
    await page.screenshot({ path: join(out, `upload-${name}.png`), fullPage: true });
  }
  // Verify the actual canvas differs from the raw image with debug/landmarks off.
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Hiện điểm nhận diện', exact: true }).uncheck();
  const pixels = await page.locator('canvas.output-canvas').evaluate(async (canvas, base64) => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${base64}`; await image.decode();
    const raw = document.createElement('canvas'); raw.width = canvas.width; raw.height = canvas.height;
    const context = raw.getContext('2d'); context.drawImage(image, 0, 0, raw.width, raw.height);
    const a = canvas.getContext('2d').getImageData(0, 0, raw.width, raw.height).data, b = context.getImageData(0, 0, raw.width, raw.height).data;
    let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(a[i + c] - b[i + c]))) > 24) changed++;
    return changed;
  }, (await readFile(fixtures['woman_hands.jpg'])).toString('base64'));
  check(pixels > 40, 'measured bracelet really rendered onto canvas, not just a status label'); report.compositeChangedPixels = pixels;
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Chụp & lưu ảnh', exact: true }).click(); await (await download).saveAs(join(out, 'upload-auto-fit.png'));
  await page.getByRole('checkbox', { name: 'Debug Mode', exact: true }).check();
  // Change requested mode while retaining the image; wait for the correct worker reply.
  await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng', exact: true }).check();
  await page.getByTestId('upload-modes').filter({ hasText: 'worker: straight-wrist' }).waitFor({ timeout: 30000 });
  await page.getByTestId('upload-status').filter({ hasText: 'Auto Fit thành công' }).waitFor();
  await page.getByRole('checkbox', { name: 'Cận cảnh · cổ tay thẳng', exact: true }).uncheck();
  await page.getByTestId('upload-modes').filter({ hasText: 'worker: forearm' }).waitFor({ timeout: 30000 });
  await page.getByTestId('upload-status').filter({ hasText: 'Auto Fit thành công' }).waitFor();
  await page.getByRole('checkbox', { name: 'Dynamic Auto Fit', exact: true }).uncheck();
  await page.getByTestId('upload-status').filter({ hasText: 'Manual Calibration' }).waitFor();
  check((await read()).method === 'manual', 'manual fallback remains explicit');
  // A real blank image goes through the actual model, not fabricated landmarks.
  const blank = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 500; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); return c.toDataURL('image/png').split(',')[1]; });
  await page.locator('input[type=file]').setInputFiles({ name: 'no-hand.png', mimeType: 'image/png', buffer: Buffer.from(blank, 'base64') });
  await page.getByTestId('upload-status').filter({ hasText: 'Không phát hiện bàn tay' }).waitFor({ timeout: 60000 });
  check(await page.getByTestId('sizing-status').count() === 0, 'no hand must not create a provisional bracelet');
  report.noHandMessage = await page.getByTestId('upload-status').innerText();
  check(!report.errors.length, JSON.stringify(report.errors));
  await writeFile(join(out, 'upload-fit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ images: report.images.map(({ fixture, modes, method, message, requests }) => ({ fixture, modes, method, message, requests })), compositeChangedPixels: pixels, noHandMessage: report.noHandMessage, errors: report.errors }, null, 2));
  console.log('PASS segmentation auto fit, native edges, upload fallback, mode synchronization, PNG and no-hand rejection');
} catch (error) {
  if (page) { await page.screenshot({ path: join(out, 'upload-failure.png'), fullPage: true }); report.failure = { error: String(error), debug: await page.getByTestId('tracking-debug').innerText().catch(() => ''), upload: await page.getByTestId('upload-status').innerText().catch(() => '') }; await writeFile(join(out, 'upload-failure.json'), JSON.stringify(report, null, 2)); }
  throw error;
} finally { await browser.close(); }
