import { drawWristEngineDebug, matchesPocFrame } from '../../features/bracelet/views/debug/wristEngineDebug';
import { beginCanvasFrame } from '../../shared/canvas/canvasCompositor';
import { drawProduct } from '../../features/clothing/controllers/clothingController';
import { isFrameUsable } from '../../features/bracelet/services/tracking/trackingPolicy';
import { trackingMessage, uploadTrackingMessage } from '../../features/bracelet/views/trackingMessages';
import { drawWristDebug, drawWristMeasurementDebug } from '../../features/bracelet/views/debug/wristDebug';
import { sizingDebug } from '../../features/bracelet/services/diagnostics/sizingDebug';
import { debugSample } from '../../features/bracelet/services/diagnostics/wristDiagnostics';
import { imageRenderFit } from '../../features/bracelet/models/braceletDimensions';
import { braceletRenderFrame } from '../../features/bracelet/models/braceletRenderFrame';
import { imageOcclusionOptions } from '../../features/bracelet/views/rendering/imageOcclusion';
import { drawLiveForearmDebug } from '../../features/bracelet/views/debug/liveForearmDebug';
import type { ApplicationBindings } from '../controllers/controllerBindings';
export function paintTryOn(bindings: ApplicationBindings) {
  const { state, canvas, video, mode, appearance, setTracking, setDetected, setSizing, setTrackingHint, setDebugCount, debugLog, setError, publishLive } = bindings;

  const c = canvas.current, s = state.current, v = video.current;
  if (!c) return;
  const ctx = c.getContext('2d'); if (!ctx) return;
  const held = s.source === 'camera' && mode === 'bracelet' && s.presentation === 'hold' && !s.renderFailed ? s.frameBuffer.read(performance.now(), s.holdUntil) : null;
  if (s.source === 'camera' && s.presentation === 'hold' && !held) {
    s.presentation = 'hidden'; s.holdUntil = 0;
    s.points = []; s.liveOrientation = null; s.forearmContour = null;
    s.tracking = { ...s.tracking, state: 'lost', source: 'None', radius: undefined }; setTracking(s.tracking); setDetected(false); setSizing(null);
    s.liveSizingDebug = null; s.liveHint = trackingMessage(s.tracking.reason);
    s.performance.pose(performance.now(), null, 'LOST', c.width);
  }
  const expired = s.source === 'camera' && (mode === 'bracelet' ? !isFrameUsable(s.capturedAt, s.receivedAt, performance.now()) || (s.tracking.source === 'ROI' && (s.tracking.roi?.ageMs ?? 2000) + performance.now() - s.capturedAt > 2000) : performance.now() - s.capturedAt > 500);
  if (expired && !held && (s.wrist || s.points.length || s.tracking.state !== 'lost')) {
    s.wrist = null; s.points = []; s.filter.reset(); setDetected(false);
    s.sizer.missing(performance.now()); s.roi.reset(); s.live.missing(performance.now());
    s.sizing = null; setSizing(null);
    s.liveOrientation = null; s.forearmContour = null; s.liveMask = null; s.forearm.missing(performance.now());
    s.tracking = { ...s.tracking, state: 'lost', reason: 'stale', source: 'None', phase: 'initial', radius: undefined }; setTracking(s.tracking);
    setTrackingHint(trackingMessage('stale'));
    if (mode === 'bracelet') { s.liveSizingDebug = null; s.liveHint = trackingMessage('stale'); s.performance.pose(performance.now(), null, 'LOST', c.width); }
    if (appearance.current.debug) setDebugCount(debugLog.current.append(debugSample(performance.now(), s.tracking, null, appearance.current.scale)));
  }
  const image = held?.image ?? (s.source === 'camera' ? (!expired && s.frame ? s.frame : v) : s.image);
  if (!image || (image instanceof HTMLVideoElement && image.readyState < 2)) return;
  const w = image instanceof HTMLVideoElement ? image.videoWidth : image instanceof ImageBitmap || image instanceof HTMLCanvasElement ? image.width : image.naturalWidth;
  const h = image instanceof HTMLVideoElement ? image.videoHeight : image instanceof ImageBitmap || image instanceof HTMLCanvasElement ? image.height : image.naturalHeight;
  if (!w || !h) return;
  const liveCamera = s.source === 'camera' && mode === 'bracelet';
  const paintKey = liveCamera ? [image, image instanceof HTMLVideoElement ? image.currentTime : 0, held?.pose ?? s.wrist, appearance.current.color, appearance.current.scale, appearance.current.showPoints, appearance.current.debug, appearance.current.engineDebugMode, held ? held.mask : s.liveMask, held?.points ?? s.points, w, h] : null;
  // RAF vẫn kiểm tra grace và độ cũ ở mỗi nhịp. Composition không đổi
  // không cần vẽ lại bitmap, lớp debug hoặc gửi lại scene GL đã cache.
  if (paintKey && s.painted && paintKey.every((v, i) => v === s.painted![i])) return;
  s.painted = paintKey;
  const paintAt = performance.now(), renderedBefore = s.bracelet.renderedFrames;
  beginCanvasFrame(ctx, image, w, h, s.source === 'camera');
  const renderWrist = held?.pose ?? s.wrist, renderPoints = held?.points ?? s.points, renderSizing = held?.sizing ?? s.sizing;
  const points = renderPoints.map(p => ({ ...p, x: p.x * c.width, y: p.y * c.height }));
  const a = appearance.current;
  const renderFit = imageRenderFit(a.scale, s.source === 'image' && (s.sizing?.method === 'image' || s.sizing?.method === 'manual-edges'));
  if (mode === 'bracelet' && renderSizing && (!s.sizingKey || s.sizingKey.pose !== renderSizing.reference || s.sizingKey.fit !== a.scale || s.sizingKey.width !== c.width)) {
    s.sizingKey = { pose: renderSizing.reference, fit: a.scale, width: c.width };
    const values = sizingDebug(renderSizing.reference, a.scale, c.width, renderSizing.measurement, renderSizing.method, renderSizing.message, renderFit);
    if (liveCamera) s.liveSizingDebug = values; else setSizing(values);
  }
  if (mode === 'bracelet') {
    if (renderWrist && !s.renderFailed) {
      try {
        const frame = braceletRenderFrame(held?.renderPose ?? s.renderPose ?? s.trackingPose ?? renderWrist, renderWrist.radius, renderFit, a.color);
        // Giữ nhánh depth hình học đã được đối chứng trước khi cải tiến Upload.
        // Phép đo thất bại không được tắt depth testing hoặc bóng; mask đáng tin cậy
        // có thể giới hạn proxy theo vùng foreground quan sát được.
        s.bracelet.drawFrame(ctx, frame, s.source === 'image' ? imageOcclusionOptions(s.imageMask) : { debugProxy: a.debug, imageMask: held ? held.mask : s.liveMask });
      }
      catch (error) {
        console.error('Three.js:', error); s.renderFailed = true; s.bracelet.clear(); s.wrist = null; s.filter.reset(); setDetected(false);
        s.tracking = { ...s.tracking, state: 'low-confidence', reason: 'render-error', radius: undefined }; setTracking(s.tracking); setTrackingHint(s.source === 'image' ? uploadTrackingMessage('render-error', s.points.length > 0) : trackingMessage('render-error'));
        setError('Không khởi chạy được đồ họa WebGL 2. Hãy bật tăng tốc đồ họa và thử lại trên Chrome/Edge mới nhất.');
      }
    }
  } else drawProduct(ctx, points, mode, a.color, a.scale);
  if (a.debug && mode === 'bracelet') {
    const pocMode = a.engineDebugMode ?? 'v1';
    if (s.source !== 'camera' || pocMode === 'v1') drawWristDebug(ctx, renderPoints, renderWrist, a.scale);
    if (renderSizing && (s.source !== 'camera' || pocMode === 'v1')) drawWristMeasurementDebug(ctx, renderSizing.measurement, renderWrist, renderSizing.method, renderFit, s.source === 'camera');
    if (s.source === 'camera' && pocMode === 'v1') drawLiveForearmDebug(ctx, held ? held.orientation : s.liveOrientation, renderWrist, held ? held.contour : s.forearmContour);
  }
  if (a.debug && liveCamera && a.engineDebugMode && a.engineDebugMode !== 'v1') {
    const poc = s.lastDetection?.liveObservation?.poc;
    if (matchesPocFrame(poc, s.capturedAt, performance.now(), w, h, !!held)) drawWristEngineDebug(ctx, poc!, a.engineDebugMode, s.liveOrientation);
  }
  if (a.showPoints || a.debug) {
    const ids = mode === 'bracelet' ? points.map((_, i) => i) : [11, 12, 23, 24];
    ctx.fillStyle = '#a0ffb7'; ctx.strokeStyle = '#163b2c'; ctx.lineWidth = 1;
    ids.forEach(i => { const p = points[i]; if (p) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, c.width / 200), 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } });
  }
  if (s.source === 'image' && s.pickingEdges) for (const p of s.picked) {
    ctx.strokeStyle = '#00ffbd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x * c.width, p.y * c.width, 6, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  if (liveCamera) {
    const now = performance.now(); s.performance.add('composite', now); s.performance.add('renderMs', now, now - paintAt);
    if (s.bracelet.renderedFrames > renderedBefore) s.performance.add('webgl', now);
    if (s.presentation === 'current' && s.wrist && s.presentedTimestamp !== s.capturedAt) {
      s.presentedTimestamp = s.capturedAt; s.performance.add('captureToPresentMs', now, now - s.capturedAt);
      if (s.frameSensorCaptureTime !== undefined && now >= s.frameSensorCaptureTime) s.performance.add('sensorToPresentMs', now, now - s.frameSensorCaptureTime);
    }
    publishLive();
  }

}
