# Mira — AR Bracelet Try-On

**Trạng thái hiện tại:** Upload dùng segmentation body-skin kết hợp biên pixel gốc để đo và mask occlusion; đăng ký XY riêng, giữ quaternion/camera và model/PBR. Không thêm control UI. Xem [ảnh A/B, số liệu và giới hạn](docs/upload-occlusion.md). Chưa nghiệm thu trên ảnh người dùng vừa gửi trong chat vì thiếu file gốc có thể đọc bởi Node. Các báo cáo phục hồi trước đó là lịch sử.

**Live Camera:** Hand là nguồn chính, khuỷu tay/Pose là bổ sung. Wrist pose hợp lệ có thể hiện kích thước ước lượng trước khi đủ biên để xác nhận Auto Fit. Có hysteresis và grace tối đa 300ms, giữ đúng cặp ảnh–pose khi một frame lỗi. Giữ calibration khi xoay; model Lumière, PBR, ánh sáng và hành vi Upload được bảo toàn. **Chưa nghiệm thu webcam người thật hoặc lật mu/lòng 180° thật.** Xem [báo cáo hiện tại](docs/live-wrist-continuity.md); [báo cáo trục cổ tay trước đó](docs/live-wrist-axis.md) là lịch sử của bước triển khai trước.

React + TypeScript + Vite, Tailwind, MediaPipe Hand/Pose và **Three.js WebGL 2**. Vòng tay là mesh bangle 3D khép kín với PBR, phản chiếu studio, shadow và proxy depth-only. Canvas 2D chỉ ghép ảnh/video với layer Three.js, vẽ landmark và xuất PNG. Thử áo vẫn dùng Canvas như trước.

**Hiệu năng Live:** lấy frame bằng video callback, native observation chạy Worker khi có OffscreenCanvas, giữ tối đa một request và một metadata frame mới nhất; render/UI cập nhật riêng. Debug Console có `[mira-perf]`. Replay đối chứng cho khoảng22–26 cập nhật pose/render thật mỗi giây, camera gần30fps; chưa nghiệm thu webcam vật lý. Xem [số liệu trước/sau, giới hạn và cách đo](docs/live-performance.md).

Không backend, tài khoản hoặc tải ảnh/video lên máy chủ. Mô hình, WASM và môi trường phản chiếu được xử lý tại trình duyệt.

## Chạy

Node.js **22 LTS**:

```bash
npm install
npm run dev
```

Mở địa chỉ localhost Vite in ra. Lần cài đầu cần mạng để tải mô hình chính thức của Google. Nếu thiếu tài nguyên:

```bash
npm run assets
```

Script này chuẩn bị WASM tương thích module worker và nhiều task Hand + Pose. Sau khi đủ tài nguyên, sử dụng không cần CDN. Camera cần **localhost hoặc HTTPS**; HTTP qua IP LAN trên điện thoại không đủ quyền camera. Chrome/Edge mới, WebGL 2 và tăng tốc đồ họa được ưu tiên.

## Cách thử vòng

**Ảnh tải lên không bắt buộc có khuỷu tay.** Nếu forearm thiếu/không ghép được Pose, ứng dụng thử straight-wrist từ Hand. Có wrist pose nhưng biên chưa rõ sẽ hiện **Provisional Fit — kích thước tạm tính**, cho chọn hai mép da bằng nút **Chọn hai mép cổ tay** hoặc chỉnh Manual Fit, không ghi nhận thành Auto Fit chính xác. Khi chưa có foreground mask đáng tin cậy, dùng depth proxy hình học ước lượng như nguồn trước native Upload; không coi đó là segmentation da thật. Lỗi hình học vẫn bị từ chối, kèm mã kỹ thuật. Xem [báo cáo Upload và giới hạn](docs/wrist-measurement-debug.md).

**Camera:** Auto Fit bật sẵn, bắt đầu độ vừa 100%. Đưa bàn tay/cổ tay rõ vào khung. Pose hợp lệ có thể hiện vòng ở trạng thái ước lượng; ba phép đo biên nhất quán mới xác nhận Auto Fit. Segmentation lấy theo nhịp. Giữ calibration qua biên yếu/góc xoay; không thu nhỏ về prior vì một frame lỗi. Khi Hand mất, ROI chỉ tiếp tục nếu điểm ảnh còn khớp thật, tối đa 2 giây. Khi cả Hand/ROI đều thiếu, giữ cặp ảnh–pose hợp lệ tối đa 300ms rồi ẩn; mất Hand lâu phải hiệu chuẩn lại. UI không có checkbox Auto Fit riêng. [Báo cáo và checklist Live hiện tại](docs/live-wrist-continuity.md).

- **Camera theo cẳng tay — tắt cận cảnh:** ưu tiên hướng cẳng tay từ Pose đáng tin cậy khi có; không bắt buộc khuỷu tay. Có thể dùng đường biên cẳng tay hoặc quan hệ Hand–cẳng tay đã quan sát. Khi chưa có dữ liệu độc lập, fallback dùng giả định cổ tay thẳng, hiển thị chất lượng suy giảm.
- **Mặc định — cận cảnh:** đã bật sẵn “Cận cảnh · cổ tay thẳng”. Bắt đầu với bàn tay/cổ tay thẳng; nên để lộ một đoạn cẳng tay. Live đo hướng từ vùng ảnh nhìn thấy, chỉ yêu cầu Pose bổ sung khi hướng/độ sâu thiếu chắc chắn. Silhouette 2D không xác định được độ sâu; gập tay trong chiều sâu không quan sát được có thể suy giảm/ẩn vòng. Upload giữ nguyên quy trình cũ.
- **Độ vừa vòng tay:** mặc định 100%; UI hiện tại có thanh kéo 65–140%, “Đặt lại” về 100%. Giá trị giữ qua các frame, dừng/bật camera và đổi sản phẩm trong cùng lần mở trang. Thanh size chỉ hiệu chỉnh **vòng**, không scale proxy cổ tay hoặc đổi tracking. Đây là hiệu chỉnh bằng mắt, không đo chu vi thật.
- Vẫn có tải/kéo thả ảnh JPG/PNG/WebP dưới 20 MB, chọn vàng/bạc/vàng hồng/đen, xem landmark và chụp/lưu PNG. Webcam phản chiếu như gương; ảnh tải lên giữ chiều gốc.
- Vòng và ảnh webcam dùng cùng khung đã suy luận để giảm trôi do độ trễ; tốc độ hiển thị phụ thuộc tốc độ AI. Bracelet ẩn khi frame quá 1.000 ms hoặc không có kết quả mới trong 500 ms sau receipt; ảnh và landmark luôn dùng cùng frame. Webcam xuất tối đa 960px, ảnh tĩnh tối đa 1600px.

## Debug Mode

Debug Mode vẽ hai mép/lát cắt và kích thước lỗ vòng. Với Live, mở DevTools → Console, lọc `[mira-live]` để xem JSON mỗi frame: trạng thái ACQUIRING/TRACKING/DEGRADED/LOST, nguồn, timestamp, độ trễ, quaternion, trục, bán kính, scale, bề rộng đo/chiếu và lý do reject. UI hiện tại không có nút tải log riêng. Log chỉ ở máy, không chứa pixel ảnh/video. Xem [báo cáo và checklist Live](docs/live-camera.md).

Bật “Debug Mode” trong bảng vòng tay để xem landmark, Hand 0, tâm vòng, trục local (đỏ X, xanh lá Y, xanh dương Z/cẳng tay), proxy cyan (camera) và lý do tracking. Upload hiển thị ROI, trục cẳng tay, đường cắt, lý do reject và trạng thái che khuất. Residual/scale/basis là chỉ số hình học, không phải xác suất AI. Debug mặc định tắt. Xem checklist webcam và giới hạn tại [bracelet-audit.md](docs/bracelet-audit.md).

## Kiểm tra

```bash
npm test
npm run build
npm run preview
```

Kiểm thử trình duyệt có thể chạy lại được. Giữ `npm run dev` trong một Terminal, mở Terminal khác:

```bash
npm run test:upload-occlusion
npm run test:live
npm run test:live-axis
npm run test:live-continuity
npm run test:live-performance
npm run test:3d-recovery
npm run test:upload
npm run test:upload-measurement
npm run test:session
npm run test:dynamic
npm run test:ar
npm run test:sizing
```

Mặc định dùng Google Chrome đã cài, headless. Nếu không có Chrome, cài Chromium của Playwright:

```bash
npx playwright install chromium
AR_BROWSER=chromium npm run test:ar
```

`AR_URL` tùy chọn địa chỉ Vite. Bộ kiểm thử cần **dev server** vì kiểm tra trực tiếp module hình học; lần đầu tải ảnh mẫu chính thức của MediaPipe, lưu trong thư mục tạm. Không sử dụng ảnh riêng của người dùng.

Kết quả tạo trong `artifacts/` (không đưa vào Git):

- `ar-geometry-views.png`: đối chiếu toàn vòng / bật depth proxy ở các góc tổng hợp.
- `bracelet-photo.png`: kết quả nhận diện thật trên ảnh mẫu.
- `studio-desktop.png`, `studio-mobile.png`: kiểm tra UI.
- `ar-verification.json`: số pixel hiển thị/bị che, kết quả tích hợp và luồng phát lại.

## Kết quả và giới hạn nghiệm thu

- 190/190 unit test đã qua; kiểm tra mesh, PBR/depth, hệ camera, forearm, quaternion, scale, hysteresis/grace, calibration, frame scheduling, mask equivalence và telemetry. Số liệu từng bước trước nằm trong báo cáo lịch sử.
- Chrome đã chạy Hand + Pose thật, chế độ cận cảnh, màu, size, PNG, thử áo, dừng camera/chuyển tab và mobile.
- Luồng webcam phát lại ảnh mẫu đã kiểm tra đứng yên, trái/phải, xoay **trong mặt phẳng ảnh**, gần/xa và dữ liệu quá hạn. Các kịch bản này không thay thế video xoay tay thật theo chiều sâu.
- WebGL được kiểm tra bằng tư thế tổng hợp: đứng, ngang, xoay mặt trong→cạnh→ngoài, nghiêng 45°, gần/xa. Các ảnh này chứng minh hình học/depth rendering, không chứng minh mức vừa vặn trên người thật.
- Khuỷu tay không phải điều kiện khởi tạo Live. Hand-only dùng giả định cổ tay thẳng/quan hệ cẳng tay đã học, chưa phải quan sát forearm 3D độc lập. Auto Fit chỉ xác nhận biên ảnh đủ tin cậy; trước đó là kích thước ước lượng. ROI có thể từ chối da ít texture hoặc correspondence bị che; không hạ ngưỡng để bám nhầm nền.

**Chưa nghiệm thu trên năm tư thế webcam vật lý của người dùng.** Chưa có mesh/depth da thật hay hiệu chuẩn camera/mm. Upload có mask foreground cổ điển được kiểm tra độ tin cậy, chưa phải segmentation da được huấn luyện; proxy vẫn có thể lệch độ sâu, tay áo hoặc vật che ngang. Không cam kết photorealistic, không xuyên da hoặc không trôi trong mọi tư thế.

Xem [báo cáo kiểm tra tổng thể và Debug Mode](docs/bracelet-audit.md), [báo cáo sửa kích thước và cách kiểm thử webcam](docs/bracelet-sizing.md) và [báo cáo tracking trước đó](docs/bracelet-tracking.md).

## Source chính

```text
src/vision.worker.ts      Hand + Pose, cùng frame và timestamp
src/wristGeometry.ts      Fit world/ảnh, forearm association, hệ trục, lọc quaternion
src/braceletModel.ts      Mesh bangle kín, đá, proxy, PBR, camera CV → Three
src/braceletRenderer.ts   WebGL, PMREM/ánh sáng, depth-only, bóng và giải phóng GPU
src/imageWristMeasurement.ts ROI native, nhiều lát cắt, foreground; observation-only
src/braceletRenderFrame.ts Ranh giới tracking transform / sizing / renderer
src/imageCoordinates.ts   CSS/letterbox → tọa độ ảnh gốc
src/imageOcclusion.ts     Mask giới hạn depth/shadow, riêng Upload
src/useTryOn.ts           Camera/ảnh, đồng bộ, compositing, PNG, cleanup
src/App.tsx               UI; thêm một tùy chọn cận cảnh liên quan tracking
src/draw.ts               Renderer áo giữ nguyên
src/*.test.ts             Kiểm thử toán học và topology
src/testing/              Fixture QA; không dùng trong inference của ứng dụng
scripts/verify-ar.mjs     Kiểm thử trình duyệt có thể chạy lại
```
