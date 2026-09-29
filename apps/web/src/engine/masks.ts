import type { MediaAsset, SubjectMask, SubjectRegion } from '../types/motion';

export interface SegmentationResult {
  mask: SubjectMask;
  /** A real pixel-level alpha matte aligned to normalized asset coordinates; ownership transfers to the renderer. */
  alphaBitmap?: ImageBitmap;
}

export interface MaskProviderContext {
  /** The plan's region is a point prompt only. Providers must derive the returned mask from pixels. */
  region: SubjectRegion | null;
  subjectName?: string;
  subjectType?: string;
  /** A renderer-owned, bounded-resolution source canvas supplied to avoid decoding a second full image. */
  image?: CanvasImageSource;
}

/** Browser/local providers plug into the existing shared preview/export renderer. */
export interface MaskProvider {
  readonly id: string;
  segment(asset: MediaAsset, subjectId: string, signal?: AbortSignal, context?: MaskProviderContext): Promise<SegmentationResult | null>;
}

let activeMaskProvider: MaskProvider | null = null;

export function registerMaskProvider(provider: MaskProvider): () => void {
  const previous = activeMaskProvider;
  activeMaskProvider = provider;
  return () => {
    if (activeMaskProvider === provider) activeMaskProvider = previous;
  };
}

export function getMaskProvider(): MaskProvider | null {
  return activeMaskProvider;
}

export function isReliableMask(mask: SubjectMask): boolean {
  return mask.confidence === 'high' && (mask.source === 'segmentation' || mask.source === 'user');
}

export function maskAreaRatio(mask: SubjectMask): number {
  if (!mask.region) return 0;
  if (mask.mode === 'ellipse') return Math.PI * mask.region.width * mask.region.height / 4;
  if (mask.mode === 'polygon' && mask.polygon && mask.polygon.length >= 3) {
    let doubledArea = 0;
    for (let index = 0; index < mask.polygon.length; index += 1) {
      const a = mask.polygon[index];
      const b = mask.polygon[(index + 1) % mask.polygon.length];
      doubledArea += a.x * b.y - b.x * a.y;
    }
    return Math.min(1, Math.abs(doubledArea) / 2);
  }
  return mask.region.width * mask.region.height;
}

export interface MaskCanvases {
  bounds: { x: number; y: number; width: number; height: number };
  maskCanvas: HTMLCanvasElement;
}

export async function createMaskCanvases(mask: SubjectMask, sourceWidth: number, sourceHeight: number, alphaBitmap?: ImageBitmap): Promise<MaskCanvases | null> {
  const region = mask.region;
  if (!region || mask.confidence === 'unavailable') return null;
  const x = Math.max(0, Math.floor(region.x * sourceWidth));
  const y = Math.max(0, Math.floor(region.y * sourceHeight));
  const right = Math.min(sourceWidth, Math.ceil((region.x + region.width) * sourceWidth));
  const bottom = Math.min(sourceHeight, Math.ceil((region.y + region.height) * sourceHeight));
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff';

  if (mask.mode === 'alpha' && alphaBitmap) {
    context.drawImage(alphaBitmap, region.x * alphaBitmap.width, region.y * alphaBitmap.height, region.width * alphaBitmap.width, region.height * alphaBitmap.height, 0, 0, width, height);
  } else if (mask.mode === 'alpha' && mask.alphaMaskDataUrl) {
    const alpha = await loadMaskImage(mask.alphaMaskDataUrl);
    context.drawImage(alpha, region.x * alpha.naturalWidth, region.y * alpha.naturalHeight, region.width * alpha.naturalWidth, region.height * alpha.naturalHeight, 0, 0, width, height);
  } else if (mask.mode === 'polygon' && mask.polygon && mask.polygon.length >= 3) {
    context.beginPath();
    mask.polygon.forEach((point, index) => {
      const px = (point.x - region.x) / Math.max(0.0001, region.width) * width;
      const py = (point.y - region.y) / Math.max(0.0001, region.height) * height;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.closePath();
    context.fill();
  } else if (mask.mode === 'ellipse') {
    context.beginPath();
    context.ellipse(width / 2, height / 2, width * 0.49, height * 0.49, 0, 0, Math.PI * 2);
    context.fill();
  } else {
    context.fillRect(0, 0, width, height);
  }

  if (mask.feather > 0 && mask.mode !== 'alpha') {
    const feather = Math.max(0.5, Math.min(width, height) * mask.feather);
    const feathered = document.createElement('canvas');
    feathered.width = width;
    feathered.height = height;
    const featherContext = feathered.getContext('2d');
    if (featherContext) {
      featherContext.filter = `blur(${feather}px)`;
      featherContext.drawImage(canvas, 0, 0);
      context.clearRect(0, 0, width, height);
      context.filter = 'none';
      context.drawImage(feathered, 0, 0);
    }
  }
  return { bounds: { x, y, width, height }, maskCanvas: canvas };
}

function loadMaskImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the supplied alpha mask.'));
    image.src = source;
  });
}

/**
 * Builds a conservative, low-resolution edge-color diffusion patch behind a trusted cut-out. This is
 * not generative inpainting and the renderer applies it only after cut-out preparation succeeds.
 */
export function createDiffusedRepair(source: HTMLCanvasElement, bounds: MaskCanvases['bounds'], maskCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(bounds.width, bounds.height));
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const patch = document.createElement('canvas');
  let maskCanvasSmall: HTMLCanvasElement | null = null;
  let output: HTMLCanvasElement | null = null;
  let keepOutput = false;
  try {
    patch.width = width;
    patch.height = height;
    const context = patch.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, width, height);

    maskCanvasSmall = document.createElement('canvas');
    maskCanvasSmall.width = width;
    maskCanvasSmall.height = height;
    const maskContext = maskCanvasSmall.getContext('2d', { willReadFrequently: true });
    if (!maskContext) return null;
    maskContext.drawImage(maskCanvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const mask = maskContext.getImageData(0, 0, width, height).data;
    const data = pixels.data;
    const count = width * height;
    const visited = new Uint8Array(count);
    const queue = new Uint32Array(count);
    let head = 0;
    let tail = 0;
    const threshold = 80;

    // Seed every non-mask pixel. A breadth-first flood copies only colors from the nearest visible boundary.
    for (let index = 0; index < count; index += 1) {
      if (mask[index * 4 + 3] < threshold) {
        visited[index] = 1;
        queue[tail++] = index;
      }
    }
    if (tail === 0) return null;
    const visitNeighbor = (neighbor: number, sourceIndex: number) => {
      if (visited[neighbor] || mask[neighbor * 4 + 3] < threshold) return;
      visited[neighbor] = 1;
      const src = sourceIndex * 4;
      const dst = neighbor * 4;
      data[dst] = data[src];
      data[dst + 1] = data[src + 1];
      data[dst + 2] = data[src + 2];
      data[dst + 3] = data[src + 3];
      queue[tail++] = neighbor;
    };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) visitNeighbor(index - 1, index);
      if (x + 1 < width) visitNeighbor(index + 1, index);
      if (y > 0) visitNeighbor(index - width, index);
      if (y + 1 < height) visitNeighbor(index + width, index);
    }
    context.putImageData(pixels, 0, 0);

    // Only retain repaired pixels where the mask is present; antialiasing feathers the patch edge.
    output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d');
    if (!outputContext) return null;
    outputContext.drawImage(patch, 0, 0);
    outputContext.globalCompositeOperation = 'destination-in';
    outputContext.drawImage(maskCanvasSmall, 0, 0);
    keepOutput = true;
    return output;
  } finally {
    patch.width = 1;
    patch.height = 1;
    if (maskCanvasSmall) {
      maskCanvasSmall.width = 1;
      maskCanvasSmall.height = 1;
    }
    if (output && !keepOutput) {
      output.width = 1;
      output.height = 1;
    }
  }
}

export function createSubjectCutout(source: HTMLCanvasElement, maskInfo: MaskCanvases): HTMLCanvasElement | null {
  const cutout = document.createElement('canvas');
  cutout.width = maskInfo.bounds.width;
  cutout.height = maskInfo.bounds.height;
  const context = cutout.getContext('2d');
  if (!context) return null;
  context.drawImage(
    source,
    maskInfo.bounds.x, maskInfo.bounds.y, maskInfo.bounds.width, maskInfo.bounds.height,
    0, 0, maskInfo.bounds.width, maskInfo.bounds.height,
  );
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskInfo.maskCanvas, 0, 0);
  context.globalCompositeOperation = 'source-over';
  return cutout;
}
