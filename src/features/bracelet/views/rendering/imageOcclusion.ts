import * as THREE from 'three';
import type { ImageMask } from '../../models/imageCoordinates';
import { BANGLE, BANGLE_CLEARANCE_SCALE } from '../../models/braceletDimensions';
/** Giữ depth pass hình học bất kể Auto Fit hay provisional. Foreground đáng tin cậy có thể refine silhouette của proxy. */
export function imageOcclusionOptions(mask: ImageMask | null) {
  return { occlusion: true, imageMask: mask, debugProxy: false } as const;
}


/** Giới hạn depth theo foreground của ảnh đang render. gl_FragCoord có gốc dưới-trái, ảnh/mask có gốc trên-trái. Upload và Live đều có thể cung cấp mask cùng frame. */
export class ImageOcclusion {
  private mask: ImageMask | null = null;
  private texture: THREE.DataTexture | null = null;
  readonly uniforms = {
    imageMaskEnabled: { value: false }, imageMask: { value: null as THREE.DataTexture | null },
    imageMaskRoi: { value: new THREE.Vector4() }, imageViewport: { value: new THREE.Vector2(1, 1) },
  };
  install(material: THREE.Material, contactShadow = false) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = `uniform bool imageMaskEnabled; uniform sampler2D imageMask; uniform vec4 imageMaskRoi; uniform vec2 imageViewport;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {
        if (imageMaskEnabled) {
          vec2 photoUv = vec2(gl_FragCoord.x / imageViewport.x, 1.0 - gl_FragCoord.y / imageViewport.y);
          vec2 maskUv = (photoUv - imageMaskRoi.xy) / imageMaskRoi.zw;
          if (any(lessThan(maskUv, vec2(0.0))) || any(greaterThan(maskUv, vec2(1.0)))) discard;
          if (texture2D(imageMask, maskUv).r < 0.5) discard;
        }`);
      if (contactShadow) {
        // Proxy cẳng tay từ một camera không đủ cơ sở tạo bóng đổ dài, đậm.
        // Giới hạn mặt nhận bóng hiện có vào vùng tiếp xúc của vòng;
        // giữ PBR, ánh sáng và cách xử lý shading đã được kiểm chứng.
        const halfTube = BANGLE.tubeRadius * BANGLE_CLEARANCE_SCALE;
        shader.vertexShader = `varying float imageProxyZ;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nimageProxyZ = position.z;');
        shader.fragmentShader = `varying float imageProxyZ;\n${shader.fragmentShader}`.replace('#include <tonemapping_fragment>', `if (imageMaskEnabled) gl_FragColor.a *= 1.0 - smoothstep(${halfTube.toFixed(6)}, ${(halfTube * 2).toFixed(6)}, abs(imageProxyZ));\n#include <tonemapping_fragment>`);
      }
    };
    material.customProgramCacheKey = () => `upload-foreground-clip-v2-${contactShadow}`;
  }
  update(mask: ImageMask | null, width: number, height: number) {
    this.uniforms.imageViewport.value.set(width, height);
    this.uniforms.imageMaskEnabled.value = !!mask;
    if (mask === this.mask) return;
    this.texture?.dispose(); this.texture = null; this.mask = mask;
    if (mask) {
      const texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RedFormat);
      texture.flipY = false; texture.unpackAlignment = 1;
      texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.needsUpdate = true;
      this.texture = texture; const r = mask.roi;
      this.uniforms.imageMaskRoi.value.set(r.x, r.y, r.width, r.height);
    }
    this.uniforms.imageMask.value = this.texture;
  }
  dispose() { this.texture?.dispose(); this.texture = null; this.mask = null; }
}
