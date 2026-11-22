# Live: trục cẳng tay, tâm vòng và chuyển động 0° → 20°

Đã sửa code và kiểm thử tự động; **chưa nghiệm thu webcam người thật**. Xoay một ảnh trong mặt phẳng màn hình không chứng minh đã xử lý được pronation/supination 3D của người thật. Không có clip webcam có nhãn để công bố độ chính xác tracking thực tế.

## Bảo toàn trạng thái

Git đang ở nhánh `fix/live-camera`, có các thay đổi từ bước sửa trước chưa commit. Đã lưu toàn bộ trạng thái hiện tại, kể cả file chưa commit/untracked, vào `backups/pre-live-axis-20261121T124307Z/project-state.zip`, kèm manifest SHA256, diff và Git status; CRC ZIP đã qua. Không reset/clean hay ghi đè project. Đây là checkpoint của bản Live trước yêu cầu này.

Chạy lại Upload trước sửa và giữ baseline trong `artifacts/live-axis-baseline/upload-occlusion/`; giữ báo cáo Live cũ trong `artifacts/live-axis-baseline/live-camera/`.

## Nguyên nhân được xác nhận

1. **Trục bàn tay bị dùng làm trục cẳng tay.** `analyzeWrist()` trong `wristGeometry.ts` dựng `handAxis = -unit(mean(MCPs)-wrist)` ở chế độ straight-wrist. Vòng và proxy cùng dùng trục này làm local Z. Điều đó đúng trong giả định tay/cẳng tay thẳng, nhưng gập hoặc lệch bàn tay không đồng nghĩa cẳng tay thay đổi hướng.
2. **Tâm vòng đi theo cùng trục sai.** Offset `.25 × palmLength` được cộng theo handAxis. Với fixture có cẳng tay đứng yên, bàn tay lệch 20°, công thức cũ gây sai khác tâm khoảng 0.0139 đơn vị scene. Test mới so trực tiếp tâm với vị trí đeo trên cẳng tay đã biết. Đây là số liệu tổng hợp, không phải sai số đo trên webcam.
3. **Gate axial kiểm tra trục bàn tay trước khi có trục cẳng tay.** Bàn tay hướng gần camera có thể khiến toàn bộ pose bị loại dù Pose cung cấp hướng cẳng tay khác đủ tin cậy. Live nay chỉ hoãn gate axial này tới bước xác định cẳng tay; vẫn giữ mọi kiểm tra dữ liệu/geometry còn lại. Upload giữ default cũ.
4. **Roll và hướng mặt phẳng chưa tách rõ.** Trước đây nội suy toàn quaternion từ frame dựng theo bàn tay; smoothing không thể sửa sai định nghĩa trục. Không tìm thấy bằng chứng cross-product hoặc quy ước CV→Three cũ bị sai. Bản mới dựng lại basis theo cẳng tay, sau đó tách swing khỏi twist; palm transverse cung cấp roll, không dùng palm normal làm pháp tuyến vòng.
5. **ROI có thể phạt chính các điểm đã bị che.** Gate cũ lấy inliers chia toàn bộ feature đã seed. Khi còn 10 correspondence hợp lệ trong số 24 seed, nó có thể loại cả tracking dù các điểm còn nhìn thấy nhất quán. Chế độ partial Live nay yêu cầu ≥75% consensus trên các correspondence thật còn lại, vẫn ≥6 inlier, phân bố đủ rộng, NCC uniqueness, forward/backward, RMS và giới hạn biến dạng. Default cũ giữ nguyên. Seed Live có thể giới hạn theo foreground, tránh lấy texture nền.
6. **Score corner/crease chưa đảm bảo patch phân biệt được.** Lượt regression đã gặp 24 seed nhưng chỉ 5 correspondence còn đạt. Live nay kiểm tra identity NCC/uniqueness ngay lúc seed, bỏ các patch mơ hồ và tiếp tục tìm ứng viên khác thay vì lấp hết budget. Sau sửa, lượt phát lại ghi nhận 8/8 correspondence/inlier khi Hand bị che; đó là dữ liệu ảnh phát lại, không phải độ chính xác trên tay thật. Unit test sọc một chiều kiểm tra việc reject từ lúc seed, không hạ ngưỡng khớp.

Không xác nhận Manual Fit bị nhân hai lần, không có lỗi torus bị hở topology, và không có bằng chứng cần thay material/model. Lỗi lật tay thực tế chưa có video để kết luận một nguyên nhân duy nhất; các nguyên nhân hình học/gate/temporal ở trên được chứng minh bằng code và fixture có kiểm soát.

## Dữ liệu và hệ trục

- Hand 0: điểm neo cổ tay quan sát ở frame hiện tại. Hand longitudinal axis: hướng đối diện MCP mean; không mặc định là hướng cẳng tay.
- Forearm axis: hướng cổ tay → phía khuỷu; ưu tiên Pose đã ghép đúng Hand và qua kiểm tra world/image/visibility. Nếu không có elbow đáng tin cậy, đo đường tâm phần cẳng tay nhìn thấy.
- Foreground 2D: 19 lát cắt từ gần cổ tay về phía cẳng tay, collar nền độc lập hai bên, xác nhận chuyển tiếp trên pixel gốc; segmentation body-skin nếu có. Theo dõi tâm từng cặp mép, RANSAC + PCA, ≥6 lát hợp lệ, đủ chiều dài, residual/taper liên tục. Không suy ra độ sâu chỉ từ màu da hay silhouette.
- Bracelet local +Z: pháp tuyến mặt phẳng vòng, cùng trục cẳng tay. Local X: palm transverse chiếu lên mặt phẳng vuông góc cẳng tay. Local Y = Z × X; tính lại X = Y × Z, chuẩn hóa; determinant = +1.
- Palm normal được giữ riêng cho quan sát/roll, không điều khiển trực tiếp pháp tuyến vòng.
- CV +X phải, +Y xuống, +Z xa. Three đổi bằng rotation Xπ, determinant vẫn +1. Chỉ mirror toàn bộ composition Canvas một lần. Chiều dài scene không phải mm; pixel/normalized/world không trộn trực tiếp.

## Thay đổi công thức

### Hướng và vị trí

Forearm silhouette cung cấp hướng `d` trên ảnh. Với một giả định thành phần độ sâu `az` được ghi rõ, giải hướng 3D thỏa đạo hàm perspective:

`a_xy = az × C_xy/C_z + t × d`, với `|a|=1`, chọn nghiệm t dương.

Không chia cho cos(view); từ chối nghiệm suy biến/axial. `az` đến từ Pose đã được kiểm tra hoặc giả định straight-wrist lúc khởi tạo. Khi thiếu độ sâu độc lập và Hand cho thấy biến đổi ngoài mặt phẳng lớn, giữ giả định chỉ trong 500ms rồi reject; không tuyên bố silhouette đo được Z. Một Pose depth spike lớn cần ba quan sát mới nhất quán trước khi thay depth; lúc chờ, worker yêu cầu Pose liên tiếp để giảm độ trễ.

`wristAnchor = oldCenter - oldAxis × .25 × palmLength`

`wearCenter = wristAnchor + forearmAxis × .25 × palmLength`

Neo được tính từ Hand của frame hiện tại; không xoay một offset màn hình cố định và không để parent scale dời tâm. Lateral registration tiếp tục từ các biên tốt, tách khỏi orientation/sizing. Manual Fit chỉ thay group vòng.

### Orientation và smoothing

Gram–Schmidt tạo basis từ forearm axis và palm transverse. Nếu chúng gần song song, chỉ dùng transverse đã quan sát trước, tối đa 350ms; sau đó reject nếu chưa có roll đáng tin cậy. Chọn nhánh quaternion/sign liên tục. Local-Z π chỉ dùng vì Lumière hiện tại có đối xứng tương ứng; không áp dụng cho sản phẩm bất đối xứng.

Swing nội suy hướng cẳng tay, giới hạn lag góc 0.08rad. Parallel transport transverse theo swing, rồi nội suy twist riêng, giới hạn lag 0.15rad. Vì vậy đổi roll không kéo pháp tuyến vòng sang trục không liên quan. Tâm/radius/distance vẫn lọc riêng. Frame cũ/out-of-order không được phép reset rồi ghi đè orientation mới.

### Sizing và occlusion

Giữ kiến trúc `rFrame = k × filteredDistanceReference`. `k` đến từ biên ảnh và inverse perspective, không đo từ bề rộng bounding box bàn tay. Giữ calibration qua biên yếu/đổi góc, chỉ nhận lại các số đo phù hợp gần góc tham chiếu. Manual chỉ nhân một lần vào vòng; proxy có scale riêng, root rigid scale=1. Không đổi `braceletDimensions`, clearance hay kiểu oval để sửa tracking.

Vòng/proxy cùng transform cẳng tay đã sửa. Foreground mask của đúng frame có thể giới hạn depth/shadow hiện có; không dùng mask cũ lên video mới. Tạo A: tắt occlusion; B: bật depth + foreground; C: depth proxy không mask, cùng pose/scale/material để tách nguyên nhân. Geometry/material/ánh sáng trong renderer không bị sửa. Mask không phải mesh da 3D; nếu không có mask đáng tin cậy thì vẫn phải ghi rõ proxy ước lượng.

## File/hàm sửa trong bước này

| File | Hàm/lớp và mục đích |
| --- | --- |
| `src/liveForearmContour.ts` | `measureForearmContour()`: đo hướng phần cẳng tay từ native RGB/skin mask, kiểm tra consensus, extent và hình dạng. |
| `src/liveForearmPose.ts` | `LiveForearmEstimator.update()`: hợp nhất Pose/contour, phân biệt trục bàn tay, độ sâu và roll; fallback có giới hạn. |
| `src/liveWristFrame.ts` | `wristFrame()`, `axisFromScreen()`, `wristAnchor()`, `placeOnForearm()`, `filterWristOrientation()`: basis, projection, offset và swing/twist. |
| `src/liveWristTracking.ts` | Dùng filter swing/twist, đánh dấu orientation suy giảm, truyền foreground vào seed ROI; sizing tách biệt. |
| `src/useTryOn.ts` | Nhánh camera mới: Hand/Pose độc lập, native contour → pose → đo lại width theo forearm axis → session → cùng render DTO; mask/debug đúng frame. |
| `src/vision.worker.ts` | Pose bổ sung theo nhịp trong close-up, hoặc liên tiếp khi cần xác nhận depth; echo trackingMode vẫn là mode request. Upload không chạy nhánh bổ sung này. |
| `src/wristGeometry.ts` | Cờ `deferAxialCheck` mặc định false, chỉ Live dùng true; không bỏ invalid-data/fit/bounds/basis. |
| `src/wristRoiTracking.ts` | Tham số foreground và partial correspondence consensus, default cũ giữ nguyên. |
| `src/liveForearmDebug.ts` | Hand axis cam, forearm axis xanh lá, local Z đã render xanh dương, tâm vòng hồng, đường tâm contour cyan. Chỉ Debug Mode. |
| `src/wristTracking.ts` | Lý do orientation riêng, không yêu cầu elbow khi chỉ thiếu dữ liệu hướng. |
| `src/liveForearm.test.ts` | 36 test mới: 0/20/45/90/180, flexion độc lập, projection, determinant, depth spike, timestamp, scale, partial ROI, foreground và seed ambiguity. |
| `scripts/verify-live-axis.mjs` | MediaPipe VIDEO thật trên photo captureStream; kiểm tra 0→20, tâm/trục/k, góc cao hơn, xuất A/B/C. |

Model Lumière, geometry, gems, PBR, camera model, lighting, `braceletSizing`, `braceletDimensions`, thuật toán Upload và App/CSS/thử áo được giữ. `wristGeometry` có cờ mới tương thích default; Upload được đối chiếu pixel thực, không chỉ dựa vào hash module.

## Kiểm thử và bằng chứng

1. `npm test`: **163/163 pass**; 36 test mới ở bước này. Test ưu tiên đặt bàn tay lệch 20° nhưng cẳng tay không đổi, kiểm tra trực tiếp normal và tâm. Test baseline0 giữ q/tâm/radius; các góc khác kiểm tra basis determinant+1 và roll không đổi plane. Test pose/forearm depth bị mơ hồ phải degrade rồi reject.
2. `npm run build`: **TypeScript + Vite pass**.
3. `npm run test:live`: actual MediaPipe VIDEO, gần/xa, Manual độc lập, ROI khi phần Hand biến mất, hết hạn và nhận lại.
4. `npm run test:live-axis`: actual inference trên ảnh được xoay trong mặt phẳng 0°,20°,45°,90°,180°. Ca20 bắt buộc có hướng cẳng tay độc lập, normal vòng gần cùng hướng sau filter, tâm bám vị trí đeo trong ảnh và `k` không nhảy. Đây không phải video lật cổ tay 3D thật.
5. `npm run test:upload-occlusion`: **15 PNG** trên ba ảnh, Manual100/98, gồm A/B và phép đo, byte-identical so với baseline trước bước này. Kiểm tra UI canvas và render B vẫn khớp. `artifacts/live-axis/upload-regression.json`.

Ảnh A/B/C và debug: `artifacts/live-axis/20-A.png`, `20-B.png`, `20-C.png`, `20-debug.png`. JSON chứa q, radius, width và số pixel che; A là mesh đầy đủ, B giữ phần trước và che phần sau. Đối chứng không mask tại pose mới chỉ khác rất ít ở ngoài foreground; không kết luận mọi trường hợp hình chữ C đều do mask. Sai trục ban đầu còn làm chính proxy depth lệch theo bàn tay.

`artifacts/live-axis/report.json` và `debug-log.json` là dữ liệu phát lại có kiểm soát. Không dùng residual của ảnh xoay hoặc số inlier từ ảnh phát lại để công bố độ chính xác webcam. Native RGB/segmentation cũng không phải ground truth độ sâu.

## Chạy và test webcam còn lại

```sh
npm install
npm run dev
# Terminal khác, giữ Vite chạy:
npm test
npm run build
npm run test:live
npm run test:live-axis
npm run test:upload-occlusion
```

Nếu Vite đang chạy ở cổng5173, tải lại trang. Để độ vừa100%, bật Debug Mode, mở Console lọc `[mira-live]`. Log gồm timestamp/latency, Hand0 và wear/render center trong cùng pixel, trục hand/forearm/localZ, quaternion, nguồn/confidence hướng, nguồn depth, width/radius/scale, lý do reject và occlusion. Confidence ở đây là chỉ số chất lượng hình học/measurement, không phải xác suất AI được hiệu chuẩn.

Ưu tiên nghiệm thu:

1. Mu bàn tay giơ thẳng, cổ tay/cẳng tay thẳng: lưu baseline0, không đổi Manual.
2. Nghiêng **cả cẳng tay** sang trái/phải20°; đường cyan và trục xanh lá/xanh dương phải đi cùng nhau, tâm hồng ở vùng đeo. Sau đó gập **bàn tay**20° trong khi cẳng tay giữ nguyên; trục vòng phải theo cẳng tay, không theo trục cam của Hand.
3. Thử45°, xoay mu→cạnh→lòng90°–180° chậm; đối chiếu `forearmSource`, `depthSource`, q và reject reason. Forearm pitch/yaw trong chiều sâu cần dữ liệu bổ sung; có thể degrade/ẩn khi thiếu dữ liệu 3D.
4. Gần/xa, biên có bóng/nền giống da; khi phép đo yếu không thu nhỏ về prior, nhưng không giữ pose sai vô hạn.
5. Mất/nhận lại Hand; thử cổ tay nhỏ/lớn của hai người sau khi chờ mất tracking >2 giây. ROI không thay detector 3D vô hạn.
6. So A/B occlusion tại các góc đang lỗi và Upload lại các ảnh đang dùng.

**Chưa kiểm chứng thực tế:** động tác người thật0→20/45°, lật mu/lòng180°, hai kích thước cổ tay thật, wrist flexion ngoài mặt phẳng, ánh sáng/bóng và mọi tốc độ CPU. RGB + silhouette không đo được trục cẳng tay 3D hoặc chu vi mm chính xác; cận cảnh vẫn phải ghi nhận giả định độ sâu. Chưa kết luận sửa hoàn toàn hoặc đạt photorealistic.
