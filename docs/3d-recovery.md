# Phục hồi 3D có chọn lọc — bằng chứng trước/sau

> Trạng thái Upload mới nhất: xem [kiểm tra Auto Fit và occlusion](upload-occlusion.md). Các chính sách/số liệu bên dưới thuộc mốc phục hồi trước đó.

## Kết luận và phạm vi

Đã xử lý hai regression tái hiện được từ snapshot source thật: phép đo Upload được phép ghi đè tâm/quaternion, kể cả khi bị reject; Provisional Fit tắt depth/shadow. Không thay model, material, ánh sáng, camera projection, công thức Auto Fit hoặc chức năng áo. **Chưa xác nhận đã trở lại đúng phiên bản người dùng từng thấy đẹp**: không có Git hoặc một bản nguồn/hình ảnh cũ được người dùng đánh dấu là known-good. Việc đánh giá độ chân thực cuối cùng vẫn cần đối chiếu ảnh/webcam của người dùng.

Bằng chứng xem ngay: [ảnh đối chiếu](../artifacts/recovery-3d/comparison.png), [gallery trước/sau](../artifacts/recovery-3d/comparison.html), [số liệu JSON](../artifacts/recovery-3d/report.json).

## Sao lưu trước mọi sửa source

- `backups/pre-3d-recovery-20261121T055941Z/project-state.zip`: 117 file, 53.765.061 bytes; gồm source, cấu hình/lockfile, tài nguyên public, build và artifacts tại thời điểm bắt đầu.
- `manifest.json` cùng thư mục lưu SHA-256 từng file và SHA-256 ZIP. Đã kiểm tra CRC toàn archive và kiểm tra lại SHA sau khi sửa. Không ghi đè archive.
- Loại `node_modules` (cài lại bằng lockfile) và chính thư mục `backups` để tránh đệ quy. Không loại source hoặc thay đổi chưa commit.
- `before-src/` được trích nguyên văn từ ZIP, chỉ để so sánh; không phải bản được tạo lại từ trí nhớ.

Không chạy reset/clean, không tạo Git repo mới, không ghi đè toàn project. Dev server của người dùng được giữ nguyên; không khởi tạo server khác.

## Kết quả tìm lịch sử

- CWD và các thư mục cha không có Git repository, nên không có Git history/diff để sử dụng.
- VS Code `User/History` có 5 resource; không có file thuộc dự án vòng tay. Không có `.history` hoặc `.vscode` local-history trong project.
- Không tìm thấy source vòng tay trong các repo GitHub Practice đã kiểm tra. File tạm `/private/tmp/bracelet-sizing-before-session.mts` là bản sizing cũ với import đã chuyển sang đường dẫn tuyệt đối, không phải renderer/model hoặc bản known-good của dự án.
- Kiểm tra thêm các session Codex có sẵn không tìm được snapshot model cũ hơn. Quét Downloads/Desktop không hoàn thành trong môi trường hiện tại và đã được dừng; không khẳng định đã kiểm tra hết mọi backup trên máy.
- Có nguồn tham chiếu xác thực từ **kết quả đọc file trước lần sửa native Upload gần nhất**. Bốn file hoàn chỉnh đã lưu tại `reference-before-native-upload/`, kèm `reference-provenance.json` và diff; đây là chứng cứ source, **không đồng nghĩa người dùng đã duyệt chất lượng hình ảnh bản đó**.

### Đối chiếu các tầng 3D

| Thành phần | Kết quả |
|---|---|
| `braceletModel.ts` | Byte-for-byte giống nguồn trước native Upload và ZIP trước phục hồi; không thay torus, đá, PBR, proxy geometry hoặc transform cơ bản |
| `braceletDimensions.ts` | Hằng số model giống nguồn tham chiếu. Nguồn mới có thêm `imageRenderFit()` trước đợt phục hồi này; hàm và các công thức giữ nguyên trong đợt này |
| Projection/camera | `configureCamera()` và CV→Three rotation không đổi |
| Ánh sáng/tone mapping/environment | Các thiết lập renderer giống source tham chiếu; không chỉnh màu/roughness để che lỗi |
| Quaternion và tâm | Code nhận diện gốc không đổi; regression nằm ở `s.wrist = measurementResult.pose` trong Upload |
| Occlusion | Nhánh Upload mới trước phục hồi tắt toàn proxy/shadow khi không có mask hoặc fit còn provisional; nguồn trước native Upload vẫn dùng geometry-depth fallback |

Hash `braceletModel.ts`: `08d318c02debf563be6959e17dd8c4e6198803c6676704c909b1e8bfc980dfbd`. Kiểm chứng đầy đủ trong `source-integrity.json`.

## Regression đã tái hiện

Dùng MediaPipe Hand/Pose thật trên ảnh mẫu Google, rồi đưa **cùng landmark và cùng ảnh** qua hai pipeline: source trong ZIP trước phục hồi và source đã sửa. Không mock landmark cho phép so sánh ảnh này.

| Ảnh | Trước phục hồi | Sau phục hồi |
|---|---|---|
| `pointing_up.jpg` | Bước đo làm lệch orientation 4,887° và dời tâm 7,981 px so với tracking | Không thêm góc xoay hoặc dời tâm từ measurement |
| `thumb_up.jpg` | Measurement bị reject, nhưng trả pose đã xoay 16,386°; Provisional tắt occlusion | Giữ orientation từ tracking; depth bật, mask có khi phép đo hợp lệ |
| `woman_hands.jpg` | Provisional, occlusion tắt | Vẫn Provisional; depth proxy ước lượng được giữ, không giả vờ có mask hay Auto Fit thành công |

Các góc **0° sau sửa là độ lệch do measurement so với tracking**, không phải chứng minh tracking trùng hoàn toàn với cổ tay thật. Tâm tracking vẫn có sai số của mô hình giải phẫu/Hand/Pose.

Bán kính trước/sau: pointing `0,113340 → 0,113263`; thumb `0,103967 → 0,115805` (chuyển từ prior sang phép đo được chấp nhận); woman giữ `0,064890`. Không dùng hệ số phóng/thu cố định. Không kết luận lỗi kích thước đã hết trên mọi ảnh. Giới hạn Manual 85% → khoảng 91,98% trong trường hợp Visual Fit có measurement vẫn là chính sách có sẵn, chưa chỉnh ở bước phục hồi này.

## Những sửa đổi có trọng tâm

- `imageWristMeasurement.ts`: trả **observation + mask**, không trả WristPose. Hiệu chỉnh trục tìm biên chỉ quay hướng quét 2D, không tạo quaternion 3D hoặc dời tâm render. Manual hai mép cũng chỉ cung cấp độ rộng. Giữ ROI native, nhiều lát cắt, kiểm tra foreground/outlier/reject và debug.
- `braceletRenderFrame.ts`: hợp đồng dữ liệu tách tracking transform, wrist radius, Manual Fit và màu. Adapter chỉ ghép bán kính vào transform từ nhận diện; không truyền model/material/light từ sizing.
- `braceletRenderer.ts`: thêm `drawFrame()` và cache adapter; giữ nguyên engine, scene, model, ánh sáng, projection và API render-layer dùng trong QA.
- `useTryOn.ts`: giữ riêng `trackingPose` trước fitting; không gán lại pose từ kết quả đo; truyền kích thước qua hợp đồng render.
- `imageOcclusion.ts`: policy độc lập Auto Fit; thiếu mask dùng geometry-depth fallback như source tham chiếu, mask đáng tin cậy chỉ bổ sung giới hạn silhouette.
- `App.tsx`, `wristTracking.ts`: sửa nội dung trạng thái hiện có cho đúng proxy fallback. **Không thêm control/UI hoặc tính năng sản phẩm**.
- Unit tests và scripts được cập nhật theo API observation-only; thêm kiểm thử trước/sau và guard sizing không đổi pose/material/geometry.

Không sửa `braceletModel.ts`, `braceletDimensions.ts`, `wristGeometry.ts`, `vision.worker.ts`, `wristRoiTracking.ts`, `draw.ts`, stylesheet hoặc assets sản phẩm.

## Ranh giới kiến trúc hiện tại

```text
Hand/Pose worker → analyzeWristForSource + WristFilter → tracked transform
                                              ├────→ Renderer tracking input
Ảnh gốc + projection hints → Wrist Measurement ─→ WidthMeasurement / ImageMask
WidthMeasurement + tracked pose → WristSizer ──→ radius only at render boundary
radius + Manual Fit ────────────────────────────→ Renderer sizing input
ImageMask ──────────────────────────────────────→ Occlusion policy/depth pass
Renderer: original closed mesh + PBR + lights + camera → Canvas composite / PNG
```

`WidthMeasurement` không chứa quyền sửa geometry/material/lighting. `ImageWristResult` không có `pose`. Thử ảnh, fallback không cần elbow, Manual Calibration, màu, size, PNG và debug/log vẫn được giữ. Camera dùng thuật toán tracking/sizing trước đó và hợp đồng mới không thay transform.

## Kiểm thử và bằng chứng

- **99 unit tests qua**, gồm 4 test mới: 100 tổ hợp radius/Manual Fit không đổi rigid transform/vertex/material; hai mép thủ công không đổi pose; thiếu mask vẫn có depth; size không hợp lệ bị chặn tại boundary.
- TypeScript/production build qua.
- `npm run test:3d-recovery`: 3 ảnh thật, trước/sau từ snapshot, đối chiếu renderer nguồn cũ ở 3 màu. Sai khác RGBA lớn nhất **1/255**, trung bình dưới `0,000023`; bạc/vàng hồng trùng hoàn toàn trong lần chạy. Chứng minh render core tương đương trên cùng input, không chứng minh pose đúng da thật.
- Depth sau sửa có pixel phía sau bị che và phía trước còn hiển thị: pointing 655 pixel bị che / 1523 visible; thumb 725 / 1916; woman 676 / 1349 (đo alpha, tắt shadow khi đếm).
- `test:upload-measurement` qua: native 1×/4×/8×, input Manual 85% theo chính sách sẵn có, hai mép qua DOM, PNG thật, manual fallback và GPU mask mapping.
- `test:ar` qua: 192 tư thế tổng hợp, 10 góc gallery, màu/PNG, camera replay, mất dữ liệu, giải phóng camera, thử áo và mobile.
- `test:session` qua: replay A/B/C/D, size/calibration phiên và ROI; giữ calibration ratio 0,360205 khi Manual 100/150%, ROI có 9/9 inlier trong frame ghi nhận. Đây là replay ảnh, không phải xoay cổ tay 3D thật.

Ảnh `thumb_up` đổi từ Provisional sang measured là kết quả bỏ sự phụ thuộc sai giữa phép quét 2D và quaternion; không phải bằng chứng Auto Fit đã chính xác mọi cổ tay. `woman_hands` vẫn có foreground không đủ rõ để tự đo.

## Cách chạy và đối chiếu

```bash
npm run dev
# Terminal khác, Vite vẫn chạy:
npm test
npm run build
npm run test:3d-recovery
```

Nếu Vite đang chạy, chỉ cần refresh trang. Xem `artifacts/recovery-3d/comparison.html` hoặc `comparison.png` và `report.json`. Script recovery cần thư mục backup/reference nêu trên; không xóa nó nếu cần tái lập so sánh.

Chưa thử webcam vật lý hoặc ảnh riêng đang gây regression cho người dùng. Chưa tìm được bản trước nhiều vòng sửa Auto Fit có xác nhận chất lượng. **Không tuyên bố hoàn tất phục hồi chất lượng hình ảnh cũ.** Proxy/shadow vẫn là mô hình xấp xỉ, có thể lệch da hoặc tạo bóng chưa tự nhiên; depth thực, wrist twist và camera intrinsics chưa được đo. Auto Fit/Provisional và các ca quá rộng/quá nhỏ còn lại nên được xử lý ở một bước riêng sau khi nghiệm thu hình thức 3D.
