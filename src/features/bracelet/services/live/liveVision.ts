import { analyzeWrist } from '../geometry/wristGeometry';
import type { TrackingMode } from '../../models/wrist.types';
import { LiveForearmEstimator } from './liveForearmPose';
import { measureForearmContour } from './liveForearmContour';
import { measureImageWrist, wristImageRoi } from '../measurement/imageWristMeasurement';
import { measureSegmentedWrist } from '../measurement/segmentedWristMeasurement';
import type { LiveObservationInput, LiveObservation } from '../../models/vision.types';
/** Giữ chuỗi observation Live trên CÙNG bitmap. Chỉ chuyển pixel/forearm work khỏi UI thread, không đổi tracking, sizing, filter hay material. Upload và áo không khởi tạo processor này. */
export class LiveVision {
  private forearm = new LiveForearmEstimator();
  private mode: TrackingMode | null = null;
  private sample = new OffscreenCanvas(1, 1);
  private native = new OffscreenCanvas(1, 1);
  private sampleContext = this.sample.getContext('2d', { willReadFrequently: true });
  private nativeContext = this.native.getContext('2d', { willReadFrequently: true });
  get supported() { return !!this.sampleContext && !!this.nativeContext; }
  observe(frame: ImageBitmap, input: LiveObservationInput): LiveObservation {
    const { points, worldPoints, armPoints, armWorldPoints, handedness, timestamp, mode, skin } = input;
    if (mode !== this.mode) { this.forearm.reset(); this.mode = mode; }
    const aspect = frame.height / frame.width;
    const hand = analyzeWrist(points, worldPoints, aspect, handedness, { mode: 'straight-wrist', deferAxialCheck: true });
    const arm = armPoints.length ? analyzeWrist(points, worldPoints, aspect, handedness, { mode: 'forearm', armPoints, armWorldPoints }) : null;
    const raw = hand.pose ?? (hand.reason === 'axial-view' ? arm?.pose : null);
    const out: LiveObservation = { hand, pose: raw ? { ...raw, source: mode } : null, orientation: null, contour: null, measurement: { width: null, confidence: 0, reason: 'Không có phép đo biên hợp lệ trên frame này.' }, mask: null, pixels: null, needsArmObservation: false };
    const factor = Math.min(1, 640 / Math.max(frame.width, frame.height)), sw = Math.round(frame.width * factor), sh = Math.round(frame.height * factor);
    if (this.sample.width !== sw || this.sample.height !== sh) { this.sample.width = sw; this.sample.height = sh; }
    this.sampleContext!.drawImage(frame, 0, 0, sw, sh);
    const pixels = this.sampleContext!.getImageData(0, 0, sw, sh); out.pixels = { width: sw, height: sh, data: pixels.data };
    if (out.pose) {
      try {
        const region = wristImageRoi(out.pose, frame.width, frame.height, points[0]);
        if (this.native.width !== region.width || this.native.height !== region.height) { this.native.width = region.width; this.native.height = region.height; }
        this.nativeContext!.drawImage(frame, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
        const native = { ...region, data: this.nativeContext!.getImageData(0, 0, region.width, region.height).data };
        const semanticContour = skin ? measureForearmContour(native, out.pose, points[0], skin) : null;
        out.contour = semanticContour?.direction ? semanticContour : measureForearmContour(native, out.pose, points[0]);
        const quality = (arm?.metrics.armVisibility ?? 0) * Math.max(0, 1 - (arm?.metrics.fitResidual ?? 1));
        out.orientation = this.forearm.update(out.pose, out.contour, timestamp, arm?.pose, quality);
        out.pose = out.orientation.pose;
        if (out.pose) {
          const semantic = skin ? measureSegmentedWrist(native, out.pose, skin, points[0]) : null;
          const rgb = semantic?.measurement.width != null ? null : measureImageWrist(native, out.pose, points[0], true, 0, true);
          out.measurement = semantic?.measurement.width != null ? semantic.measurement : rgb!.measurement;
          out.mask = semantic?.mask ?? rgb?.mask ?? null;
        }
      } catch { out.pose = null; out.measurement = { width: null, confidence: 0, reason: 'Không phân tích được ROI trên frame webcam.' }; }
    } else this.forearm.missing(timestamp);
    out.needsArmObservation = this.forearm.needsArmObservation;
    return out;
  }
}
