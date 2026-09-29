import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFallbackPlan, normalizePlan } from '../engine/planBuilder';
import { createRenderRuntime, disposeRenderRuntime, renderScene, type RenderRuntime } from '../engine/renderer';
import { DEFAULT_SETTINGS } from '../types/motion';

afterEach(() => { vi.unstubAllGlobals(); });

class RecordingContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  filter = 'none';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  translates: Array<[number, number]> = [];
  drawCalls: Array<{ image: CanvasImageSource; args: number[] }> = [];
  fills: Array<[number, number, number, number]> = [];

  save() {}
  restore() {}
  clearRect() {}
  rotate() {}
  scale() {}
  beginPath() {}
  closePath() {}
  fill() {}
  clip() {}
  moveTo() {}
  lineTo() {}
  rect() {}
  ellipse() {}
  translate(x: number, y: number) { this.translates.push([x, y]); }
  fillRect(x: number, y: number, width: number, height: number) { this.fills.push([x, y, width, height]); }
  drawImage(image: CanvasImageSource, ...args: number[]) { this.drawCalls.push({ image, args }); }
  createLinearGradient() { return { addColorStop() {} } as CanvasGradient; }
}

function makeCanvas(width: number, height: number, context: RecordingContext) {
  return { width, height, getContext: () => context } as unknown as HTMLCanvasElement;
}

function makeScene(independentMask: boolean) {
  let plan = buildFallbackPlan({ fileName: 'car.png', width: 100, height: 100, duration: 8, fps: 30, style: '2D' });
  if (independentMask) {
    const trustedMask = { ...plan.subjects[0].mask, source: 'segmentation' as const, confidence: 'high' as const };
    plan = normalizePlan({
      ...plan,
      source: 'edited',
      subjects: plan.subjects.map((subject, index) => index === 0 ? { ...subject, mask: trustedMask } : subject),
      layers: plan.layers.map((layer) => layer.kind === 'subject' ? { ...layer, mask: trustedMask } : layer),
    }, 8, 30, 'edited');
    const main = plan.layers.find((layer) => layer.kind === 'subject')!;
    main.keyframes.push(
      { id: 'test-x-start', at: 0, property: 'x', value: 0, easing: 'linear' },
      { id: 'test-x-middle', at: 0.5, property: 'x', value: 0.08, easing: 'linear' },
      { id: 'test-x-end', at: 1, property: 'x', value: 0.02, easing: 'linear' },
    );
  }
  const subjectLayer = plan.layers.find((layer) => layer.kind === 'subject')!;
  const mainMask = subjectLayer.mask!;
  const background = { width: 100, height: 100 } as HTMLCanvasElement;
  const source = { width: 100, height: 100 } as HTMLCanvasElement;
  const cutout = { width: 60, height: 40 } as HTMLCanvasElement;
  const repair = { width: 60, height: 40 } as HTMLCanvasElement;
  const maskCanvas = { width: 60, height: 40 } as HTMLCanvasElement;
  const runtime = {
    source,
    backgroundPlate: background,
    sourceWidth: 100,
    sourceHeight: 100,
    disposed: false,
    subjects: new Map([[subjectLayer.id, {
      layerId: subjectLayer.id,
      mask: mainMask,
      maskInfo: { bounds: { x: 20, y: 30, width: 60, height: 40 }, maskCanvas },
      cutout: independentMask ? cutout : null,
      repair: independentMask ? repair : null,
      canMoveIndependently: independentMask,
    }]]),
  } as unknown as RenderRuntime;
  const settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    width: 400,
    height: 400,
    cameraEnabled: false,
    effectsEnabled: false,
    particlesEnabled: false,
  };
  return { plan, runtime, settings, background };
}

function renderAt(scene: ReturnType<typeof makeScene>, time: number) {
  const context = new RecordingContext();
  const canvas = makeCanvas(400, 400, context);
  renderScene({ canvas, plan: scene.plan, settings: scene.settings, runtime: scene.runtime }, time);
  return context;
}

describe('shared subject renderer', () => {
  it('does not create a cut-out or repair patch from an estimated mask', async () => {
    const contexts: RecordingContext[] = [];
    class FakeCanvas {
      width = 0;
      height = 0;
      context = new RecordingContext();
      constructor() { contexts.push(this.context); }
      getContext() { return this.context; }
    }
    const bitmap = { width: 100, height: 100, close: vi.fn() };
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const plan = buildFallbackPlan({ fileName: 'car.png', width: 100, height: 100, duration: 8, fps: 30, style: '2D' });
    const asset = { id: 'test-asset', name: 'car.png', type: 'image/png', width: 100, height: 100, blob: new Blob(['image']), objectUrl: 'blob:test' };
    const runtime = await createRenderRuntime(asset, plan, DEFAULT_SETTINGS, null);
    const main = plan.layers.find((layer) => layer.kind === 'subject')!;
    const prepared = runtime.subjects.get(main.id) as unknown as { canMoveIndependently: boolean; cutout: HTMLCanvasElement | null };
    expect(prepared.canMoveIndependently).toBe(false);
    expect(prepared.cutout).toBeNull();
    expect(contexts[1].drawCalls).toHaveLength(1);
    expect(contexts[1].drawCalls[0].image).toBe(runtime.source);
    disposeRenderRuntime(runtime);
  });

  it('renders approximate subject motion as a clipped material highlight without shifting the source plate', () => {
    const scene = makeScene(false);
    const start = renderAt(scene, 0);
    const middle = renderAt(scene, 4);
    expect(scene.plan.layers.find((layer) => layer.kind === 'background')?.motions).toHaveLength(0);
    expect(start.drawCalls).toHaveLength(1);
    expect(middle.drawCalls).toHaveLength(1);
    expect(start.drawCalls[0].image).toBe(scene.background);
    expect(middle.drawCalls[0].image).toBe(scene.background);
    expect(start.drawCalls[0].args).toEqual(middle.drawCalls[0].args);
    expect(start.translates).toHaveLength(2);
    expect(middle.translates).toHaveLength(2);
    expect(start.fills.length).toBeGreaterThan(1);
    expect(middle.fills.length).toBeGreaterThan(1);
  });

  it('passes time-varying subject transforms to the existing renderer for a trusted mask', () => {
    const scene = makeScene(true);
    const start = renderAt(scene, 0);
    const middle = renderAt(scene, 4);
    expect(start.drawCalls[0].image).toBe(scene.background);
    expect(start.drawCalls[0].args).toEqual(middle.drawCalls[0].args);
    expect(start.translates).toHaveLength(3);
    expect(middle.translates).toHaveLength(3);
    expect(middle.translates[2][0]).toBeGreaterThan(start.translates[2][0] + 1);
    expect(start.drawCalls.some((call) => call.image !== scene.background)).toBe(true);
  });
});
