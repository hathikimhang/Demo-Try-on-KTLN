import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyCameraPose, configureCamera, createBraceletObjects, disposeObjects } from './braceletModel';
import type { WristPose } from './wristGeometry';
import type { ImageMask } from './imageCoordinates';
import { ImageOcclusion } from './imageOcclusion';
import { renderPose, type BraceletRenderFrame } from './braceletRenderFrame';

type RenderOptions = { occlusion?: boolean; shadows?: boolean; debugProxy?: boolean; imageMask?: ImageMask | null };
/** Three.js renders the transparent 3D layer. Canvas 2D only composites it
 * with the exact inference frame and exports PNG. No CPU ring rasterizer. */
export class BraceletRenderer {
  /** CPU submission telemetry only; no changes to rendering quality. */
  renderedFrames = 0;
  lastRenderMs = 0;
  private engine: ReturnType<BraceletRenderer['createEngine']> | null = null;
  private cache: { pose: WristPose; color: string; size: number; width: number; height: number; occlusion: boolean; shadows: boolean; debugProxy: boolean; imageMask: ImageMask | null } | null = null;
  private framePose: { tracking: BraceletRenderFrame['tracking']; radius: number; pose: WristPose } | null = null;
  private createEngine() {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const objects = createBraceletObjects(); scene.add(objects.group);
    const imageOcclusion = new ImageOcclusion();
    imageOcclusion.install(objects.occluder.material); imageOcclusion.install(objects.shadow.material, true);
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04); scene.environment = environment.texture;
    disposeObjects(room); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x45445a, 0.8));
    const key = new THREE.DirectionalLight(0xfff3df, 3);
    key.castShadow = true; key.shadow.mapSize.set(512, 512); key.shadow.normalBias = 0.001; key.shadow.bias = -0.00005;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe4ecff, 1.3); scene.add(fill);
    const engine = { renderer, scene, camera, objects, environment, key, fill, imageOcclusion, lost: false };
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); engine.lost = true; });
    return engine;
  }
  renderLayer(pose: WristPose, color: string, size: number, width: number, height: number, options: RenderOptions = {}) {
    const e = this.engine ?? (this.engine = this.createEngine());
    if (e.lost) throw new Error('WebGL context lost');
    const occlusion = options.occlusion ?? true, shadows = options.shadows ?? true, debugProxy = options.debugProxy ?? false, c = this.cache;
    const imageMask = options.imageMask ?? null;
    if (c && c.pose === pose && c.color === color && c.size === size && c.width === width && c.height === height && c.occlusion === occlusion && c.shadows === shadows && c.debugProxy === debugProxy && c.imageMask === imageMask) return e.renderer.domElement;
    const factor = Math.min(1, 1200 / Math.max(width, height));
    const rw = Math.max(1, Math.round(width * factor)), rh = Math.max(1, Math.round(height * factor));
    if (e.renderer.domElement.width !== rw || e.renderer.domElement.height !== rh) e.renderer.setSize(rw, rh, false);
    e.imageOcclusion.update(imageMask, rw, rh);
    configureCamera(e.camera, pose.focal, pose.aspect); applyCameraPose(e.objects.group, pose, size);
    e.objects.debugProxy.visible = debugProxy;
    e.objects.metal.color.set(color); e.objects.occluder.visible = occlusion; e.objects.shadow.visible = occlusion && shadows;
    const r = Math.max(pose.radius, e.objects.bracelet.scale.x), center = e.objects.group.position;
    e.key.position.copy(center).add(new THREE.Vector3(-3 * r, 5 * r, 6 * r)); e.key.target.position.copy(center);
    const sc = e.key.shadow.camera;
    sc.left = sc.bottom = -r * 3; sc.right = sc.top = r * 3; sc.near = r * 0.2; sc.far = r * 18; sc.updateProjectionMatrix();
    e.fill.position.copy(center).add(new THREE.Vector3(4 * r, -r, 2 * r));
    const renderAt = performance.now();
    e.renderer.render(e.scene, e.camera);
    this.renderedFrames++; this.lastRenderMs = performance.now() - renderAt;
    this.cache = { pose, color, size, width, height, occlusion, shadows, debugProxy, imageMask }; return e.renderer.domElement;
  }
  draw(ctx: CanvasRenderingContext2D, pose: WristPose, color: string, size: number, options: RenderOptions = {}) {
    ctx.drawImage(this.renderLayer(pose, color, size, ctx.canvas.width, ctx.canvas.height, options), 0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  drawFrame(ctx: CanvasRenderingContext2D, frame: BraceletRenderFrame, options: RenderOptions = {}) {
    const previous = this.framePose, radius = frame.sizing.wristRadius;
    if (!previous || previous.tracking !== frame.tracking || previous.radius !== radius) this.framePose = { tracking: frame.tracking, radius, pose: renderPose(frame) };
    this.draw(ctx, this.framePose!.pose, frame.color, frame.sizing.manualFitMultiplier, options);
  }
  clear() {
    if (this.engine) { const e = this.engine; e.imageOcclusion.dispose(); disposeObjects(e.scene); e.key.shadow.dispose(); e.environment.dispose(); e.renderer.dispose(); e.renderer.forceContextLoss(); }
    this.engine = null; this.cache = null; this.framePose = null;
  }
}
