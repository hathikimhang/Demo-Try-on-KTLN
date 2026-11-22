/** Bắt đầu ghép khung; caller vẽ layer và gọi ctx.restore() khi kết thúc.
 * Chỉ lật composition webcam một lần, giữ nguyên hệ tọa độ của ảnh tải lên. */
export function beginCanvasFrame(ctx: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number, mirror: boolean) {
  const c = ctx.canvas, ratio = Math.min(1, 1600 / Math.max(width, height));
  if (c.width !== Math.round(width * ratio) || c.height !== Math.round(height * ratio)) {
    c.width = Math.round(width * ratio); c.height = Math.round(height * ratio);
  }
  ctx.clearRect(0, 0, c.width, c.height); ctx.save();
  if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(image, 0, 0, c.width, c.height);
}
