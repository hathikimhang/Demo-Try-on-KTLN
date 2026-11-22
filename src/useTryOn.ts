import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, Point, TrackingMode, WorkerReply } from './types';
import { drawProduct } from './draw';
import { smoothPoints } from './geometry';
import { analyzeWrist, analyzeWristForSource, project, rotate, WristFilter, type WristPose } from './wristGeometry';
import { BraceletRenderer } from './braceletRenderer';
import { emptyTracking, isFrameUsable, trackingMessage, uploadTrackingMessage, wristViewAngle, type TrackingSnapshot, type TrackingSource } from './wristTracking';
import { drawWristDebug, drawWristMeasurementDebug } from './wristDebug';
import { measureWristWidth, WristSizer, sizingDebug, type FitMethod, type SizingDebug, type WidthMeasurement } from './braceletSizing';
import { WristRoiTracker, type PixelFrame, type RoiResult } from './wristRoiTracking';
import { WristDebugLog, debugSample } from './wristDiagnostics';
import { BRACELET_ASSET, imageRenderFit } from './braceletDimensions';
import { manualImageWrist, measureImageWrist, wristImageRoi } from './imageWristMeasurement';
import { clientToImagePoint, type ImageMask, type ImagePoint } from './imageCoordinates';
import { braceletRenderFrame } from './braceletRenderFrame';
import { imageOcclusionOptions } from './imageOcclusion';
import { measureSegmentedWrist } from './segmentedWristMeasurement';
import { registerImageWrist } from './imageWristRegistration';
import { LiveWristSession } from './liveWristTracking';
import { measureForearmContour, type ForearmContour } from './liveForearmContour';
import { LiveForearmEstimator, type LiveOrientation } from './liveForearmPose';
import { drawLiveForearmDebug } from './liveForearmDebug';
import { LIVE_PIPELINE_VERSION, type LivePresentation } from './liveContinuity';
import { LiveFrameBuffer } from './liveFrameBuffer';
import { LiveFrameClock, LiveFrameGate, type CameraFrame } from './liveFrameClock';
import { LivePerformance } from './livePerformance';
import { liveSkinInterval } from './liveTaskBudget';

type Detection = Omit<Extract<WorkerReply, { type: 'result' }>, 'frame'>;
export function useTryOn(mode: Mode, color: string, scale: number, showPoints: boolean, trackingMode: TrackingMode = 'straight-wrist', debug = false, autoFit = true) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<'empty' | 'camera' | 'image'>('empty');
  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState(false);
  const [tracking, setTracking] = useState<TrackingSnapshot>(emptyTracking);
  const [sizing, setSizing] = useState<SizingDebug | null>(null);
  const [error, setError] = useState('');
  const [latency, setLatency] = useState(0);
  const [saved, setSaved] = useState(false);
  const [debugCount, setDebugCount] = useState(0);
  const [calibration, setCalibration] = useState({ picking: false, count: 0, message: '' });
  const [debugLog] = useState(() => ({ current: new WristDebugLog() }));
  const [trackingHint, setTrackingHint] = useState('Đưa toàn bộ bàn tay và cổ tay vào khung hình');
  const [state] = useState(() => ({ current: {
    worker: null as Worker | null, stream: null as MediaStream | null, image: null as HTMLImageElement | null,
    frame: null as ImageBitmap | null, points: [] as Point[], wrist: null as WristPose | null,
    lastDetection: null as Detection | null, renderFailed: false,
    sizer: new WristSizer(), roi: new WristRoiTracker(), live: new LiveWristSession(), lastSkinRequest: -Infinity, measurementCanvas: null as HTMLCanvasElement | null,
    forearm: new LiveForearmEstimator(), liveOrientation: null as LiveOrientation | null, forearmContour: null as ForearmContour | null, liveMask: null as ImageMask | null,
    needsArmObservation: false,
    frameClock: new LiveFrameClock(), frameGate: new LiveFrameGate(), performance: new LivePerformance(),
    latestCameraFrame: null as CameraFrame | null,
    lastCapturedVideoFrame: -1, skinCostMs: null as number | null,
    uiNextAt: 0, uiSemantic: '', liveHint: '', workerLatency: 0, liveSizingDebug: null as SizingDebug | null, logCount: 0,
    painted: null as unknown[] | null, presentedTimestamp: 0, sensorCaptureTime: undefined as number | undefined, requestSensorCaptureTime: undefined as number | undefined, frameSensorCaptureTime: undefined as number | undefined,
    frameBuffer: new LiveFrameBuffer(), presentation: 'hidden' as LivePresentation, holdUntil: 0, lastResultTimestamp: 0,
    sizing: null as { method: FitMethod; message: string; measurement: WidthMeasurement; reference: WristPose } | null,
    sizingKey: null as { pose: WristPose; fit: number; width: number } | null,
    imageMask: null as ImageMask | null, imagePose: null as WristPose | null,
    trackingPose: null as WristPose | null,
    renderPose: null as WristPose | null,
    manualEdges: null as [ImagePoint, ImagePoint] | null, pickingEdges: false, picked: [] as ImagePoint[],
    filter: new WristFilter(), bracelet: new BraceletRenderer(), receivedAt: 0, capturedAt: 0, tracking: emptyTracking(),
    raf: 0, generation: 0, pending: false, source: 'empty', lastTime: -1, url: '', timeout: 0,
  } }));
  const appearance = useRef({ color, scale, showPoints, trackingMode, debug, autoFit });
  appearance.current = { color, scale, showPoints, trackingMode, debug, autoFit };
  const publishLive = useCallback(() => {
    const s = state.current, now = performance.now();
    const semantic = `${s.tracking.state}/${s.tracking.reason}/${s.tracking.source}/${s.liveHint}`;
    if (now < s.uiNextAt && semantic === s.uiSemantic) return;
    s.uiNextAt = now + 250; s.uiSemantic = semantic;
    setTracking(s.tracking); setDetected(s.tracking.state === 'tracking'); setTrackingHint(s.liveHint);
    setLatency(s.workerLatency); setSizing(s.liveSizingDebug); setDebugCount(s.logCount);
  }, []);
  const updateWrist = useCallback((data: Detection) => {
    if (mode !== 'bracelet') return;
    const s = state.current;
    const aspect = s.frame ? s.frame.height / s.frame.width : s.image ? s.image.naturalHeight / s.image.naturalWidth : 1;
    const modeOption = appearance.current.trackingMode;
    const analysis = analyzeWristForSource(data.points, data.worldPoints, aspect, data.handedness, { input: s.source === 'image' ? 'image' : 'camera', mode: modeOption, armPoints: data.armPoints, armWorldPoints: data.armWorldPoints });
    const stale = s.source === 'camera' && !isFrameUsable(data.timestamp, s.receivedAt, performance.now());
    // Worker mode is the inference REQUEST. An upload's local fallback may
    // legitimately produce another effective mode; it is not a stale request.
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
      if (context) try { context.drawImage(image, 0, 0, sw, sh); pixels = context.getImageData(0, 0, sw, sh); } catch { /* Explicit read failure; never substitute fabricated pixels. */ }
    }
    // Separate camera orchestration. The static-image pipeline below, including
    // its detector fallback, native fit, registration and mask, is unchanged.
    if (s.source === 'camera') {
      // Hand longitudinal direction and forearm direction are distinct. A
      // sparse, matched Pose observation may assist even in close-up mode.
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
        Object.assign(live, { pipelineVersion: LIVE_PIPELINE_VERSION, workerPipelineVersion: data.pipelineVersion ?? 'unknown', optionalPoseStatus: data.armStatus ?? 'unknown', presentation: held ? 'hold' : result.presentation, renderFrameTimestamp: held?.capturedAt ?? data.timestamp, frameHeldMs: held ? performance.now() - held.receivedAt : 0, displayedLandmarks: held?.points ?? s.points, hasRenderPose: !!(held || s.wrist), estimatedSize: displayedSizing?.method === 'provisional', renderedQuaternion: (held?.pose ?? s.wrist)?.orientation ?? null, renderedCenterImagePx: imagePoint(held?.pose ?? s.wrist) });
        const row = debugSample(data.timestamp, s.tracking, values, manual, live);
        s.logCount = debugLog.current.append(row); console.debug('[mira-live]', JSON.stringify(row));
      }
      return;
    }
    let trackingSource: TrackingSource = 'None', roi: RoiResult | null = null;
    s.wrist = !stale && !mismatch && analysis.pose ? s.filter.update(analysis.pose, s.source === 'camera' ? data.timestamp : 0) : null;
    if (s.wrist) trackingSource = analysis.effectiveMode === 'forearm' ? 'Hand Landmarker + Pose' : 'Hand Landmarker';
    else if (!stale && !mismatch && s.source === 'camera' && pixels) {
      roi = s.roi.track(pixels, data.timestamp);
      s.wrist = roi.pose; if (roi.pose) trackingSource = 'ROI';
    }
    const trackedPose = s.wrist;
    s.trackingPose = trackedPose;
    s.renderPose = trackedPose;
    if (s.wrist) {
      let measurement: WidthMeasurement = pixels ? measureWristWidth(pixels, s.wrist, trackingSource === 'ROI' ? undefined : data.points[0]) : { width: null, confidence: 0, reason: 'Không đọc được ảnh gốc để đo cổ tay (native-read-failed)' };
      if (s.source === 'image' && s.image) {
        s.imagePose = s.wrist; s.imageMask = null;
        let imageRegistration = s.wrist;
        const iw = s.image.naturalWidth, ih = s.image.naturalHeight;
        const region = wristImageRoi(s.wrist, iw, ih, data.points[0]);
        const sample = s.measurementCanvas ?? (s.measurementCanvas = document.createElement('canvas'));
        sample.width = region.width; sample.height = region.height;
        const context = sample.getContext('2d', { willReadFrequently: true });
        if (context) try {
          context.drawImage(s.image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
          const native = { ...region, data: context.getImageData(0, 0, region.width, region.height).data };
          const semantic = data.skin ? measureSegmentedWrist(native, s.wrist, data.skin, data.points[0]) : null;
          const result = semantic?.measurement.width != null ? semantic : measureImageWrist(native, s.wrist, data.points[0]);
          // Segmentation can provide valid occlusion evidence even if a native
          // edge is too weak for sizing. Keep these two decisions independent.
          measurement = result.measurement.width !== null ? result.measurement : semantic?.measurement ?? result.measurement;
          s.imageMask = semantic?.mask ?? result.mask;
          imageRegistration = registerImageWrist(s.wrist, semantic?.measurement ?? measurement);
        } catch { /* Explicit native-read-failed; do not substitute scaled pixels. */ }
        if (s.manualEdges) {
          const manual = manualImageWrist(s.imagePose, s.manualEdges, { width: iw, height: ih });
          measurement = manual.measurement;
          // Keep only a verified foreground mask; manual clicks do not invent one.
        }
        if (measurement.image) measurement.image.maskAvailable = !!s.imageMask;
        // Registration is a separate, validated image-position stage. Sizing
        // never supplies a quaternion or changes the raw detection transform.
        s.wrist = imageRegistration; s.renderPose = imageRegistration;
      }
      const fitted = s.sizer.update(s.wrist, measurement, data.timestamp, { input: s.source === 'image' ? 'image' : 'camera', auto: appearance.current.autoFit, video: s.source === 'camera', policy: BRACELET_ASSET.fitting, trackingSource: trackingSource === 'ROI' ? 'ROI' : 'Hand' });
      s.wrist = fitted.pose; s.sizing = { method: fitted.method, message: fitted.message, measurement, reference: fitted.pose ?? trackedPose! };
      if (trackingSource !== 'ROI') {
        // Seed features only inside a currently observed, plausible wrist. An
        // oversized manual bracelet must not expand this skin ROI or the proxy.
        if (s.wrist && pixels && measurement.width && measurement.confidence >= .65) s.roi.seed(pixels, s.wrist, data.timestamp);
        else s.roi.reset();
      }
    } else {
      s.filter.reset(); s.sizer.missing(data.timestamp); s.roi.reset(); s.sizing = null; setSizing(null);
      if (s.source === 'image') {
        s.imagePose = null; s.imageMask = null;
        if (s.pickingEdges) { s.pickingEdges = false; s.picked = []; setCalibration({ picking: false, count: 0, message: 'Chưa có tư thế cổ tay hợp lệ để chọn mép.' }); }
      }
    }
    const reason = stale ? 'stale' : mismatch ? 'mode-switch' : s.renderFailed ? 'render-error' : trackedPose && !s.wrist ? 'sizing' : trackingSource === 'ROI' && s.wrist ? 'ok' : analysis.pose && !s.wrist ? 'reacquiring' : roi && !roi.pose ? 'roi-lost' : analysis.reason;
    s.tracking = {
      state: stale ? 'lost' : s.wrist && !s.renderFailed ? 'tracking' : !data.points.length ? 'lost' : 'low-confidence',
      reason, metrics: analysis.metrics, mode: analysis.effectiveMode, landmarks: data.points.length, radius: s.wrist?.radius,
      requestedMode: s.source === 'image' ? analysis.requestedMode : undefined, workerMode: s.source === 'image' ? data.trackingMode : undefined, fallbackReason: analysis.fallbackReason,
      source: trackingSource, phase: s.wrist ? 'continuous' : 'initial', viewAngle: trackedPose ? wristViewAngle(trackedPose) : undefined,
      roi: roi ? { matches: roi.matches, inliers: roi.inliers, rms: roi.rms, ageMs: roi.ageMs, quality: roi.quality } : undefined,
      roiSeed: trackingSource !== 'ROI' ? s.roi.seedEvidence : undefined,
    };
    setTracking(s.tracking); setTrackingHint(s.source === 'image' ? uploadTrackingMessage(reason, data.points.length > 0, s.sizing ?? undefined) : reason === 'sizing' && s.sizing ? s.sizing.message : roi ? roi.reason : trackingMessage(reason));
    setDetected(s.tracking.state === 'tracking');
    if (appearance.current.debug) {
      const width = canvas.current?.width ?? 0;
      const renderFit = imageRenderFit(appearance.current.scale, s.source === 'image' && (s.sizing?.method === 'image' || s.sizing?.method === 'manual-edges'));
      const values = s.sizing ? sizingDebug(s.sizing.reference, appearance.current.scale, width, s.sizing.measurement, s.sizing.method, s.sizing.message, renderFit) : null;
      setDebugCount(debugLog.current.append(debugSample(data.timestamp, s.tracking, values, appearance.current.scale)));
    }
  }, [mode]);

  const paint = useCallback(() => {
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
    const paintKey = liveCamera ? [image, image instanceof HTMLVideoElement ? image.currentTime : 0, held?.pose ?? s.wrist, appearance.current.color, appearance.current.scale, appearance.current.showPoints, appearance.current.debug, held ? held.mask : s.liveMask, held?.points ?? s.points, w, h] : null;
    // RAF still checks grace/staleness every tick. Identical compositions do
    // not redraw the same bitmap/debug overlay or submit a cached GL scene.
    if (paintKey && s.painted && paintKey.every((v, i) => v === s.painted![i])) return;
    s.painted = paintKey;
    const paintAt = performance.now(), renderedBefore = s.bracelet.renderedFrames;
    const ratio = Math.min(1, 1600 / Math.max(w, h));
    if (c.width !== Math.round(w * ratio) || c.height !== Math.round(h * ratio)) { c.width = Math.round(w * ratio); c.height = Math.round(h * ratio); }
    ctx.clearRect(0, 0, c.width, c.height); ctx.save();
    if (s.source === 'camera') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(image, 0, 0, c.width, c.height);
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
          // Restore the verified pre-upload geometry-depth fallback. A failed
          // measurement cannot turn depth testing/shadows off. A trusted mask
          // may additionally clip the proxy to observed foreground pixels.
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
      drawWristDebug(ctx, renderPoints, renderWrist, a.scale);
      if (renderSizing) drawWristMeasurementDebug(ctx, renderSizing.measurement, renderWrist, renderSizing.method, renderFit, s.source === 'camera');
      if (s.source === 'camera') drawLiveForearmDebug(ctx, held ? held.orientation : s.liveOrientation, renderWrist, held ? held.contour : s.forearmContour);
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
  }, [mode]);

  const stop = useCallback(() => {
    const s = state.current;
    s.generation++; cancelAnimationFrame(s.raf); s.frameClock.stop(); s.frameGate.reset(); clearTimeout(s.timeout);
    s.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); }); s.stream = null;
    s.worker?.terminate(); s.worker = null; s.pending = false; s.points = []; s.image = null;
    s.frame?.close(); s.frame = null; s.wrist = null; s.filter.reset(); s.bracelet.clear(); s.receivedAt = 0; s.capturedAt = 0; s.tracking = emptyTracking(); setTracking(s.tracking);
    s.lastDetection = null; s.renderFailed = false;
    s.sizer.reset(); s.roi.reset(); s.live.reset(); s.lastSkinRequest = -Infinity; s.sizing = null; s.sizingKey = null; setSizing(null); s.measurementCanvas = null;
    s.forearm.reset(); s.liveOrientation = null; s.forearmContour = null; s.liveMask = null;
    s.needsArmObservation = false;
    s.painted = null; s.presentedTimestamp = 0; s.uiNextAt = 0; s.uiSemantic = ''; s.liveSizingDebug = null; s.logCount = 0;
    s.sensorCaptureTime = s.requestSensorCaptureTime = s.frameSensorCaptureTime = undefined;
    s.latestCameraFrame = null;
    s.lastCapturedVideoFrame = -1; s.skinCostMs = null;
    s.performance.reset(performance.now());
    s.frameBuffer.clear(); s.presentation = 'hidden'; s.holdUntil = s.lastResultTimestamp = 0;
    s.imagePose = null; s.imageMask = null; s.trackingPose = null; s.renderPose = null; s.manualEdges = null; s.picked = []; s.pickingEdges = false; setCalibration({ picking: false, count: 0, message: '' });
    if (s.url) { URL.revokeObjectURL(s.url); s.url = ''; }
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
    s.source = 'empty'; s.lastTime = -1;
    setSource('empty'); setDetected(false); setBusy(false); setLatency(0);
    setSaved(false); setTrackingHint('Đưa toàn bộ bàn tay và cổ tay vào khung hình');
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => { paint(); }, [color, scale, showPoints, debug, paint]);
  useEffect(() => {
    if (mode !== 'bracelet') return;
    const s = state.current; if (autoFit) s.sizer.reset(); s.live.reset(); s.frameBuffer.clear(); s.presentation = 'hidden'; s.sizingKey = null;
    // Video will refit on the next inference; a still image needs an explicit
    // refit. Neither branch changes the orientation estimator or user trim.
    if (s.source === 'image' && s.lastDetection) { updateWrist(s.lastDetection); paint(); }
    else if (s.source === 'camera') { s.wrist = null; s.sizing = null; setSizing(null); setDetected(false); paint(); }
  }, [autoFit, mode, updateWrist, paint]);
  useEffect(() => {
    const s = state.current; s.filter.reset(); s.roi.reset(); s.live.reset(); s.forearm.reset(); s.frameBuffer.clear(); s.presentation = 'hidden';
    if (s.lastDetection) { updateWrist(s.lastDetection); paint(); }
    // A still image has no camera loop to request the newly selected detector.
    if (s.image && s.worker && s.lastDetection) void submit(s.image, false, s.generation);
  }, [trackingMode, updateWrist, paint]);

  const initialize = (generation: number) => new Promise<Worker>((resolve, reject) => {
    const s = state.current; debugLog.current.reset(); setDebugCount(0);
    const worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
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
        s.points = mode === 'shirt' && s.source === 'camera' ? smoothPoints(s.points, data.points) : data.points;
        const { frame: _frame, ...detection } = data;
        s.lastDetection = detection; updateWrist(detection);
        const pixels = data.points.map(p => ({ ...p, x: p.x * 1000, y: p.y * 1000 }));
        // Pose visibility must be sufficient for actual garment placement.
        if (mode === 'shirt') setDetected(pixels.length >= 25 && [11, 12, 23, 24].every(i => (pixels[i].visibility ?? 1) >= 0.45));
        if (liveCamera) { s.performance.add('mainUpdateMs', performance.now(), performance.now() - updateAt); publishLive(); submitLatestCamera(generation); }
        else { setLatency(Math.round(data.elapsed)); setBusy(false); paint(); }
        if (mode === 'bracelet' && data.trackingMode !== appearance.current.trackingMode && s.image) void submit(s.image, false, generation);
      }
    };
    worker.postMessage({ type: 'init', mode, base: new URL(import.meta.env.BASE_URL, location.href).href });
  });

  const submit = async (image: HTMLVideoElement | HTMLImageElement, isVideo: boolean, generation: number) => {
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
  };

  const submitLatestCamera = (generation: number) => {
    const s = state.current, frame = s.latestCameraFrame, v = video.current;
    if (s.pending || !frame || !v || generation !== s.generation || s.source !== 'camera') return;
    // Keep only metadata, never a queued bitmap. If a newer decoded frame
    // arrived while busy, sample CURRENT video immediately on completion.
    if (s.frameGate.observe(frame.presentedFrames ?? frame.mediaTime, false) !== 'ready') return;
    s.sensorCaptureTime = frame.captureTime; void submit(v, true, generation);
  };

  const startCamera = async () => {
    stop(); setError(''); setBusy(true);
    const s = state.current, generation = s.generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera cần HTTPS hoặc localhost và trình duyệt có hỗ trợ webcam.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (generation !== s.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      s.stream = stream;
      stream.getVideoTracks()[0].onended = () => { stop(); setError('Camera đã bị ngắt kết nối. Vui lòng bật lại.'); };
      const v = video.current!; v.srcObject = stream; await v.play();
      if (generation !== s.generation) return;
      s.source = 'camera'; setSource('camera'); paint();
      const liveCamera = mode === 'bracelet';
      if (liveCamera) {
        s.performance.reset(performance.now());
        const render = () => { if (generation !== s.generation) return; paint(); s.performance.log(performance.now(), appearance.current.debug); s.raf = requestAnimationFrame(render); }; render();
      }
      await initialize(generation);
      if (generation !== s.generation) return;
      setBusy(false);
      if (liveCamera) {
        s.frameClock.start(v, frame => {
          if (generation !== s.generation || v.readyState < 2) return;
          const previous = s.latestCameraFrame;
          if (previous && (frame.presentedFrames ?? frame.mediaTime) <= (previous.presentedFrames ?? previous.mediaTime)) { s.performance.duplicates++; return; }
          s.latestCameraFrame = frame;
          s.performance.camera(frame.at, frame.presentedFrames);
          const decision = s.frameGate.observe(frame.presentedFrames ?? frame.mediaTime, s.pending);
          if (decision === 'duplicate') { s.performance.duplicates++; return; }
          if (decision === 'busy') { s.performance.dropped++; return; }
          s.sensorCaptureTime = frame.captureTime; void submit(v, true, generation);
        });
        return;
      }
      const loop = () => {
        if (generation !== s.generation) return;
        paint();
        if (v.readyState >= 2 && !s.pending && v.currentTime !== s.lastTime) { s.lastTime = v.currentTime; void submit(v, true, generation); }
        s.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      if (generation !== s.generation) return;
      stop();
      const name = e instanceof Error ? e.name : '';
      setError(name === 'NotAllowedError' ? 'Bạn chưa cấp quyền camera. Cho phép camera trong cài đặt trình duyệt, hoặc tải ảnh lên.' : name === 'NotFoundError' ? 'Không tìm thấy camera. Bạn có thể tải ảnh lên để thử.' : name === 'NotReadableError' ? 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó và thử lại.' : e instanceof Error ? e.message : 'Không thể mở camera. Hãy thử tải ảnh lên.');
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Vui lòng chọn ảnh JPG, PNG hoặc WebP.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('Ảnh quá lớn. Vui lòng chọn ảnh dưới 20 MB.'); return; }
    stop(); setError(''); setBusy(true);
    const s = state.current, generation = s.generation;
    try {
      const image = new Image(); s.url = URL.createObjectURL(file); image.src = s.url; await image.decode();
      if (generation !== s.generation) return;
      s.image = image; s.source = 'image'; setSource('image'); paint();
      await initialize(generation);
      if (generation === s.generation) await submit(image, false, generation);
    } catch { if (generation === s.generation) { stop(); setError('Không mở được ảnh hoặc mô hình AI. Thử ảnh khác và kiểm tra tệp mô hình.'); } }
  };

  const save = () => {
    if (state.current.source === 'empty' || !canvas.current) return;
    paint(); canvas.current.toBlob(blob => {
      if (!blob) { setError('Không lưu được ảnh. Vui lòng thử lại.'); return; }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `mira-${mode}-${Date.now()}.png`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setSaved(true);
    }, 'image/png');
  };
  const exportDebug = () => {
    const s = state.current, settings = appearance.current;
    const effective = imageRenderFit(settings.scale, s.source === 'image' && (s.sizing?.method === 'image' || s.sizing?.method === 'manual-edges'));
    const values = s.sizing ? sizingDebug(s.sizing.reference, settings.scale, canvas.current?.width ?? 1, s.sizing.measurement, s.sizing.method, s.sizing.message, effective) : null;
    setDebugCount(debugLog.current.append(debugSample(performance.now(), s.tracking, values, settings.scale)));
    const url = URL.createObjectURL(new Blob([debugLog.current.serialize()], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `mira-wrist-debug-${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const beginCalibration = () => {
    const s = state.current; if (s.source !== 'image' || !s.imagePose) return;
    s.pickingEdges = !s.pickingEdges; s.picked = [];
    setCalibration({ picking: s.pickingEdges, count: 0, message: s.pickingEdges ? 'Chọn lần lượt hai mép da ở cùng một đường ngang cổ tay. Không chọn mép vòng.' : '' }); paint();
  };
  const clearCalibration = () => {
    const s = state.current; s.manualEdges = null; s.pickingEdges = false; s.picked = [];
    setCalibration({ picking: false, count: 0, message: '' });
    if (s.lastDetection) { updateWrist(s.lastDetection); paint(); }
  };
  const pickWristEdge = (event: { clientX: number; clientY: number }) => {
    const s = state.current, c = canvas.current;
    if (!s.pickingEdges || !s.image || !s.imagePose || !c) return;
    const dimensions = { width: s.image.naturalWidth, height: s.image.naturalHeight };
    const p = clientToImagePoint(c.getBoundingClientRect(), c, dimensions, event.clientX, event.clientY);
    if (!p) return;
    s.picked.push(p);
    if (s.picked.length === 2) {
      const pair = s.picked as [ImagePoint, ImagePoint], result = manualImageWrist(s.imagePose, pair, dimensions);
      if (result.measurement.width === null) { s.picked = []; setCalibration({ picking: true, count: 0, message: result.measurement.reason }); paint(); return; }
      s.manualEdges = [...pair]; s.pickingEdges = false; s.picked = [];
      setCalibration({ picking: false, count: 2, message: 'Đã chọn hai mép. Bề rộng này là calibration thủ công, không phải Auto Fit.' });
      if (s.lastDetection) updateWrist(s.lastDetection);
    } else setCalibration({ picking: true, count: 1, message: 'Đã chọn mép thứ nhất; chọn mép đối diện trên cùng đường ngang cổ tay.' });
    paint();
  };
  return { canvas, video, fileInput, source, busy, detected, error, latency, saved, trackingHint, tracking, sizing, startCamera, stop, upload, save, exportDebug, debugCount, calibration, canCalibrate: source === 'image' && !!state.current.imagePose, beginCalibration, clearCalibration, pickWristEdge };
}
