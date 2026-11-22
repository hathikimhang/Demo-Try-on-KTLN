# Báo cáo nâng cấp AR Bracelet — theo từng giai đoạn

> Lịch sử triển khai. Các thay đổi mới về kích thước, chế độ mặc định, góc xoay và hiệu chỉnh được mô tả tại [bracelet-sizing.md](bracelet-sizing.md).

## 1. Kiến trúc và nguyên nhân cũ

Trước thay đổi lần này, `braceletRenderer.ts` dùng **Canvas 2D + rasterize tam giác trên CPU**, với mesh vòng và proxy cổ tay tự dựng; chưa có Three.js/PBR. SVG trong `ProductArt.tsx` chỉ là ảnh minh họa sản phẩm, không phải renderer webcam. Bản cũ đã có topology vòng kín, nên không chính xác nếu quy mọi lỗi thành “chỉ dùng PNG”.

Những điểm có thể làm vòng trông hở/biến dạng:

- Trục cẳng tay được kéo dài từ lòng bàn tay vì chưa chạy Pose. Khi gập cổ tay, bàn tay và cẳng tay không cùng hướng; proxy che sai đoạn vòng.
- Trộn XY ảnh với Z world bằng hệ số cố định. Fit cặp điểm thay đổi theo góc có thể làm hệ trục và tỉ lệ dao động. Hình học và proxy sau đó trông biến dạng dù vòng có mesh.
- Proxy cố định không khớp biên da thật. Cắt cung vòng tại biên proxy nằm trong vùng da khiến người xem thấy “đầu vòng” trên da. Đổi renderer không tự giải quyết sự khác biệt này.
- Vật liệu CPU đơn giản và vùng raster nhỏ làm thiếu phản chiếu kim loại/chi tiết độ sâu. Thanh size cũ còn có hành vi chỉ giảm độ dày ở dưới 100%.
- Camera mirror cũ thực hiện ở Canvas ghép chung ảnh và sản phẩm: cách này đúng và được giữ. Đồng bộ đúng frame đã suy luận cũng được giữ.

## 2. Three.js và mô hình vòng khép kín

`braceletModel.ts` tạo `TorusGeometry` đủ **2π**, 144 đoạn quanh vòng × 24 đoạn tiết diện, oval thiết kế cố định 1:0.84, có 22 đá đa diện. Mỗi frame chỉ đổi transform của một group; không kéo từng đỉnh để fit landmark và không cắt cung vòng theo góc nhìn.

Vật liệu `MeshPhysicalMaterial`: metalness 1, roughness 0.23, clearcoat nhẹ; màu lấy trực tiếp từ lựa chọn vàng/bạc/vàng hồng/đen. `RoomEnvironment` + PMREM tạo phản chiếu studio tại chỗ, thêm hemisphere/key/fill light. Shadow map 512px và `ShadowMaterial` trên proxy tạo bóng tiếp xúc nhẹ. Đây là PBR trong môi trường giả định, chưa đo ánh sáng thực của webcam hoặc vật liệu trang sức thật.

Canvas 2D chỉ ghép layer WebGL trong suốt vào ảnh, vẽ điểm debug và lưu PNG. Không còn CPU rasterizer vòng cũ. Layer WebGL được render đầy khung, không cắt ROI quanh vòng. WebGL 2 lỗi/context loss sẽ báo rõ, không tự quay lại sticker. GPU geometry/material/environment/shadow map/context được giải phóng khi tắt hoặc thay nguồn.

Kiểm tra sau giai đoạn này: topology hàn seam theo tọa độ cho thấy mỗi cạnh hình học thuộc đúng hai tam giác; không có cạnh hở. Vòng giữ nguyên buffer đỉnh qua 360° và hiệu chỉnh size chỉ scale đều. Renderer được chạy trong Chrome với MediaPipe trước khi đổi thuật toán forearm.

## 3. Wrist + palm + forearm

### Dữ liệu thật và ghép hai model

Chế độ vòng chạy **Hand Landmarker + Pose Landmarker Lite**, cùng `ImageBitmap` và timestamp. Không cộng trực tiếp world coordinates hai model vì gốc world khác nhau. Worker dùng hai WASM task; bộ nạp module phục hồi factory khi import bị cache để task thứ hai khởi tạo đúng.

Từ Hand, least-squares similarity căn world XY về image XY (cùng đơn vị chiều rộng ảnh), dùng world Z sau cùng scale. Cách này giữ tỉ lệ 3D đồng đều, kiểm tra residual và tránh cơ sở shear khi trộn tọa độ tùy ý. Lấy MCP 5/9/13/17 để xác định palm axis và hướng ngang.

Từ Pose, thử cặp khuỷu–cổ tay 13/15 và 14/16, đối chiếu khoảng cách cổ tay với Hand điểm 0. Yêu cầu visibility của ảnh/world ≥ 0.7, điểm nằm trong khung, chiều dài hợp lý, ghép không mơ hồ. Chỉ dùng vector khuỷu trừ cổ tay của Pose; XY bám vị trí quan sát, Z lấy độ nghiêng tương đối world của cẳng tay.

Trục dọc vòng theo cổ tay→khuỷu tay. Hướng ngang từ bàn tay được trực giao hóa với trục cẳng tay; tích có hướng tạo trục còn lại. Mặt phẳng vòng vuông góc trục cẳng tay. Tâm đặt về phía cẳng tay 0.25 chiều dài lòng bàn tay; bán kính ước lượng từ độ rộng palm, có thanh size để hiệu chỉnh bằng mắt.

### Khi không đủ dữ liệu

- Mặc định **không dùng palm axis thay forearm axis** nếu mất khuỷu tay hoặc ghép tay thiếu chắc chắn. Ẩn vòng và hướng dẫn để lộ khuỷu tay/cổ tay.
- Một tùy chọn liên quan duy nhất được thêm vào bảng hiện có: **“Cận cảnh · cổ tay thẳng”**. Người dùng chủ động chọn giả định cổ tay thẳng để dùng ảnh cận bàn tay. Chế độ này giới hạn độ nghiêng trục khoảng 37° ra khỏi mặt phẳng ảnh và từ chối bàn tay gần cạnh; không phải forearm tracking đo được.
- Auto từ chối hướng gần dọc camera, hướng palm/forearm bất hợp lý, điểm quá nhỏ, nằm sát mép, hoặc fit lỗi. Cận cảnh không đủ dữ liệu thì cũng ẩn vòng.
- Confidence/visibility là đầu ra mô hình, không bảo đảm đúng mọi cảnh. Pose có thể không tìm được cẳng tay khi vai/thân bị cắt; Hand có thể không tìm được bàn tay quá nhỏ khi đứng xa.

### Camera, smoothing và size

CV: +X sang phải, +Y xuống dưới, +Z ra xa. Three.js chuyển bằng phép quay π quanh X, camera nhìn -Z. FOV được tính từ tiêu cự giả định và aspect; đã kiểm tra phép chiếu ở năm aspect dọc/ngang. Tiêu cự **chưa được hiệu chuẩn vật lý**.

Webcam chỉ mirror **một lần sau khi ghép cả ảnh và layer 3D**; ảnh tải lên không mirror. Không dùng scale âm trong model làm đảo normal/ánh sáng. `ImageBitmap` đã suy luận quay về main thread để landmark và video cùng thời điểm.

Lọc tâm, log-scale và quaternion theo thời gian, thích nghi với tốc độ. Slerp chọn đường ngắn qua ±180°. Outlier vị trí/tỉ lệ/góc lớn bị ẩn; cần ba kết quả nhất quán để tái nhận thay vì nhảy ngay. Mất dữ liệu/reset nguồn thì xóa filter. Sau 500 ms không có dữ liệu mới thì ẩn sản phẩm. Vẫn có độ trễ suy luận, không cam kết FPS hoặc triệt tiêu hết rung.

Size có thanh kéo mặc định 70–160% và ô nhập mở rộng (xem [bản sửa sizing](bracelet-sizing.md)), scale **đồng đều cả vòng và proxy** để hiệu chỉnh giả định kích thước cổ tay; giữ thiết kế và độ hở tương đối ổn định. Không phải chọn kích cỡ vòng theo milimet. Nếu điểm chuyển tiếp cung vòng còn nằm trên da hoặc quá xa biên tay, cần hiệu chỉnh size; không nên tiếp tục tăng độ nghiêng để ép fit một proxy sai.

## 4. Occlusion và giới hạn proxy

Trụ ellipse thuôn nhẹ, có nắp kín và đủ dài quanh vùng đeo, định hướng theo cùng forearm group. Material `colorWrite=false`, `depthWrite=true`, `depthTest=true`, render trước kim loại. Proxy không sơn màu da lên ảnh. WebGL depth buffer loại phần vòng nằm sau bề mặt proxy; phần trước dùng hình học/material thật. Shadow receiver chỉ thêm bóng lên bề mặt này.

Ở góc cạnh tuyệt đối, cung trước có thể tự che cung sau nên bật/tắt proxy không nhất thiết thay đổi số pixel. Ở góc nghiêng 45°, kiểm tra GPU đã đo được phần cung sau biến mất trong khi cung trước vẫn hiện. Hình học vòng vẫn khép kín khi tắt proxy; các “đầu” nhìn thấy sau masking là giao tuyến che khuất, không phải mesh bị chặt.

Không thêm segmentation người/nền vì mask 2D đó không phân biệt kim loại trước da với kim loại sau da. Mask áp toàn vòng sẽ xóa cả phần trước đúng ra phải hiện. Segmentation vùng tay có thể cải thiện silhouette, nhưng vẫn cần depth ordering. Hiện chưa triển khai skin segmentation hoặc mesh cổ tay thật.

**Chưa giải quyết hoàn toàn:** biên proxy lệch da, tay áo/vật/ngón tay khác che ngang, độ sâu tuyệt đối của camera đơn, sai số world landmark và hiệu chuẩn chu vi. Do đó chưa thể bảo đảm vòng không xuyên da, không hở hoặc đúng occlusion trong mọi cảnh. Khi nhìn gần dọc trục cẳng tay, thân cẳng tay có thể che toàn bộ vòng; ứng dụng chủ động từ chối góc này thay vì ép hiện trang sức.

Hướng tiếp theo nếu cần chất lượng thương mại: camera calibration + số đo cổ tay; hand/forearm mesh có silhouette, segmentation vùng tay để căn biên; kiểm tra trên bộ video tay thật và các tone da/ánh sáng/thiết bị khác nhau. Three.js/PBR là nền render, không thay thế các dữ liệu đó.

## 5. Kiểm thử và bằng chứng

`npm test` kiểm tra topology kín của vòng/proxy, hình học bất biến, material/depth, camera, association/visibility, forearm khác palm, thiếu khuỷu tay, giới hạn close-up, jitter, dịch chuyển/scale, mất tracking, ±180° và outlier.

`npm run test:ar` chạy Chrome với MediaPipe thật trên ảnh mẫu chính thức và luồng phát lại. Kiểm tra đổi màu, size, PNG, thử áo, dừng track, stale tracking và mobile. Luồng phát lại biến đổi ảnh 2D (không thay bằng landmark giả): đứng yên, trái/phải, roll ảnh, gần/xa. Các pose tổng hợp riêng chỉ dùng để kiểm tra renderer và không được đưa vào inference của ứng dụng.

Bằng chứng cục bộ trong `artifacts/`: ảnh mẫu, UI, bảng góc WebGL và JSON kết quả. Lần chạy xác nhận được: ảnh cận bàn tay có Hand 21 + Pose 33 nhưng bị auto từ chối do thiếu cặp khuỷu tay hợp lệ; close-up nhận đúng. Ảnh toàn thân yoga có bàn tay nhỏ không được Hand nhận diện. Vì vậy chưa coi test này là bằng chứng nghiệm thu forearm tracking trên người thật; hướng forearm dương tính hiện được kiểm tra bằng fixture toán học.

Kết quả bàn giao: **18/18 unit test đạt**, `npm run build` đạt. Chrome trên bản production đã kiểm tra Hand + Pose, Three.js, màu, PNG và áo; không có lỗi JavaScript của trang. Kiểm tra riêng từ chối camera, ảnh trống và WebGL 2 không khả dụng đều hiển thị hướng dẫn thay vì sập trang. Các lượt kiểm tra phần mềm này không thay thế bảng nghiệm thu thực tế dưới đây.

### Checklist nghiệm thu trực tiếp còn cần chạy

| Tình huống | Cách thử | Quan sát |
|---|---|---|
| Thẳng đứng | Để lộ vai, khuỷu tay, cổ tay, bàn tay | Vòng ổn định, không nhảy hướng; hướng dẫn nếu thiếu dữ liệu |
| Nằm ngang | Dang cẳng tay ngang camera | Mặt phẳng vòng theo cẳng tay, không dùng góc cổ tay cũ |
| Mặt trong → ngoài | Xoay chậm, giữ khuỷu tay nhìn rõ | Mesh không biến dạng; cung bị che và highlight thay đổi |
| Nghiêng 45° | Nghiêng cả cẳng tay với khuỷu tay trong khung | Phần sau được che hợp lý với biên tay thật |
| Gần/xa | Giữ đủ các điểm trong khung khi tiến/lùi | Scale đều, không bóp méo hoặc thay thiết kế |
| Di chuyển liên tục | Trái/phải rồi trở lại | Không nhảy lớn; mất tracking thì ẩn, tái nhận có kiểm tra |
| Cận cảnh | Chủ động bật tùy chọn, cổ tay thẳng | Chỉ thử góc hỗ trợ; xoay gần cạnh thì ẩn thay vì đoán |
| Các chức năng cũ | Màu, size, ảnh, camera, lưu, chuyển tab | Kết quả PNG giống Canvas; camera/GPU được giải phóng |

Chưa có video/ảnh năm tư thế người dùng đã thử và chưa kiểm tra webcam vật lý ở lần nâng cấp này. Chưa tuyên bố đáp ứng mọi tiêu chí hình ảnh thực tế hoặc photorealistic.

Tài liệu gốc: [Three.js PBR materials](https://threejs.org/manual/en/materials.html), [Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), [Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).
