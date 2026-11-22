import type { WorkerReply } from '../workers/vision.protocol';
import { trackClothingPoints, clothingDetected } from '../../features/clothing/controllers/clothingController';
import { liveSkinInterval } from '../../features/bracelet/services/live/liveTaskBudget';
import type { ApplicationBindings } from '../controllers/controllerBindings';
export function initializeVisionWorker(bindings: ApplicationBindings, generation: number) {
  const { state, debugLog, setDebugCount, stop, setError, mode, updateWrist, setDetected, setLatency, setBusy, paint, appearance, publishLive, submitLatestCamera, submit } = bindings;
  return new Promise<Worker>((resolve, reject) => {
    const s = state.current; debugLog.current.reset(); setDebugCount(0);
    const worker = new Worker(new URL('../workers/vision.worker.ts', import.meta.url), { type: 'module' });
    s.worker = worker;
    s.timeout = window.setTimeout(() => reject(new Error('Khởi tạo AI quá lâu. Kiểm tra tệp mô hình và thử lại.')), 60000);
    worker.onerror = () => { clearTimeout(s.timeout); reject(new Error('Không khởi chạy được AI. Hãy thử Chrome/Edge mới nhất.')); if (generation === s.generation) { stop(); setError('AI gặp lỗi. Vui lòng thử lại.'); } };
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (generation !== s.generation) { if (data.type === 'result') data.frame?.close(); return; }
      if (data.type === 'ready') { clearTimeout(s.timeout); resolve(worker); }
      if (data.type === 'error') {
        console.error('MediaPipe:', data.message);
        clearTimeout(s.timeout); reject(new Error(data.message));
        stop(); setError('Không xử lý được AI. Chạy “npm run assets” để kiểm tra mô hình, rồi thử lại.');
      }
      if (data.type === 'result') {
        if (s.source === 'camera' && (!Number.isFinite(data.timestamp) || data.timestamp <= s.lastResultTimestamp)) { data.frame?.close(); return; }
        if (s.source === 'camera') s.lastResultTimestamp = data.timestamp;
        const liveCamera = s.source === 'camera' && mode === 'bracelet', updateAt = performance.now();
        if (liveCamera) { s.performance.observationThread = data.liveObservation ? 'worker' : 'main-fallback'; s.performance.result(updateAt, data.elapsed); for (const [key, value] of Object.entries(data.timings ?? {})) s.performance.add(key, updateAt, value); }
        s.pending = false;
        s.frame?.close(); s.frame = data.frame ?? null;
        s.receivedAt = performance.now(); s.capturedAt = data.timestamp; s.frameSensorCaptureTime = s.requestSensorCaptureTime; s.workerLatency = Math.round(data.elapsed);
        if (liveCamera && (data.timings?.skinMs ?? 0) > 5) s.skinCostMs = data.timings!.skinMs;
        s.points = mode === 'shirt' && s.source === 'camera' ? trackClothingPoints(s.points, data.points) : data.points;
        const { frame: _frame, ...detection } = data;
        s.lastDetection = detection; updateWrist(detection);
        const pixels = data.points.map(p => ({ ...p, x: p.x * 1000, y: p.y * 1000 }));
        // Visibility của Pose phải đủ tin cậy để đặt áo thực tế.
        if (mode === 'shirt') setDetected(clothingDetected(pixels));
        if (liveCamera) { s.performance.add('mainUpdateMs', performance.now(), performance.now() - updateAt); publishLive(); submitLatestCamera(generation); }
        else { setLatency(Math.round(data.elapsed)); setBusy(false); paint(); }
        if (mode === 'bracelet' && data.trackingMode !== appearance.current.trackingMode && s.image) void submit(s.image, false, generation);
      }
    };
    worker.postMessage({ type: 'init', mode, base: new URL(import.meta.env.BASE_URL, location.href).href });
  });
}
export async function submitVisionFrame(bindings: ApplicationBindings, image: HTMLVideoElement | HTMLImageElement, isVideo: boolean, generation: number) {  
const { state, mode, appearance, stop, setError } = bindings;

  const s = state.current;
  if (s.pending || generation !== s.generation) return;
  const liveCamera = isVideo && mode === 'bracelet';
  if (liveCamera && image instanceof HTMLVideoElement) {
    const frames = image.getVideoPlaybackQuality?.().totalVideoFrames;
    if (frames && frames > 0) { if (frames === s.lastCapturedVideoFrame) return; s.lastCapturedVideoFrame = frames; }
  }
  s.pending = true;
  if (liveCamera) { s.performance.request(performance.now()); s.requestSensorCaptureTime = s.sensorCaptureTime; }
  try {
    const width = image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth;
    const height = image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight;
    const factor = Math.min(1, 960 / Math.max(width, height));
    const timestamp = performance.now();
    const bitmap = await createImageBitmap(image, { resizeWidth: Math.round(width * factor), resizeHeight: Math.round(height * factor) });
    if (liveCamera) s.performance.add('bitmapMs', performance.now(), performance.now() - timestamp);
    if (generation !== s.generation || !s.worker) { bitmap.close(); return; }
    const edge = s.sizing?.measurement;
    const reliableEdges = !!edge?.width && edge.confidence >= .8 && (edge.sampleCount ?? 0) >= 5;
    const measureSkin = liveCamera && timestamp - s.lastSkinRequest >= liveSkinInterval(s.skinCostMs, reliableEdges);
    if (measureSkin) s.lastSkinRequest = timestamp;
    s.worker.postMessage({ type: 'frame', bitmap, video: isVideo, timestamp, needArm: appearance.current.trackingMode === 'forearm', measureSkin, deferArm: isVideo && mode === 'bracelet' && !s.lastDetection?.points.length, observeArm: isVideo && mode === 'bracelet' && s.needsArmObservation }, [bitmap]);
  } catch { if (generation === s.generation) { stop(); setError('Không đọc được hình ảnh. Hãy thử ảnh JPG/PNG khác hoặc bật lại camera.'); } }

}
