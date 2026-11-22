# Kiểm tra tổng thể bracelet try-on

## Phạm vi và bằng chứng

Đã đọc pipeline Hand/Pose → fit world/image → hệ trục/quaternion → Three.js → canvas → PNG, sửa tập trung vào bracelet và chạy lại kiểm thử. Không có thay đổi CSS để giấu lỗi hình học. CSS mới chỉ dành cho bảng Debug Mode.

Tệp yêu cầu chỉ chứa văn bản, **không có năm ảnh thực tế**. Bảng dưới đối chiếu năm mô tả với các cơ chế xác nhận được trong source. Không phải kết luận rằng từng ảnh đã được tái hiện hoặc sửa xong trên webcam thật.

| Lỗi được mô tả | Bằng chứng / nguyên nhân có thể giải thích | File liên quan | Xử lý và phần chưa xác nhận |
| --- | --- | --- | --- |
| 1. Hai đường cong chồng nhau | Scene chỉ tạo **một** band, một instanced mesh đá; bóng dùng ShadowMaterial, proxy không ghi màu. Hai cung có thể là trước/sau của cùng vòng khi silhouette proxy sai hoặc hướng bàn tay không đại diện hướng cẳng tay. Chưa có bằng chứng duplicate mesh hay z-fighting từ năm ảnh. | `braceletModel.ts`, `braceletRenderer.ts`, `wristGeometry.ts` | Kiểm thử một band, topology kín, debug proxy/trục và cache debug. Không xóa một cung hoặc tạo mặt vòng giả để che triệu chứng. Cần ảnh để xác định silhouette sai cụ thể. |
| 2. Hở lớn / dạng C | Torus đủ 2π, topology kín. Phần bị depth-test loại có thể làm hình chiếu giống C dù mesh kín; proxy cũ dài từ −5 tới +5 bán kính, lấn sâu vào phía bàn tay và có thể che sai. Chưa có segmentation da. | `braceletModel.ts`, `braceletRenderer.ts` | Đổi proxy thành đoạn kín từ −0.75 đến +3.25, +Z hướng khuỷu tay; giữ tiết diện tại vòng và clearance. Depth vẫn che phần sau. Không bảo đảm giao tuyến proxy khớp da thật; một cung sau bị da che là hành vi hợp lý. |
| 3. Tỷ lệ / occlusion chưa tự nhiên | Size là prior từ MCP, không phải bề mặt hoặc chu vi cổ tay. Camera dùng tiêu cự giả định. Fit thủ công hiệu chỉnh cả ước lượng cổ tay và vòng. | `wristGeometry.ts`, `braceletModel.ts`, `App.tsx` | Giữ scale theo ảnh/3D, clearance, smoothing và Manual Fit đã sửa trước đó; thêm kiểm tra độ phân tán tỷ lệ world/image và số liệu debug. Chưa có số đo vật lý hoặc mesh da để nghiệm thu độ vừa tuyệt đối. |
| 4. Vòng mất dù thấy cổ tay | Timeout cũ tính từ **capture timestamp**: suy luận trên 500 ms khiến kết quả vừa nhận đã hết hạn. Ngoài ra, solver trả null cho rất nhiều nguyên nhân nhưng UI không phân biệt chúng; proxy dài có thể che toàn bộ ở góc dọc trục. | `useTryOn.ts`, `wristTracking.ts`, `wristGeometry.ts`, `braceletModel.ts` | Tách thời điểm capture/receipt; giới hạn tuổi frame 1.000 ms và khoảng im lặng sau receipt 500 ms cho bracelet. Frame và landmarks luôn đồng bộ. Thêm Tracking / Low Confidence / Lost cùng lý do. Kiểm tra góc dọc theo viewing ray và giảm proxy che quá xa. Không khẳng định riêng ảnh 4 do timeout khi chưa có ảnh/log. |
| 5. Vòng dựng sai trục | Chế độ cận cảnh dùng trục cổ tay→ngược tâm MCP, nên gập cổ tay sẽ khác trục cẳng tay thật. World landmarks cũng có thể đổi basis; bộ lọc cũ chưa xử lý đối xứng nửa vòng và không dùng handedness để xác nhận đổi tay. Không tìm thấy lỗi thứ tự CV→Three trong source. | `wristGeometry.ts`, `vision.worker.ts`, `useTryOn.ts` | Giữ hệ trục trực giao, dùng Pose ở chế độ cẳng tay; thêm chọn quaternion tương đương gần frame trước cho thiết kế đối xứng, xác nhận đổi tay qua ba mẫu và reason khi từ chối. Cận cảnh chỉ hỗ trợ cổ tay thẳng; gập cổ tay cần Pose ghép đủ tin cậy. |

## Thứ tự xử lý theo mức ảnh hưởng

1. Tránh kết quả sai âm thầm: kiểm tra frame, nhận diện lý do solver thất bại, chống dùng kết quả của chế độ cũ và bỏ tư thế thiếu tin cậy.
2. Giới hạn proxy theo vùng cổ tay/cẳng tay; giữ hình học vòng, khoảng hở, depth ordering và hướng trục.
3. Ổn định hướng giữa các frame/đổi tay, thêm công cụ debug và kiểm thử hồi quy toàn bộ luồng.

## Kiểm tra hệ tọa độ và projection

- Solver dùng CV: +X phải, +Y xuống, +Z xa camera. Nhân normalized Y với `height/width`, nên X/Y/Z sau fit dùng cùng đơn vị chiều rộng ảnh.
- World của Hand và Pose không cùng gốc. Chỉ dùng vector elbow−wrist của Pose; không cộng hai tập tọa độ world.
- +Z local của vòng là hướng cẳng tay; +X local là MCP across trực giao hóa với +Z; +Y = Z×X. Do đó X×Y = Z và mặt phẳng XY của vòng vuông góc cẳng tay. Các kiểm thử kiểm tra trực giao, chuẩn hóa và handedness hình học ở cả hai tay.
- Chuyển CV→Three bằng quay π quanh X: `(x,y,z) → (x,−y,−z)`, là phép quay thuận tay, không phải phản chiếu. Quaternion group = `cvToThree * wristOrientation`; không cộng Euler per-frame.
- Perspective camera: aspect = width/height; FOV = `2*atan(imageAspect/(2*focal))`. Kiểm thử projection ở năm aspect. Focal là giả định, chưa có camera calibration.
- Mirror webcam duy nhất ở canvas ghép cuối. Video, vòng, landmark và trục debug cùng được mirror một lần. Ảnh upload không mirror; legend debug ở DOM nên chữ không bị lật. Không đảo kích thước âm theo handedness.
- Kiểm tra hướng gần trục nhìn dùng `abs(dot(forearmAxis, normalize(center)))`, gồm cả cổ tay lệch tâm ảnh. Ngưỡng 0.72 cho cận cảnh, 0.86 cho Pose; không suy ra thêm một góc khi trục không đủ tin cậy.
- Quaternion `q` và `−q` đã được slerp theo đường ngắn. Nay thêm lựa chọn `q * rotationZ(π)` gần frame trước khi cùng tay/cùng chế độ và thời gian liên tục. Phép này chỉ hợp lệ vì band ellipse, proxy và 22 đá hiện tại đối xứng nửa vòng. **Nếu đổi sang thiết kế bất đối xứng, phải bỏ hoặc đổi quy tắc đối xứng này.** Không đảo +Z cẳng tay.

## Tracking và fallback

- `tracking`: solver có pose hợp lệ, filter xác nhận, frame còn dùng được và WebGL hoạt động.
- `low-confidence`: có tay nhưng dữ liệu fit/ghép Pose/góc nhìn không đủ tốt, đang xác nhận outlier/đổi tay, chuyển mode hoặc lỗi render. Ẩn vòng ngay; không giữ vòng cũ trên vị trí tay mới.
- `lost`: không có tay hoặc frame hết hạn. Trở về video mới nếu luồng AI ngừng trả kết quả, xóa pose/filter.
- Cả ba là trạng thái từ các điều kiện quan sát được, **không phải confidence do MediaPipe xuất ra**. Debug hiện residual world/image, scale ảnh, độ ổn định basis, độ song song viewing ray, số landmark, bán kính, mức fit và reason. Không giả tạo phần trăm độ tin cậy AI.
- Kết quả worker mang mode đã thực sự chạy. Khi người dùng đổi mode giữa lúc worker xử lý, kết quả cũ không được dùng để đặt vòng; ảnh tĩnh được gửi lại với mode hiện hành. Webcam tự gửi frame tiếp theo.
- Giữ exponential smoothing tâm, log-scale, quaternion, giới hạn lag và xử lý outlier. Đổi handedness ở cùng vị trí cũng cần ba mẫu nhất quán; không blend tư thế hai tay.
- Frame AI 650 ms có thể hiển thị khi vừa nhận vì có đúng ảnh inference, nhưng vẫn bị bỏ khi tuổi vượt 1.000 ms hoặc worker không có kết quả mới hơn 500 ms. Máy rất chậm vẫn có thể mất hiển thị; không hứa thời gian thực ở mọi thiết bị.

## Hình học, clipping và occlusion

- Một mesh band kín, 144×24 đoạn, 2π; một instanced mesh 22 đá. Không đổi buffer đỉnh theo góc, không cắt cung theo ảnh mẫu.
- Proxy là trụ ellipse kín với tiết diện `r(z) = 1.02 + 0.02*z`, chiều sâu 0.72 lần chiều rộng. Chỉ rút ngắn chiều dài và dịch về phía cẳng tay; tiết diện tại vòng vẫn giữ nguyên.
- Depth proxy: `colorWrite=false`, `depthWrite=true`, `depthTest=true`, renderOrder 0. Band/đá có depthTest, renderOrder 2. Shadow riêng với depthWrite false. Camera near 0.01, far 50; vùng vòng gần focal 1.35, nên các ca hỗ trợ không nằm sát clipping plane.
- Mesh debug cyan chỉ hiện khi bật Debug Mode, wireframe, depthWrite false, không thay depth mask. Renderer cache có debug flag. Khi tắt debug, pixel đầu ra được kiểm tra trùng với bản trước khi bật debug.
- Không tự tắt occlusion chỉ để ép vòng hiện. Các ca gần dọc trục bị solver từ chối có hướng dẫn; debug gallery vẫn có một pose dọc trục để chẩn đoán renderer, không phải góc được app cam kết hỗ trợ.
- Sau rút ngắn proxy, ca renderer dọc trục tổng hợp còn 7.316 pixel thay vì bị che toàn bộ như proxy cũ. Đây là bằng chứng sửa cơ chế che quá mức, không phải bằng chứng hình học đó khớp da thật.

## Kiểm thử đã chạy

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| `npm test` | **28/28 đạt**: vector/basis/quaternion, projection, hai tay, đổi tay, lật nửa vòng, scale/gần xa, frame chậm/stale, reason thiếu dữ liệu, topology, một band, clearance, proxy bounds, smoothing và tests tracking cũ. |
| `npm run build` | TypeScript và Vite đạt. Repo không có script lint riêng. |
| `npm run test:ar` | Chrome đạt: AI Hand thật trên ảnh mẫu; Pose thử khi yêu cầu; chọn màu/sản phẩm, upload, PNG, webcam phát lại, cleanup và mobile. Debug bật/tắt được; ba trạng thái Tracking/Low Confidence/Lost đã được quan sát trong kiểm thử. |
| Ma trận GPU | **192 tổ hợp tổng hợp**: hai tay, dọc/ngang, xoay 0/45/90/180°, nghiêng ±0.7 rad, scale gần/xa, fit 65%/140%. Cả 192 được solver chấp nhận và còn phần vòng hiển thị sau occlusion; ít nhất 34 pixel alpha >30 trên ảnh đo 300×300. Không chứng minh mức vừa trên người thật. |
| Occlusion tổng hợp nghiêng 45° | 2.158 pixel cung sau bị che; phần trước vẫn hiện. Hình học vẫn kín khi bỏ proxy; không pixel vòng chạm biên khung gallery. |
| Video phát lại ảnh mẫu | Trái/phải, xoay trong mặt phẳng ảnh, gần/xa, timeout, Manual Fit 120% giữ qua frame và đổi sản phẩm, màu giữ qua frame. Đây không phải video xoay 3D cổ tay thật hoặc kiểm thử tốc độ tay thật. |

Bằng chứng mới trong `artifacts/`: `bracelet-debug.png`, `bracelet-photo.png`, `ar-geometry-views.png`, `ar-verification.json`, `studio-desktop.png`, `studio-mobile.png`.

## Hướng dẫn thử webcam tương ứng năm mô tả

Chạy `npm run dev`, mở localhost bằng Chrome/Edge, bật camera và Debug Mode. Để lộ da tại vùng đeo, ánh sáng đều. Bắt đầu Manual Fit 100%; giữ cổ tay thẳng trong cận cảnh. Tắt cận cảnh và để thấy khuỷu tay nếu kiểm tra cổ tay gập.

| Ca đối chiếu | Thao tác | Cần kiểm tra |
| --- | --- | --- |
| 1 — hai cung | Lòng bàn tay hướng camera, cổ tay dọc rồi ngang; sau đó quay mu bàn tay | Không có vòng thứ hai ở tâm khác. So sánh cyan proxy với biên da. Hai cung của một hình chiếu không tự động là mesh trùng. |
| 2 — hở lớn | Xoay từ 0→45→90° chậm, quan sát cả hai bên cổ tay | Band không biến dạng; cung sau được che ở vị trí hợp lý. Nếu đường cắt nằm trong vùng da hoặc phần trước bị cắt, ghi lại proxy/trục/reason. |
| 3 — độ vừa | Giữ tay yên, đưa gần rồi xa; chỉnh Manual Fit một lần và lặp lại | Kích thước đi theo tay, không tự reset; khoảng hở hợp lý và không co sụp khi xoay. Nếu không có một mức fit dùng được ở các góc, proxy không đủ chính xác. |
| 4 — biến mất | Giữ tay rõ; sau đó che một phần bàn tay/cổ tay, bỏ che; thử di chuyển chậm và nhanh | Debug chỉ rõ `no-hand`, `fit`, `axial-view`, `stale` hoặc `reacquiring`. Mất dữ liệu phải ẩn, không treo vòng ở chỗ cũ; khi dữ liệu hợp lệ phải nhận lại. Phân biệt có landmark với có pose đủ tin cậy. |
| 5 — dựng sai trục | Giữ cổ tay thẳng rồi gập nhẹ; so sánh cận cảnh với chế độ Pose khi thấy khuỷu tay | Trục xanh dương phải hướng theo cẳng tay ở chế độ Pose, mặt phẳng vòng gần vuông góc với trục đó. Cận cảnh không cam kết cho cổ tay gập. Không có cú xoay 180° ngẫu nhiên khi cùng tay. |

Cuối cùng thử đổi màu, đổi sản phẩm, dừng/bật webcam, upload ảnh và lưu PNG; kiểm tra mức hiệu chỉnh vòng vẫn giữ trong phiên trang hiện tại. Tải lại trang hoặc bấm Đặt lại mới về 100%.

## Chưa sửa được chỉ bằng dữ liệu hiện có

Chưa nghiệm thu năm ảnh hoặc webcam vật lý của người dùng. Chưa có mesh da, segmentation biên cổ tay, camera calibration, bộ video 3D tay thật hay dữ liệu nhiều người/thiết bị. Vì vậy chưa thể bảo đảm không xuyên da, không hở theo silhouette thật hoặc occlusion tự nhiên ở mọi tư thế. Pose cũng có thể không nhận được cẳng tay khi thân/vai bị cắt. Hand landmarks có thể suy đoán cả phần bị che; chỉ số hình học không phát hiện được mọi suy đoán sai nhưng tự nhất quán.

Calibration hiện có là hiệu chỉnh bằng mắt với Manual Fit, giữ cổ tay thẳng ở ánh sáng tốt, rồi kiểm lại dọc/ngang và nhiều góc. Chưa có trường nhập chu vi cổ tay hoặc số đo tương ứng trong dự án; không tự diễn giải khoảng cách MCP thành mm. Nếu bổ sung chu vi thật, cần thêm hiệu chuẩn tỷ lệ camera hoặc mốc kích thước biết trước và mô hình tiết diện phù hợp; chu vi một mình không xác định được độ sâu và silhouette của cổ tay RGB.

Để tiến tới nghiệm thu không xuyên da trên người thật: thu video các ca trên có Debug Mode, xác nhận hướng cẳng tay và fit; sau đó thêm dữ liệu silhouette/mesh hoặc bước calibration có mốc vật lý. Không nên ép renderer hiện toàn bộ vòng hoặc vá một góc cố định theo từng ảnh.
