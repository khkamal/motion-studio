import type { BrushMode, Stroke } from '@mediapipe/tasks-vision';
import type { MediaAsset, SubjectMask, SubjectRegion } from '../types/motion';
import type { MaskProvider, MaskProviderContext, SegmentationResult } from '../engine/masks';
import { canRunLocalSegmentation } from './capabilities';

const MEDIAPIPE_VERSION = '1.0.1';
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
// The stateful Stroke API is paired with the official int8 v2 model (30,525,312 bytes).
export const MAGIC_TOUCH_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task';
export const SEGMENTATION_MAX_EDGE = 512;
const MAX_MASK_EDGE = 768;
const MAX_MASK_PIXELS = MAX_MASK_EDGE * MAX_MASK_EDGE;
const MODEL_CACHE_VERSION = 'magic-touch-v2-int8';
// MediaPipe 1.0.1 types declare the BrushMode enum, but its JS bundle omits the runtime export.
// Keep the documented enum value typed against the package until that export is available.
const POSITIVE_BRUSH_MODE = 1 as BrushMode;
const MIN_SEED_CONFIDENCE = 0.46;
const COMPONENT_THRESHOLD = 0.45;
const MIN_COMPONENT_RATIO = 0.0015;
const MAX_COMPONENT_RATIO = 0.72;
const MAX_BOUNDS_RATIO = 0.48;
const DEFAULT_CACHE_ENTRIES = 4;
const DEFAULT_IDLE_UNLOAD_MS = 60_000;
const INITIALIZATION_RETRY_MS = 30_000;

export interface RawSegmentationMask {
  width: number;
  height: number;
  /** Confidence probabilities for the selected foreground, normally in [0, 1]. */
  values: ArrayLike<number>;
  /** Releases any MediaPipe-owned buffers after the confidence values have been copied. */
  close?: () => void;
}

export interface InteractiveSegmentationEngine {
  segment(image: HTMLCanvasElement, point: { x: number; y: number }): RawSegmentationMask | null;
  close(): void;
}

interface CachedMask {
  width: number;
  height: number;
  /** One byte per low-resolution alpha pixel, deliberately not a base64 data URL. */
  alpha: Uint8Array;
  mask: SubjectMask;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

export interface MediaPipeMaskProviderOptions {
  createEngine?: () => Promise<InteractiveSegmentationEngine>;
  createCanvas?: () => HTMLCanvasElement;
  createBitmap?: (canvas: HTMLCanvasElement) => Promise<ImageBitmap>;
  isSupported?: () => boolean;
  maxEdge?: number;
  maxCacheEntries?: number;
  idleUnloadMs?: number;
}

function createCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

function createBitmap(canvas: HTMLCanvasElement): Promise<ImageBitmap> {
  return createImageBitmap(canvas);
}

function dimensionsOf(image: CanvasImageSource): { width: number; height: number } | null {
  const source = image as CanvasImageSource & {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const width = source.naturalWidth || source.videoWidth || source.width || 0;
  const height = source.naturalHeight || source.videoHeight || source.height || 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

function pointForRegion(region: SubjectRegion): NormalizedPoint {
  return {
    x: Math.min(1, Math.max(0, region.x + region.width / 2)),
    y: Math.min(1, Math.max(0, region.y + region.height / 2)),
  };
}

function cacheKey(asset: MediaAsset, subjectId: string, region: SubjectRegion, point: NormalizedPoint): string {
  return JSON.stringify([
    MODEL_CACHE_VERSION,
    asset.id,
    asset.blob.size,
    asset.width,
    asset.height,
    subjectId,
    point.x.toFixed(4),
    point.y.toFixed(4),
    region.x.toFixed(4),
    region.y.toFixed(4),
    region.width.toFixed(4),
    region.height.toFixed(4),
  ]);
}

function probabilityAt(values: ArrayLike<number>, index: number): number {
  const value = Number(values[index]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value > 1 ? value / 255 : value);
}

function touchesComponent(index: number, width: number, height: number, component: Uint8Array): boolean {
  const x = index % width;
  const y = Math.floor(index / width);
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    const nextY = y + offsetY;
    if (nextY < 0 || nextY >= height) continue;
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const nextX = x + offsetX;
      if ((offsetX === 0 && offsetY === 0) || nextX < 0 || nextX >= width) continue;
      if (component[nextY * width + nextX]) return true;
    }
  }
  return false;
}

/**
 * Keep only the confidence-mask component connected to the point prompt. Gemini's box is not used
 * as a mask or as evidence of reliability; it only supplied the seed coordinates.
 */
export function extractSeededMask(
  values: ArrayLike<number>,
  width: number,
  height: number,
  point: NormalizedPoint,
): CachedMask | null {
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || Math.max(width, height) > MAX_MASK_EDGE || pixelCount > MAX_MASK_PIXELS || values.length !== pixelCount) return null;

  const seedX = Math.min(width - 1, Math.max(0, Math.round(point.x * (width - 1))));
  const seedY = Math.min(height - 1, Math.max(0, Math.round(point.y * (height - 1))));
  let seed = -1;
  let seedConfidence = 0;
  for (let y = Math.max(0, seedY - 2); y <= Math.min(height - 1, seedY + 2); y += 1) {
    for (let x = Math.max(0, seedX - 2); x <= Math.min(width - 1, seedX + 2); x += 1) {
      const index = y * width + x;
      const confidence = probabilityAt(values, index);
      if (confidence > seedConfidence) {
        seed = index;
        seedConfidence = confidence;
      }
    }
  }
  if (seed < 0 || seedConfidence < MIN_SEED_CONFIDENCE) return null;

  const component = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;
  component[seed] = 1;
  queue[tail++] = seed;
  let confidenceTotal = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const tryAddNeighbor = (neighbor: number) => {
    if (component[neighbor] || probabilityAt(values, neighbor) < COMPONENT_THRESHOLD) return;
    component[neighbor] = 1;
    queue[tail++] = neighbor;
  };
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    confidenceTotal += probabilityAt(values, index);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (x > 0) tryAddNeighbor(index - 1);
    if (x + 1 < width) tryAddNeighbor(index + 1);
    if (y > 0) tryAddNeighbor(index - width);
    if (y + 1 < height) tryAddNeighbor(index + width);
  }

  const componentRatio = tail / pixelCount;
  const meanConfidence = confidenceTotal / tail;
  if (componentRatio < MIN_COMPONENT_RATIO || componentRatio > MAX_COMPONENT_RATIO || meanConfidence < 0.53) return null;

  const paddingX = Math.max(1, Math.round((maxX - minX + 1) * 0.025));
  const paddingY = Math.max(1, Math.round((maxY - minY + 1) * 0.025));
  const left = Math.max(0, minX - paddingX);
  const top = Math.max(0, minY - paddingY);
  const right = Math.min(width, maxX + paddingX + 1);
  const bottom = Math.min(height, maxY + paddingY + 1);
  const region: SubjectRegion = {
    x: left / width,
    y: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height,
  };
  if (region.width * region.height >= MAX_BOUNDS_RATIO) return null;

  const alpha = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const confidence = probabilityAt(values, index);
    if (component[index] || (confidence >= 0.12 && touchesComponent(index, width, height, component))) {
      alpha[index] = Math.round(confidence * 255);
    }
  }

  const mask: SubjectMask = {
    mode: 'alpha',
    source: 'segmentation',
    confidence: 'high',
    region,
    polygon: null,
    alphaMaskDataUrl: null,
    feather: 0,
    note: 'MediaPipe MagicTouch v2 pixel mask, seeded from the planned subject region and sanity-checked. Fine edges or touching objects may still be imperfect.',
  };
  return { width, height, alpha, mask };
}

async function createMediaPipeEngine(): Promise<InteractiveSegmentationEngine> {
  const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  const task = await InteractiveSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MAGIC_TOUCH_MODEL_URL, delegate: 'CPU' },
  });

  return {
    segment(image, point) {
      task.setImage(image);
      const mask = task.segment([createPositiveSeedStroke(point)]);
      return {
        width: mask.width,
        height: mask.height,
        values: mask.getAsFloat32Array(),
        close: () => mask.close(),
      };
    },
    close: () => task.close(),
  };
}

export function createPositiveSeedStroke(point: NormalizedPoint): Stroke {
  return { brushMode: POSITIVE_BRUSH_MODE, point: [point], isCompleted: true };
}

function closeBitmap(bitmap: ImageBitmap | undefined) {
  try {
    bitmap?.close();
  } catch {
    // A browser may already have released a bitmap after a failed canvas operation.
  }
}

export class MediaPipeMaskProvider implements MaskProvider {
  readonly id = 'mediapipe-magic-touch-v2';

  private readonly createEngine: () => Promise<InteractiveSegmentationEngine>;
  private readonly createCanvas: () => HTMLCanvasElement;
  private readonly createBitmap: (canvas: HTMLCanvasElement) => Promise<ImageBitmap>;
  private readonly isSupported: () => boolean;
  private readonly maxEdge: number;
  private readonly maxCacheEntries: number;
  private readonly idleUnloadMs: number;
  private readonly cache = new Map<string, CachedMask>();
  private readonly pending = new Map<string, Promise<CachedMask | null>>();
  private engine: InteractiveSegmentationEngine | null = null;
  private enginePromise: Promise<InteractiveSegmentationEngine | null> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAfter = 0;
  private disposed = false;

  constructor(options: MediaPipeMaskProviderOptions = {}) {
    this.createEngine = options.createEngine ?? createMediaPipeEngine;
    this.createCanvas = options.createCanvas ?? createCanvas;
    this.createBitmap = options.createBitmap ?? createBitmap;
    this.isSupported = options.isSupported ?? canRunLocalSegmentation;
    this.maxEdge = Math.max(64, Math.min(SEGMENTATION_MAX_EDGE, options.maxEdge ?? SEGMENTATION_MAX_EDGE));
    this.maxCacheEntries = Math.max(1, Math.min(8, options.maxCacheEntries ?? DEFAULT_CACHE_ENTRIES));
    this.idleUnloadMs = options.idleUnloadMs ?? DEFAULT_IDLE_UNLOAD_MS;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  async segment(
    asset: MediaAsset,
    subjectId: string,
    signal?: AbortSignal,
    context?: MaskProviderContext,
  ): Promise<SegmentationResult | null> {
    if (this.disposed || signal?.aborted || !this.isSupported() || !context?.image || !context.region) return null;
    const point = pointForRegion(context.region);
    const key = cacheKey(asset, subjectId, context.region, point);
    let entry = this.getCached(key);
    if (!entry) {
      let request = this.pending.get(key);
      if (!request) {
        request = this.runInference(context.image, point, signal)
          .then((result) => {
            if (result && !this.disposed) this.storeCached(key, result);
            return result;
          })
          .catch(() => null);
        this.pending.set(key, request);
      }
      try {
        entry = await request;
      } finally {
        if (this.pending.get(key) === request) this.pending.delete(key);
        this.scheduleIdleUnload();
      }
    }
    if (!entry || signal?.aborted || this.disposed) return null;
    try {
      const alphaBitmap = await this.materialize(entry);
      if (signal?.aborted || this.disposed) {
        closeBitmap(alphaBitmap);
        return null;
      }
      return { mask: entry.mask, alphaBitmap };
    } catch {
      return null;
    }
  }

  clearCache() {
    this.cache.clear();
  }

  dispose() {
    this.disposed = true;
    this.clearCache();
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    try {
      this.engine?.close();
    } catch {
      // Provider disposal is best-effort; rendering has already moved to its fallback path.
    }
    this.engine = null;
    this.enginePromise = null;
    this.pending.clear();
  }

  private getCached(key: string): CachedMask | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private storeCached(key: string, entry: CachedMask) {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async getEngine(): Promise<InteractiveSegmentationEngine | null> {
    if (this.disposed || Date.now() < this.retryAfter) return null;
    if (this.engine) return this.engine;
    if (!this.enginePromise) {
      this.enginePromise = this.createEngine()
        .then((engine) => {
          if (this.disposed) {
            engine.close();
            return null;
          }
          this.engine = engine;
          return engine;
        })
        .catch(() => {
          this.retryAfter = Date.now() + INITIALIZATION_RETRY_MS;
          return null;
        })
        .finally(() => { this.enginePromise = null; });
    }
    return this.enginePromise;
  }

  private async runInference(
    source: CanvasImageSource,
    point: NormalizedPoint,
    signal?: AbortSignal,
  ): Promise<CachedMask | null> {
    if (signal?.aborted) return null;
    const dimensions = dimensionsOf(source);
    if (!dimensions) return null;
    const scale = Math.min(1, this.maxEdge / Math.max(dimensions.width, dimensions.height));
    const inputWidth = Math.max(1, Math.round(dimensions.width * scale));
    const inputHeight = Math.max(1, Math.round(dimensions.height * scale));
    const input = this.createCanvas();
    input.width = inputWidth;
    input.height = inputHeight;
    const context = input.getContext('2d', { willReadFrequently: true });
    if (!context) {
      input.width = 1;
      input.height = 1;
      return null;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, inputWidth, inputHeight);

    let rawMask: RawSegmentationMask | null = null;
    try {
      const engine = await this.getEngine();
      if (!engine || signal?.aborted || this.disposed) return null;
      rawMask = engine.segment(input, point);
      if (!rawMask) return null;
      const extracted = extractSeededMask(rawMask.values, rawMask.width, rawMask.height, point);
      if (!extracted) return null;
      // Retain only low-resolution alpha bytes; never keep a full-resolution decoded image or bitmap.
      return extracted;
    } finally {
      rawMask?.close?.();
      input.width = 1;
      input.height = 1;
    }
  }

  private async materialize(entry: CachedMask): Promise<ImageBitmap> {
    const canvas = this.createCanvas();
    canvas.width = entry.width;
    canvas.height = entry.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a matte canvas.');
    const imageData = context.createImageData(entry.width, entry.height);
    for (let index = 0; index < entry.alpha.length; index += 1) {
      const offset = index * 4;
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = entry.alpha[index];
    }
    context.putImageData(imageData, 0, 0);
    try {
      return await this.createBitmap(canvas);
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  private scheduleIdleUnload() {
    if (this.idleUnloadMs <= 0 || this.disposed) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size > 0) return;
      try {
        this.engine?.close();
      } catch {
        // Releasing the task is opportunistic; cached alpha bytes remain usable.
      }
      this.engine = null;
      this.enginePromise = null;
    }, this.idleUnloadMs);
  }
}

export function createMediaPipeMaskProvider(options: MediaPipeMaskProviderOptions = {}): MediaPipeMaskProvider {
  return new MediaPipeMaskProvider(options);
}

/** The singleton is registered by main.tsx and shared by preview and export. */
export const browserMaskProvider = createMediaPipeMaskProvider();
