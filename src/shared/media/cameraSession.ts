/** Quyền truy cập và giải phóng stream dùng chung cho hai loại sản phẩm. */
export async function requestCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera cần HTTPS hoặc localhost và trình duyệt có hỗ trợ webcam.');
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
}

export function releaseCameraStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
}
