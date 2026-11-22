import * as THREE from 'three';
import { BANGLE_CLEARANCE_SCALE, BANGLE, FOREARM, finalWorldScale } from '../../models/braceletDimensions';
export { BANGLE_CLEARANCE_SCALE } from '../../models/braceletDimensions';


/** Bangle đầy đủ 2π và bất biến. XY local là mặt phẳng vòng, +Z hướng cẳng tay. */
export function createBangleGeometry() {
  const geometry = new THREE.TorusGeometry(BANGLE.majorRadius, BANGLE.tubeRadius, 24, 144, Math.PI * 2);
  geometry.scale(1, BANGLE.oval, 1); // Thiết kế cố định, không làm biến dạng theo frame.
  geometry.computeBoundingSphere();
  return geometry;
}

export function createForearmGeometry() {
  const geometry = new THREE.CylinderGeometry(FOREARM.top, FOREARM.bottom, FOREARM.length, 64, 4, false);
  // +Z local hướng khuỷu tay; giới hạn đầu proxy gần cổ tay,
  // không kéo dài năm bán kính vào bàn tay và phía trước vòng.
  geometry.rotateX(Math.PI / 2); geometry.scale(1, FOREARM.oval, 1); geometry.translate(0, 0, FOREARM.offset);
  return geometry;
}

export function createBraceletObjects() {
  const group = new THREE.Group();
  const bracelet = new THREE.Group(), wrist = new THREE.Group();
  bracelet.name = 'bracelet-size'; wrist.name = 'estimated-wrist-size'; group.add(bracelet, wrist);
  const metal = new THREE.MeshPhysicalMaterial({ color: '#c5a15e', metalness: 1, roughness: 0.23, clearcoat: 0.3, clearcoatRoughness: 0.16, envMapIntensity: 1.25 });
  const band = new THREE.Mesh(createBangleGeometry(), metal);
  band.scale.setScalar(BANGLE_CLEARANCE_SCALE);
  band.name = 'closed-bangle'; band.castShadow = true; band.receiveShadow = true; band.renderOrder = 2; bracelet.add(band);
  const gems = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.047, 0), new THREE.MeshPhysicalMaterial({ color: '#e4edf5', metalness: 0, roughness: 0.12, clearcoat: 1, ior: 1.7, envMapIntensity: 1.6 }), 22);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 22; i++) {
    const t = (i + 0.5) / 22 * Math.PI * 2;
    matrix.makeRotationZ(t); matrix.setPosition(Math.cos(t) * 1.21, Math.sin(t) * 1.21 * 0.84, 0);
    gems.setMatrixAt(i, matrix);
  }
  gems.scale.setScalar(BANGLE_CLEARANCE_SCALE);
  gems.instanceMatrix.needsUpdate = true; gems.castShadow = true; gems.renderOrder = 2; bracelet.add(gems);
  const proxyGeometry = createForearmGeometry();
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide });
  const occluder = new THREE.Mesh(proxyGeometry, depthMaterial);
  occluder.name = 'forearm-depth-only'; occluder.renderOrder = 0; wrist.add(occluder);
  const shadow = new THREE.Mesh(proxyGeometry, new THREE.ShadowMaterial({ color: '#100c08', opacity: 0.2, depthWrite: false, side: THREE.FrontSide }));
  shadow.receiveShadow = true; shadow.renderOrder = 3; shadow.name = 'forearm-contact-shadow'; wrist.add(shadow);
  const debugProxy = new THREE.Mesh(proxyGeometry, new THREE.MeshBasicMaterial({ color: '#52e6ff', wireframe: true, transparent: true, opacity: .35, depthWrite: false, depthTest: false }));
  debugProxy.name = 'debug-proxy'; debugProxy.visible = false; debugProxy.renderOrder = 4; wrist.add(debugProxy);
  return { group, bracelet, wrist, band, metal, gems, occluder, shadow, debugProxy };
}


// CV dùng phải/xuống/ra xa, Three.js dùng phải/lên/về camera.
// Phép xoay đúng bảo toàn handedness; chỉ mirror composition hoàn chỉnh một lần.
const cvToThree = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

export function applyCameraPose(group: THREE.Object3D, pose: { center: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number }; radius: number }, manualSize: number) {
  group.position.set(pose.center.x, -pose.center.y, -pose.center.z);
  group.quaternion.copy(cvToThree).multiply(new THREE.Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w));
  // Tracking là rigid. Fit chỉ đổi trang sức, không đổi proxy da,
  // camera, vị trí hoặc hướng. Gán scale tuyệt đối ở mỗi frame.
  group.scale.setScalar(1);
  group.getObjectByName('estimated-wrist-size')?.scale.setScalar(pose.radius);
  group.getObjectByName('bracelet-size')?.scale.setScalar(finalWorldScale(pose.radius, manualSize));
}

export function configureCamera(camera: THREE.PerspectiveCamera, focal: number, imageAspect: number) {
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(imageAspect / (2 * focal)));
  camera.aspect = 1 / imageAspect; camera.near = 0.01; camera.far = 50; camera.updateProjectionMatrix();
}

export function disposeObjects(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
      if (object instanceof THREE.InstancedMesh) object.dispose();
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
