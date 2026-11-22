import type { Point } from '../../../shared/types/vision';
import { smoothPoints } from '../models/clothingGeometry';

export { drawProduct } from '../views/rendering/clothingRenderer';

export function trackClothingPoints(previous: Point[], next: Point[]) {
  return smoothPoints(previous, next);
}

/** Giữ đúng các landmark và ngưỡng visibility của luồng áo hiện tại. */
export function clothingDetected(pixels: Point[]) {
  return pixels.length >= 25 && [11, 12, 23, 24].every(i => (pixels[i].visibility ?? 1) >= 0.45);
}
