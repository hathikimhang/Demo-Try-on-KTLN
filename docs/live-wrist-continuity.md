# Live wrist-first: acquisition, orientation, continuity và fit

Đã triển khai bản sửa có trọng tâm, chưa nghiệm thu webcam người thật. Các phép xoay ảnh trong trình duyệt và quaternion tổng hợp không chứng minh đã xử lý được lật mu/lòng bàn tay 180° thật. Kết quả kiểm thử nằm ở `artifacts/live-continuity/`, `artifacts/live-camera/` và `artifacts/live-axis/`.

## Bảo vệ phiên bản trước sửa

Checkpoint: `backups/pre-wrist-continuity-20261121T150544Z/project-state.zip`, 268 file, CRC ZIP đã kiểm tra, kèm manifest SHA256, Git status và diff. Giữ mọi thay đổi chưa commit, không reset/clean. Upload đã chạy lại trước sửa, baseline tại `artifacts/wrist-continuity-baseline/upload-occlusion/`.

Không sửa model Lumière, kích thước model, material, lighting, renderer, camera projection, thuật toán đo/mask Upload, hay renderer áo. `App.tsx` chỉ sửa hai câu hướng dẫn cũ nói khuỷu tay là bắt buộc; giữ nguyên cấu trúc UI, control và chế độ sáng/tối.

## Nguyên nhân xác nhận từ source trước sửa

1. `LiveWristSizer.update()` yêu cầu ba phép đo biên tốt, đủ số lát cắt và góc lòng bàn tay, trước khi trả pose để render. Vì vậy Hand hợp lệ vẫn không có vòng nếu biên chưa đo được. Thông báo mặc định còn nhắc ánh sáng dù không hề đo độ sáng.
2. `LiveForearmEstimator.update()` từ chối Hand fallback lệch seed hơn `.15 rad` (khoảng 8,6°), dù Hand hiện tại vẫn hợp lệ. Nhánh giữ hướng trước cũng có giới hạn hand-axis delta rất nhỏ. Đây là một nguyên nhân cụ thể của mất vòng khi nghiêng nhẹ; không chứng minh là nguyên nhân duy nhất của lỗi xoay tay thật.
3. `LiveWristSession.update()` ghi trạng thái DEGRADED nhưng trả `fit:null` ngay khi cả raw/ROI thất bại. Hook xóa pose nên vòng ẩn ngay, chưa có grace thực sự. Filter reject raw cũng không thử ROI nếu raw ban đầu khác null.
4. Kích thước đã hiệu chuẩn vẫn bị đánh dấu suy giảm chỉ vì frame hiện tại không đo được biên. Một frame thiếu Hand xóa nhóm mẫu acquisition. Hai việc này gây dao động trạng thái/khó hoàn tất fit.
5. Khởi tạo/lỗi Pose nằm trong đường lỗi của cả worker; task bổ sung có thể dừng camera Hand đang hoạt động. Cận cảnh còn yêu cầu Pose cùng nhịp segmentation dù chưa cần quan sát khuỷu tay.
6. Các constructor controller nằm trong đối số `useRef({...})`, nên biểu thức khởi tạo vẫn chạy mỗi React render. Instance được giữ bởi ref không bị thay, nhưng các instance tạm bị tạo rồi bỏ đi không cần thiết.

Không tìm thấy bằng chứng Manual Fit bị nhân lặp trong model, torus hở topology hoặc phép đổi CV→Three cần đảo lại. Không thay geometry/PBR để sửa tracking.

## Luồng và thay đổi

`Hand VIDEO + timestamp → Hand geometry → Pose/contour/Hand fallback → forearm basis → placement/filter → sizing → continuity → matching frame + render DTO → renderer hiện có`.

| File | Trách nhiệm và thay đổi |
| --- | --- |
| `src/liveForearmPose.ts` | Giữ ưu tiên Pose/contour độc lập. Học quan hệ trục cẳng tay trong hệ Hand từ quan sát tốt; dùng quan hệ này khi thiếu ảnh cẳng tay. Chưa có quan hệ thì dùng giả định straight-wrist chất lượng thấp. Bỏ gate seed 8,6°, giữ kiểm tra axial, basis, độ sâu và thời hạn roll. |
| `src/liveWristSizing.ts` | `allowEstimate` chỉ bật cho Live: Hand geometry hợp lệ được hiện ước lượng; không coi prior là biên đã đo. Ba phép đo nhất quán mới xác nhận calibration. Giữ reference view, target size và sample qua mất ngắn; hoàn tất chuyển tiếp giới hạn tốc độ dù các biên mới yếu. |
| `src/liveWristTracking.ts` | Filter reject được thử ROI thật. Calibration không mất vì thiếu một phép đo. Kết hợp bốn trạng thái với quyết định hiển thị riêng. |
| `src/liveContinuity.ts` | ACQUIRING/TRACKING/DEGRADED/LOST, hai quan sát tốt để trở lại TRACKING; frame tốt đầu tiên được hiện ngay. Grace tối đa 300ms kể từ receipt hợp lệ cuối, không tự gia hạn bằng frame lỗi. |
| `src/liveFrameBuffer.ts` | Giữ một ảnh raw cùng pose, mask, điểm và sizing khớp ảnh. Grace không dùng pose cũ trên ảnh video mới. Hết hạn/stale/ROI TTL thì không dùng snapshot. |
| `src/useTryOn.ts` | Controller khởi tạo lazy một lần. Chỉ nhánh camera dùng estimate/grace; chống timestamp cũ trước khi ghi đè frame. Render/PNG dùng cùng cặp ảnh–pose; expiry được kiểm tra cả trong RAF khi worker không trả kết quả. Clear snapshot khi dừng/đổi mode. |
| `src/vision.worker.ts` | Hand-first: frame đầu không đợi Pose. Pose Live là bổ sung, lỗi có backoff 5 giây, không đóng Hand/camera. Cận cảnh chỉ yêu cầu Pose khi hướng/độ sâu cần bổ sung. Upload/thử áo giữ đường xử lý task cũ. |
| `src/types.ts`, `src/wristTracking.ts` | Thêm metadata phiên bản worker/trạng thái task và nguồn `Grace frame` để debug rõ ràng. |
| `src/liveContinuity.test.ts` và hai suite Live cũ | Test estimate/confirmation, reference view, transition, grace/hysteresis, timestamp, Hand relation, scale độc lập; cập nhật kỳ vọng phù hợp hành vi mới. |
| `scripts/verify-live-continuity.mjs`, `scripts/verify-live-camera.mjs` | Kiểm thử MediaPipe VIDEO thật bằng photo captureStream, lỗi task bổ sung, blank input, lifecycle, gần/xa, loss/reacquisition. |

### Orientation và giới hạn dữ liệu

Giữ basis/swing–twist, local Z theo forearm, Hand0 neo vị trí và offset về phía cẳng tay của bước trước. Khi quan sát forearm tốt:

`forearmInHand = inverse(qHand) × forearmAxis`

Khi không có forearm độc lập, xoay quan hệ này theo Hand hiện tại; đây là giả định cổ tay cứng, không phải Pose elbow hoặc phép đo depth mới. Chưa có quan hệ thì giả định cổ tay thẳng. Confidence các nhánh này là `.55`/`.4`, không gán bằng confidence contour/Pose. Silhouette chỉ cung cấp hướng 2D; giữ các kiểm tra thiếu depth/basis/axial. Dữ liệu không quan sát được vẫn có thể bị từ chối.

### Sizing

`rFrame = k × filteredDistanceReference`

`kTarget = median(radiusFromImageWidth(pose, width) / distanceReference)`

`kNew = kOld × exp(clamp(log(kTarget/kOld), −0.18 dt, +0.18 dt))`

Không có hệ số phóng đại mới. Prior chỉ để preview với trạng thái provisional. Phép đo đầu đủ chất lượng được ưu tiên cho preview, nhưng chưa công bố calibration khi chưa có ba mẫu phù hợp. Sau xác nhận, lưu góc tham chiếu; không tái fit ở góc khác để phóng đại bán kính. Hoàn tất chuyển tiếp tới target đã xác nhận ngay cả khi biên hiện tại mất; không giữ mãi radius nhỏ giữa chừng. Mất Hand hơn 1500ms phải xác nhận lại. Root scale=1, wrist proxy theo radius, bracelet theo radius × Manual Fit đúng một lần. Đây là Visual Fit, chưa phải mm/True-to-Size.

### Continuity và occlusion

Grace giữ đúng ảnh raw, pose và mask hợp lệ cùng nhau trong bộ nhớ trình duyệt, tối đa 300ms kể từ receipt cuối. Có thể thấy khung hình dừng ngắn; không ngoại suy pose lên ảnh mới. Frame cũ, mode sai hoặc mất tracking lâu không được giữ vô hạn. Recovery hysteresis chỉ điều khiển nhãn, không cố tình giấu frame hợp lệ mới.

Proxy và vòng vẫn dùng cùng transform forearm, với scale độc lập. Snapshot giữ mask đúng ảnh; không dùng mask cũ để che trên ảnh mới. Không sửa model, depth material hay ánh sáng. Kiểm tra A/B/C tách mesh đầy đủ, depth+foreground và depth không mask; đây là kiểm tra hình học proxy, không phải ground truth mesh da.

## Kiểm thử và cách đọc bằng chứng

- `npm test`: 180/180 test, gồm 17 test continuity mới. Chuỗi tổng hợp 10s đứng/20s twist có frame lỗi định kỳ; các test quaternion/forearm/scale trước vẫn chạy.
- `npm run build`: TypeScript + Vite pass.
- `npm run test:live-continuity`: chặn model Pose có chủ đích, vẫn khởi tạo bằng Hand ở chế độ forearm. Replay đứng 10.023s: 72 frame suy luận, 0 frame ẩn; chuyển động ảnh liên tục 20.050s: 110 frame, 0 frame ẩn. Kích thước nội tại từ 0.35155 đến 0.36991, tỷ lệ max/min khoảng 1.0523. Số này thuộc fixture replay, không phải sai số sizing trên người thật.
- Blank input được đưa vào model thật, không tạo landmark giả. Đã đối chiếu pixel nền `[42,81,123,255]` của khung giữ với ảnh trước, timestamp render cũ hơn input; giữ khoảng 124.7ms ở lượt này. Mất dài rồi nhận lại phải bắt đầu provisional với calibration trống trước khi đo lại. Kết quả cũ replay bị bỏ qua.
- Toggle sáng/tối khi Live giữ đúng 1 engine, 1 session controller, 1 worker và track camera còn live; tắt camera giải phóng track. Đây cũng là kiểm tra React rerender không khởi tạo lại tracking/model.
- `test:live`: pass gần/xa, Manual Fit, mất Hand và nhận lại. Lỗ vòng khoảng 91.5px ở ảnh xa, 133.8px ở ảnh gần; cổ tay tương ứng 82.1/120.0px. Manual 130% tăng lỗ vòng khoảng 114.8→149.4px, proxy giữ khoảng 103px. ROI chỉ thành công nếu correspondence đủ; lượt hiện tại ghi `partialRejected`, không coi reject là đã tracking được cổ tay độc lập. Lượt đầu có 3 correspondence, không đủ 6, đã lưu bằng chứng ở `artifacts/live-continuity/partial-roi-rejection/`. Test không sửa thuật toán/hạ ngưỡng ROI để biến ca thiếu dữ liệu thành thành công.
- `test:live-axis`: pass ảnh xoay 0/20/45/90/180°, center/axis/scale và A/B/C occlusion. Ở ảnh20°, hướng contour đổi 19.622°, sai khác tâm so với phép xoay ảnh khoảng 0.479px. A có 2675 pixel mesh, B còn 1743 pixel, 877 pixel sau bị che, không có pixel bị che nằm ngoài foreground ở lượt đo này. Đây là ảnh xoay 2D và proxy có kiểm soát, không thay cho lật cổ tay 3D hoặc độ sâu da thật.
- `test:upload-occlusion`: pass; `artifacts/live-continuity/upload-regression.json` xác nhận 15/15 PNG A/B/measurement trên ba fixture byte-identical với baseline trước sửa. Hash 13 module bảo vệ không đổi trong `artifacts/live-continuity/protected-sources.json`; App chỉ khác hai câu hướng dẫn đã nêu.

Các script chạy tuần tự, không mở nhiều suite Chrome đồng thời. Bộ đo Canvas dùng task sau event handler để tránh đọc trước khi ứng dụng paint; lifecycle instrument đúng URL module Vite đang được app sử dụng. Test phân biệt grace 300ms với TTL calibration 1500ms, không yêu cầu reset calibration cho một lần mất ngắn.

## Chạy và nghiệm thu webcam còn lại

```sh
npm install
npm run dev
# Terminal khác, giữ Vite chạy:
npm test
npm run build
npm run test:live-continuity
npm run test:live
npm run test:live-axis
npm run test:upload-occlusion
```

Nếu server đã chạy, tải lại toàn trang để worker/controller dùng cùng bản. Để Manual Fit 100%, bật Debug Mode; Console lọc `[mira-live]`, `pipelineVersion` và `workerPipelineVersion` đều phải là `wrist-first-continuity-1`. Log có source hướng/depth/confidence, input/render timestamp, presentation current/hold/hidden, thời gian giữ, pose/trục/tâm, radius/k, width/scale và trạng thái estimate. Chỉ số confidence hình học không phải xác suất AI được hiệu chuẩn.

1. Chỉ bàn tay + cổ tay, không khuỷu: kiểm tra preview xuất hiện khi pose hợp lệ, thông báo rõ estimate nếu chưa đo được biên. Giữ thẳng 10s để thu calibration.
2. Nghiêng cả cẳng tay 20°, rồi gập riêng bàn tay; đối chiếu tâm/trục forearm, không chỉ nhìn trục Hand. Khi thiếu forearm độc lập, giả định rigid/straight chưa phân biệt được gập tay thật.
3. Lật mu→cạnh→lòng chậm, quay liên tục 20s. Cần video thực tế để nghiệm thu pronation/supination và drift; chưa kết luận bản sửa đáp ứng mọi góc 180°.
4. Đưa gần/xa, giữ Manual 100%, rồi 130% để so. Radius proxy không đổi chỉ vì Manual; kích thước hình chiếu đi theo khoảng cách, không nhân lặp theo frame.
5. Che tạm rồi trở lại. Grace là ảnh đứng ngắn có thời hạn; khi thiếu correspondence thật phải ẩn. Sau mất Hand lâu hơn 1.5s, đo lại để tránh giữ size người trước.
6. Tải lại ảnh đang dùng, thử màu/sáng tối/chụp PNG và tab áo.

Chưa có webcam vật lý/clip lật tay được gán nhãn trong phiên này. Chưa đo được forearm 3D đầy đủ từ một Hand/silhouette, chu vi mm, mesh da hay độ sâu occlusion thật. Da ít texture/che khuất lớn có thể làm ROI thất bại; CPU chậm/inference quá hạn có thể làm ẩn vòng. Không tuyên bố đã sửa hoàn toàn, không trôi mọi góc hoặc đạt photorealistic.
