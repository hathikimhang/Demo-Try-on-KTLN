import type { Point } from '../../shared/types/vision';
import { createBraceletState } from '../../features/bracelet/controllers/braceletRuntime';
export function createTryOnRuntime() {
  return {
    worker: null as Worker | null,
    stream: null as MediaStream | null,
    image: null as HTMLImageElement | null,
    frame: null as ImageBitmap | null,
    points: [] as Point[],
    receivedAt: 0,
    capturedAt: 0,
    raf: 0,
    generation: 0,
    pending: false,
    source: 'empty',
    lastTime: -1,
    url: '',
    timeout: 0,
    ...createBraceletState()
  };
}
export type TryOnRuntime = ReturnType<typeof createTryOnRuntime>;
