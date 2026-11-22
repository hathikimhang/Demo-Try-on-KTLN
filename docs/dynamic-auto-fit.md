# Dynamic Auto Fit — triển khai và kiểm chứng

> Đây là báo cáo giai đoạn trước. **Bản hiện tại** có scale vòng/proxy độc lập, calibration trong phiên, ROI từ pixel khi thiếu bàn tay và 70 unit test. Xem [báo cáo hiện tại, dữ liệu A/B/C/D và giới hạn](wrist-measurement-debug.md). Các công thức/chính sách dự đoán và bảng số dưới đây lưu kết quả lịch sử trước những thay đổi này.

## Những nguyên nhân còn lại trong bản cũ

Scale đã được nhân đúng một lần, Manual Fit không bị Auto Fit ghi đè và camera/projection dùng cùng hệ đơn vị. Giới hạn 140% đã được bỏ ở lần sửa sizing trước; đó không còn là lỗi chính của lần nâng cấp này.

Vấn đề hiện tại nằm ở khả năng đo và giữ hiệu chỉnh:

- Phép dò biên cũ lấy vùng tìm kiếm từ một prior vốn có thể quá nhỏ, dễ không tới được biên da thật. Fit ngược cũng chỉ tìm tới bốn lần prior đó.
- So màu RGB với ngưỡng cố định tương đối và dừng ở biên đầu tiên khiến shadow/texture/cuff làm nhiều frame rơi về fallback. Bề ngang xương MCP không phải bề ngang da cổ tay.
- Lúc không đo được, renderer vẫn hiện vòng từ prior hoặc hiệu chỉnh cũ, tạo lại cảm giác vòng quá nhỏ.
- Sizer chỉ phân biệt Left/Right, giữ correction khi Hand tracking mất và chưa có thời hạn rõ cho dự đoán. Left/Right không phải định danh người; người khác cùng nhãn có thể nhận hiệu chỉnh cũ.
- Lọc hệ số tương đối theo prior đã làm mượt có thể gây trễ kép khi thay đổi khoảng cách.

Không xác nhận được sai số trên cổ tay cụ thể của người dùng vì chưa có video webcam vật lý. Các nguyên nhân trên được xác nhận từ code và kiểm thử có kiểm soát.

## Đo cổ tay động

`measureWristWidth()` trong `src/braceletSizing.ts`:

1. Dùng Hand landmark 0 làm mốc; trục ngang gần vuông góc trục cẳng tay lấy từ tư thế 3D hiện có. Pose tiếp tục được dùng trong chế độ forearm; không thay thuật toán orientation.
2. Đọc **ảnh gốc của đúng frame đã suy luận**, không đọc vòng/debug đã vẽ. Giữ tọa độ unmirrored; compositing lật ảnh và vòng cùng một lần như trước.
3. Quét sáu lát cắt từ gần cổ tay tới vị trí đeo. Vùng tìm kiếm phụ thuộc phạm vi tay khả dụng, không bị khóa vào một wrist radius nhỏ. Không lấy bounding box bàn tay làm số đo cổ tay.
4. Phân tích profile luminance/chroma cục bộ, thử nhiều cặp biên thay vì dừng ở một chuyển tiếp yếu. Kiểm tra tương phản, nội vùng, tính bền của vùng ngoài và độ đối xứng hợp lý.
5. Chỉ nhận cụm ít nhất ba lát cắt đồng thuận. Đưa width ở lát cắt gần cổ tay về mặt phẳng đeo bằng viewing ray/projection của camera. Width, contrast, spread, số lát cắt và quality là dữ liệu hình học/ảnh, không phải xác suất AI đã hiệu chuẩn.

Đây là phân tích đường biên, **chưa phải semantic skin segmentation**. Nền giống da, vùng cơ thể khác chồng lên cổ tay, áo hoặc vật che có thể làm phép đo bị từ chối hoặc sai. Đã xem xét [Image Segmenter của MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter): các model phân vùng theo lớp có thể bổ sung mask, nhưng mask người/nền hoặc skin tổng quát chưa bảo đảm tách đúng cổ tay khỏi mặt/bàn tay khác. Chưa thêm một model chưa được kiểm chứng cho biên cổ tay ở bước này.

## Công thức và cập nhật theo frame

Gọi `W` là chiều ngang Canvas, `w` là width ảnh đã quy về mặt phẳng đeo trong đơn vị chiều rộng ảnh, `P(r)` là width chiếu của tiết diện proxy với bán kính `r`:

```text
wristWidthPixels = w × W
autoRadiusTarget = nghiệm r sao cho P(r) = w
autoScale = làm mượt autoRadiusTarget hợp lệ
finalRenderScale = autoScale × manualFitMultiplier
fitRatio = projectedInnerDiameterPixels / wristWidthPixels
```

Giải ngược dùng đúng phép chiếu `f*x/z`, `f*y/z` của hệ camera CV/Three.js. Không so trực tiếp pixel với mét hoặc đơn vị mô hình. Khoảng tìm nghiệm được mở rộng tới width đo được, với kiểm tra camera/giá trị hữu hạn, không còn ceiling `4 × underestimated prior`.

Làm mượt median ba quan sát và log-radius thích nghi tốc độ. Khi đã có median, giới hạn lag quanh mục tiêu để vòng không co nhỏ rõ khi tay tiến gần. Thay đổi anatomy/correction lớn cần các kết quả nhất quán trước khi nhận; một frame nhiễu không được làm scale nhảy lớn. Filter radius và hệ trục tracking cũ vẫn giữ nguyên; sizer chỉ trả bản sao pose với radius mới.

Parent scale được **gán** bằng tích trên mỗi lần render, không nhân tích lũy. Scale 1.10 tại band/gems là khoảng hở thiết kế cũ. Các kích thước model và proxy giữ nguyên trong `braceletDimensions.ts`; Auto Fit thay kích thước dựa trên ảnh từng người, không dùng một render scale cố định cho tất cả.

## Trạng thái và mất tracking

| Trạng thái | Hành vi |
|---|---|
| `measuring` | Chờ ba frame video đủ rõ lúc đầu; không render vòng nhỏ từ prior |
| `image` | Tính lại theo width ảnh trên từng frame hợp lệ |
| `predictive` | Biên tạm mất: dùng khoảng cách Hand và correction tốt gần nhất, tối đa 250 ms; quality hiện tại bằng 0 |
| Hết thời hạn dự đoán | Ẩn vòng, tiếp tục chờ đo lại tự động; không bắt chỉnh tay |
| Mất Hand/stale/đổi nguồn | Xóa hiệu chỉnh cũ; nhận lại khi dữ liệu tốt, không mang size người trước sang người mới |
| `manual` | Chỉ khi người dùng tắt Dynamic Auto Fit; hiệu chỉnh dự phòng một lần, khoảng cách vẫn theo Hand |

Hệ thống không có biometric person ID. Khi hai người đổi tay trong khung liên tục mà không mất tracking, đo ảnh mới sẽ thích nghi; biến đổi lớn cần xác nhận. Không bảo đảm phát hiện được mọi đổi người nếu ảnh/landmark vẫn giống nhau.

Frame đồng bộ xử lý 650 ms vẫn có thể thu đủ phép đo, không reset vô hạn vì nhầm chậm inference với mất tracking. Hook giữ cơ chế loại frame stale đã có.

## Visual Auto Fit và True-to-Size

Mẫu hiện tại là **Visual Auto Fit**: mô hình minh họa thay đổi kích thước hiển thị cho hợp cổ tay. Không khẳng định đường kính thật theo mm hoặc người dùng đeo vừa một size hàng hóa cố định.

`BRACELET_ASSET` khai báo `fitting: 'visual-auto'`, `physicalInnerDiameterMm: null`. Asset khai báo `fixed-size` bị chặn auto resize và báo cần dữ liệu size + hiệu chuẩn camera. True-to-Size chưa được triển khai đầy đủ; không có nút giả vờ bật đo mm.

Manual Fit giữ mặc định **100%**; không bị ghi đè khi Auto Fit chạy. Nếu người dùng chủ động đặt một bias khác, bias đó vẫn được nhân một lần. Chỉ tắt Dynamic Auto Fit để dùng Manual Calibration trong trường hợp đo biên không khả thi.

## Debug Mode

Ngoài các số đo sizing trước đây, hiển thị:

- Wrist width (pixels), đã đưa về mặt phẳng đeo.
- Bracelet projected inner diameter (pixels).
- Fit ratio, hoặc `—` nếu chưa có phép đo đủ tin cậy.
- Auto scale và Final render scale; chưa render thì bằng 0.
- Edge quality dựa trên profile/các lát cắt, không phải xác suất AI.
- Tracking state/reason, fit residual và view alignment của landmark như trước.

Pixel là pixel Canvas gốc, không phải CSS pixel. Đơn vị scene `u` không phải mm.

## Kết quả kiểm thử

**48/48 unit test**: cổ tay nhỏ/lớn với cùng prior, prior rất nhỏ, nhiều tone màu, nền không rõ, khoảng cách liên tục, xoay ngang/dọc/45°/90° trong các fixture được hỗ trợ, mất/tái nhận, đổi người cùng nhãn Right, outlier, thời hạn 250 ms, frame chậm, fixed-size guard. Fixture toán học/ảnh tổng hợp không được dùng thay AI trong ứng dụng.

Chrome chạy MediaPipe thật trên ảnh test chính thức của Google, Manual Fit giữ 100%:

| Ảnh mẫu thật | Wrist width | Lỗ vòng chiếu | Fit ratio |
|---|---:|---:|---:|
| `pointing_up.jpg` | 77,5 px | 85,8 px | 1,108 |
| `thumb_up.jpg` | 90,9 px | 100,1 px | 1,101 |

Ảnh `woman_hands.jpg` có cảnh chồng lấp/biên khó: bị Auto Fit từ chối, vòng bị ẩn và có hướng dẫn; Manual Calibration vẫn hoạt động khi chủ động chọn.

Replay ảnh thật qua camera stream, chạy Hand thật từng frame, vẫn ở 100%:

| Kịch bản | Wrist width | Lỗ vòng chiếu | Fit ratio |
|---|---:|---:|---:|
| Đứng yên | 100,8 px | 112,0 px | 1,112 |
| Xa | 69,6 px | 77,5 px | 1,113 |
| Gần | 125,9 px | 139,9 px | 1,112 |
| Roll ảnh 45° | 100,2 px | 112,2 px | 1,120 |

25 mẫu chuyển động liên tục hợp lệ có ratio **1,084–1,115**, không thay Manual Fit. Mất ảnh tay rồi trở lại tự nhận lại; worker bị dừng trả kết quả thì lớp phủ được xóa. Đây là replay ảnh 2D, **không phải video xoay tay thật theo chiều sâu**.

Kiểm thử hồi quy `test:ar` và `test:sizing` đã qua: manual fallback, màu, PNG, camera cleanup, chuyển chế độ, thử áo, mobile, orientation/occlusion/mesh. Không có thay đổi geometry của model hoặc proxy cho lần nâng cấp này.

## Chạy và kiểm tra lại

```bash
npm install
npm run dev
```

Bật camera, giữ Dynamic Auto Fit bật và Manual Fit 100%, để lộ bàn tay/cổ tay trên nền khác màu da. Chờ nhận các frame đầu. Thử gần/xa và di chuyển chậm; theo dõi Fit ratio cùng width. Nếu dùng chế độ forearm thì cần thấy khuỷu tay. Tắt Dynamic Auto Fit mới dùng Manual Calibration khi cảnh không thể đo biên.

Terminal thứ hai khi Vite đang chạy:

```bash
npm run test:dynamic
npm run test:ar
npm run test:sizing
```

`test:dynamic` dùng Chrome có sẵn (hoặc `AR_BROWSER=chromium`), tải ảnh mẫu chính thức lần đầu vào thư mục tạm, tạo báo cáo `artifacts/dynamic-auto-fit.json`, ảnh UI và `dynamic-replay.png`. Chạy `npm test` và `npm run build` để kiểm tra công thức/TypeScript/build.

**Chưa kiểm thử webcam vật lý của người dùng.** Chưa xác nhận độ tự nhiên ở mọi ánh sáng, da, camera, vật che hoặc góc xoay thật. Không cam kết photorealistic, đúng size mm, không xuyên da trong mọi cảnh hay luôn nhận diện được biên. Khi dữ liệu không đáng tin cậy, ưu tiên không render sai.
