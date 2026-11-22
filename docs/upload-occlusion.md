# Upload Image: kiểm tra vòng khép kín, Auto Fit và occlusion

Ảnh người dùng đã gửi trong chat nhưng chưa có đường dẫn/tệp gốc mà tiến trình Node có thể đọc. **Các số liệu và ảnh A/B dưới đây là ảnh mẫu MediaPipe, không phải ảnh người dùng vừa đính kèm. Chưa nghiệm thu trên đúng ảnh đó.**

## Đã xác nhận

- Model là torus 360°; kiểm thử manifold không có mép mở. Không thay mesh, đá, material PBR hoặc các hằng số sản phẩm.
- A/B giữ cùng pose, scale, camera và màu; chỉ đổi occlusion. A hiển thị nguyên vòng và không có pixel chạm mép viewport. B dùng depth testing trên vùng mask da. Phần sau tay có thể không nhìn thấy trong ảnh 2D dù geometry vẫn khép kín.
- `too-few-slices` trên `woman_hands` do bộ đo màu cũ loại cả 15 lát cắt: yêu cầu hai bên nền tương tự nhau không phù hợp khi có mặt và áo ở hai phía.
- Tâm từ Hand trên ảnh đó khoảng (281,6; 683,9) px, trong khi trung điểm hai mép da được xác nhận là (285,3; 663,3) px. Proxy đặt lệch và không được mask có thể tạo đầu vòng/cast shadow sai chỗ.

## Sửa có trọng tâm

1. Worker chỉ chạy **MediaPipe Selfie Multiclass** cho ảnh tĩnh vòng tay. Dùng lớp `body-skin`, tách khỏi mặt/áo. Camera và thử áo không chạy thêm segmentation.
2. `segmentedWristMeasurement.ts` dùng probability map hướng dẫn vùng tìm biên; biên được kiểm tra lại bằng RGB ảnh gốc. Cần ít nhất 5 lát cắt nhất quán, core da đủ tin cậy, cả hai biên native/semantic đồng thuận và chất lượng tổng đạt ngưỡng. Không nới confidence Hand hoặc gán measured chỉ từ model.
3. `imageWristRegistration.ts` là tầng đăng ký vị trí riêng: chỉ dịch XY khi có hai mép semantic/native đáng tin cậy và >=5 lát cắt; giữ nguyên quaternion, Z, camera và raw tracking. Dịch quá nửa bề rộng hoặc dữ liệu yếu sẽ giữ pose cũ. Sizing chỉ điều chỉnh radius qua phép chiếu hiện có.
4. Mask occlusion được quyết định độc lập việc sizing thành công. Proxy chỉ che trên foreground quan sát được; không để hình trụ ước lượng ghi depth ra nền khi có mask.
5. Bóng proxy trên ảnh được giới hạn gần mặt phẳng vòng theo bán kính ống torus (0,11–0,22 đơn vị model), tránh mảng bóng dài. Không chỉnh PBR/material của vòng, ánh sáng hoặc bóng webcam.
6. Manual Fit không bắt buộc cho các ca đạt điều kiện: thử ở 100%. Vẫn giữ giá trị người dùng nhập, không nhân lặp qua frame. Chính sách giới hạn collision 85% có từ trước giữ nguyên. Đã phát hiện giá trị Manual Fit mặc định trong App.tsx là 1,2 (120%); sửa duy nhất giá trị đó về 1 (100%) để không phóng thêm 20% lên kết quả Auto Fit.

## Kết quả trên ảnh mẫu, Manual 100%

| Ảnh | Wrist width (px gốc) | Lỗ vòng chiếu (px gốc) | Auto Fit | Tâm vòng (px gốc) |
|---|---:|---:|---|---|
| mira-dynamic-pointing-up.jpg | 78.0 | 86.39 | image | (175.0, 306.1) |
| mira-dynamic-thumb-up.jpg | 90.0 | 99.10 | image | (268.8, 281.2) |
| mira-dynamic-woman-hands.jpg | 90.0 | 105.48 | image | (285.3, 663.3) |

Trên `woman_hands`: 7 lát cắt hợp lệ; 4 bị loại vì core không đủ tin cậy là da tay, 1 cặp biên/tâm không hợp lý, 3 khác nhóm width nhất quán. Chất lượng 83% là chỉ số estimator, không phải xác suất đo đúng hay số đo mm. Quaternion không đổi.

A/B và chi tiết từng candidate nằm trong:

- `artifacts/upload-occlusion/comparison.html` / `comparison.png`.
- `*-100-A.png`: nguyên vòng khi tắt occlusion.
- `*-100-B.png`: bật depth/mask/bóng tiếp xúc, cùng pose và scale.
- `*-98-A.png`, `*-98-B.png`: đối chiếu Manual 98%.
- `*-measurement.png`: ROI, đường cắt, candidate và hai mép được chọn.
- `report.json`: native widths, projected inner diameter, tâm, reject reasons, confidence, số pixel full/visible/hidden và kiểm tra với Canvas ứng dụng.

Trong lần kiểm thử đã lưu: 0 pixel vòng bị che ở vùng probability da <0,35 và 0 pixel nguyên vòng chạm biên khung. Đây là kiểm tra theo mask, **không phải ground truth chiều sâu hoặc segmentation hoàn hảo**. Ảnh B ở Manual 100% và 98% khớp pixel Canvas thực trong cả ba ca. QA cũng kiểm tra mặc định UI là 100%.

## Kiểm thử và phạm vi giữ nguyên

- 107 unit tests và TypeScript/build qua; gồm kiểm tra topology, tọa độ, shadow/biên giả, mask yếu, registration không xoay/không đổi Z, size inverse và contact shadow.
- Browser tests đã kiểm tra Upload, PNG, ảnh native 1×/4×/8×, model segmentation bị chặn để kiểm tra fallback thật, 192 tư thế tổng hợp, camera replay, thử áo và mobile.
- UI có thay đổi riêng trong lúc làm việc (ô số đổi thành slider); giữ nguyên giao diện slider, chỉ sửa default bracelet 1,2 → 1 trong `App.tsx`; không chỉnh stylesheet. Bài A/B hỗ trợ cả slider và ô số.
- `braceletModel.ts`, `braceletDimensions.ts`, `wristGeometry.ts`, `draw.ts`, `style.css` không bị sửa trong lượt này. Backup trước sửa: `backups/pre-upload-occlusion-20261121T075701Z/project-state.zip`, kèm SHA-256/manifest.

## Chạy và kiểm tra đúng ảnh người dùng

```bash
npm install
npm run dev
# Terminal khác, giữ Vite chạy:
npm run test:upload-occlusion
# Dùng đúng file ảnh gốc trên máy:
TRYON_IMAGE="/duong/dan/anh.jpg" npm run test:upload-occlusion
```

Nếu thiếu model, chạy `npm run assets`. Model dùng chính thức, pinned version 1, 16.371.837 bytes; SHA-256 `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`. [Tài liệu MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) mô tả các lớp body-skin/face-skin/clothes. [Model card chính thức](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf) mô tả giới hạn và đầu vào 256×256.

## Chưa giải quyết / chưa xác nhận

Chưa có file gốc của ảnh người dùng vừa gửi để đo hoặc xuất A/B; không gán số liệu ảnh mẫu cho ảnh đó. Không tuyên bố đã đạt photorealistic hoặc sửa hoàn toàn trường hợp người dùng. Segmentation vẫn có sai số; Z và tiết diện cẳng tay là giả định hình học, chưa có depth thật/camera calibration/size mm. Góc gập hoặc axial, tay bị che, model thiếu hay biên native không đủ rõ vẫn có thể Provisional; fallback không được gọi là Auto Fit chính xác. Không thay đổi kích thước vật lý của asset fixed-size.


## Kiểm chứng occlusion cuối cùng

| Ảnh mẫu | Pixel vòng bị proxy không mask che ngoài vùng da | Sau mask | Canvas A/B 100% | Canvas B 98% |
|---|---:|---:|---|---|
| mira-dynamic-pointing-up.jpg | 55 | 0 | 0 pixel khác | 0 pixel khác |
| mira-dynamic-thumb-up.jpg | 96 | 0 | 0 pixel khác | 0 pixel khác |
| mira-dynamic-woman-hands.jpg | 194 | 0 | 0 pixel khác | 0 pixel khác |

Các số đếm dùng cùng pose/kích thước; chỉ thay mask trong depth pass và so metal alpha khi tắt shadow. Bóng tiếp xúc là bước riêng, không được tính là hình học vòng bị mất. `source-integrity.json` xác nhận mesh/material/dimensions/tracking geometry/áo không đổi và ZIP trước sửa còn nguyên.
