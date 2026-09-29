import { describe, expect, it, vi } from 'vitest';
import { canRunLocalSegmentation, type SegmentationDeviceProfile } from '../services/capabilities';
import { createMediaPipeMaskProvider, createPositiveSeedStroke, extractSeededMask, type InteractiveSegmentationEngine, type RawSegmentationMask } from '../services/mediapipeMaskProvider';
import type { MediaAsset, SubjectRegion } from '../types/motion';

class FakeCanvasContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  drawImage = vi.fn();
  putImageData = vi.fn();

  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  context = new FakeCanvasContext();

  getContext() { return this.context; }
}

function circleMask(width = 40, height = 20, centerX = 0.5, centerY = 0.5): Float32Array {
  const values = new Float32Array(width * height);
  const cx = Math.round(centerX * (width - 1));
  const cy = Math.round(centerY * (height - 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= 5) values[y * width + x] = 0.92;
      else if (distance <= 6) values[y * width + x] = 0.34;
    }
  }
  return values;
}

const asset: MediaAsset = {
  id: 'asset-1',
  name: 'subject.png',
  type: 'image/png',
  width: 1000,
  height: 500,
  blob: new Blob(['pixels'], { type: 'image/png' }),
  objectUrl: 'blob:subject',
};
const region: SubjectRegion = { x: 0.35, y: 0.35, width: 0.3, height: 0.3 };
const source = { width: 1000, height: 500 } as HTMLCanvasElement;

function makeProvider(maskFactory: () => RawSegmentationMask, maxCacheEntries = 4) {
  const canvases: FakeCanvas[] = [];
  const createCanvas = vi.fn(() => {
    const canvas = new FakeCanvas();
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  });
  const observedInputSizes: Array<{ width: number; height: number }> = [];
  const segment = vi.fn((image: HTMLCanvasElement, _point: { x: number; y: number }) => {
    observedInputSizes.push({ width: image.width, height: image.height });
    return maskFactory();
  });
  const engine: InteractiveSegmentationEngine = {
    segment,
    close: vi.fn(),
  };
  const createEngine = vi.fn(async () => engine);
  const createBitmap = vi.fn(async (canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    close: vi.fn(),
  }) as unknown as ImageBitmap);
  const provider = createMediaPipeMaskProvider({
    createEngine,
    createCanvas,
    createBitmap,
    isSupported: () => true,
    maxCacheEntries,
    idleUnloadMs: 0,
  });
  return { provider, engine, segment, createEngine, createCanvas, createBitmap, canvases, observedInputSizes };
}

describe('MediaPipe MagicTouch subject-mask provider', () => {
  it('creates a typed modern positive-brush Stroke prompt at the planned subject point', () => {
    expect(createPositiveSeedStroke({ x: 0.4, y: 0.6 })).toEqual({
      brushMode: 1,
      point: [{ x: 0.4, y: 0.6 }],
      isCompleted: true,
    });
  });

  it('returns a pixel-level alpha mask derived from the seeded model output', async () => {
    const rawMaskClose = vi.fn();
    const { provider, segment, createBitmap, canvases, observedInputSizes } = makeProvider(() => ({
      width: 40,
      height: 20,
      values: circleMask(),
      close: rawMaskClose,
    }));
    const result = await provider.segment(asset, 'subject_1', undefined, { region, image: source });

    expect(segment).toHaveBeenCalledTimes(1);
    expect(observedInputSizes).toEqual([{ width: 512, height: 256 }]);
    expect(segment.mock.calls[0][1]).toEqual({ x: 0.5, y: 0.5 });
    expect(result?.mask).toMatchObject({
      mode: 'alpha', source: 'segmentation', confidence: 'high', alphaMaskDataUrl: null,
    });
    expect(result?.mask.region).not.toEqual(region);
    expect(result?.alphaBitmap).toMatchObject({ width: 40, height: 20 });
    expect(rawMaskClose).toHaveBeenCalledTimes(1);
    expect(createBitmap).toHaveBeenCalledTimes(1);
    expect(canvases[canvases.length - 1]?.context.putImageData).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it('reuses bounded alpha bytes across independent preview/export runtimes and returns disposable bitmaps', async () => {
    let inferenceCount = 0;
    const { provider, segment, engine, createBitmap } = makeProvider(() => {
      inferenceCount += 1;
      return { width: 40, height: 20, values: circleMask(), close: vi.fn() };
    });
    const first = await provider.segment(asset, 'subject_1', undefined, { region, image: source });
    const second = await provider.segment(asset, 'subject_1', undefined, { region, image: { width: 1000, height: 500 } as HTMLCanvasElement });

    expect(inferenceCount).toBe(1);
    expect(segment).toHaveBeenCalledTimes(1);
    expect(provider.cacheSize).toBe(1);
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(first?.alphaBitmap).not.toBe(second?.alphaBitmap);
    first?.alphaBitmap?.close();
    expect(second?.alphaBitmap?.close).not.toHaveBeenCalled();
    provider.dispose();
    expect(engine.close).toHaveBeenCalledTimes(1);
    expect(provider.cacheSize).toBe(0);
  });

  it('accepts the modern model-native mask size while keeping pixel processing bounded', () => {
    const width = 768;
    const height = 768;
    const values = new Float32Array(width * height);
    const center = width / 2;
    for (let y = center - 30; y <= center + 30; y += 1) {
      for (let x = center - 30; x <= center + 30; x += 1) {
        const distance = Math.hypot(x - center, y - center);
        if (distance <= 24) values[y * width + x] = 0.92;
        else if (distance <= 30) values[y * width + x] = 0.34;
      }
    }

    expect(extractSeededMask(values, width, height, { x: 0.5, y: 0.5 })?.width).toBe(768);
  });

  it('rejects weak, diffuse, oversized, or unseeded confidence maps', () => {
    const weak = new Float32Array(40 * 20).fill(0.12);
    const oversized = new Float32Array(40 * 20).fill(0.92);
    const offsetObject = circleMask(40, 20, 0.12, 0.15);

    expect(extractSeededMask(weak, 40, 20, { x: 0.5, y: 0.5 })).toBeNull();
    expect(extractSeededMask(oversized, 40, 20, { x: 0.5, y: 0.5 })).toBeNull();
    expect(extractSeededMask(offsetObject, 40, 20, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('caps cached mask entries to a small LRU and skips low-memory or data-saving devices', async () => {
    const { provider } = makeProvider(() => ({ width: 40, height: 20, values: circleMask(), close: vi.fn() }), 1);
    const secondRegion = { ...region, x: 0.3 };
    await provider.segment(asset, 'subject_1', undefined, { region, image: source });
    await provider.segment(asset, 'subject_1', undefined, { region: secondRegion, image: source });
    expect(provider.cacheSize).toBe(1);
    provider.dispose();

    const capable: SegmentationDeviceProfile = {
      webAssembly: true, imageBitmap: true, canvas: true, hardwareConcurrency: 4, deviceMemoryGb: 4, saveData: false,
    };
    expect(canRunLocalSegmentation(capable)).toBe(true);
    expect(canRunLocalSegmentation({ ...capable, deviceMemoryGb: 1 })).toBe(false);
    expect(canRunLocalSegmentation({ ...capable, hardwareConcurrency: 1 })).toBe(false);
    expect(canRunLocalSegmentation({ ...capable, saveData: true })).toBe(false);
  });
});
