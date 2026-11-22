import { downloadBlob } from '../../../shared/browser/exportFile';
import { wristViewAngle } from '../services/tracking/trackingPolicy';
import { trackingMessage, uploadTrackingMessage } from '../views/trackingMessages';
import type { TrackingSource, RoiResult } from '../models/tracking.types';
import { measureWristWidth } from '../services/measurement/wristBoundaryMeasurement';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
import type { WidthMeasurement } from '../models/fitting.types';
import { debugSample } from '../services/diagnostics/wristDiagnostics';
import { BRACELET_ASSET, imageRenderFit } from '../models/braceletDimensions';
import { manualImageWrist, measureImageWrist, wristImageRoi } from '../services/measurement/imageWristMeasurement';
import { clientToImagePoint } from '../models/imageCoordinates';
import type { ImagePoint } from '../models/imageCoordinates';
import { measureSegmentedWrist } from '../services/measurement/segmentedWristMeasurement';
import { registerImageWrist } from '../services/fitting/imageWristRegistration';
import type { BraceletBindings, WristPreparation } from './braceletRuntime';
import type { BraceletDetection as Detection } from '../models/vision.types';
export function updateUploadBracelet(bindings: BraceletBindings, data: Detection, prepared: WristPreparation) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;
  const { aspect, modeOption, analysis, stale, mismatch, pixels } = prepared; const s = state.current;

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
        // Segmentation có thể cung cấp mask occlusion hợp lệ dù biên pixel gốc
        // chưa đủ rõ để đo kích thước; giữ hai quyết định này độc lập.
        measurement = result.measurement.width !== null ? result.measurement : semantic?.measurement ?? result.measurement;
        s.imageMask = semantic?.mask ?? result.mask;
        imageRegistration = registerImageWrist(s.wrist, semantic?.measurement ?? measurement);
      } catch { /* Đọc ROI native thất bại; không thay bằng ảnh đã scale. */ }
      if (s.manualEdges) {
        const manual = manualImageWrist(s.imagePose, s.manualEdges, { width: iw, height: ih });
        measurement = manual.measurement;
        // Chỉ giữ foreground mask đã kiểm chứng; click thủ công không tạo mask giả.
      }
      if (measurement.image) measurement.image.maskAvailable = !!s.imageMask;
      // Registration là bước vị trí ảnh độc lập đã được kiểm tra; sizing
      // không được cung cấp quaternion hoặc thay đổi transform nhận diện gốc.
      s.wrist = imageRegistration; s.renderPose = imageRegistration;
    }
    const fitted = s.sizer.update(s.wrist, measurement, data.timestamp, { input: s.source === 'image' ? 'image' : 'camera', auto: appearance.current.autoFit, video: s.source === 'camera', policy: BRACELET_ASSET.fitting, trackingSource: trackingSource === 'ROI' ? 'ROI' : 'Hand' });
    s.wrist = fitted.pose; s.sizing = { method: fitted.method, message: fitted.message, measurement, reference: fitted.pose ?? trackedPose! };
    if (trackingSource !== 'ROI') {
      // Chỉ seed feature trong vùng cổ tay đang được quan sát và hợp lý.
      // Vòng được chỉnh lớn bằng tay không được làm rộng ROI da hoặc proxy.
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

  setTracking(s.tracking);
  setTrackingHint(s.source === 'image' ? uploadTrackingMessage(reason, data.points.length > 0, s.sizing ?? undefined) : reason === 'sizing' && s.sizing ? s.sizing.message : roi ? roi.reason : trackingMessage(reason));

  setDetected(s.tracking.state === 'tracking');

  if (appearance.current.debug) {
    const width = canvas.current?.width ?? 0;
    const renderFit = imageRenderFit(appearance.current.scale, s.source === 'image' && (s.sizing?.method === 'image' || s.sizing?.method === 'manual-edges'));
    const values = s.sizing ? sizingDebug(s.sizing.reference, appearance.current.scale, width, s.sizing.measurement, s.sizing.method, s.sizing.message, renderFit) : null;
    setDebugCount(debugLog.current.append(debugSample(data.timestamp, s.tracking, values, appearance.current.scale)));
  }
}
export function beginCalibration(bindings: BraceletBindings) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;

  const s = state.current; if (s.source !== 'image' || !s.imagePose) return;
  s.pickingEdges = !s.pickingEdges; s.picked = [];
  setCalibration({ picking: s.pickingEdges, count: 0, message: s.pickingEdges ? 'Chọn lần lượt hai mép da ở cùng một đường ngang cổ tay. Không chọn mép vòng.' : '' }); paint();

}
export function clearCalibration(bindings: BraceletBindings) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;

  const s = state.current; s.manualEdges = null; s.pickingEdges = false; s.picked = [];
  setCalibration({ picking: false, count: 0, message: '' });
  if (s.lastDetection) { updateWrist(s.lastDetection); paint(); }

}
export function pickWristEdge(bindings: BraceletBindings, event: { clientX: number; clientY: number }) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;

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

}
export function exportDebug(bindings: BraceletBindings) {
  const { state, appearance, canvas, video, debugLog, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, paint, updateWrist, publishLive, submit } = bindings;

  const s = state.current, settings = appearance.current;
  const effective = imageRenderFit(settings.scale, s.source === 'image' && (s.sizing?.method === 'image' || s.sizing?.method === 'manual-edges'));
  const values = s.sizing ? sizingDebug(s.sizing.reference, settings.scale, canvas.current?.width ?? 1, s.sizing.measurement, s.sizing.method, s.sizing.message, effective) : null;
  setDebugCount(debugLog.current.append(debugSample(performance.now(), s.tracking, values, settings.scale)));
  downloadBlob(new Blob([debugLog.current.serialize()], { type: 'application/json' }), `mira-wrist-debug-${Date.now()}.json`);
}
