import { analyzeWristForSource } from '../services/geometry/wristGeometry';
import { isFrameUsable } from '../services/tracking/trackingPolicy';
import type { PixelFrame } from '../models/tracking.types';
import type { BraceletBindings } from './braceletRuntime';
import type { BraceletDetection as Detection } from '../models/vision.types';
import { updateLiveBracelet } from './liveBraceletController';
import { updateUploadBracelet } from './uploadBraceletController';
export function updateBracelet(bindings: BraceletBindings, data: Detection) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;

  const s = state.current;

  const aspect = s.frame ? s.frame.height / s.frame.width : s.image ? s.image.naturalHeight / s.image.naturalWidth : 1;

  const modeOption = appearance.current.trackingMode;

  const analysis = analyzeWristForSource(data.points, data.worldPoints, aspect, data.handedness, { input: s.source === 'image' ? 'image' : 'camera', mode: modeOption, armPoints: data.armPoints, armWorldPoints: data.armWorldPoints });

  const stale = s.source === 'camera' && !isFrameUsable(data.timestamp, s.receivedAt, performance.now());

  // Chế độ Worker là chế độ của REQUEST; fallback cục bộ khi Upload
  // có thể tạo chế độ hiệu lực khác mà không phải request bị cũ.
  const mismatch = data.trackingMode !== analysis.requestedMode;

  const image = s.source === 'camera' ? s.frame : s.image;

  let pixels: PixelFrame | null = data.liveObservation?.pixels ?? null;

  if (image && s.source === 'camera' && !data.liveObservation) {
    const iw = image instanceof ImageBitmap ? image.width : image.naturalWidth;
    const ih = image instanceof ImageBitmap ? image.height : image.naturalHeight;
    const factor = Math.min(1, 640 / Math.max(iw, ih));
    const sample = s.measurementCanvas ?? (s.measurementCanvas = document.createElement('canvas'));
    const sw = Math.round(iw * factor), sh = Math.round(ih * factor);
    if (sample.width !== sw || sample.height !== sh) { sample.width = sw; sample.height = sh; }
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context) try { context.drawImage(image, 0, 0, sw, sh); pixels = context.getImageData(0, 0, sw, sh); } catch { /* Đọc ảnh thất bại; không thay bằng pixel tự tạo. */ }
  }
  const prepared = { aspect, modeOption, analysis, stale, mismatch, pixels };
  if (s.source === 'camera') return updateLiveBracelet(bindings, data, prepared);
  return updateUploadBracelet(bindings, data, prepared);
}
