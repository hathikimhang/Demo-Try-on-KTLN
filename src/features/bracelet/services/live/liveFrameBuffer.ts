import type { Point } from '../../../../shared/types/vision';
import type { WristPose, LiveOrientation, ForearmContour } from '../../models/wrist.types';
import type { FitMethod, WidthMeasurement } from '../../models/fitting.types';
import type { ImageMask } from '../../models/imageCoordinates';
import { isFrameUsable } from '../tracking/trackingPolicy';
export type LiveFrameSnapshot = {
  image: HTMLCanvasElement; pose: WristPose; renderPose: WristPose;
  points: Point[]; mask: ImageMask | null; orientation: LiveOrientation | null;
  contour: ForearmContour | null;
  sizing: { method: FitMethod; message: string; measurement: WidthMeasurement; reference: WristPose };
  capturedAt: number; receivedAt: number; validUntil: number;
};


/** Chỉ một khung raw trong bộ nhớ trình duyệt. Trong grace vẫn đổi màu/Manual Fit được bằng cặp ảnh/pose/mask cũ khớp nhau. Không sao chép DOM UI hoặc gửi pixel lên server. */
export class LiveFrameBuffer {
  private canvas: HTMLCanvasElement | null = null;
  snapshot: LiveFrameSnapshot | null = null;
  capture(frame: ImageBitmap, data: Omit<LiveFrameSnapshot, 'image'>) {
    const canvas = this.canvas ?? (this.canvas = document.createElement('canvas'));
    if (canvas.width !== frame.width || canvas.height !== frame.height) { canvas.width = frame.width; canvas.height = frame.height; }
    const ctx = canvas.getContext('2d'); if (!ctx) { this.snapshot = null; return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(frame, 0, 0);
    this.snapshot = { ...data, image: canvas };
  }
  read(now: number, holdUntil: number) {
    const s = this.snapshot;
    return s && now < holdUntil && now < s.validUntil && isFrameUsable(s.capturedAt, s.receivedAt, now) ? s : null;
  }
  clear() { if (this.canvas) { this.canvas.width = this.canvas.height = 0; } this.canvas = null; this.snapshot = null; }
}
