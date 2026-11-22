# Sửa riêng kích thước vòng tay

> Báo cáo sizing giai đoạn trước. **Bản hiện tại** đã tách Manual Fit khỏi proxy và dùng calibration trong phiên + ROI có kiểm chứng. Xem [báo cáo mới nhất](wrist-measurement-debug.md). Các số và mô tả parent scale bên dưới là lịch sử sửa clamp, không phải kiến trúc hiện tại.

## Nguyên nhân xác nhận từ code trước sửa

1. `wristGeometry.ts` lấy bán kính từ `clamp(breadth * 0.44, palmLength * 0.32, palmLength * 0.52)`. Đây là prior từ các điểm xương bàn tay, **không đo bề rộng da cổ tay**. Prior có thể thấp hơn cổ tay thật; tăng một hệ số cố định không chứng minh được độ vừa trên người khác. Công thức tracking này được giữ nguyên, dùng làm prior/fallback, không đổi orientation hoặc vị trí.
2. `applyCameraPose()` có `clamp(manualSize, 0.65, 1.4)`. Do đó dù nhập 160%, 240%… renderer vẫn chỉ nhận 140%. Slider cũ cũng dừng ở 140%.
3. **Không tìm thấy Auto Fit ghi đè Manual Fit**: `fits.bracelet` thuộc state React, chỉ đổi ở điều khiển người dùng/Đặt lại; vòng lặp AI không gọi `setFits`. Cần giữ cấu trúc này, không “sửa” một reset không tồn tại.
4. Parent scale là `radius × manual`; child band/gems có scale 1.10 để tạo khoảng hở thiết kế. Đây **không phải Manual Fit bị nhân hai lần**. Các scale này được gán lại bằng `setScalar`, không `multiplyScalar` qua từng frame.
5. Không có lỗi nhân/chia 1.000 giữa mét và pixel trong bước render: world landmark được fit sang hệ scene theo chiều rộng ảnh; camera dùng cùng hệ đó. Scene **không phải mm**, và đường kính luôn bằng hai lần bán kính. Phép chiếu CV và Three.js đã được đối chiếu bằng test.

Không có video webcam riêng của người dùng ở lần sửa này, nên chưa thể xác nhận prior sai bao nhiêu trên cổ tay cụ thể đó. Hard clamp 140% là lỗi xác nhận trực tiếp từ code và kiểm thử.

## Sizing mới, không thay tracking/orientation/occlusion

`braceletSizing.ts` dùng các lát cắt vuông góc trục tay ở vị trí đeo, trên **ảnh gốc cùng frame AI**, không đọc ảnh đã vẽ vòng. Màu vùng trung tâm được học cục bộ; không có ngưỡng màu da cố định. Chỉ nhận phép đo khi thấy hai cạnh có tương phản và ít nhất ba lát cắt nhất quán. Vải, texture, nền tương tự da, tay bị che hoặc biên không rõ sẽ chuyển sang **Calibration thủ công**, kèm thông báo trên bảng size.

Đây là đo biên ảnh có kiểm tra chất lượng, chưa phải skin segmentation hoặc phép đo cơ thể chính xác. Có thể không nhận được biên da thật trong cảnh phức tạp. Ảnh mẫu `woman_hands.jpg` đã kiểm tra bị từ chối đo biên; app báo calibration thay vì tự phóng một hệ số lớn.

Khi phép đo đủ rõ, tính chiều rộng dự kiến của lát cắt proxy bằng cách chiếu ellipse 3D qua camera thật đang dùng. Giải ngược bán kính để chiều rộng chiếu bằng chiều rộng quan sát. Không so trực tiếp pixel với scene unit. Hệ số hiệu chỉnh được làm mượt theo log-scale; một frame nhiễu không được tăng size gấp đôi. Khi tạm mất đo biên, giữ hiệu chỉnh tương đối và thay đổi theo hand scale để không khóa một số pixel cố định khi tay tiến/lùi; giao diện vẫn báo cần calibration.

Chỉ radius đưa vào renderer được thay; center, quaternion, worker, kiểm tra tracking và cấu trúc depth mesh không đổi. Manual Fit vẫn ở state riêng, nhân đúng một lần sau khi tính base scale:

```text
finalWorldScale = baseScale × manualFitMultiplier
```

Không còn clamp 140% trong renderer. Slider mặc định 70–160%, ô **Manual Fit (%)** cho nhập lớn hơn; slider tự mở rộng theo số nhập. Số âm, NaN và vô hạn không phải hiệu chỉnh hợp lệ. Các giá trị lớn là lựa chọn rõ ràng của người dùng, không phải scale tự động được hardcode.

Manual Fit hiệu chỉnh đồng đều **vòng và proxy ước lượng**, đúng chức năng calibration hiện có; không thay chu vi sản phẩm theo mm. Estimated wrist trong debug là proxy **sau hiệu chỉnh**. Số đo da độc lập được hiển thị riêng ở `Observed wrist width`; không được nhầm proxy đã chỉnh với bề rộng da đo được.

## Hợp đồng đơn vị và đường kính

`braceletDimensions.ts` là nguồn thông số chung cho geometry, sizing và debug; tỷ lệ thiết kế không đổi:

| Đại lượng local | Giá trị |
|---|---:|
| Torus major radius | 1.12 |
| Tube radius | 0.10 |
| Oval của vòng | 0.84 |
| Scale khoảng hở thiết kế, chỉ ở band/gems | 1.10 |
| Proxy radius tại mặt phẳng đeo z=0 | 1.02 |
| Proxy oval | 0.72 |
| Inner major radius vòng sau design scale | `(1.12 − 0.10) × 1.10 = 1.122` |

Với `F = baseScale × manualFitMultiplier`:

```text
estimated wrist diameter = 2 × 1.02 × F
bracelet inner diameter  = 2 × 1.122 × F
```

Trục nhỏ tương ứng nhân 0.72 cho proxy, 0.84 cho vòng. Lỗ vòng lớn hơn proxy khoảng 10% ở trục lớn và 28% ở trục nhỏ. Không bảo đảm cùng tỷ lệ đó ở đường kính chiếu pixel vì hình oval và phối cảnh; debug chiếu cả hai hình trong cùng hệ camera và cùng hướng ngang cổ tay.

## Debug bắt buộc

Bật Debug Mode để xem:

- Estimated wrist diameter — hai trục proxy sau calibration, đơn vị scene `u`.
- Bracelet inner diameter — hai trục lỗ vòng sau scale, cùng `u`.
- Base scale — scale đã fit từ ảnh hoặc fallback/calibration trước.
- Manual fit multiplier — đúng state người dùng, không bị Auto Fit thay.
- Final world scale — tích của hai dòng trên.
- Projected bracelet diameter — **đường kính trong** chiếu ngang trục tay, pixel Canvas.
- Estimated wrist width — lát cắt proxy cùng camera/hướng, pixel Canvas.
- Observed wrist width — số đo biên ảnh độc lập; `—` khi không đủ tin cậy.

`u` không phải mm. `px` là pixel của Canvas gốc, không phải kích thước CSS trên màn hình; debug ghi rõ chiều ngang Canvas. Ảnh/camera mirror không đổi độ dài, vì ảnh và vòng được lật chung một lần.

## Giá trị trước/sau đã chạy

Ảnh mẫu MediaPipe, Canvas ngang 640px, cùng tư thế và base scale 0.06489007:

| Yêu cầu Manual Fit 240% | Trước sửa (bị clamp 140%) | Sau sửa |
|---|---:|---:|
| Final world scale | 0.09084610 | 0.15573617 |
| Projected inner diameter | 122.0px | 209.5px |

Đây là xác nhận điều khiển 240% có tác dụng, **không phải khuyến nghị đeo vòng ở 240%**.

Ca kiểm thử công thức có kiểm soát, dùng chiều rộng mục tiêu 100px (không phải khẳng định cổ tay trong ảnh mẫu rộng 100px):

| Đại lượng | Prior landmark | Sau giải ngược từ 100px |
|---|---:|---:|
| Base scale | 0.06489007 | 0.08748133 |
| Estimated wrist width | 74.2px | 100.0px |
| Projected inner diameter | 87.1px | 117.5px |

Ở ảnh mẫu thực, phép đo biên không đủ tin cậy nên tại Manual Fit 100%, scale vẫn 0.06489007; app báo calibration. Không giả vờ đã đo được 100px hoặc tự tăng scale để tạo kết quả đẹp.

## Kiểm thử và cách chạy lại

```bash
npm test
npm run build
```

38/38 unit test đã qua, gồm 10 test sizing mới: đo cạnh ảnh tổng hợp ở nhiều màu, fallback ảnh phẳng, fit ngược phối cảnh, 70/100/160/240/350%, 100 frame không tích lũy scale, khoảng hở hai trục, debug so trực tiếp với camera Three.js, gần/xa, một frame nhiễu và đầu vào không hợp lệ.

Giữ dev server chạy rồi ở Terminal khác:

```bash
npm run test:sizing
```

Chrome headless dùng ảnh mẫu MediaPipe thật và luồng phát lại, không bật webcam vật lý. Test đã kiểm tra đủ bảy số debug, size tới 350%, 240% giữ nguyên qua khởi động camera và ít nhất 12 frame AI, PNG và mobile. Xem `artifacts/sizing-verification.json`, `sizing-debug.png`, `sizing-photo.png`. Kiểm thử auto measurement dương tính dùng hình học/ảnh tổng hợp có kích thước biết trước; ảnh mẫu thật kiểm chứng nhánh calibration.

## Nghiệm thu bằng webcam của bạn

1. Chạy `npm run dev`, bật camera, Debug Mode và cận cảnh/cổ tay thẳng như trước. Giữ bàn tay và cổ tay rõ, nền khác màu da, ánh sáng đều.
2. Đặt Manual Fit 100%. Nếu có Auto Fit ảnh, so `Observed wrist width` với `Estimated wrist width`; khi ổn định chúng nên gần nhau. `Projected bracelet diameter` phải nhỉnh hơn width của proxy.
3. Nếu hiện Calibration thủ công, chỉnh Độ vừa cho lưới cyan tại vị trí đeo khớp bề ngang da. Nếu 160% chưa đủ, nhập 180%, 200%… trong Manual Fit (%), mỗi lần tăng ít. Không cần sửa source hoặc chạy lại npm.
4. Theo dõi `Final world scale = Base scale × Manual fit multiplier`; nhập 200% phải tăng scale gấp đôi so cùng base 100%. Kiểm tra số multiplier giữ nguyên qua nhiều frame, đổi màu và đưa tay gần/xa.
5. Đưa tay gần/xa từ từ: cả vòng và proxy phải đổi theo phối cảnh, không bị giữ ở một kích thước pixel cũ hoặc co nhỏ đột ngột.
6. Tắt Debug để xem/sưu kết quả sạch. Nếu proxy vẫn lệch biên da do tư thế hoặc vật che, ghi nhận riêng; lần sửa này không thay orientation, vị trí hoặc thuật toán occlusion.

**Chưa kiểm thử webcam vật lý, chưa tuyên bố đã khớp hoàn toàn cổ tay người dùng.** Đo biên ảnh chỉ là phép hiệu chỉnh có điều kiện; vẫn cần calibration thủ công trong cảnh khó.
