/** Xuất Blob cục bộ; không gửi dữ liệu lên server. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveCanvasPng(canvas: HTMLCanvasElement, filename: string, onSaved: () => void, onError: (message: string) => void) {
  canvas.toBlob(blob => {
    if (!blob) { onError('Không lưu được ảnh. Vui lòng thử lại.'); return; }
    downloadBlob(blob, filename); onSaved();
  }, 'image/png');
}
