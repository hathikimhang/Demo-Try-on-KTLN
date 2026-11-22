import { requestCameraStream, releaseCameraStream } from '../../shared/media/cameraSession';
import { createImageInput, imageInputError } from '../../shared/media/imageInput';
import { saveCanvasPng } from '../../shared/browser/exportFile';
import { createTryOnRuntime } from '../services/tryOnRuntime';
import { paintTryOn } from '../services/paintTryOn';
import { initializeVisionWorker, submitVisionFrame } from '../services/VisionWorkerClient';
import type { ApplicationBindings } from './controllerBindings';
import { updateBracelet } from '../../features/bracelet/controllers/braceletController';
import { submitLatestCamera as submitLatestLiveCamera, startLiveRendering, startLiveAcquisition } from '../../features/bracelet/controllers/liveBraceletController';
import { beginCalibration as beginCalibrationAction, clearCalibration as clearCalibrationAction, pickWristEdge as pickWristEdgeAction, exportDebug as exportDebugAction } from '../../features/bracelet/controllers/uploadBraceletController';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode } from '../../shared/types/tryOn';

import type { TrackingMode } from '../../features/bracelet/models/wrist.types';

import { emptyTracking } from '../../features/bracelet/models/tracking.types';

import type { TrackingSnapshot } from '../../features/bracelet/models/tracking.types';

import type { SizingDebug } from '../../features/bracelet/models/fitting.types';

import { WristDebugLog } from '../../features/bracelet/services/diagnostics/wristDiagnostics';

type Detection = import('../../features/bracelet/models/vision.types').BraceletDetection;

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
  const [state] = useState(() => ({ current: createTryOnRuntime() }));
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
  const updateWrist = useCallback((data: Detection) => { if (mode === 'bracelet') updateBracelet(bindings, data); }, [mode]);

  const paint = useCallback(() => { paintTryOn(bindings); }, [mode]);

  const stop = useCallback(() => {
    const s = state.current;
    s.generation++; cancelAnimationFrame(s.raf); s.frameClock.stop(); s.frameGate.reset(); clearTimeout(s.timeout);
    releaseCameraStream(s.stream); s.stream = null;
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
    // Video sẽ fit lại ở lần suy luận tiếp theo; ảnh tĩnh cần yêu cầu fit lại riêng.
    // Hai nhánh đều giữ nguyên bộ ước lượng orientation và mức hiệu chỉnh của người dùng.
    if (s.source === 'image' && s.lastDetection) { updateWrist(s.lastDetection); paint(); }
    else if (s.source === 'camera') { s.wrist = null; s.sizing = null; setSizing(null); setDetected(false); paint(); }
  }, [autoFit, mode, updateWrist, paint]);
  useEffect(() => {
    const s = state.current; s.filter.reset(); s.roi.reset(); s.live.reset(); s.forearm.reset(); s.frameBuffer.clear(); s.presentation = 'hidden';
    if (s.lastDetection) { updateWrist(s.lastDetection); paint(); }
    // Ảnh tĩnh không có vòng lặp camera để yêu cầu chế độ nhận diện mới.
    if (s.image && s.worker && s.lastDetection) void submit(s.image, false, s.generation);
  }, [trackingMode, updateWrist, paint]);

  const initialize = (generation: number) => initializeVisionWorker(bindings, generation);

  const submit = (image: HTMLVideoElement | HTMLImageElement, isVideo: boolean, generation: number) => submitVisionFrame(bindings, image, isVideo, generation);

  const submitLatestCamera = (generation: number) => { submitLatestLiveCamera(bindings, generation); };

  const startCamera = async () => {
    stop(); setError(''); setBusy(true);
    const s = state.current, generation = s.generation;
    try {
      const stream = await requestCameraStream();
      if (generation !== s.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      s.stream = stream;
      stream.getVideoTracks()[0].onended = () => { stop(); setError('Camera đã bị ngắt kết nối. Vui lòng bật lại.'); };
      const v = video.current!; v.srcObject = stream; await v.play();
      if (generation !== s.generation) return;
      s.source = 'camera'; setSource('camera'); paint();
      const liveCamera = mode === 'bracelet';
      if (liveCamera) {
        startLiveRendering(bindings, generation);
      }
      await initialize(generation);
      if (generation !== s.generation) return;
      setBusy(false);
      if (liveCamera) {
        startLiveAcquisition(bindings, generation);
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
    const inputError = imageInputError(file);
    if (inputError) { setError(inputError); return; }
    stop(); setError(''); setBusy(true);
    const s = state.current, generation = s.generation;
    try {
      const image = createImageInput(file, url => { s.url = url; }); await image.decode();
      if (generation !== s.generation) return;
      s.image = image; s.source = 'image'; setSource('image'); paint();
      await initialize(generation);
      if (generation === s.generation) await submit(image, false, generation);
    } catch { if (generation === s.generation) { stop(); setError('Không mở được ảnh hoặc mô hình AI. Thử ảnh khác và kiểm tra tệp mô hình.'); } }
  };

  const save = () => {
    if (state.current.source === 'empty' || !canvas.current) return;
    paint(); saveCanvasPng(canvas.current, `mira-${mode}-${Date.now()}.png`, () => setSaved(true), setError);
  };
  const exportDebug = () => { exportDebugAction(bindings); };
  const beginCalibration = () => { beginCalibrationAction(bindings); };
  const clearCalibration = () => { clearCalibrationAction(bindings); };
  const pickWristEdge = (event: { clientX: number; clientY: number }) => { pickWristEdgeAction(bindings, event); };
  const bindings: ApplicationBindings = { state, appearance, canvas, video, debugLog, mode, setTracking, setSizing, setDetected, setTrackingHint, setDebugCount, setCalibration, setError, setLatency, setBusy, setSaved, setSource, paint, updateWrist, publishLive, submit, submitLatestCamera, stop };
  return { canvas, video, fileInput, source, busy, detected, error, latency, saved, trackingHint, tracking, sizing, startCamera, stop, upload, save, exportDebug, debugCount, calibration, canCalibrate: source === 'image' && !!state.current.imagePose, beginCalibration, clearCalibration, pickWristEdge };
}
