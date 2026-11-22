
/** Mỗi frame decode chỉ được suy luận một lần. Khi bận chỉ giữ metadata mới nhất; callback lấy video hiện tại, không giữ hàng đợi bitmap cũ. */
export class LiveFrameGate {
  private lastTime = -Infinity;
  private newestTime = -Infinity;
  reset() { this.lastTime = this.newestTime = -Infinity; }
  observe(mediaTime: number, busy: boolean): 'ready' | 'busy' | 'duplicate' {
    if (!Number.isFinite(mediaTime) || mediaTime <= this.lastTime || mediaTime < this.newestTime) return 'duplicate';
    this.newestTime = mediaTime;
    if (busy) return 'busy';
    this.lastTime = mediaTime; return 'ready';
  }
}

export type CameraFrame = { at: number; mediaTime: number; presentedFrames?: number; captureTime?: number };

export class LiveFrameClock {
  private id = 0;
  private active = false;
  private video: HTMLVideoElement | null = null;
  private native = false;
  private generation = 0;
  start(video: HTMLVideoElement, onFrame: (frame: CameraFrame) => void) {
    this.stop(); this.active = true; this.video = video;
    const generation = this.generation;
    this.native = typeof video.requestVideoFrameCallback === 'function';
    const next = () => {
      if (!this.active || generation !== this.generation) return;
      if (this.native) this.id = video.requestVideoFrameCallback((at, meta) => { if (!this.active || generation !== this.generation) return; onFrame({ at, mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames, captureTime: meta.captureTime }); next(); });
      else this.id = requestAnimationFrame(at => { if (!this.active || generation !== this.generation) return; const count = video.getVideoPlaybackQuality?.().totalVideoFrames; onFrame({ at, mediaTime: video.currentTime, presentedFrames: count && count > 0 ? count : undefined }); next(); });
    }; next();
  }
  stop() { this.active = false; this.generation++; if (this.video) { if (this.native) this.video.cancelVideoFrameCallback(this.id); else cancelAnimationFrame(this.id); } this.video = null; this.id = 0; }
}
