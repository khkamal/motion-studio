import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFallbackPlan } from '../engine/planBuilder';
import { registerMaskProvider, type MaskProvider, type SegmentationResult } from '../engine/masks';
import { createRenderRuntime, disposeRenderRuntime, renderScene, type RenderRuntime } from '../engine/renderer';
import { exportMotionVideo } from '../services/exporter';
import { createMediaPipeMaskProvider, type InteractiveSegmentationEngine } from '../services/mediapipeMaskProvider';
import { DEFAULT_SETTINGS, type MediaAsset, type SubjectMask } from '../types/motion';

const maskDoubles = vi.hoisted(() => ({
  repair: vi.fn(),
  cutout: vi.fn(),
}));

vi.mock('../engine/masks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/masks')>();
  return {
    ...actual,
    createDiffusedRepair: maskDoubles.repair,
    createSubjectCutout: maskDoubles.cutout,
  };
});

class FakeContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  imageSmoothingEnabled = true;
  filter = 'none';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  drawCalls: Array<{ image: CanvasImageSource; args: number[] }> = [];
  translates: Array<[number, number]> = [];
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
  fillRect() {}
  createImageData(width: number, height: number) { return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData; }
  putImageData() {}
  translate(x: number, y: number) { this.translates.push([x, y]); }
  drawImage(image: CanvasImageSource, ...args: number[]) { this.drawCalls.push({ image, args }); }
  createLinearGradient() { return { addColorStop() {} } as CanvasGradient; }
}

class FakeCanvas {
  width = 0;
  height = 0;
  context = new FakeContext();
  captureStream() {
    const track = { requestFrame: vi.fn(), stop: vi.fn() };
    return {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
  }
  getContext() { return this.context as unknown as CanvasRenderingContext2D; }
}

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['webm-frame']) } as BlobEvent);
      this.onstop?.();
    });
  }
}

const asset: MediaAsset = {
  id: 'renderer-asset',
  name: 'car.png',
  type: 'image/png',
  width: 100,
  height: 100,
  blob: new Blob(['image'], { type: 'image/png' }),
  objectUrl: 'blob:renderer-test',
};

let canvases: FakeCanvas[];
let bitmap: ImageBitmap;
let unregister: (() => void) | null = null;

function makeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function installCanvasFakes() {
  canvases = [];
  bitmap = makeBitmap(100, 100);
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas;
    }),
  });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
}

function makeSegmentationResult(mask: SubjectMask, alphaBitmap = makeBitmap(48, 48)): SegmentationResult {
  return { mask, alphaBitmap };
}

function makeProvider(result: SegmentationResult | null) {
  const segment = vi.fn(async (..._args: Parameters<MaskProvider['segment']>) => result);
  const provider: MaskProvider = { id: 'test-mask-provider', segment };
  return { provider, segment };
}

function makeRenderCanvas() {
  const context = new FakeContext();
  const canvas = new FakeCanvas();
  canvas.width = 400;
  canvas.height = 400;
  canvas.context = context;
  return { canvas: canvas as unknown as HTMLCanvasElement, context };
}

function renderAt(plan: ReturnType<typeof buildFallbackPlan>, runtime: RenderRuntime, time: number) {
  const { canvas, context } = makeRenderCanvas();
  renderScene({ canvas, plan, runtime, settings: { ...structuredClone(DEFAULT_SETTINGS), width: 400, height: 400 } }, time);
  return context;
}

beforeEach(() => {
  installCanvasFakes();
  maskDoubles.repair.mockReset();
  maskDoubles.cutout.mockReset();
  const repair = new FakeCanvas() as unknown as HTMLCanvasElement;
  const cutout = new FakeCanvas() as unknown as HTMLCanvasElement;
  repair.width = 48;
  repair.height = 48;
  cutout.width = 48;
  cutout.height = 48;
  maskDoubles.repair.mockReturnValue(repair);
  maskDoubles.cutout.mockReturnValue(cutout);
});

afterEach(() => {
  unregister?.();
  unregister = null;
  vi.unstubAllGlobals();
});

describe('registered pixel masks in the shared renderer', () => {
  it('uses the registered provider for the planned main subject and renders a stable repaired plate plus animated cut-out', async () => {
    const plan = buildFallbackPlan({ fileName: 'car.png', width: 100, height: 100, duration: 8, fps: 30, style: '2D' });
    const main = plan.layers.find((layer) => layer.kind === 'subject')!;
    const generatedMask = {
      ...main.mask!,
      mode: 'alpha' as const,
      source: 'segmentation' as const,
      confidence: 'high' as const,
      region: { x: 0.35, y: 0.32, width: 0.3, height: 0.34 },
      alphaMaskDataUrl: null,
      note: 'Generated from a model confidence mask.',
    };
    const alphaBitmap = makeBitmap(48, 48);
    const { provider, segment } = makeProvider(makeSegmentationResult(generatedMask, alphaBitmap));
    unregister = registerMaskProvider(provider);

    // No provider argument: the default registration is the same one used by PreviewStage and exporter.
    const runtime = await createRenderRuntime(asset, plan, DEFAULT_SETTINGS);
    const prepared = runtime.subjects.get(main.id)!;
    expect(segment).toHaveBeenCalledTimes(1);
    expect(segment.mock.calls[0][0]).toBe(asset);
    expect(segment.mock.calls[0][1]).toBe(main.id);
    expect(segment.mock.calls[0][3]).toMatchObject({
      region: plan.subjectAnalysis.movingRegions.find((entry) => entry.subjectId === main.id)?.region,
      subjectName: plan.subjects[0].name,
    });
    expect(segment.mock.calls[0][3]?.image).toBe(runtime.source);
    expect(prepared.mask.source).toBe('segmentation');
    expect(prepared.canMoveIndependently).toBe(true);
    expect(runtime.subjectIsolationStatus).toBe('segmented');
    expect(alphaBitmap.close).toHaveBeenCalledTimes(1);
    expect(maskDoubles.repair).toHaveBeenCalledTimes(1);
    expect(maskDoubles.cutout).toHaveBeenCalledTimes(1);

    const start = renderAt(plan, runtime, 0);
    const middle = renderAt(plan, runtime, 4);
    const startBackground = start.drawCalls.find((call) => call.image === runtime.backgroundPlate);
    const middleBackground = middle.drawCalls.find((call) => call.image === runtime.backgroundPlate);
    expect(startBackground).toBeDefined();
    expect(startBackground?.args).toEqual(middleBackground?.args);
    expect(start.translates).toHaveLength(3);
    expect(middle.translates).toHaveLength(3);
    expect(middle.translates[2][0]).toBeGreaterThan(start.translates[2][0] + 1);
    expect(start.drawCalls.some((call) => call.image !== runtime.backgroundPlate)).toBe(true);

    disposeRenderRuntime(runtime);
  });

  it('shares registered local segmentation and cached masks between preview and the existing export renderer', async () => {
    const plan = buildFallbackPlan({ fileName: 'car.png', width: 100, height: 100, duration: 8, fps: 30, style: '2D' });
    let inferenceCount = 0;
    const engine: InteractiveSegmentationEngine = {
      segment: vi.fn(() => {
        inferenceCount += 1;
        const width = 32;
        const height = 32;
        const values = new Float32Array(width * height);
        const centerX = 16;
        const centerY = 17;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (Math.hypot(x - centerX, y - centerY) <= 5) values[y * width + x] = 0.92;
            else if (Math.hypot(x - centerX, y - centerY) <= 6) values[y * width + x] = 0.34;
          }
        }
        return { width, height, values, close: vi.fn() };
      }),
      close: vi.fn(),
    };
    const provider = createMediaPipeMaskProvider({
      createEngine: async () => engine,
      createCanvas: () => new FakeCanvas() as unknown as HTMLCanvasElement,
      createBitmap: async (canvas) => makeBitmap(canvas.width, canvas.height),
      isSupported: () => true,
      idleUnloadMs: 0,
    });
    unregister = registerMaskProvider(provider);

    const previewRuntime = await createRenderRuntime(asset, plan, DEFAULT_SETTINGS);
    expect(previewRuntime.subjectIsolationStatus).toBe('segmented');
    renderScene({ canvas: makeRenderCanvas().canvas, plan, runtime: previewRuntime, settings: { ...DEFAULT_SETTINGS, width: 400, height: 400 } }, 0);
    disposeRenderRuntime(previewRuntime);

    let renderedFrames = 0;
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder as unknown as typeof MediaRecorder);
    vi.stubGlobal('window', {
      setTimeout: (callback: TimerHandler) => {
        if (typeof callback === 'function') queueMicrotask(callback as () => void);
        return 1;
      },
      clearTimeout: vi.fn(),
    });
    const result = await exportMotionVideo({
      asset,
      plan,
      settings: { ...DEFAULT_SETTINGS, width: 400, height: 400 },
      format: 'webm',
      width: 400,
      height: 400,
      duration: 1,
      fps: 24,
      quality: 0.5,
      signal: new AbortController().signal,
      onProgress: () => { renderedFrames += 1; },
    });

    expect(inferenceCount).toBe(1);
    expect(engine.segment).toHaveBeenCalledTimes(1);
    expect(result.totalFrames).toBe(24);
    expect(result.mimeType).toMatch(/^video\/webm/);
    expect(renderedFrames).toBe(24);
    expect(maskDoubles.repair).toHaveBeenCalledTimes(2);
    expect(maskDoubles.cutout).toHaveBeenCalledTimes(2);
    provider.dispose();
  });

  it('segments only the primary planned subject automatically while leaving secondary subjects addressable and safe', async () => {
    const plan = buildFallbackPlan({ fileName: 'car.png', width: 100, height: 100, duration: 8, fps: 30, style: '2D' });
    const mainLayer = plan.layers.find((layer) => layer.kind === 'subject')!;
    const mainSubject = plan.subjects[0];
    const secondaryMask = { ...mainSubject.mask, region: { x: 0.12, y: 0.16, width: 0.2, height: 0.25 } };
    const secondarySubjectId = 'subject_2';
    plan.subjects.push({ ...mainSubject, id: secondarySubjectId, name: 'Secondary tree', importance: 5, region: secondaryMask.region, mask: secondaryMask });
    plan.layers.push({
      ...mainLayer,
      id: secondarySubjectId,
      subjectId: secondarySubjectId,
      name: 'Secondary tree',
      importance: 5,
      zIndex: 3,
      mask: secondaryMask,
      motions: mainLayer.motions.map((motion, index) => ({ ...motion, id: `secondary-motion-${index}`, targetId: secondarySubjectId })),
      keyframes: mainLayer.keyframes.map((frame, index) => ({ ...frame, id: `secondary-keyframe-${index}` })),
    });
    plan.subjectAnalysis.movingRegions.push({
      id: 'moving-subject-2', subjectId: secondarySubjectId, label: 'Secondary tree', region: secondaryMask.region, reason: 'Secondary subject test region.',
    });
    const generatedMask = {
      ...mainLayer.mask!, mode: 'alpha' as const, source: 'segmentation' as const, confidence: 'high' as const,
      region: { x: 0.35, y: 0.32, width: 0.3, height: 0.34 }, alphaMaskDataUrl: null,
    };
    const { provider, segment } = makeProvider(makeSegmentationResult(generatedMask));
    unregister = registerMaskProvider(provider);

    const runtime = await createRenderRuntime(asset, plan, DEFAULT_SETTINGS);
    expect(segment).toHaveBeenCalledTimes(1);
    expect(segment.mock.calls[0][1]).toBe(mainLayer.id);
    expect(runtime.subjects.get(mainLayer.id)?.canMoveIndependently).toBe(true);
    expect(runtime.subjects.get(secondarySubjectId)?.canMoveIndependently).toBe(false);
    expect(runtime.subjects.get(secondarySubjectId)?.mask.confidence).toBe('approximate');
    disposeRenderRuntime(runtime);
  });

  it('rejects Gemini-like estimates and segmentation labels without an actual alpha payload', async () => {
    const plan = buildFallbackPlan({ fileName: 'car.png', width: 100, height: 100, duration: 8, fps: 30, style: '2D' });
    const main = plan.layers.find((layer) => layer.kind === 'subject')!;
    const estimatedBitmap = makeBitmap(48, 48);
    const estimated = makeSegmentationResult({
      ...main.mask!,
      mode: 'ellipse',
      source: 'model-estimate',
      confidence: 'approximate',
      note: 'Estimated region only.',
    }, estimatedBitmap);
    const { provider, segment } = makeProvider(estimated);
    unregister = registerMaskProvider(provider);
    const runtime = await createRenderRuntime(asset, plan, DEFAULT_SETTINGS);
    const prepared = runtime.subjects.get(main.id)!;

    expect(segment).toHaveBeenCalledTimes(1);
    expect(estimatedBitmap.close).toHaveBeenCalledTimes(1);
    expect(prepared.canMoveIndependently).toBe(false);
    expect(prepared.mask.source).toBe('heuristic');
    expect(runtime.subjectIsolationStatus).toBe('estimated-fallback');
    expect(maskDoubles.repair).not.toHaveBeenCalled();
    expect(runtime.backgroundPlate.getContext('2d')?.drawImage).toBeDefined();
    const backgroundCalls = (runtime.backgroundPlate.getContext('2d') as unknown as FakeContext).drawCalls;
    expect(backgroundCalls).toHaveLength(1);
    expect(backgroundCalls[0].image).toBe(runtime.source);
    disposeRenderRuntime(runtime);

    unregister?.();
    unregister = null;
    maskDoubles.repair.mockClear();
    const claimedSegmentation: SubjectMask = {
      ...main.mask!,
      mode: 'alpha',
      source: 'segmentation',
      confidence: 'high',
      alphaMaskDataUrl: null,
    };
    const noPixels = makeProvider({ mask: claimedSegmentation });
    unregister = registerMaskProvider(noPixels.provider);
    const withoutAlpha = await createRenderRuntime(asset, plan, DEFAULT_SETTINGS);
    expect(withoutAlpha.subjects.get(main.id)?.canMoveIndependently).toBe(false);
    expect(withoutAlpha.subjects.get(main.id)?.mask.source).toBe('heuristic');
    expect(maskDoubles.repair).not.toHaveBeenCalled();
    disposeRenderRuntime(withoutAlpha);
  });
});
