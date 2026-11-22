/** Kiểm tra đầu vào trước khi đóng phiên đang hoạt động. */
export function imageInputError(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Vui lòng chọn ảnh JPG, PNG hoặc WebP.';
  if (file.size > 20 * 1024 * 1024) return 'Ảnh quá lớn. Vui lòng chọn ảnh dưới 20 MB.';
  return null;
}

/** Caller sở hữu URL ngay khi hàm trả về và phải thu hồi khi đóng phiên. */
export function createImageInput(file: File, rememberUrl: (url: string) => void) {
  const image = new Image(), url = URL.createObjectURL(file);
  rememberUrl(url);
  image.src = url;
  return image;
}
