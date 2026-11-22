import * as THREE from 'three';
import type { ImageMask } from './imageCoordinates';
import { BANGLE, BANGLE_CLEARANCE_SCALE } from './braceletDimensions';

/** Independent of Auto Fit success/provisional state: preserve the historical
 * geometric depth pass. Reliable image foreground can refine its silhouette. */
export function imageOcclusionOptions(mask: ImageMask | null) {
  return { occlusion: true, imageMask: mask, debugProxy: false } as const;
}

/** Upload-only foreground clipping. gl_FragCoord is bottom-left, the source
 * photo/mask top-left. Webcam retains its existing unmasked depth pass. */
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
        // A monocular forearm proxy does not justify a long, opaque cast shadow.
        // Restrict the existing receiver to the band contact zone; product
        // PBR and light settings remain unchanged, as does all webcam shading.
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
