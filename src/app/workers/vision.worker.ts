/// <reference lib="webworker" />
import { HandLandmarker, PoseLandmarker, ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Mode } from '../../shared/types/tryOn';
import { LiveVision } from '../../features/bracelet/services/live/liveVision';
import type { SkinSegmentation } from '../../shared/types/vision';
import { LIVE_PIPELINE_VERSION } from '../../features/bracelet/models/liveContinuity';
// MediaPipe dùng self.import khi importScripts bị từ chối trong ES Worker.
// prepare-assets cung cấp WASM factory trên globalThis cho đường import này.
(self as unknown as { import: (url: string) => Promise<unknown> }).import = async url => {
  const module = await import(/* @vite-ignore */ url);
  // Module import được cache; cần khôi phục factory cho từng WASM instance
  // của Hand/Pose, không dựa vào tác dụng phụ chỉ chạy một lần khi import.
  (self as unknown as { ModuleFactory: unknown }).ModuleFactory = module.ModuleFactory;
  return module;
};

// Logger WASM của thư viện khai báo fallback trong một block; strict mode
// của ES module giới hạn phạm vi đó, nên cần cung cấp logger global tương ứng.
(globalThis as unknown as { custom_dbg: (...args: unknown[]) => void }).custom_dbg = (...args) => console.debug(...args);

let detector: HandLandmarker | PoseLandmarker | undefined;

let armDetector: PoseLandmarker | undefined;

let assetBase = '';

let runningMode: 'IMAGE' | 'VIDEO' = 'IMAGE';

let skinDetector: ImageSegmenter | undefined;

let productMode: Mode = 'bracelet';

let armRetryAfter = 0;

let liveVision: LiveVision | undefined;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const mode: Mode = data.mode;
      productMode = mode;
      assetBase = data.base;
      const fileset = await FilesetResolver.forVisionTasks(`${data.base}wasm`);
      const options = { baseOptions: { modelAssetPath: `${data.base}models/${mode === 'bracelet' ? 'hand' : 'pose'}.task`, delegate: 'CPU' as const }, runningMode, minTrackingConfidence: 0.5 };
      detector = mode === 'bracelet'
        ? await HandLandmarker.createFromOptions(fileset, { ...options, numHands: 1, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5 })
        : await PoseLandmarker.createFromOptions(fileset, { ...options, numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, outputSegmentationMasks: false });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      const bitmap: ImageBitmap = data.bitmap;
      try {
        if (!detector) throw new Error('Mô hình chưa sẵn sàng.');
        const next = data.video ? 'VIDEO' : 'IMAGE';
        if (next !== runningMode) { await detector.setOptions({ runningMode: next }); await armDetector?.setOptions({ runningMode: next }); runningMode = next; }
        const start = performance.now();
        const result = data.video ? detector.detectForVideo(bitmap, data.timestamp) : detector.detect(bitmap);
        const handEnd = performance.now();
        // Live cận cảnh có thể yêu cầu các quan sát Pose bổ sung theo nhịp;
        // Upload giữ nguyên hành vi theo chế độ đã yêu cầu.
        const wantArm = !(data.video && data.deferArm) && (data.needArm || (data.video && data.observeArm));
        const observeArm = async () => {
        if (wantArm && result.landmarks.length && detector instanceof HandLandmarker && !armDetector) {
          const fileset = await FilesetResolver.forVisionTasks(`${assetBase}wasm`);
          armDetector = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${assetBase}models/pose.task`, delegate: 'CPU' },
            runningMode, numPoses: 1, minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6,
            minTrackingConfidence: 0.6, outputSegmentationMasks: false,
          });
        }
        // Khi task đã nạp, vẫn quan sát cẳng tay nếu Hand tạm thời mất nhận diện.
        // Pose riêng lẻ không cung cấp twist cổ tay; UI không được tự tạo dữ liệu này.
        return wantArm && armDetector ? (data.video ? armDetector.detectForVideo(bitmap, data.timestamp) : armDetector.detect(bitmap)) : undefined;
        };
        let arm: Awaited<ReturnType<typeof observeArm>>;
        let armStatus = data.video && data.deferArm ? 'deferred' : wantArm ? 'no-arm' : 'not-requested';
        if (data.video && productMode === 'bracelet') {
          if (wantArm && performance.now() >= armRetryAfter) try {
            arm = await observeArm(); if (arm?.landmarks.length) armStatus = 'observed';
          } catch (error) {
            // Pose chỉ là nguồn bổ sung cho Live; lỗi model, tải tệp hoặc suy luận
            // không được đóng Hand detector hay phiên camera đang hoạt động.
            armStatus = 'unavailable'; armRetryAfter = performance.now() + 5000;
            try { armDetector?.close(); } catch { /* Task có thể đã được đóng. */ }
            armDetector = undefined; console.warn('Optional Live Pose unavailable:', error);
          }
          else if (wantArm) armStatus = 'unavailable';
        } else arm = await observeArm(); // Giữ cách xử lý lỗi hiện tại của Upload và áo.
        const armEnd = performance.now();
        let skin: SkinSegmentation | undefined;
        // Upload giữ nguyên hành vi; Live yêu cầu các quan sát thưa nhưng đúng khung,
        // không tái sử dụng mask của khung cũ trên khung mới.
        if ((!data.video || data.measureSkin) && productMode === 'bracelet' && result.landmarks.length) {
          try {
            skinDetector ??= await ImageSegmenter.createFromOptions(await FilesetResolver.forVisionTasks(`${assetBase}wasm`), {
              baseOptions: { modelAssetPath: `${assetBase}models/skin.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
            });
            if (skinDetector.getLabels()[2] !== 'body-skin') throw new Error('Unsupported segmentation labels');
            skinDetector.segment(bitmap, result => {
              const mask = result.confidenceMasks?.[2];
              if (mask) skin = { width: mask.width, height: mask.height, confidence: new Float32Array(mask.getAsFloat32Array()) };
            });
          } catch (error) { console.warn('Optional upload segmentation unavailable:', error); }
        }
        const skinEnd = performance.now();
        // Phép toán observation, ngưỡng và độ phân giải gốc được giữ nguyên khi
        // chạy trong Worker; trình duyệt cũ vẫn có fallback trên main thread.
        if (data.video && productMode === 'bracelet' && typeof OffscreenCanvas !== 'undefined') liveVision ??= new LiveVision();
        const liveObservation = data.video && productMode === 'bracelet' && liveVision?.supported ? liveVision.observe(bitmap, {
          points: result.landmarks[0] ?? [], worldPoints: result.worldLandmarks[0] ?? [],
          armPoints: arm?.landmarks[0] ?? [], armWorldPoints: arm?.worldLandmarks[0] ?? [],
          handedness: 'handedness' in result ? result.handedness[0]?.[0]?.categoryName ?? '' : '',
          timestamp: data.timestamp, mode: data.needArm ? 'forearm' : 'straight-wrist', skin,
        }) : undefined;
        const reply = {
          type: 'result', points: result.landmarks[0] ?? [], worldPoints: result.worldLandmarks[0] ?? [],
          handedness: 'handedness' in result ? result.handedness[0]?.[0]?.categoryName ?? '' : '',
          armPoints: arm?.landmarks[0] ?? [], armWorldPoints: arm?.worldLandmarks[0] ?? [],
          elapsed: performance.now() - start, timestamp: data.timestamp, trackingMode: data.needArm ? 'forearm' : 'straight-wrist',
          skin: liveObservation ? undefined : skin,
          liveObservation,
          timings: { handMs: handEnd - start, armMs: armEnd - handEnd, skinMs: skinEnd - armEnd, observationMs: performance.now() - skinEnd },
          armStatus, pipelineVersion: LIVE_PIPELINE_VERSION,
          // Trả về đúng khung đã suy luận. Vẽ video mới với landmark cũ
          // làm vòng trượt ngay cả khi hình học được tính đúng.
          frame: data.video ? bitmap : undefined,
        };
        self.postMessage(reply, [...(data.video ? [bitmap] : []), ...(!liveObservation && skin ? [skin.confidence.buffer] : []), ...(liveObservation?.pixels ? [liveObservation.pixels.data.buffer] : []), ...(liveObservation?.mask ? [liveObservation.mask.data.buffer] : [])]);
      } finally { bitmap.close(); }
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
