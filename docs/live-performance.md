# Live Camera: đo và tối ưu hiệu năng

Đã tối ưu pipeline Live dựa trên CPU profile và số liệu trước/sau. **Chưa nghiệm thu webcam người thật.** Tất cả số FPS dưới đây thuộc Chrome headless, MediaPipe VIDEO thật trên ảnh được phát bằng `captureStream(30)`, không phải camera vật lý hay video lật cổ tay 3D.

## Checkpoint và phạm vi

Trước sửa: nhánh `fix/live-camera`, có thay đổi chưa commit từ các bước trước. Đã sao lưu source, script, tài nguyên model/WASM và tài liệu vào `backups/pre-live-performance-20261122T023030Z/project-state.zip`, kèm manifest SHA256, Git status, diff; CRC ZIP đã kiểm tra. Các artifacts trước đó giữ tại chỗ. Không reset/clean hay ghi đè project.

Để đối chứng lại, giải nén checkpoint vào thư mục tạm và chạy server riêng; bộ đo cuối chạy tuần tự trên bản cũ và mới. Server người dùng ở cổng5173 không bị dừng. Các server5182/5183 chỉ dùng kiểm thử.

Giữ nguyên model Lumière, geometry, material, lighting, camera projection, forearm basis, swing/twist, temporal filters, sizing/calibration, Manual Fit và continuity/grace. Không thêm UI/control, không giảm confidence hay resolution. Không đổi App/CSS, chế độ sáng/tối hoặc renderer áo.

## Nguyên nhân có bằng chứng

1. **Performance lag trên main thread.** MediaPipe vốn đã ở Worker, nhưng `useTryOn.updateWrist()` đọc native ROI và chạy RGB/segmentation boundary/mask trên main. Trong bản cũ, vòng lặp mask gọi `backgrounds.map(distance)` trên từng pixel; `distance` lại tạo mảng và `Math.hypot`. CPU profile đứng yên tập trung ở `imageWristMeasurement.distance`, không phải Three.js. Main xử lý trung bình khoảng81ms/kết quả khi đứng và106ms khi ảnh chuyển động. Điều này chặn RAF, xử lý sự kiện và nguồn replay.
2. **Khoảng trống giữa các pose.** Segmentation chạy mỗi450ms, thường mất khoảng140ms trong Worker, ngay cả khi RGB đã có biên tốt. Đây là một nguyên nhân của các khoảng cập nhật dài, không phải lỗi quaternion.
3. **Scheduling theo RAF/currentTime.** Một request đang xử lý đã được giới hạn, nên không có bằng chứng hàng đợi tăng vô hạn. Tuy vậy `video.currentTime` có thể tiến giữa hai frame decode; pha ảnh trống của baseline ghi nhận7 request cùng camera frame. Chờ callback mới sau khi Worker rảnh cũng có thể bỏ lỡ frame mới nhất đã tới trong lúc bận.
4. **Công việc lặp trên main/React.** Render loop ghép lại cùng bitmap/debug overlay nhiều lần dù pose không đổi; React publish tracking/metrics ở mỗi kết quả. Ví dụ baseline pha mất tay có khoảng92 composition/s cho nguồn30fps, trong khi GL scene thực sự thay đổi dưới1fps. Con số composition này không thể gọi là92 FPS tracking.

Không có bằng chứng cần tăng smoothing để giải quyết các nút thắt trên. Không sửa các hệ số filter hoặc công thức orientation/Auto Fit. Thời gian gửi lệnh GL chỉ khoảng0.2–0.3ms trong phép đo này; đây là CPU submission, không phải phép đo thời gian GPU hoàn tất.

## Thay đổi theo tầng

| File | Thay đổi |
| --- | --- |
| `src/liveForeground.ts` | Phép phân loại foreground tương đương: bỏ cấp phát mảng trong vòng pixel, dừng khi đã khớp một nền; chỉ gộp prototype bằng nhau chính xác. Giữ `Math.hypot`, threshold và mask resolution. |
| `src/imageWristMeasurement.ts` | Tham số `liveFastMask` mặc định false; chỉ Live bật. Forward cờ khi refine lại trục. Các lát cắt, chọn biên, reject, width và đường Upload mặc định không đổi. |
| `src/liveVision.ts` | Chuyển nguyên chuỗi observation Live sang Worker: Hand geometry → native crop → contour/Pose → forearm → measurement/mask. Dùng OffscreenCanvas tái sử dụng; không thay công thức. Trả pixel ROI/pose/mask cùng timestamp của bitmap đó. |
| `src/vision.worker.ts` | Gọi observation processor chỉ cho Live bracelet; transfer buffer pixel/mask thay vì copy. Thêm thời gian Hand/Pose/skin/observation. Upload và áo không chạy processor này. |
| `src/liveFrameClock.ts` | `requestVideoFrameCallback`, fallback RAF/decode counter nếu có. Chỉ nhận frame mới, tối đa một request gồm cả thời gian tạo ImageBitmap; giữ một metadata frame mới nhất khi bận, không giữ hàng đợi bitmap. Worker rảnh thì lấy video hiện tại nếu frame đó chưa được xử lý. Cancel callback khi dừng. |
| `src/liveTaskBudget.ts` | Khi biên đã đủ chất lượng, khoảng semantic observation dựa vào chi phí skin đo được, mục tiêu khoảng10% thời gian, giới hạn450–2000ms. Biên yếu/mất phép đo trở lại nhịp450ms cũ. Không tái sử dụng mask semantic cũ trên ảnh mới. |
| `src/livePerformance.ts` | Telemetry số liệu có giới hạn bộ nhớ, không pixel/network/React. Đếm riêng camera, inference, composite, GL; latency, delta và state transition. |
| `src/useTryOn.ts` | Camera acquisition độc lập RAF render. Handler chỉ cập nhật tracking; RAF dùng pose/frame hợp lệ mới nhất và cache composition giống nhau. Publish UI khoảng4Hz, thay đổi trạng thái quan trọng hiện ngay. Dừng/đổi tab giải phóng callback, bitmap và worker. Browser thiếu OffscreenCanvas dùng nhánh main cũ. |
| `src/braceletRenderer.ts` | Chỉ thêm counter và thời gian CPU quanh `renderer.render()`; không đổi scene, mesh, material, lighting hoặc chất lượng render. |
| `src/types.ts` | DTO observation và worker stage timings. |
| `src/livePerformance.test.ts`, `src/imageWristMeasurement.test.ts` | Test mask equivalence, scheduler/duplicate/latest frame/cancel/fallback, task budget, telemetry và invariants của pose. |
| `scripts/verify-live-performance.mjs` | Benchmark thực tế trước/sau; CPU profile và toàn bộ số liệu ở artifacts. `verify-live-axis` instrument đúng URL module Vite; `verify-upload-occlusion` đối chiếu thêm fast mask với phép đo cũ trên ảnh thật. |

### Inference, rendering và giới hạn nội suy

RAF không chờ MediaPipe. Handler không gọi Three.js trực tiếp cho Live; renderer dùng quan sát hợp lệ mới nhất, có cache khi không đổi. Giữ cặp ảnh/pose/mask cùng frame để tránh vòng trượt trên da. Không nội suy pose cũ lên video mới chưa được quan sát, không thêm ngoại suy vô hạn. Grace300ms và giới hạn stale/ROI của bản trước giữ nguyên.

Vì vậy **RAF60fps không đồng nghĩa có60 pose mới hoặc video composition mới mỗi giây**. Kết quả dưới đây báo riêng GL/composite thật. Khi semantic task chậm vẫn có thể thấy khoảng cập nhật; không che vấn đề đó bằng số FPS của RAF hoặc tăng smoothing. Nội suy chuyển động độc lập trên video mới cần thêm phép đo optical flow/depth đáng tin cậy, nằm ngoài bản tối ưu giữ nguyên orientation này.

## Số liệu trước/sau

Bằng chứng: `artifacts/live-performance/before-confirmed/report.json` và `after/report.json`; cùng bộ đo, ảnh, viewport, resolution và shader. Có profile main-thread dạng `.cpuprofile`. Lượt `mask-only/` đo riêng tối ưu vòng pixel: main khoảng15.7ms, camera gần30fps, không long task trong5 giây.

| Chỉ số | Trước | Sau |
| --- | ---: | ---: |
| Camera presented FPS, đứng10s | 17.69 | 29.93 |
| Inference/GL cập nhật thật, đứng10s | 7.26 | 25.55 |
| Main handler trung bình, đứng | 80.94ms | 4.69ms |
| Main long tasks, đứng10s | 55 | 0 |
| Camera presented FPS, chuyển động20s | 14.81 | 30.00 |
| Inference/GL cập nhật thật, chuyển động20s | 5.99 | 21.85 |
| Main handler trung bình, chuyển động | 105.80ms | 4.67ms |
| Capture request → pose sẵn sàng, trung bình | 165.50ms | 45.40ms |
| Khoảng giữa kết quả pose, p95 | 440.90ms | 56.30ms |
| Main long tasks, chuyển động20s | 84 | 0 |
| React commits/s, chuyển động | 5.99 | 3.60 |
| Frame kết quả ẩn vòng, chuyển động | 0 | 0 |
| Số request đồng thời tối đa | 1 | 1 |

Camera FPS được tính từ chênh lệch `presentedFrames`, không chỉ số callback. Callback FPS có trường riêng. Nguồn ảnh replay dùng RAF nên main thread cũ cũng làm nguồn phát chậm; không suy ra camera sensor vật lý trước sửa chỉ đạt15fps. Pha ảnh trống sau sửa không có duplicate request trong lượt đo, bản cũ có7.

Telemetry sau sửa đo capture request → composition hoàn tất; ví dụ cửa sổ2s cuối pha chuyển động có trung bình47.3ms, p95 khoảng64.8ms, max170.1ms. Đây không phải sensor-to-screen webcam latency. `sensorToPresentMs` chỉ có số nếu browser cung cấp `captureTime` thực tế, không tự giả định một giá trị.

Delta quaternion giữa hai kết quả, p95 pha chuyển động: khoảng0.2005→0.0372rad. Delta log-radius p95: khoảng0.02388→0.00830. Nhịp lấy mẫu dày hơn làm delta mỗi frame nhỏ hơn; **không coi đây là bằng chứng độ chính xác orientation hay kích thước vật lý tăng**. Không sửa filter. Sau pha xoay nhanh rồi dừng, range tâm trong2s cuối khoảng0.46px (baseline0.31px); cả hai đều là fixture tĩnh, chưa có số liệu jitter trên da/người thật.

Chưa đạt30 cập nhật pose/GL mới liên tục trong mọi pha. Replay gần/xa đạt khoảng22.2 cập nhật/s; tác vụ semantic vẫn có đỉnh khoảng160–170ms. Không giảm độ phân giải hoặc thay chất liệu để lấy FPS. Các kiểm tra generation và bản vá telemetry/nhãn LOST cuối chỉ bảo vệ restart/expiry/metadata, không đổi các đường đang tracking được dùng trong benchmark.

## Debug và kiểm thử

Giữ Debug Mode hiện có. Console lọc:

- `[mira-perf]`: mỗi giây, camera/inference/composite/GL FPS, số request đang chờ và tối đa, frame không được gửi suy luận, duplicate/busy callback, các stage ms, interval/delta/state transitions. Cửa sổ thống kê2s, bộ nhớ giới hạn. Frame không được suy luận gồm tối đa một frame mới nhất đang chờ được lấy, không phải request đã xếp hàng.
- `[mira-live]`: pose, trục, nguồn hướng/depth, measurement/calibration và lý do reject theo frame như trước.

`observationThread` phải là `worker` khi có OffscreenCanvas; `main-fallback` là đường tương thích chậm hơn. `captureToPresentMs` tính từ lúc ứng dụng yêu cầu bitmap, không phải lúc photon chạm sensor. `webglFPS` chỉ tăng khi có lệnh render GL thật, cache hit không được tính thêm.

Kết quả trên bản cuối:

- `npm test`: **190/190 pass**; `npm run build`: **TypeScript + Vite pass**; `git diff --check` không lỗi.
- `test:live-continuity`: pass; đứng10s có220 kết quả suy luận, chuyển động ảnh20s có397 kết quả, không có frame ẩn vòng. Task Pose bị chặn vẫn khởi tạo bằng Hand; blank frame dùng grace đúng ảnh/pose; mất dài đo lại; renderer/controller/worker vẫn mỗi loại một instance khi đổi theme.
- `test:live-axis`: pass các góc ảnh0/20/45/90/180 và A/B/C occlusion. Ở ảnh20°, residual tâm khoảng0.24px; đây là fixture ảnh xoay, không phải sai số trên cổ tay thật.
- `test:live`: pass gần/xa, Manual130% tách proxy, correspondence ROI thật trong lượt này, hết hạn và đo lại, PNG và dừng camera. ROI vẫn có thể reject da ít texture như giới hạn cũ.
- `test:upload-occlusion`: pass. **15/15 PNG byte-identical** với kết quả trước sửa; ba ảnh mẫu được đối chiếu thêm phép đo/mask fast và legacy. `upload-regression.json` chứa SHA256 từng ảnh.
- Smoke test áo: Pose IMAGE/VIDEO thật trên `pose.jpg`, màu/size/PNG, không đi qua processor vòng, dừng track khi chuyển tab và mobile đều pass; `shirt-regression.json` lưu kết quả.
- `protected-sources.json`: **17 module/UI nguồn được bảo vệ byte-identical**, gồm orientation/filter/calibration, model và dimensions, occlusion, shirt, App/CSS/theme. Renderer chỉ thêm telemetry, measurement module chỉ thêm đường mask Live tương đương như mô tả trên.

Log và số liệu tổng hợp tại `artifacts/live-performance/`; `comparison.json` là đối chứng cùng bộ đo. Unit test kiểm tra fast mask giữ nguyên toàn bộ measurement/reject và mask bytes, gồm shadow/highlight/ambiguous/refinement. Test scheduler bao gồm callback cũ bị gọi trễ sau stop/restart không tạo thêm vòng lặp acquisition.

```sh
npm install
npm run dev
# Terminal khác, giữ Vite chạy:
npm test
npm run build
npm run test:live-performance
npm run test:live-continuity
npm run test:live-axis
npm run test:live
npm run test:upload-occlusion
```

Chạy từng suite Chrome tuần tự. `AR_URL` chọn server thử nghiệm; `PERF_TAG` đặt thư mục kết quả. Chrome headless có overhead instrumentation/profile, DevTools đang mở cũng có thể ảnh hưởng FPS; không so trực tiếp với webcam thiết bị khác.

## Nghiệm thu webcam còn lại

Tải lại toàn trang để worker mới được nạp. Manual100%, giữ cổ tay10s; nghiêng chậm trái/phải; xoay20s; xoay nhanh rồi dừng; gần/xa; rời khung rồi quay lại. Quan sát riêng camera có giật, vòng có rung, hay vòng theo chậm. Đối chiếu pose interval, skin/observation/main ms và capture-to-present thay vì chỉ nhìn AI ms.

Giữ các góc có dữ liệu forearm/Hand đáng tin cậy; không bắt buộc khuỷu tay. Khi nguồn hướng là hand-assumption/hand-calibrated, đây vẫn là giả định cổ tay thẳng/cứng như bản trước. Góc 3D không quan sát được, cổ tay bị che nhiều hoặc da thiếu texture vẫn có thể degrade/ẩn; bản tối ưu không biến ROI2D thành tracker cổ tay3D độc lập.

Cuối cùng tải lại các ảnh đang dùng, chọn màu, sáng/tối, chụp PNG và thử tab áo. Cần người dùng nghiệm thu trực tiếp trên webcam/các góc đang lỗi trước khi kết luận trải nghiệm đã đạt yêu cầu.
