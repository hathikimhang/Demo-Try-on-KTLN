import * as THREE from 'three';
import type { WristPose } from '../../models/wrist.types';
/** Fixture kiểm tra renderer, không phải dữ liệu inference hoặc pose fallback của ứng dụng. */
export function renderScenarios(): { name: string; pose: WristPose }[] {
  const views: [string, number, number, number, number][] = [
    ['Thẳng đứng', -Math.PI / 2, 0, 0, .23], ['Nằm ngang', -Math.PI / 2, 0, Math.PI / 2, .23],
    ['Mặt trong', -Math.PI / 2, 0, 0, .23], ['Xoay 45°', -Math.PI / 2, Math.PI / 4, 0, .23], ['Đang xoay ra cạnh', -Math.PI / 2, Math.PI / 2, 0, .23],
    ['Mặt ngoài', -Math.PI / 2, Math.PI, 0, .23], ['Nghiêng 45°', -Math.PI / 4, 0, 0, .23],
    ['Xa camera', -Math.PI / 2, 0, 0, .14], ['Gần camera', -Math.PI / 2, 0, 0, .30],
    ['Nhìn dọc trục (chỉ render)', 0, 0, 0, .23],
  ];
  return views.map(([name, pitch, twist, roll, radius]) => ({ name, pose: {
    center: { x: 0, y: 0, z: 1.35 }, radius, focal: 1.35, aspect: 1, palmLength: radius * 3, handedness: 'Right',
    orientation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), twist)),
  } }));
}
