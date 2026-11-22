import type { WristPose } from '../models/wrist.types';
import { analyzeWrist, project, rotate } from '../services/geometry/wristGeometry';
import { isFrameUsable, wristViewAngle } from '../services/tracking/trackingPolicy';
import { trackingMessage } from '../views/trackingMessages';
import type { TrackingSource } from '../models/tracking.types';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
import type { WidthMeasurement } from '../models/fitting.types';
import { debugSample } from '../services/diagnostics/wristDiagnostics';
import { BRACELET_ASSET } from '../models/braceletDimensions';
import { measureImageWrist, wristImageRoi } from '../services/measurement/imageWristMeasurement';
import { measureSegmentedWrist } from '../services/measurement/segmentedWristMeasurement';
import { measureForearmContour } from '../services/live/liveForearmContour';
import { LIVE_PIPELINE_VERSION } from '../models/liveContinuity';
import type { BraceletBindings, WristPreparation } from './braceletRuntime';
import type { BraceletDetection as Detection } from '../models/vision.types';
export function updateLiveBracelet(bindings: BraceletBindings, data: Detection, prepared: WristPreparation) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;
  const { aspect, modeOption, analysis, stale, mismatch, pixels } = prepared; const s = state.current;

  // Trục dọc bàn tay khác trục cẳng tay; quan sát Pose ghép đúng
  // có thể hỗ trợ theo nhịp ngay cả trong chế độ cận cảnh.
  const handAnalysis = data.liveObservation?.hand ?? analyzeWrist(data.points, data.worldPoints, aspect, data.handedness, { mode: 'straight-wrist', deferAxialCheck: true });
  const armAnalysis = data.armPoints.length ? analyzeWrist(data.points, data.worldPoints, aspect, data.handedness, { mode: 'forearm', armPoints: data.armPoints, armWorldPoints: data.armWorldPoints }) : null;
  const rawHand = handAnalysis.pose ?? (handAnalysis.reason === 'axial-view' ? armAnalysis?.pose : null);
  let observed: WristPose | null = rawHand ? { ...rawHand, source: modeOption } : null;
  s.liveOrientation = null; s.forearmContour = null; s.liveMask = null;
  let measurement: WidthMeasurement = { width: null, confidence: 0, reason: 'Không có phép đo biên hợp lệ trên frame này.' };
  if (data.liveObservation && !stale && !mismatch) {
    observed = data.liveObservation.pose;
    s.liveOrientation = data.liveObservation.orientation; s.forearmContour = data.liveObservation.contour;
    s.liveMask = data.liveObservation.mask; measurement = data.liveObservation.measurement;
    s.needsArmObservation = data.liveObservation.needsArmObservation;
  } else if (observed && s.frame && !stale && !mismatch) {
    const W = s.frame.width, H = s.frame.height, region = wristImageRoi(observed, W, H, data.points[0]);
    const sample = s.measurementCanvas ?? (s.measurementCanvas = document.createElement('canvas'));
    sample.width = region.width; sample.height = region.height;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (ctx) try {
      ctx.drawImage(s.frame, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
      const native = { ...region, data: ctx.getImageData(0, 0, region.width, region.height).data };
      const semanticContour = data.skin ? measureForearmContour(native, observed, data.points[0], data.skin) : null;
      s.forearmContour = semanticContour?.direction ? semanticContour : measureForearmContour(native, observed, data.points[0]);
      const armQuality = (armAnalysis?.metrics.armVisibility ?? 0) * Math.max(0, 1 - (armAnalysis?.metrics.fitResidual ?? 1));
      s.liveOrientation = s.forearm.update(observed, s.forearmContour, data.timestamp, armAnalysis?.pose, armQuality);
      s.needsArmObservation = s.forearm.needsArmObservation;
      observed = s.liveOrientation.pose;
      if (observed) {
        const semantic = data.skin ? measureSegmentedWrist(native, observed, data.skin, data.points[0]) : null;
        const rgb = semantic?.measurement.width != null ? null : measureImageWrist(native, observed, data.points[0], true, 0, true);
        measurement = semantic?.measurement.width != null ? semantic.measurement : rgb!.measurement;
        s.liveMask = semantic?.mask ?? rgb?.mask ?? null;
      }
    } catch (error) { observed = null; measurement = { width: null, confidence: 0, reason: 'Không phân tích được ROI trên frame webcam.' }; if (appearance.current.debug) console.warn('[mira-live-roi]', error); }
    else observed = null;
  } else s.forearm.missing(data.timestamp);
  const liveStale = stale || !isFrameUsable(data.timestamp, s.receivedAt, performance.now());
  const result = s.live.update(observed, measurement, pixels, data.timestamp, { usable: !liveStale && !mismatch, auto: appearance.current.autoFit, fixedSize: BRACELET_ASSET.fitting === 'fixed-size', orientationReliable: (s.liveOrientation?.confidence ?? 0) >= .75, foreground: s.liveMask, allowEstimate: true, now: s.receivedAt });
  if (result.ignored) return;
  s.trackingPose = s.renderPose = result.tracked; s.wrist = result.fit?.pose ?? null;
  s.sizing = result.fit && result.tracked ? { ...result.fit, measurement, reference: result.fit.pose ?? result.tracked } : null;
  s.presentation = result.presentation; s.holdUntil = result.holdUntil;
  if (s.wrist && s.sizing && s.frame && result.presentation === 'current') s.frameBuffer.capture(s.frame, { pose: s.wrist, renderPose: s.renderPose ?? s.wrist, sizing: s.sizing, points: s.points, mask: s.liveMask, orientation: s.liveOrientation, contour: s.forearmContour, capturedAt: data.timestamp, receivedAt: s.receivedAt, validUntil: Math.min(data.timestamp + 1000, s.receivedAt + 500, result.source === 'ROI' ? data.timestamp + Math.max(0, 2000 - (result.roi?.ageMs ?? 2000)) : Infinity) });
  const held = result.presentation === 'hold' ? s.frameBuffer.read(performance.now(), result.holdUntil) : null;
  if (!s.sizing && !held) s.liveSizingDebug = null;
  const reason = liveStale ? 'stale' : mismatch ? 'mode-switch' : s.renderFailed ? 'render-error' : s.wrist ? 'ok' : result.tracked ? 'sizing' : s.liveOrientation && !s.liveOrientation.pose ? 'orientation' : rawHand ? 'reacquiring' : handAnalysis.reason;
  const trackingSource: TrackingSource = held ? 'Grace frame' : result.source === 'ROI' ? 'ROI' : result.source === 'Hand' ? s.liveOrientation?.source === 'Pose' ? 'Hand Landmarker + Pose' : 'Hand Landmarker' : 'None';
  s.tracking = { state: s.wrist && !s.renderFailed && result.fit?.method !== 'provisional' ? 'tracking' : result.status === 'LOST' ? 'lost' : 'low-confidence', reason, metrics: analysis.metrics, mode: analysis.effectiveMode, landmarks: data.points.length, radius: (held?.pose ?? s.wrist)?.radius, source: trackingSource, phase: s.wrist || held ? 'continuous' : 'initial', viewAngle: result.tracked ? wristViewAngle(result.tracked) : undefined, roi: result.roi ? { matches: result.roi.matches, inliers: result.roi.inliers, rms: result.roi.rms, ageMs: result.roi.ageMs, quality: result.roi.quality } : undefined, roiSeed: result.seed };
  s.liveHint = held ? 'Đang giữ khung hình ổn định · đang nhận lại cổ tay.' : result.fit?.method === 'provisional' || reason === 'sizing' ? result.fit?.message ?? trackingMessage(reason) : trackingMessage(reason);
  s.performance.pose(performance.now(), s.wrist, result.status, s.frame?.width ?? 0);
  if (appearance.current.debug) {
    const width = s.frame?.width ?? 0, manual = appearance.current.scale;
    const displayedSizing = held?.sizing ?? s.sizing;
    const values = displayedSizing ? sizingDebug(displayedSizing.reference, manual, width, displayedSizing.measurement, displayedSizing.method, displayedSizing.message) : null;
    const o = s.liveOrientation;
    const imagePoint = (p: WristPose | null) => p ? { x: project(p.center, p).x * width, y: project(p.center, p).y * width } : null;
    const live = { state: result.status, capturedAt: data.timestamp, receivedAt: s.receivedAt, inferenceMs: data.elapsed, totalAgeMs: performance.now() - data.timestamp, frameSize: { width, height: s.frame?.height ?? 0 }, wristCenter: result.tracked?.center ?? null, wristLandmark: data.points[0] ?? null, wristLandmarkImagePx: data.points[0] ? { x: data.points[0].x * width, y: data.points[0].y * width * aspect } : null, expectedWearCenterImagePx: imagePoint(o?.pose ?? null), braceletCenterImagePx: imagePoint(s.wrist), rawHandMetrics: handAnalysis.metrics, rawHandAxis: handAnalysis.pose ? rotate(handAnalysis.pose.orientation, { x: 0, y: 0, z: 1 }) : null, estimatedForearmAxis: o?.forearmAxis ?? null, forearmSource: o?.source ?? 'None', orientationConfidence: o?.confidence ?? 0, depthSource: o?.depth ?? null, orientationReason: o?.reason ?? handAnalysis.reason, contour: s.forearmContour, forearmAxis: result.tracked ? rotate(result.tracked.orientation, { x: 0, y: 0, z: 1 }) : null, braceletCenter: s.wrist?.center ?? null, quaternion: result.tracked?.orientation ?? null, rotationDeltaRadians: result.rotationDelta, landmarks: data.points, measurementReason: measurement.reason, roiReason: result.roi?.reason ?? null, measuredWidthPx: measurement.width === null ? null : measurement.width * width, fitRatio: values?.fitRatio ?? null, occlusion: s.liveMask ? 'depth-proxy-current-foreground' : 'depth-proxy-estimated', sameInferenceFrame: true };
    Object.assign(live, { observationFrameId: data.liveObservation?.frameId ?? null, wristEngineV2: appearance.current.engineDebugMode !== 'v1' ? data.liveObservation?.poc ?? null : null, pipelineVersion: LIVE_PIPELINE_VERSION, workerPipelineVersion: data.pipelineVersion ?? 'unknown', optionalPoseStatus: data.armStatus ?? 'unknown', presentation: held ? 'hold' : result.presentation, renderFrameTimestamp: held?.capturedAt ?? data.timestamp, frameHeldMs: held ? performance.now() - held.receivedAt : 0, displayedLandmarks: held?.points ?? s.points, hasRenderPose: !!(held || s.wrist), estimatedSize: displayedSizing?.method === 'provisional', renderedQuaternion: (held?.pose ?? s.wrist)?.orientation ?? null, renderedCenterImagePx: imagePoint(held?.pose ?? s.wrist) });
    const row = debugSample(data.timestamp, s.tracking, values, manual, live);
    s.logCount = debugLog.current.append(row); console.debug('[mira-live]', JSON.stringify(row));
  }
  return;

}
export function submitLatestCamera(bindings: BraceletBindings, generation: number) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;

  const s = state.current, frame = s.latestCameraFrame, v = video.current;
  if (s.pending || !frame || !v || generation !== s.generation || s.source !== 'camera') return;
  // Chỉ giữ metadata mới nhất, không xếp hàng bitmap. Nếu có khung decode mới
  // trong lúc bận, lấy video HIỆN TẠI ngay khi xử lý xong.
  if (s.frameGate.observe(frame.presentedFrames ?? frame.mediaTime, false) !== 'ready') return;
  s.sensorCaptureTime = frame.captureTime; void submit(v, true, generation);

}
export function startLiveRendering(bindings: BraceletBindings, generation: number) { const { state, appearance, paint } = bindings; const s = state.current; s.performance.reset(performance.now()); const render = () => { if (generation !== s.generation) return; paint(); s.performance.log(performance.now(), appearance.current.debug); s.raf = requestAnimationFrame(render); }; render(); }
export function startLiveAcquisition(bindings: BraceletBindings, generation: number) { const { state, video, submit } = bindings; const s = state.current, v = video.current!; s.frameClock.start(v, frame => { if (generation !== s.generation || v.readyState < 2) return; const previous = s.latestCameraFrame; if (previous && (frame.presentedFrames ?? frame.mediaTime) <= (previous.presentedFrames ?? previous.mediaTime)) { s.performance.duplicates++; return; } s.latestCameraFrame = frame; s.performance.camera(frame.at, frame.presentedFrames); const decision = s.frameGate.observe(frame.presentedFrames ?? frame.mediaTime, s.pending); if (decision === 'duplicate') { s.performance.duplicates++; return; } if (decision === 'busy') { s.performance.dropped++; return; } s.sensorCaptureTime = frame.captureTime; void submit(v, true, generation); }); }
