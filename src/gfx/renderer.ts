import { NeutralToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';

export interface RenderContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}

export function createRenderContext(canvas: HTMLCanvasElement, pixelRatio: number): RenderContext {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatio));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.sortObjects = true;

  const scene = new Scene();
  scene.matrixWorldAutoUpdate = true;
  const camera = new PerspectiveCamera(72, 1, 0.08, 5e9);
  camera.position.set(0, 0, 0);
  scene.add(camera);
  return { renderer, scene, camera };
}

export function resizeRenderContext(ctx: RenderContext, pixelRatio: number): void {
  const canvas = ctx.renderer.domElement;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  ctx.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatio));
  ctx.renderer.setSize(w, h, false);
  ctx.camera.aspect = w / Math.max(1, h);
  ctx.camera.updateProjectionMatrix();
}
