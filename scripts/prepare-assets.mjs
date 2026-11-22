import { mkdir, cp, access, writeFile, rename, readdir, readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/models/', root), { recursive: true });
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root), new URL('public/wasm/', root), { recursive: true });
// MediaPipe's loader expects a global factory. Export it to globalThis when
// loaded as an ES module inside Vite's module worker (no eval required).
for (const file of await readdir(new URL('public/wasm/', root))) {
  if (!file.endsWith('.js')) continue;
  const path = new URL(`public/wasm/${file}`, root);
  await writeFile(path, `${await readFile(path, 'utf8')}\n;globalThis.ModuleFactory = ModuleFactory;\nexport { ModuleFactory };\n`);
}
for (const [file, model] of [['hand.task', 'hand_landmarker/hand_landmarker'], ['pose.task', 'pose_landmarker/pose_landmarker_lite']]) {
  const dest = new URL(`public/models/${file}`, root);
  try { await access(dest); continue; } catch { /* First installation */ }
  console.log(`Đang tải mô hình ${file}…`);
  try {
    const res = await fetch(`https://storage.googleapis.com/mediapipe-models/${model}/float16/1/${model.split('/')[1]}.task`, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    await writeFile(new URL(`${dest.href}.tmp`), data);
    await rename(new URL(`${dest.href}.tmp`), dest);
  } catch (error) {
    console.error('Không tải được mô hình. Kiểm tra mạng và chạy npm run assets.', error);
    process.exitCode = 1;
  }
}
// Pinned official model; used only by still-image bracelet analysis.
const skin = new URL('public/models/skin.tflite', root);
try { await access(skin); } catch {
  try {
    const res = await fetch('https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite', { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(new URL(`${skin.href}.tmp`), new Uint8Array(await res.arrayBuffer()));
    await rename(new URL(`${skin.href}.tmp`), skin);
  } catch (error) { console.error('Không tải được model phân vùng ảnh. Chạy lại npm run assets.', error); process.exitCode = 1; }
}
