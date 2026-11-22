# Live Camera — phạm vi và bằng chứng

> Báo cáo của bước tách Live/Auto Fit trước đây. Bản sửa tiếp theo về trục cẳng tay, tâm vòng, swing/twist và occlusion nằm tại [live-wrist-axis.md](live-wrist-axis.md). Các số liệu dưới đây là lịch sử của bước trước.

Đã triển khai sửa riêng luồng Live. Chưa nghiệm thu bằng webcam thật; chưa xác nhận động tác xoay mu/lòng bàn tay 180° trên tay người thật. Không coi video phát lại từ ảnh là thử nghiệm chuyển động 3D thực.

## Bảo toàn trước khi sửa

Thư mục ban đầu chưa có Git. Đã tạo ZIP đầy đủ và manifest SHA256 tại `backups/pre-live-camera-20261121T111338Z/`, kiểm tra CRC archive; tạo commit baseline `d2659cc` và nhánh `fix/live-camera`. Giữ nguyên các file public/chưa commit; không reset, clean hoặc ghi đè project.

Upload trước sửa được chạy lại bằng ba ảnh chính thức MediaPipe: pointing_up, thumb_up, woman_hands. Baseline: `artifacts/live-camera-baseline/upload-occlusion/`. Bản sao source trước sửa cũng chạy độc lập trong thư mục tạm, chỉ thêm console log, để lấy số liệu Live trên cùng ảnh/canvas.

## Lỗi xác nhận trong source

1. `WristFilter.update()` trả null để đợi ba quan sát xác nhận cú nhảy, nhưng `useTryOn.updateWrist()` gọi `filter.reset()` khi null. Lần gọi sau mất bộ đếm và nhận pose trực tiếp. Test mới kiểm tra lần một/hai vẫn bị từ chối, lần ba mới nhận.
2. Filter cũ đi thẳng vào nhánh khởi tạo nếu khoảng cách frame >250ms, bỏ qua kiểm tra nhảy góc/dấu quaternion. Đây là khoảng trễ hoàn toàn có thể xảy ra khi chạy CPU.
3. `WristSizer` khóa calibration sau ba số đo đầu; các số đo tốt hơn về sau không thể sửa calibration sai lúc khởi tạo. Test có kiểm soát tái hiện size bị giữ ở 60% giá trị quan sát mới; bộ Live mới hội tụ về số đo đúng có giới hạn tốc độ.
4. Một frame biên yếu có thể xóa ROI dù Hand và calibration vẫn hợp lệ. Thay đổi nhãn handedness cũng có thể reset calibration. Live mới không dùng nhãn handedness hoặc anatomical prior để tự nhận dạng người mới.
5. ROI mặc định hết hạn tại khoảng cách frame 250ms. Lần phát lại đầu ghi nhận bị loại ở 296ms. ROI Live nay có giới hạn 500ms, vẫn yêu cầu correspondence thực, NCC uniqueness, kiểm tra ngược, RANSAC, giới hạn scale/góc và tuổi mốc 2 giây.
6. Bộ chọn feature chỉ ưu tiên corner, bỏ qua nhiều vùng nếp da/biên cổ tay. Live thêm ứng viên gradient trên nếp/biên; không giảm ngưỡng MediaPipe hoặc bỏ kiểm tra khớp. Test da trơn và sọc một chiều đảm bảo không coi aperture ambiguity là tracking thật.

Không phát hiện double-scale của Manual Fit trong model hiện tại: root rigid có scale=1; proxy và vòng có group riêng. Không xác nhận lỗi cross-product hay thứ tự quaternion hiện tại; không thay các phép đổi hệ tọa độ đã có. Ảnh phát lại chuẩn không tái hiện vòng nhỏ nghiêm trọng: bản cũ đã cho đường kính trong khoảng 116px, bản mới khoảng 114px. Vì vậy chưa thể gán mọi lỗi kích thước trên webcam của người dùng cho một nguyên nhân duy nhất.

## Pipeline Live mới

Camera → bitmap tối đa 960px → Hand, Pose khi chế độ forearm yêu cầu → wrist pose đã kiểm tra hình học → ROI RGB tại độ phân giải bitmap + segmentation body-skin theo nhịp tối thiểu 450ms → vị trí ngang từ hai biên → filter quaternion/vị trí/khoảng cách → sizing riêng cho Live → DTO tracking/sizing → renderer Lumière hiện có.

Segmentation và RGB phải thuộc đúng frame suy luận. Không dùng mask của frame cũ. Tracking ROI dùng bản 640px của chính frame đó để giảm chi phí; đo biên không dùng bản 640px này. CSS contain/letterbox không tham gia tính scale. Toàn bộ frame + overlay được mirror một lần khi ghép Canvas.

`LiveWristFilter` giữ các candidate bị từ chối, dùng slerp và chuẩn hóa nhánh quaternion; không nội suy Euler. Tương đương local-Z π chỉ áp dụng cho hình học Lumière hiện tại (oval torus + 22 viên đá đối xứng); unit test kiểm tra đối xứng hình học. Trục cẳng tay là local +Z; không tự sửa pitch/yaw từ segmentation thiếu dữ liệu độ sâu. Cận cảnh vẫn cần giả định cổ tay thẳng; forearm dùng Pose khi quan sát được khuỷu tay.

Vị trí ngang được hiệu chỉnh từ các cặp biên tốt, giữ dưới dạng hệ số tương đối với distance reference và lọc liên tục giữa các frame. Phép đo kích thước không thay geometry, material, ánh sáng hoặc orientation. Không áp dụng một hiệu chỉnh hướng chỉ trên các frame có mask vì có thể tạo dao động theo nhịp segmentation.

## Công thức và các hệ đơn vị

- Điểm ảnh dùng `u=x/W`, `v=y/W` ở cả hai trục. Hệ CV có +X sang phải, +Y xuống, +Z xa camera; đơn vị scene không phải mét/mm.
- `rMeasured = radiusFromImageWidth(pose, measuredWidthPx/W)`: nghiệm bisection của hình chiếu perspective ellipse proxy hiện có, không chia cho cos(góc) hay bù hai lần.
- `k = median(rMeasured / distanceReference)` từ ít nhất ba quan sát nhất quán, mỗi quan sát có ≥5 lát cắt và quality ≥0.8. Không lấy anatomical prior làm phép đo.
- `rFrame = k × filteredDistanceReference(frame)`. `k` giữ qua biên yếu/xoay; chỉ tiếp nhận nhiều phép đo mới gần góc tham chiếu, lòng/mu đủ đối diện camera. Điều chỉnh k tối đa 0.18 đơn vị log/giây của thời gian cập nhật bị giới hạn; một outlier không làm nhảy size.
- `proxyGroupScale = rFrame`; `braceletGroupScale = rFrame × manualFit`. Mesh có clearance thiết kế sẵn 1.10 như trước. Debug `finalBraceletWorldScale` bao gồm scale thiết kế này. Manual không đổi tâm, q, proxy hoặc k.
- Mẫu hiện tại là Visual Auto Fit. Asset fixed-size bị chặn tự resize; chưa có hiệu chuẩn mm để làm True-to-Size.

## Trạng thái và giới hạn mất dữ liệu

| Trạng thái developer | Hành vi |
| --- | --- |
| ACQUIRING | Có thể đã thấy Hand nhưng chưa đủ các phép đo nhất quán; chưa render vòng theo prior. |
| TRACKING | Có pose hợp lệ và fit từ quan sát đã xác nhận. |
| DEGRADED | Pose Hand còn tốt nhưng đang giữ calibration, hoặc đang tiếp tục bằng correspondence ROI có kiểm tra. |
| LOST | Không có nguồn hợp lệ/hết tuổi mốc; ẩn vòng, chờ nhận diện/đo lại. |

Không vẽ pose cũ lên ảnh webcam mới. Calibration scalar giữ qua mất Hand ngắn, hết 1.5 giây nếu không có quan sát hợp lệ thì phải đo lại. ROI có dữ liệu ảnh riêng được tiếp tục tối đa 2 giây, giữ depth/twist/size từ Hand gần nhất, không tự suy ra chuyển động 3D. Frame tổng tuổi >1000ms hoặc quá 500ms từ receipt bị ẩn; kiểm tra tuổi lại sau công đoạn đo ảnh.

## File thay đổi

| File | Vai trò |
| --- | --- |
| `src/liveWristTracking.ts` | LiveWristFilter, LiveWristSession, LiveWristPlacement; tách khỏi Upload. |
| `src/liveWristSizing.ts` | LiveWristSizer; intrinsic/distance/manual độc lập, hiệu chỉnh có điều kiện. |
| `src/useTryOn.ts` | Nhánh Live riêng, đo native ROI, kiểm tra frame, reset tài nguyên, developer log. |
| `src/vision.worker.ts` | Thêm yêu cầu segmentation Live theo nhịp, trả mask + bitmap của cùng frame. |
| `src/wristRoiTracking.ts` | Tham số Live chọn nếp/biên và gap500ms; mặc định cũ 250ms/corner giữ nguyên. |
| `src/wristDiagnostics.ts` | Trường live tùy chọn; dữ liệu Upload không đổi. |
| `src/liveWrist.test.ts` | 20 unit tests mới cho scale, quaternion, state, frame, ROI, adversarial texture. |
| `scripts/verify-live-camera.mjs` | Trình duyệt dùng actual MediaPipe VIDEO + canvas captureStream, lưu JSON/PNG. |

Không thay `braceletModel`, `braceletDimensions`, `braceletRenderer`, `wristGeometry`, `braceletSizing`, các thuật toán Upload, App/CSS hoặc thử áo. Hash các module được bảo vệ: `artifacts/live-camera/source-integrity.json`.

## Kết quả kiểm tra

- `npm test`: **127/127 pass**; gồm 20 test Live mới. Hai kích thước cổ tay và xoay 180° là fixture hình học có kiểm soát, không phải quan sát webcam người thật.
- `npm run build`: TypeScript + Vite pass.
- `npm run test:live`: pass actual Hand VIDEO inference + segmentation theo nhịp, đo/khoảng cách, roll ảnh, Manual130, ROI khi Hand mất, hết hạn và reacquire mới, dừng stream. Chụp/lưu được gọi trên UI. Không thay detector bằng landmark giả.
- `npm run test:upload-occlusion`: pass. **15 PNG** render A/B và debug phép đo trên ba ảnh, Manual100/98, byte-identical baseline. Canvas UI khớp render B. File `comparison.png` của trang báo cáo tổng hợp không dùng làm baseline renderer. Xem `artifacts/live-camera/upload-regression.json`.

Số liệu phát lại lần cuối (cùng một ảnh; gần/xa bằng đổi tỷ lệ ảnh):

| Trường hợp | Wrist chiếu (px) | Đường kính trong vòng chiếu (px) |
| --- | ---: | ---: |
| Đứng yên, Manual100 | 103.02 | 114.38 |
| Ảnh scale0.8 | 82.99 | 92.14 |
| Ảnh scale1.15 | 119.00 | 132.16 |
| Manual130 | 103.00 | 148.82 |

Biên quan sát đứng yên là 103px, vòng/biên khoảng 1.11; góc đổi giữa frame đứng yên tối đa trong cửa sổ kiểm tra khoảng 0.053°. ROI trong lần cuối có 14/14 inliers, RMS0px trên ảnh phát lại; số đo này không đại diện cho tay thật có nhiễu/chuyển động. Có lần kiểm thử trước nhận 15 inliers. Báo cáo đầy đủ: `artifacts/live-camera/report.json`, `debug-log.json`, `stationary.png`, `partial-hand.png`. Trước sửa: `artifacts/live-camera-baseline/live-before.json` và `live-before.png`.

## Chạy và nghiệm thu thực tế còn lại

```sh
npm install
npm run dev
# Terminal khác, Vite còn chạy:
npm test
npm run build
npm run test:live
npm run test:upload-occlusion
```

Nếu dùng cổng khác: `AR_URL=http://127.0.0.1:5181 npm run test:live`. Chrome headless cần môi trường cho phép khởi chạy browser. Bật Debug Mode và lọc Console `[mira-live]` để ghi lại đo/góc/scale khi thử:

1. Bắt đầu độ vừa 100%, ánh sáng đều, đưa lòng/mu và cổ tay vào khung. Chờ đủ phép đo, giữ yên khoảng 5 giây.
2. Giữ tư thế, đưa gần/xa chậm. Đối chiếu hai mép debug với da thật; tỷ lệ lỗ vòng/biên quanh 1.1 ở góc hỗ trợ, có sai số do tiết diện giả định.
3. Xoay mu → cạnh → lòng chậm 180°, rồi nghiêng cẳng tay. Khi world landmarks không đáng tin cậy/góc axial, chấp nhận ẩn vòng thay vì giả pose. Gập cổ tay cần forearm + khuỷu tay/Pose đủ rõ.
4. Đưa ngón tay ra khỏi khung nhưng giữ cổ tay có texture; đối chiếu nguồn ROI. Vùng da trơn/che khuất mạnh sẽ không duy trì được ROI.
5. Rời khung lâu >2 giây rồi trở lại; thử người thứ hai sau khi mất tracking/đo lại. Hệ thống không nhận dạng danh tính; đổi người rất nhanh ở cùng vị trí có thể không phân biệt được.
6. Kiểm tra occlusion trực tiếp ở từng góc, chụp PNG; Upload lại ảnh đang dùng và so với kết quả trước sửa.

**Còn giới hạn:** webcam RGB + Hand world là ước lượng học máy, không đo được tiết diện/độ sâu cổ tay chính xác hoặc chu vi mm. Depth proxy hiện có giữ nguyên, chưa có mesh da 3D thực. Selfie body segmentation không phải bộ tách cổ tay chuyên dụng và có thể fail dưới ánh sáng/nền khó. Không bảo đảm 180°/nghiêng mạnh với Hand-only hoặc tracking cổ tay độc lập vô hạn. Chưa thử webcam thật, xoay tay 180° thật, hai người thật, nền giống da/bóng đổ trong chuyển động hoặc mọi mức CPU. Các trường hợp đó còn cần nghiệm thu, chưa kết luận sửa hoàn toàn.
