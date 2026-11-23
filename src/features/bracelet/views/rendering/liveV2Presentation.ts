import type { BraceletBindings } from '../../controllers/braceletRuntime';
import { beginCanvasFrame } from '../../../../shared/canvas/canvasCompositor';
import { braceletRenderFrame } from '../../models/braceletRenderFrame';
import { manualFit } from '../../models/braceletDimensions';
import { drawWristEngineDebug } from '../debug/wristEngineDebug';
import { debugSample } from '../../services/diagnostics/wristDiagnostics';

/** V2-only presentation. The V1 paint path and tracker remain intact.
 * Each shown pose/mask/landmark set belongs to the copied image in its buffer. */
export function paintLiveV2(bindings: BraceletBindings) {
  const s = bindings.state.current, a = bindings.appearance.current, canvas = bindings.canvas.current;
  const video = bindings.video.current, now = performance.now(), view = s.v2Continuity.read(now);
  if (!canvas || !video) return;
  const snapshot = view.visible ? s.v2FrameBuffer.read(now, view.receivedAt + 240) : null;
  const image = snapshot?.image ?? video;
  const width = snapshot?.image.width ?? video.videoWidth, height = snapshot?.image.height ?? video.videoHeight;
  if (!width || !height || (!snapshot && video.readyState < 2)) return;
  const key = [image, snapshot ? view.capturedAt : video.currentTime, snapshot?.pose, view.opacity, a.color, a.scale, a.debug, a.showPoints];
  if (s.v2Painted && key.every((item, i) => item === s.v2Painted![i])) return;
  s.v2Painted = key;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const renderedBefore = s.bracelet.renderedFrames;
  beginCanvasFrame(ctx, image, width, height, true);
  let visible = false, reason = s.renderFailed ? 'render-error' : snapshot ? view.reason : view.visible ? 'matched-buffer-unavailable' : view.reason;
  if (snapshot && !s.renderFailed) {
    try {
      ctx.save(); ctx.globalAlpha = view.opacity;
      s.bracelet.drawFrame(ctx, braceletRenderFrame(snapshot.pose, snapshot.pose.radius, manualFit(a.scale), a.color), { debugProxy: a.debug, imageMask: snapshot.mask });
      ctx.restore(); visible = true;
    } catch (error) {
      ctx.restore(); s.renderFailed = true; reason = 'render-error';
      console.error('[mira-v2-render]', error);
    }
  }
  if (a.debug && snapshot && s.v2FrameMeta?.poc?.timestamp === snapshot.capturedAt) {
    drawWristEngineDebug(ctx, s.v2FrameMeta.poc, 'v2', snapshot.orientation, snapshot.pose, s.stabilityTrace);
  }
  if (snapshot && (a.debug || a.showPoints)) {
    ctx.fillStyle = '#a0ffb7';
    for (const p of snapshot.points) { ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  const end = performance.now(); s.performance.add('composite', end); s.performance.add('renderMs', end, end - now);
  if (s.bracelet.renderedFrames > renderedBefore) s.performance.add('webgl', end);
  if (a.debug) {
    const stability = { ...s.stability.snapshot(end, visible, reason, s.performance.snapshot(end), snapshot?.capturedAt ?? null),
      braceletEngine: 'v1-geometry+v2-continuity', rawPoseSource: 'existing-v1-fit-input', trackingState: view.state, confidence: view.confidence,
      frameId: snapshot ? s.v2FrameMeta?.frameId ?? null : null,
      observationFrameId: s.lastDetection?.liveObservation?.frameId ?? null,
      poseAgeMs: view.poseAgeMs, filterResetCount: view.filterResetCount, filterResetCountReason: 'v2-loss-reset-only', filterResetScope: 'current-v2-mode-activation',
      rawPosition: s.v2Continuity.raw?.center ?? null, filteredPosition: view.pose?.center ?? null,
      rawQuaternion: s.v2Continuity.raw?.orientation ?? null, filteredQuaternion: view.pose?.orientation ?? null,
      filterErrorScene: view.filterErrorScene, opacity: visible ? view.opacity : 0,
      imageTimestamp: snapshot?.capturedAt ?? null, poseTimestamp: snapshot?.capturedAt ?? null,
      renderedMaskPresent: !!snapshot?.mask,
    };
    s.stabilityTrace = stability;
    s.logCount = bindings.debugLog.current.append(debugSample(s.capturedAt, s.tracking, null, a.scale, { stability }));
    console.debug('[mira-stability]', JSON.stringify(stability));
  }
  bindings.publishLive();
}
