# Kiểm chứng đường biên và hiệu chuẩn cổ tay

> Trạng thái Upload mới nhất: xem [kiểm tra Auto Fit và occlusion](upload-occlusion.md). Các chính sách/số liệu bên dưới thuộc mốc phục hồi trước đó.

> **Đã được thay thế một phần bởi [bản phục hồi 3D](3d-recovery.md):** hiện measurement không thay pose; thiếu mask vẫn có geometry-depth fallback. Các số đo và mô tả tắt occlusion/đổi tâm ở phần dưới là lịch sử trước phục hồi, không còn là chính sách hiện tại.

> Bản hiện tại: đo Upload bằng ROI ở độ phân giải gốc, debug đường cắt/biên/reject, calibration hai mép, và che khuất giới hạn bằng foreground. Các phần bên dưới lưu lịch sử các lần sửa trước. Chưa có ảnh gốc người dùng báo lỗi, chưa nghiệm thu webcam vật lý hoặc độ vừa trên mọi người/góc tay.

## Upload Image: đo biên ảnh gốc và kiểm soát che khuất

### Những cơ chế đã xác nhận trong source

1. Upload trước đây dùng chung bước thu ảnh đo xuống tối đa **640 px cạnh dài** với camera. Ví dụ ảnh 640 × 960 được đo trên 427 × 640. Đây là sự mất chi tiết có thật; chưa thể xác nhận là nguyên nhân duy nhất trên ảnh người dùng chưa được cung cấp.
2. Khi phép đo không đạt confidence, Provisional Fit lấy bán kính từ anatomical prior của Hand, **không phải số đo bề rộng da**. Vì vậy bật Dynamic Auto Fit không đồng nghĩa đã đo thành công; Manual 85% chỉ thu nhỏ prior đó.
3. Thuật toán cũ kiểm tra màu nhiều điểm so với một seed trong da. Bóng/texture/chênh màu nội vùng có thể làm mất coverage hoặc thiếu các cặp biên nhất quán. Không nên nới confidence để ép nhận. Hai fixture khó vẫn được từ chối trong bản sửa này.
4. Group scale hiện tại **đã tách** vòng và wrist proxy, không tìm thấy lỗi nhân Manual Fit hai lần. Nhưng ở 85%, bán kính trong vòng = `1.122 × .85 = .9537` đơn vị model, nhỏ hơn proxy tại mặt phẳng vòng = `1.0200`. Depth testing có thể che phần lớn một mesh vẫn khép kín. Không được khắc phục bằng cách thu nhỏ proxy theo vòng.
5. Proxy trước đây ghi depth cả trên pixel nền ảnh khi biên hình học không khớp silhouette thật. Chưa có mask giới hạn nó vào foreground quan sát được. Đây là một cơ chế gây che sai có căn cứ source; không xác nhận được mọi lỗi chiều sâu của ảnh chưa có.

### Pipeline mới chỉ dành cho ảnh tĩnh

`image.decode()` → Hand/Pose trong worker → `analyzeWristForSource()` → ROI native → `measureImageWrist()` → inverse camera projection → `WristSizer` → bracelet scale độc lập → Three.js depth + foreground mask → Canvas/PNG.

| File | Hàm/trách nhiệm |
|---|---|
| `src/imageWristMeasurement.ts` | `wristImageRoi()`, `measureImageWrist()`: đọc tọa độ ROI gốc, 15 lát cắt, foreground/background thích ứng, kiểm tra contour, đặt tâm tại lát cắt đã đo |
| `src/imageWristMeasurement.ts` | `rotateImageAxis()`: chỉ hiệu chỉnh góc trong mặt phẳng ảnh có bằng chứng contour; `manualImageWrist()`: calibration từ hai mép được chọn |
| `src/imageCoordinates.ts` | `clientToImagePoint()`: CSS contain/letterbox → tọa độ ảnh, độc lập độ phân giải Canvas/DPR |
| `src/braceletSizing.ts` | `radiusFromImageWidth()` giữ phép chiếu phối cảnh; `WristSizer.update()` dùng phép đo ảnh mới, không kế thừa calibration video/prior khi đo lại ảnh thất bại |
| `src/braceletDimensions.ts` | `imageRenderFit()`: giải giới hạn va chạm từ torus và proxy, chỉ với Visual Auto Fit ảnh có số đo; không tự thay size asset cố định |
| `src/imageOcclusion.ts` | `ImageOcclusion`: mask trong tọa độ ảnh top-left giới hạn depth/shadow; giải phóng texture khi thay ảnh/cleanup |
| `src/braceletRenderer.ts` | Truyền mask cho depth/shadow, cache phân biệt mask; không mask mặt kim loại hoặc cắt mesh vòng |
| `src/useTryOn.ts` | Đọc **crop ảnh gốc**, chọn nhánh image/camera, xử lý hai lần chạm/chọn mép, render fit, log/cleanup |
| `src/wristDebug.ts`, `src/wristDiagnostics.ts` | ROI vàng, trục xanh dương, toàn bộ đường cắt, candidate bị loại, hai mép được chọn, reject reason và số đo native |
| `src/wristTracking.ts`, `src/App.tsx`, `src/style.css` | Thông báo chính xác theo giai đoạn, nút calibration ảnh, debug fit thực tế/giới hạn va chạm |

Giữ nguyên `vision.worker.ts`, `wristGeometry.ts`, `wristRoiTracking.ts`, thiết kế/model/PBR và renderer áo. Camera tiếp tục dùng thuật toán đo cũ/640 px, calibration phiên và ROI có giới hạn trước đó. Forearm/straight-wrist fallback cho ảnh vẫn giữ các kiểm tra hình học và đồng bộ requested/worker/effective mode.

### Đo và fitting

- Landmark bàn tay chỉ đặt vùng tìm kiếm và trục ban đầu, **không được gọi là số đo cổ tay chính xác**. ROI đủ rộng cho hiệu chỉnh trục có giới hạn; đọc pixel native trực tiếp, không resize ROI thành ảnh 640 px.
- 15 đường cắt bắt đầu phía cẳng tay, vuông góc trục chiếu. So sánh chromaticity tương đối và luminance nhẹ giữa lõi da và hai collar nền; không có ngưỡng màu da cố định. Cần nền phía ngoài tồn tại liên tục, loại foreground re-entry/texture, độ rộng/tâm bất thường, nền hai bên không nhất quán hoặc da/nền quá giống nhau.
- Ít nhất 5 lát cắt đồng thuận, kiểm tra bề rộng, độ liên tục tâm và outlier. Nếu trục ban đầu lệch vừa phải, chỉ quay trong mặt phẳng ảnh theo contour (giới hạn 36°) và **đo lại** bằng pixel; không nhân `1/cos` để phóng bề rộng. Không suy ra mới chiều sâu/twist từ contour 2D.
- Chọn lát cắt gần mặt phẳng đeo, dời tâm vòng về trung điểm hai mép thực sự đã đo. Giải bán kính bằng đúng `projectedWidth()` của ellipse proxy ở mặt phẳng đó. Bán kính không phải `widthPx / 2` trong scene.
- Quy ước điểm đo: `x = nativeX / imageWidth`, **`y = nativeY / imageWidth`**. Landmark `y` chuẩn hóa theo chiều cao được đổi đúng một lần. Mask dùng UV chuẩn hóa riêng x/W, y/H. CSS chỉ hiển thị; không tham gia công thức sizing. Canvas tối đa 1600 và layer WebGL tối đa 1200 chỉ là đầu ra render, không phải độ phân giải đo.
- `bracelet group scale = radius × effectiveManualFit`; root scale = 1, proxy scale = radius; child clearance thiết kế 1.10 giữ nguyên. Không tích lũy qua frame/lần đổi màu.
- Chỉ ảnh Visual Auto Fit có phép đo hoặc hai mép hợp lệ mới dùng giới hạn tránh vòng nhỏ hơn proxy: `minFit = (WRIST_MODEL_RADIUS + .01) / (BANGLE_INNER_RADIUS - taperSlope × torusHalfThickness) ≈ .919807`. `.01` là khoảng hở theo đơn vị model, không phải hệ số phóng theo người. Manual 85% được giữ trong input, **UI báo render thực tế 91,98%**, proxy không đổi. Manual 100/150% không bị thay; webcam và Provisional không dùng giới hạn này.
- Đây là **Visual Auto Fit**, không đo mm. Asset `fixed-size` vẫn bị chặn trước khi resize nếu chưa có hiệu chuẩn True-to-Size.

### Che khuất: bằng chứng và giới hạn

Classifier foreground tạo mask ROI từ màu nền quan sát được; lấp vùng background bị bao kín để tránh coi highlight nhỏ bên trong da là lỗ thủng. Đây là xử lý ảnh cổ điển, **không phải model segmentation da được huấn luyện**. Mask có độ phân giải tối đa 512 px/cạnh ROI; phép đo biên vẫn dùng native pixels.

Depth-only proxy và shadow chỉ hoạt động tại pixel foreground của mask. Phần kim loại vẫn là torus 2π khép kín, không cắt mesh thành chữ C. Nếu Auto Fit bị từ chối hoặc không có mask tin cậy, tắt proxy/shadow cho ảnh và báo rõ: toàn vòng được hiện như fallback, **chưa giải quyết che khuất**. Hai mép thủ công không tự tạo ra mask hay độ sâu chính xác.

Đã cân nhắc [MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter): các model person/body-part không tự cung cấp mặt cắt và độ sâu cổ tay chính xác. Chưa thêm model đó hoặc tuyên bố nó đã giải quyết được ảnh này. [GrabCut của OpenCV](https://docs.opencv.org/4.x/d8/d83/tutorial_py_grabcut.html) là phương án nâng cấp foreground có seed; thuật toán hiện tại không phải GrabCut. Với nền gần màu da, tay áo/vật che hoặc góc gập mạnh, cần thêm segmentation được kiểm chứng/nhãn foreground thủ công và dữ liệu nhiều góc hay depth để tiến xa hơn. Mask 2D không chứng minh chiều sâu proxy đúng da thật.

### Kiểm thử và kết quả có thể tái lập

- **95 unit tests**: gồm 15 test mới về native ROI, ảnh dọc/ngang/roll, cổ tay nhỏ/lớn, shadow/highlight, ambiguous background, contour nhảy, hiệu chỉnh trục, ảnh 600/1200/2400 px, manual pair hợp lệ/sai, collision, mask và stale remeasurement. Không sử dụng fixture tổng hợp làm inference app.
- TypeScript/production build qua.
- `npm run test:upload-measurement`: Chrome chạy MediaPipe Hand thật trên ảnh mẫu chính thức, kiểm tra hai điểm bấm DOM, lưu PNG thật, log JSON, và mask/depth bằng pixel GPU. Ảnh phóng 4/8 lần chỉ kiểm tra tọa độ, không được gọi là ảnh có thêm chi tiết thật.

| Ca thực hiện | Bề rộng da đo | Lỗ vòng chiếu | Kết quả |
|---|---:|---:|---|
| `pointing_up`, native 358 × 376, Manual 100% | 81 px | 89,78 px | Đo thành công, ratio 1,10845 |
| Cùng ảnh phóng 4 lần, 1432 × 1504 | 325 px | 360,06 px | Ratio 1,10789; độ lớn scene gần như không đổi |
| Cùng ảnh phóng 8 lần, 2864 × 3008 | 648 px | 718,19 px | Ratio 1,10831; vượt cap inference 960, Canvas 1600 và WebGL 1200 |
| Ảnh đầu, input Manual 85% | 81 px | 82,55 px | Render 91,98%, có thông báo giới hạn, không đổi proxy |
| Ảnh 4 lần, input Manual 85% | 325 px | 331,06 px | Cùng giới hạn hình học, không double scale |
| `woman_hands` | Không có phép đo tự động hợp lệ | Không gọi là measured | Manual hai mép được kiểm tra riêng, không tự tạo mask |

Test GPU với mask bất đối xứng: 651 pixel toàn vòng; 240 pixel phía sau bị depth che; mask rỗng cho toàn vòng; mask trắng khớp depth không mask; nửa mask trên chỉ thay pixel nửa trên (263 pixel), nửa dưới 0; trả về webcam/unmasked không khác pixel chuẩn. Đây là kiểm chứng shader/hệ tọa độ trên tư thế tổng hợp, **không phải ground truth depth của cổ tay thật**.

`npm run test:upload` tiếp tục phân tích 3 ảnh thật: `pointing_up` measured; `thumb_up`/`woman_hands` vẫn Provisional với lý do contour/foreground cụ thể. Không ép hai ảnh khó thành Auto Fit. `test:session`, `test:dynamic`, `test:sizing` và `test:ar` qua: camera replay A/B/C/D, tracking ROI, 192 tư thế render, màu, PNG, thử áo, dừng camera và mobile. Camera vật lý chưa được kiểm thử. Script `scripts/verify-dynamic-fit.mjs` đã được cập nhật instrumentation để quan sát cả module đo ROI ảnh mới, thay vì giả định Upload gọi hàm camera 640 px; không thay thế inference bằng landmark giả hoặc nới tiêu chí sizing.

Bằng chứng: `artifacts/upload-measurement.json`, `upload-native-1.json`, `upload-native-4.json`, `upload-native-8.json`, `upload-fit85-1.json`, `upload-fit85-4.json`, `upload-clean85-1.png`, `upload-clean85-4.png`, `upload-fallback-manual.json`, `upload-fit.json`, `session-fit.json`, `ar-verification.json`. Log không chứa ảnh/video hoặc pixel mask. PNG chỉ được tạo/tải tại máy.

### Cách chạy và tự đối chiếu ảnh đang lỗi

```bash
npm install
npm run dev
# Terminal khác (giữ Vite đang chạy):
npm run test:upload-measurement
```

1. Tải lại trang đang mở, giữ Dynamic Auto Fit bật, bắt đầu Manual Fit 100%, tải ảnh. Ảnh không bắt buộc có khuỷu tay.
2. Bật Debug: xem ROI vàng, trục xanh dương, đường cắt, **hai mép xanh ngọc thực tế** có đúng mép da hay không. Xem native width, lỗ vòng chiếu, reject reason và số lát hợp lệ. Candidate cam là điểm bị loại, không phải phép đo thành công.
3. Nếu Provisional hoặc reject: bấm **Chọn hai mép cổ tay**, chạm/bấm hai mép da cùng một đường ngang cổ tay. Không chọn mép vòng. Có thể Hủy chọn mép; input sai được yêu cầu chọn lại. Calibration này ghi nhãn thủ công, không chuyển thành Auto Fit.
4. Bấm **Đo lại tự động** để bỏ cặp mép đã chọn và thử lại. Manual Fit không bị reset. Nếu cần kiểm tra 85%, đọc thông báo giới hạn và Render thực tế trong debug.
5. Tắt Debug/điểm nhận diện rồi **Chụp & lưu ảnh** để xuất PNG sạch. Khi đang chọn dở hai mép, lưu ảnh được tắt. Bật Debug và **Tải log JSON** để lưu số đo/ROI/điểm chọn/reject, không tải ảnh lên server.

**Chưa kết luận đã sửa thành công trên ảnh cụ thể của người dùng.** Cần đối chiếu hai mép đã chọn và độ che khuất trên đúng ảnh đó. Bề rộng 2D đúng chưa xác định được bề dày cổ tay, twist cẳng tay hoặc camera intrinsics thật; góc axial/gập mạnh, nền phức tạp, biên không đủ rõ vẫn phải dùng fallback hoặc từ chối có lý do.

---

## Lịch sử trước bản đo ảnh gốc

## Upload Image: thiếu khuỷu tay và chưa đo được kích thước

### Nguyên nhân và phạm vi sửa

Upload trước đây gọi cùng `analyzeWrist(..., mode: forearm)` như camera. Nếu Pose không thấy khuỷu tay hoặc không ghép được với Hand, `no-forearm`/`arm-match` làm wrist pose bị loại. Ngay cả khi pose hợp lệ, `WristSizer` vẫn có thể trả `pose: null` vì thiếu biên ảnh. Giao diện dùng chung lời hướng dẫn camera nên yêu cầu lộ thêm khuỷu tay không cần thiết.

- `src/wristGeometry.ts` — `analyzeWristForSource()`: với **image**, chỉ khi forearm thất bại bằng `no-forearm` hoặc `arm-match` mới thử lại `straight-wrist`. Cả hai lần giữ nguyên kiểm tra Hand 0/5/9/13/17, world landmarks và hình học. `invalid-data`, `degenerate`, `bounds`, `arm-direction`, v.v. không được bỏ qua. Pose khuỷu/cổ tay phù hợp vẫn được dùng nếu có.
- `src/braceletSizing.ts` — `WristSizer.update()` chỉ cho Provisional khi có `input: 'image'`, wrist pose đã hợp lệ và `canRenderProvisional()` kiểm tra tỷ lệ/quaternion/projection an toàn. Không suy ra đây là ảnh chỉ vì `video: false`; các caller camera/default giữ hành vi trước.
- **Provisional Fit không phải Auto Fit:** lấy kích thước ban đầu từ prior của landmark, không phóng thêm hệ số tùy ý, không ghi prior thành intrinsic calibration. `calibrationRadius` và fit ratio vẫn `null`. Manual Fit điều chỉnh vòng như trước; có phép đo thật sau đó vẫn chuyển được sang measured. Asset fixed-size hoặc projection không an toàn vẫn bị chặn.
- `src/useTryOn.ts`: chọn chính sách theo source, dùng mode thực tế của pose để hiển thị nguồn Hand/Pose. Worker tiếp tục trả **mode yêu cầu**; `mode-switch` so với mode yêu cầu, không so với mode hiệu dụng sau fallback. `vision.worker.ts` không cần thay đổi. Camera/ROI vẫn dùng các điều kiện cũ.
- `src/wristTracking.ts`, `src/App.tsx`: thông báo riêng cho ảnh. Chi tiết lỗi đo nằm ở `sizing-status`; lỗi hình học có mã kỹ thuật, không tự yêu cầu người dùng chụp thêm khuỷu tay.
- `src/wristDiagnostics.ts`: log thêm requested/worker/effective mode và nguyên nhân fallback, không thêm ảnh hay landmark thô.

### Trạng thái trên ảnh

| Trạng thái | Hiển thị |
|---|---|
| Không có Hand | Không phát hiện bàn tay trong ảnh; không render vòng |
| Có Hand, pose không hợp lệ | Phát hiện bàn tay nhưng không xác định được tư thế cổ tay, kèm lý do/mã hình học |
| Có pose, không thể render an toàn | Đã xác định cổ tay nhưng chưa đo được kích thước; mã `unsafe-provisional`/lý do tương ứng |
| Có pose, thiếu biên nhưng render an toàn | Đã hiển thị vòng với kích thước tạm tính (Provisional Fit); cho chỉnh Manual Fit |
| Có pose và biên hợp lệ | Auto Fit thành công; vẫn là ước lượng hiển thị, không phải số đo mm |

Debug hiển thị `Yêu cầu: forearm · worker: forearm · đang dùng: straight-wrist · fallback: ...` khi fallback. Đây là kết quả hợp lệ, không phải frame sai mode. UI không tự bật/tắt checkbox cận cảnh của người dùng.

### Kết quả kiểm thử Upload

**80/80 unit test**, gồm 10 test mới ở `src/uploadImage.test.ts`: ảnh thiếu elbow, đủ elbow/Pose, arm-match, không có Hand, lỗi hình học, Provisional, giữ nhánh camera nghiêm ngặt, không commit prior và Manual Calibration. TypeScript/production build đã qua.

Chrome chạy Hand/Pose Landmarker thật trên ảnh mẫu, giữ checkbox cận cảnh **tắt** để tái hiện lỗi:

| Ảnh | Forearm thất bại | Mode hiệu dụng | Kết quả |
|---|---|---|---|
| `pointing_up.jpg` | `no-forearm` | straight-wrist | Auto Fit thành công |
| `thumb_up.jpg` | `no-forearm` | straight-wrist | Provisional Fit, chưa đo được biên |
| `woman_hands.jpg` | `arm-match` | straight-wrist | Provisional Fit, chưa đo được biên |
| Ảnh trắng qua model thật | Không có Hand | Không có pose | Thông báo không phát hiện bàn tay; không tạo vòng |

Mỗi ảnh gửi một inference request, không lặp yêu cầu vì fallback khác mode. Kiểm tra tắt/bật cận cảnh trên ảnh đang mở vẫn đồng bộ lại worker đúng mode. Provisional Manual 150% chỉ đổi vòng, không đổi proxy; PNG xuất được. Khi tắt debug/landmark, Canvas khác ảnh gốc **1569 pixel có chênh lệch màu >24** ở fixture Provisional, xác nhận có render chứ không chỉ đổi nhãn.

Bằng chứng: `artifacts/upload-fit.json`, `upload-pointing_up.jpg.png`, `upload-thumb_up.jpg.png`, `upload-woman_hands.jpg.png`, `upload-provisional.png`. Nhánh **Pose đầy đủ và đáng tin** được kiểm tra bằng unit fixture; không tuyên bố đã nhận đúng khuỷu tay trên một bộ ảnh người thật đầy đủ.

Đã chạy `test:upload`, `test:session`, `test:ar`, `test:dynamic`, `test:sizing`; hồi quy camera/replay, ROI, màu, PNG, thử áo và mobile đều qua. Không kiểm thử camera vật lý trong lần này.

### Cách thử và giới hạn

Với Vite đang chạy, tải lại trang rồi upload ảnh; không cần chụp thêm khuỷu tay để thử fallback. Bật Debug để xem requested/worker/effective mode. Nếu hiện Provisional, điều chỉnh Manual Fit hoặc tắt Dynamic Auto Fit để chọn Manual Calibration chủ động. Có thể tải log JSON để đối chiếu.

```bash
npm run dev
# Terminal khác, khi Vite đang chạy:
npm run test:upload
```

Fallback straight-wrist giả định bàn tay/cẳng tay gần thẳng hàng, chưa tái tạo được hướng cẳng tay thật khi cổ tay gập mạnh mà thiếu elbow. Ảnh mờ, landmark 3D không nhất quán, góc axial hoặc vùng đeo ngoài ảnh vẫn có thể bị từ chối với lý do cụ thể. Provisional chưa đo được bề rộng da, chưa đúng size mm và không bảo đảm vừa cổ tay. Chưa có ảnh gốc của người dùng để xác nhận trên đúng trường hợp đã báo.

---

Các phần dưới lưu diễn tiến sửa scale/tracking và kết quả trước khi thêm chính sách Upload mới.


## Sửa scale theo góc xoay và tiếp tục tracking cổ tay

### Nguyên nhân có bằng chứng

- `applyCameraPose()` cũ gán `group.scale = radius × Manual Fit`, trong khi band, gems, depth proxy và shadow đều nằm trong group đó. Manual 150% làm cả cổ tay giả lớn lên 50%; tỷ lệ vòng/proxy không được chỉnh độc lập.
- `WristSizer` cũ giải lại bán kính từ width ảnh và ellipse giả định ở từng frame. Một bề rộng quan sát không đổi có thể cho radius khác khi hướng ellipse thay đổi. Bộ lọc làm mượt chỉ trì hoãn sai lệch, không loại được nó.
- Đối chiếu source trước/sau trên cùng fixture 0–180°, cùng khoảng cách, width cố định: radius đỉnh của bản cũ bằng **1,3863×** lúc đầu; bản mới **1,0000×**. Đây là ca toán học tái hiện nhánh lỗi, không phải video cổ tay của người dùng. Dữ liệu: `artifacts/session-before-after.json`; regression test cũng xác nhận refit độc lập theo ellipse sẽ tăng radius trên 30% ở fixture này.
- `radiusFromImageWidth()` trước đây cho phép nghiệm đến 80% độ sâu trước camera; đó là miền không phù hợp cho một tiết diện cổ tay gần camera projection singularity. Chưa có bằng chứng video người dùng đi đúng vào miền này, nhưng miền nghiệm đã được chặn.
- Kiểm tra cũ yêu cầu mảng đủ 21 landmark dù công thức chỉ dùng Hand 0/5/9/13/17; `useTryOn` xóa tracking ngay khi không còn Hand pose. Pose phụ cũng chỉ được chạy nếu Hand vẫn tồn tại. Không có nguồn ảnh bổ sung giữ cổ tay khi thiếu bàn tay.

### Tách transform, body estimate, product fit và camera

```text
tracking root: position + quaternion, scale = 1
calibration k = initial fitted radius / initial distance reference
wrist scene scale = k × current distance reference
wrist proxy scale = wrist scene scale
bracelet group scale = wrist scene scale × Manual Fit
band/gems world scale = bracelet group scale × existing design clearance (1.10)
projection = camera projection applied once to each object's geometry
```

`k` là tỷ số theo span cổ tay–MCP giữa của Hand, **không phải mm**. `distanceScale` được tách khỏi anatomical radius/breadth, lọc median ba mẫu và giới hạn log tốc độ riêng. Một frame distance outlier không làm vòng phóng lên; radius prior dao động không còn điều khiển observer khoảng cách.

Khởi tạo video cần ba phép đo biên rõ, nhất quán. Sau đó giữ `k` trong phiên, không dùng một phép đo theo góc nhìn để thay kích thước cơ sở. Biên mới chỉ dùng để kiểm tra/hiển thị; khi không phù hợp, trạng thái là `calibrated`, không giả vờ có phép đo mới được chấp nhận. Vị trí/hướng vẫn đến từ tracking thực. Mất tracking ngắn sẽ ẩn vòng nhưng giữ riêng hệ số calibration tối đa 1,5 giây để tránh đo lại size chỉ vì Hand bị mất một nhịp khi xoay. Không giữ/vẽ pose khi thiếu dữ liệu. Đổi tay, mất tracking lâu hơn hoặc đổi nguồn/chế độ sẽ khởi tạo lại.

Manual Fit chỉ thay trang sức. Đường kính proxy, vị trí, quaternion và camera không đổi theo Manual Fit. 150% hiện đúng nghĩa vòng lớn hơn 50% so với cơ sở; hiệu ứng này khác bản cũ từng phóng cả proxy. Hình chiếu của một vòng 3D vẫn có thể đổi theo góc, dù kích thước vật thể không đổi.

Phép chuyển width của lát cắt về vùng đeo giờ dùng tỷ lệ độ sâu một lần, không dùng radius/oval prior để bù trước rồi giải ngược ellipse tiếp. Nghiệm được kiểm tra hữu hạn, hướng không axial và giới hạn hình học rộng theo palm length, không nhân một hệ số phóng đại để làm vòng lớn hơn.

### Initial Detection và Continuous Tracking

1. Initial Detection: cần Hand 0 và bốn MCP ổn định, ở trong ảnh; đầu ngón không tham gia công thức. Không hạ confidence thresholds của MediaPipe. Khởi tạo calibration và ROI từ cổ tay có biên ảnh đủ rõ.
2. Continuous Tracking: ưu tiên Hand (kết hợp Pose khi dùng forearm mode). Khi Hand không cung cấp được pose hợp lệ, thử theo dõi patch ảnh trong ROI cổ tay/cẳng tay của frame gốc.
3. ROI dùng góc ảnh có texture, đối sánh tương quan chuẩn hóa 7×7, kiểm tra xuôi/ngược, kiểm tra tính duy nhất và RANSAC similarity. Cần tối thiểu sáu inlier, độ phủ đủ rộng, residual nhỏ. Không dùng vận tốc cũ để tự vẽ một vị trí.
4. Các điểm nếp cổ tay gần thẳng hàng vẫn xác định được similarity 4 bậc tự do. Điều kiện rank hai của affine trước khi kiểm tra tích hợp đã được thay bằng độ phủ/độ tách điểm phù hợp; không giảm threshold Hand.
5. **ROI giữ scale và hướng ngoài mặt phẳng của Hand gần nhất**, chỉ cập nhật vị trí/rotation trong mặt phẳng có quan sát ảnh. Giới hạn mốc 3D **2 giây**, gap frame 250 ms, roll tích lũy 30°, tỷ lệ similarity thay đổi tổng quá khoảng 5% sẽ yêu cầu Hand trở lại. Không suy ra khoảng cách mới từ foreshortening ROI.
6. Mất texture, che khuất, correspondence sai, quá hạn hoặc worker stale: ẩn vòng và yêu cầu đưa bàn tay trở lại. Hệ số calibration được giữ riêng tối đa 1,5 giây khi không còn pose, không dùng để vẽ vị trí giả; quá thời hạn mới xóa. Bàn tay quay lại sẽ được nhận diện thật và giữ/đo lại fit tùy thời gian mất.

Đây là nâng cấp tracking tạm thời có căn cứ ảnh, **chưa phải tracker cổ tay 3D độc lập lâu dài**. Pose được tiếp tục chạy nếu đã khởi tạo trong forearm mode khi Hand mất, nhưng Pose đơn lẻ chưa được dùng để bịa wrist twist. Theo [tài liệu MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker), đầu ra là keypoint bàn tay; không có mô hình hình học bề mặt cổ tay riêng. Tracking ảnh chịu giới hạn quan sát 2D như mô tả trong [OpenCV Optical Flow](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html); ứng dụng này dùng patch matching JavaScript, không nạp OpenCV.

Muốn thử lâu khi toàn bộ bàn tay nằm ngoài khung: cần model wrist/forearm chuyên biệt đã kiểm chứng hoặc marker quanh cổ tay. Một phương án khác là fusion Pose elbow/wrist + segmentation biên + ràng buộc hình học, nhưng vẫn cần dữ liệu bổ sung để xác định twist; depth camera/marker có thể giảm sự mơ hồ. Chưa triển khai các phương án này trong bản sửa.

### Debug và lưu dữ liệu

Debug hiển thị source thực (`Hand Landmarker`, `Hand Landmarker + Pose`, `ROI`, `None`), phase, wrist/bracelet radius, Manual Fit, scale riêng, width chiếu riêng, view angle, measurement confidence và số inlier/RMS ROI. `None` là mất tracking, không render prediction giả.

View angle là góc tới tuyệt đối của pháp tuyến với viewing ray (0–90°), tránh nhảy 180° khi bộ lọc chọn basis đối xứng tương đương; không phải bộ phân loại mặt trong/mặt ngoài cổ tay.

Bật **Debug Mode**, sau khi thực hiện các tư thế bấm **Tải log JSON** ở cuối bảng debug (cuộn bảng nếu cần). Log chỉ gồm số đo/nguồn/trạng thái, tối đa 1800 frame trong RAM, ghi khi Debug bật; không chứa ảnh, video hoặc landmark thô, không gửi server. Log được giữ để tải sau khi tắt camera, nhưng bắt đầu nguồn mới sẽ mở log mới. `calibrated` khác `measured`: giữ hiệu chuẩn chứ không tái đo size hợp lệ ở mọi góc.

### File và hàm thay đổi

| File | Hàm/chức năng |
|---|---|
| `src/braceletModel.ts` | `createBraceletObjects`, `applyCameraPose`: root rigid, hai group scale độc lập |
| `src/braceletDimensions.ts` | Làm rõ `finalWorldScale` chỉ áp dụng bracelet; giữ nguyên kích thước thiết kế |
| `src/braceletRenderer.ts` | Frustum ánh sáng theo kích thước thật, không lấy root scale = 1 làm radius |
| `src/wristGeometry.ts` | `analyzeWrist`: chỉ cần anchor thiết yếu; `WristFilter`: distance observer riêng |
| `src/braceletSizing.ts` | `radiusFromImageWidth`, `measureWristWidth`, `WristSizer`, `sizingDebug`: miền nghiệm, calibration phiên, số đo riêng |
| `src/wristRoiTracking.ts` | `WristRoiTracker`, `fitSimilarity`, `applyImageSimilarity`: nguồn pixel bổ sung có kiểm tra |
| `src/wristTracking.ts` | Nguồn/phase, góc tới và hướng dẫn lấy lại tracking |
| `src/useTryOn.ts` | Chọn Hand/ROI, giữ frame đồng bộ, seed/reset và giải phóng ROI; xuất log |
| `src/vision.worker.ts` | Tiếp tục quan sát Pose đã tải khi Hand mất trong forearm mode |
| `src/wristDiagnostics.ts`, `src/App.tsx` | Log số đo trong RAM, debug và tải JSON; chỉ đổi UI liên quan vòng tay |
| `src/sessionFit.test.ts` và các test sizing/tracking cũ | 13 test mới; cập nhật tiêu chí cũ phóng cả proxy hoặc xóa size sau 250 ms |
| `scripts/verify-session-fit.mjs`, scripts kiểm tra cũ, `package.json` | Lệnh `test:session`, kiểm tra trường hợp mới và hồi quy |

Không đổi thử áo, vật liệu/thiết kế bangle hoặc ngưỡng confidence của MediaPipe.

### Kiểm thử đã chạy và phạm vi

- **70/70 unit test**. Test A/B: 360° synthetic 3D rotation, Manual 100/150%, intrinsic không đổi, không scale tích lũy; một frame distance outlier; inverse projection và coordinate transform; D với ảnh có texture, thiếu phần bàn tay và không dùng landmark giả; uniform/occluded/stale ROI phải bị từ chối.
- TypeScript + production build: `npm run build`.
- `npm run test:session`: MediaPipe thật trên replay `pointing_up.jpg`, nguồn camera là `captureStream`, không phải webcam vật lý. Kiểm tra roll ảnh ở Manual 100/150%, near/far, che vùng bàn tay, ROI, timeout, nhận lại và xuất JSON.
- `npm run test:dynamic`, `npm run test:ar`, `npm run test:sizing`: hồi quy ảnh thật, tracking, near/far, màu, Manual tới 350%, PNG, camera cleanup, shirt/mobile. Renderer kiểm tra 192 tư thế ở Fit 100/150%; thêm xác minh vòng quá nhỏ 65% bị proxy che thay vì thu nhỏ proxy.

| Ca replay | Kết quả lần chạy |
|---|---|
| A: Manual 100%, roll ảnh ±20° | wrist radius khoảng 0,08469–0,08479 scene unit; calibration ratio giữ 0,360205 |
| B: Manual 150%, cùng roll | wrist radius khoảng 0,08463–0,08484; lỗ vòng khoảng 173,3–175,2 px; proxy không nhận Manual Fit |
| C: xa → gần, Manual 150% | lỗ vòng khoảng 140,3 → 188,6 px; giữ cùng calibration ratio |
| D: che vùng bàn tay, dịch ngang nhẹ | Hand **0/21**, ROI **7/7** inlier, RMS 0,00 px ở frame ghi nhận, fit 150% giữ nguyên; hết hạn 2 giây thì ẩn và nhận lại khi Hand trở lại |

A/B 3D thật chỉ được kiểm tra bằng fixture toán học; replay chỉ roll mặt phẳng ảnh, **không thay thế quay từ mặt ngoài sang mặt trong cổ tay thật**. Các số trên không chứng minh toàn bộ da/ánh sáng/người đều ổn định. `thumb_up.jpg` có biên yếu vẫn bị Auto Fit từ chối ở khởi tạo, có fallback manual.

Bằng chứng trong `artifacts/`: `session-before-after.json`, `session-fit.json`, `session-debug-log.json`, `session-roi.png`, cùng các báo cáo hồi quy. `session-failure*.json/png` nếu có là log điều tra các lần trước, không phải kết quả kiểm thử cuối.

### Cách chạy và nghiệm thu thực tế A/B/C/D

```bash
npm install
npm run dev
```

Mở URL Vite, chọn vòng tay, bật Auto Fit và Debug. Khởi tạo bằng bàn tay/cổ tay rõ, chờ calibration. Test A ở 100%, quay mặt ngoài → trong tại cùng khoảng cách; test B đổi 150% và lặp lại; test C gần/xa; test D đưa phần bàn tay ra khỏi khung, giữ cổ tay có texture/ánh sáng đủ rõ. Theo dõi nguồn thực, calibration ratio và proxy scale: Manual Fit không được đổi proxy. Sau đó tải log JSON để so sánh.

Vòng 3D có thể đổi bề rộng chiếu theo góc vì thiết kế oval; điều cần giữ là kích thước cơ sở tương đối, không phải pixel width bất biến. Manual quá nhỏ có thể bị proxy che vì vòng nằm trong mô hình cổ tay, không còn cơ chế phóng proxy theo vòng để che hiện tượng này.

Nếu muốn đo lại trong cùng nguồn, tắt rồi bật Dynamic Auto Fit khi bàn tay đang rõ để khởi tạo lại; Manual Fit không bị reset. Nếu đổi người, nên đưa tay ra rồi vào lại. **Chỉ kết luận hai lỗi được xử lý hoàn toàn sau khi người dùng nghiệm thu webcam thật.**

---

## Lịch sử: kiểm chứng đường biên ở lần sửa trước

Các mô tả 57 test, prediction 250 ms và Manual Fit tác động proxy dưới đây là hành vi cũ, được giữ để truy vết. Chính sách hiện tại là calibration phiên và scale độc lập như phần trên.

Phạm vi: phép đo ảnh, dữ liệu debug và vòng đời hiệu chuẩn. Không sửa `wristGeometry.ts`, orientation/filter tracking, hình học/material Three.js hoặc thử áo. Không thêm segmentation chưa được kiểm chứng.

## Lỗi đã tái hiện trước khi sửa

| Ca có ground truth | Trước sửa | Sau sửa |
|---|---|---|
| Ảnh tổng hợp cổ tay rộng 160 px, có hai vệt bóng bên trong da | Nhận nhầm vệt bóng thành cổ tay: width quy về mặt phẳng đeo khoảng 69 px, quality 0,932 | Loại ứng viên có màu nội vùng xuất hiện lại phía ngoài; không dùng biên nhỏ này |
| Hai mép dao động trái/phải, giữ cùng bề rộng | Vẫn chấp nhận, quality 0,874 | Loại vì đường biên không liên tục, dù width tương tự nhau |
| Không có phép đo tốt trên 250 ms, rồi có một frame rõ | Chỉ ẩn vòng nhưng vẫn giữ calibration; render lại sau một frame | Xóa calibration quá hạn, cần ba frame video rõ để nhận lại |
| Mất biên ngay sau một frame đang làm mượt size | Prediction dùng correction từ raw candidate thay vì radius thực sự vừa render | Correction lấy từ radius đã làm mượt, tránh bước nhảy khi bắt đầu dự đoán |

Không xác nhận lỗi scale nhân hai lần: root dùng `scale.setScalar(base × manual)`, không tích lũy. Band/gems có child scale 1,10 là khoảng hở thiết kế. Unit test giờ đối chiếu riêng `occluder.getWorldScale()` và `band.getWorldScale()` với debug; giữ nguyên các transform này.

Prior trong `analyzeWrist()` vẫn là giả định giải phẫu. Auto Fit không coi đó là số đo da: phải có biên ảnh hợp lệ mới fit ngược; mất biên không quay về render prior. Manual Calibration là lựa chọn dự phòng chủ động.

## Phép đo mới

`measureWristWidth()` trong `src/braceletSizing.ts`:

1. Giữ hệ trục từ tracking hiện có. Hướng đo ngang vuông góc hình chiếu trục cẳng tay, có xét viewing ray. Từ chối trường hợp trục chiếu suy biến.
2. Quét chín lát cắt phía cẳng tay của Hand[0], quanh vùng đeo; bỏ các lát cắt cũ đi vào phần bàn tay loe rộng. Palm length chỉ định phạm vi tìm kiếm, không được xuất ra như số đo cổ tay.
3. Giữ điều kiện tương phản/nội vùng/ngoại vùng; kiểm tra thêm màu giống nội vùng quay lại sau ứng viên. Trường hợp này có thể là vệt bóng, texture hoặc nền mơ hồ: loại thay vì fit một cổ tay nhỏ.
4. Khử ứng viên lân cận để một chuyển tiếp không chiếm hết danh sách. Kiểm tra cả hai contour liên tục và phù hợp hướng cẳng tay; cụm width giống nhau chưa đủ để chấp nhận.
5. Đánh giá residual của contour trơn thay vì coi sự loe dần tự nhiên là nhiễu. Vẫn cần tối thiểu ba lát cắt nhất quán và quality ≥ 0,65. Đây là chỉ số heuristic, không phải xác suất AI.
6. Giữ lại tọa độ các ứng viên, hai mép được chọn, lát cắt được nhận/bị loại và lý do để vẽ trực tiếp lên ảnh gốc.

Không bảo đảm mọi bóng đều bị loại: một vùng bóng rộng, áo hoặc vật che có thể trông giống silhouette thật. Kiểm tra màu xuất hiện lại có chủ ý bảo thủ; nền có vùng giống da cũng có thể làm phép đo bị từ chối.

## Debug trực tiếp trên frame

Bật **Debug Mode** trong tab vòng tay:

- **Xanh ngọc:** hai mép và đường nối của lát cắt hợp lệ; nhãn `Đo biên: … px` lấy khoảng cách hai mép thật trên ảnh.
- **Cam:** ứng viên/lát cắt bị loại. Chấm xám là ứng viên chưa được chọn. Khi chỉ thấy được một mép, không tự dựng mép còn lại.
- **Nét tím:** span lỗ vòng theo phép chiếu 3D hiện tại; nét vàng khi chỉ đang dự đoán. Đây là kích thước hình chiếu, không phải segmentation da.
- `measured`: Auto Fit đã nhận phép đo ảnh; `predictive`: dùng calibration gần nhất, không có phép đo mới; `rejected`: chưa đủ dữ liệu/chờ xác nhận, không render vòng; `manual`: người dùng chọn dự phòng thủ công.

Các lát cắt có thể xanh trong giai đoạn chờ ba frame nhưng trạng thái vẫn `rejected`: biên của frame có thể tốt, calibration video chưa được xác nhận. Frame ứng viên bị temporal gate loại không được gọi là `measured`.

Debug có **hai số đo ảnh riêng**: `Hai mép trên ảnh` là raw width tại lát cắt đã vẽ; `Wrist width (pixels)` được quy về mặt phẳng đeo để so với lỗ vòng. Không so trực tiếp raw width ở một lát cắt khác độ sâu với đường kính 3D. Các tọa độ overlay dùng chiều ngang ảnh cho cả X/Y; compositing mirror toàn bộ đúng một lần, chữ trong overlay được lật bù để đọc được.

## Scale và thời gian hiệu chuẩn

```text
width_at_wear_plane = raw_width × projected_proxy_at_band / projected_proxy_at_slice
base_radius = nghiệm phép chiếu proxy(radius) = width_at_wear_plane
proxy_world_scale = smoothed_base_radius × manual_fit
bracelet_mesh_world_scale = proxy_world_scale × existing_design_clearance
fit_ratio = projected_inner_diameter_px / measured_width_at_wear_plane_px
```

Không thay công thức camera, khoảng hở hay thêm hệ số phóng lớn. `projectedSpan()` dùng cùng phép chiếu như kiểm thử camera Three.js. Manual Fit nhân một lần, không bị Auto Fit ghi đè.

Mất biên nhưng Hand vẫn hợp lệ: dùng radius đã render gần nhất, cập nhật theo chuyển động/khoảng cách Hand tối đa **250 ms**. Hết hạn: xóa calibration và ẩn vòng; video đo lại ba frame rõ. Mất Hand/stale/đổi nguồn cũng xóa calibration như trước. Biến đổi size lớn cần xác nhận nhiều frame. Không có định danh người; nếu hai người thay tay mà landmark/ảnh gần như giống nhau và tracking không ngắt, không bảo đảm nhận biết việc đổi người.

## Kết quả đã chạy

- `npm test`: **57/57** unit test, bao gồm chín ca mới; đối chiếu ground truth pixel, hướng đo, bóng/texture, contour nhảy, taper, nền gần màu da, timeout, prediction từ size đã làm mượt và không báo fit ratio của ứng viên bị từ chối. Các test cũ vẫn kiểm tra cổ tay nhỏ/lớn, near/far, rotation, outlier, Manual Fit và camera projection.
- `npm run build`: kiểm tra TypeScript và production build.
- `npm run test:dynamic`: Chrome, Hand Landmarker thật, ảnh Google và luồng phát lại ảnh qua `captureStream`. Có kiểm tra màu pixel của đường đo trên Canvas, trạng thái rejected/manual và phục hồi tracking. Không phải webcam vật lý hoặc video xoay cổ tay 3D.
- `npm run test:ar`: hồi quy renderer/proxy/mirror, màu, hiệu chỉnh, PNG, thử áo, dọn camera và mobile; các ca orientation/occlusion hình học là fixture có kiểm soát.
- `npm run test:sizing`: Manual Fit 70/100/160/240/350%, giữ hiệu chỉnh qua nhiều frame, scale/projection, PNG và mobile.

Ở lần chạy đo đường biên:

| Cảnh | Width quy về vùng đeo | Lỗ vòng chiếu | Fit ratio |
|---|---:|---:|---:|
| Ảnh `pointing_up.jpg` | 79,4 px | 88,0 px | 1,108 |
| Replay đứng yên | 102,6 px | 114,0 px | 1,111 |
| Replay xa | 72,0 px | 79,4 px | 1,102 |
| Replay gần | 128,7 px | 142,5 px | 1,107 |
| Replay xoay ảnh 45° | 102,9 px | 114,8 px | 1,116 |

25 mẫu chuyển động liên tục: ratio 1,083–1,115; Manual Fit luôn 100%. Đây là consistency với width đã đo, **không chứng minh biên khớp da mọi frame**. Báo cáo/screenshot: `artifacts/dynamic-auto-fit.json`, `dynamic-pointing_up.jpg.png`, `dynamic-thumb_up.jpg.png`, `dynamic-replay.png`.

**Coverage thay đổi cần biết:** `thumb_up.jpg` từng được chấp nhận bằng vùng lấy mẫu cũ gần bàn tay. Vùng cẳng tay mới chỉ có hai lát cắt đủ rõ trên đường đọc ảnh của ứng dụng, nên hiện bị từ chối và chuyển được sang Manual Calibration. Công cụ đối chiếu cũng phát hiện hai đường đọc Canvas lệch tối đa 2 mức màu có thể làm một lát cắt sát ngưỡng được nhận/bị loại. Chưa giải quyết triệt để tính nhạy này; không hạ ngưỡng để ép ảnh qua. `woman_hands.jpg` chồng lấp vẫn bị từ chối. Khả năng Auto Fit ở mọi nền/ánh sáng chưa được nghiệm thu.

## Chạy và nghiệm thu webcam

```bash
npm install
npm run dev
```

Mở địa chỉ Vite, tab **Thử vòng tay**, bật **Dynamic Auto Fit**, giữ **Manual Fit 100%**, bật **Debug Mode**, rồi bật camera. Xem hai chấm đầu mút xanh có nằm đúng mép da không; không chỉ nhìn ratio. Cuộn bảng debug nếu cần xem scale riêng của proxy/vòng.

Thử lần lượt cổ tay nhỏ/lớn; đứng yên; gần/xa; di chuyển; nền gần màu da; bóng đổ; che tạm vùng cổ tay nhưng giữ bàn tay trong hình. Ghi nhận cả trường hợp biên được chấm xanh sai vị trí. Mất biên ngắn phải hiện `predictive`, quá 250 ms phải ẩn và chờ đo lại, không co về prior. Khi quay lại cần đủ ba frame rõ. Nếu `rejected` kéo dài, đổi nền/ánh sáng hoặc tắt Dynamic Auto Fit để calibration thủ công.

**Chưa chạy các ca này với webcam vật lý và nhiều người thật.** Chưa có segmentation cổ tay chuyên biệt hoặc thước đo mm. Hướng cổ tay vẫn chịu giới hạn tracking cũ; góc gập/che khuất mạnh có thể không đo được. Không khẳng định độ chính xác 100%, True-to-Size hoặc photorealistic.
