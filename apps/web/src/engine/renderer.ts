import { SubjectMaskSchema, type EditorSettings, type MediaAsset, type MotionPlan, type SubjectMask } from '../types/motion';
import { evaluateScene } from './motionEngine';
import { createDiffusedRepair, createMaskCanvases, createSubjectCutout, getMaskProvider, isReliableMask, maskAreaRatio, type MaskCanvases, type MaskProvider, type MaskProviderContext, type SegmentationResult } from './masks';

const MAX_SOURCE_EDGE = 2048;

interface PreparedSubject {
  layerId: string;
  mask: SubjectMask;
  maskInfo: MaskCanvases;
  cutout: HTMLCanvasElement | null;
  repair: HTMLCanvasElement | null;
  canMoveIndependently: boolean;
}

export type SubjectIsolationStatus = 'segmented' | 'trusted-mask' | 'estimated-fallback' | 'repair-unavailable' | 'unavailable';

export interface RenderRuntime {
  source: HTMLCanvasElement;
  backgroundPlate: HTMLCanvasElement;
  subjects: Map<string, PreparedSubject>;
  sourceWidth: number;
  sourceHeight: number;
  primarySubjectId: string | null;
  subjectIsolationStatus: SubjectIsolationStatus;
  disposed: boolean;
}

export interface RenderScene {
  canvas: HTMLCanvasElement;
  plan: MotionPlan;
  settings: EditorSettings;
  runtime: RenderRuntime;
  showTransparencyGrid?: boolean;
}

function colorToRgb(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  const normalized = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [0, 255, 0];
  return [parseInt(normalized.slice(0, 2), 16), parseInt(normalized.slice(2, 4), 16), parseInt(normalized.slice(4, 6), 16)];
}

function chromaKeySource(source: HTMLCanvasElement, settings: EditorSettings) {
  if (!settings.greenScreen.enabled) return;
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, source.width, source.height);
  const target = settings.greenScreen.color === 'green'
    ? [0, 255, 0]
    : settings.greenScreen.color === 'blue'
      ? [0, 0, 255]
      : colorToRgb(settings.greenScreen.customColor);
  const tolerance = settings.greenScreen.tolerance * 255 * Math.sqrt(3);
  const softness = Math.max(1, settings.greenScreen.softness * 255 * Math.sqrt(3));
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const dr = data[index] - target[0];
    const dg = data[index + 1] - target[1];
    const db = data[index + 2] - target[2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    const blend = Math.min(1, Math.max(0, (distance - tolerance) / softness));
    const alpha = blend * blend * (3 - 2 * blend);
    data[index + 3] = Math.round(data[index + 3] * alpha);
  }
  context.putImageData(image, 0, 0);
}

function hasUsableTrustedMask(mask: SubjectMask | null | undefined): boolean {
  if (!mask || !isReliableMask(mask)) return false;
  if (mask.mode === 'alpha') return Boolean(mask.alphaMaskDataUrl);
  // A user-authored geometric mask is explicit input; estimated/model-provided geometry is never trusted.
  return mask.source === 'user';
}

function isTrustedProviderResult(result: SegmentationResult): result is SegmentationResult & { alphaBitmap: ImageBitmap } {
  const validation = SubjectMaskSchema.safeParse(result.mask);
  if (!validation.success || !result.alphaBitmap) return false;
  const mask = validation.data;
  return mask.source === 'segmentation'
    && mask.confidence === 'high'
    && mask.mode === 'alpha'
    && Boolean(mask.region)
    && result.alphaBitmap.width > 0
    && result.alphaBitmap.height > 0
    && maskAreaRatio(mask) > 0
    && maskAreaRatio(mask) < 0.48;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Render preparation cancelled.', 'AbortError');
}

function closeSegmentation(result: SegmentationResult | null) {
  try {
    result?.alphaBitmap?.close();
  } catch {
    // Providers may already have released a bitmap after a failed decode.
  }
}

function releasePreparedSubject(subject: PreparedSubject) {
  if (subject.cutout) {
    subject.cutout.width = 1;
    subject.cutout.height = 1;
  }
  if (subject.repair) {
    subject.repair.width = 1;
    subject.repair.height = 1;
  }
  subject.maskInfo.maskCanvas.width = 1;
  subject.maskInfo.maskCanvas.height = 1;
}

export async function createRenderRuntime(
  asset: MediaAsset,
  plan: MotionPlan,
  settings: EditorSettings,
  maskProvider: MaskProvider | null = getMaskProvider(),
  signal?: AbortSignal,
): Promise<RenderRuntime> {
  let bitmap: ImageBitmap | null = null;
  let source: HTMLCanvasElement | null = null;
  let backgroundPlate: HTMLCanvasElement | null = null;
  let segmentation: SegmentationResult | null = null;
  const subjects = new Map<string, PreparedSubject>();
  try {
    throwIfAborted(signal);
    bitmap = await createImageBitmap(asset.blob);
    throwIfAborted(signal);
    const scale = Math.min(1, MAX_SOURCE_EDGE / Math.max(bitmap.width, bitmap.height));
    source = document.createElement('canvas');
    source.width = Math.max(1, Math.round(bitmap.width * scale));
    source.height = Math.max(1, Math.round(bitmap.height * scale));
    const sourceContext = source.getContext('2d', { willReadFrequently: settings.greenScreen.enabled });
    if (!sourceContext) throw new Error('This browser could not create a 2D rendering context.');
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.drawImage(bitmap, 0, 0, source.width, source.height);
    bitmap.close();
    bitmap = null;

    const subjectLayers = plan.layers.filter((entry) => entry.kind === 'subject');
    const primaryLayer = [...subjectLayers].sort((a, b) => b.importance - a.importance)[0] ?? null;
    const primarySubject = primaryLayer ? plan.subjects.find((entry) => entry.id === primaryLayer.id) : undefined;
    const primaryLayerMask = primaryLayer?.mask ?? primarySubject?.mask ?? null;
    const primaryRegion = primaryLayer
      ? plan.subjectAnalysis.movingRegions.find((entry) => entry.subjectId === primaryLayer.id)?.region
        ?? primarySubject?.region
        ?? primaryLayerMask?.region
        ?? null
      : null;

    // Segment only the primary subject automatically. Secondary subjects continue to use explicit/user masks
    // or the existing conservative fallback; the provider API remains subject-ID based for future selection.
    if (maskProvider && primaryLayer && !hasUsableTrustedMask(primaryLayerMask) && primaryRegion) {
      const context: MaskProviderContext = {
        region: primaryRegion,
        subjectName: primarySubject?.name ?? primaryLayer.name,
        subjectType: primarySubject?.type,
        image: source,
      };
      try {
        const result = await maskProvider.segment(asset, primaryLayer.id, signal, context);
        if (signal?.aborted) {
          closeSegmentation(result);
          throwIfAborted(signal);
        }
        if (result && isTrustedProviderResult(result)) segmentation = { ...result, mask: SubjectMaskSchema.parse(result.mask) };
        else closeSegmentation(result);
      } catch (error) {
        if (signal?.aborted) throw error;
        // A failed optional provider leaves the safe approximate renderer usable.
      }
    }

    throwIfAborted(signal);
    // Segment before chroma-keying so the model sees the original RGB image and no second full decode is needed.
    chromaKeySource(source, settings);
    backgroundPlate = document.createElement('canvas');
    backgroundPlate.width = source.width;
    backgroundPlate.height = source.height;
    const backgroundContext = backgroundPlate.getContext('2d');
    if (!backgroundContext) throw new Error('Could not prepare the background plate.');
    // Keep the source plate stable. Only a successfully repaired trusted cut-out may patch it.
    backgroundContext.drawImage(source, 0, 0);

    for (const layer of subjectLayers) {
      throwIfAborted(signal);
      const subject = plan.subjects.find((entry) => entry.id === layer.id);
      const declaredRegion = plan.subjectAnalysis.movingRegions.find((entry) => entry.subjectId === layer.id)?.region ?? subject?.region ?? null;
      const layerMask = layer.mask ?? subject?.mask ?? null;
      const providerResult = layer.id === primaryLayer?.id ? segmentation : null;
      let mask = providerResult?.mask ?? layerMask;
      if (providerResult && mask) {
        // The mask bounds come from model pixels, never from the prompt box.
        mask = { ...mask, mode: 'alpha', alphaMaskDataUrl: null };
      } else if (mask?.source === 'segmentation' && mask.confidence === 'high' && !hasUsableTrustedMask(mask)) {
        mask = {
          ...mask,
          mode: mask.region ? 'ellipse' : 'rect',
          source: 'model-estimate',
          confidence: mask.region ? 'approximate' : 'unavailable',
          alphaMaskDataUrl: null,
          note: 'A segmentation label without a pixel matte is not trusted. The original source stays intact.',
        };
      }
      if (!mask?.region && declaredRegion) {
        mask = {
          mode: 'ellipse', source: 'model-estimate', confidence: 'approximate', region: declaredRegion,
          polygon: null, alphaMaskDataUrl: null, feather: 0.025,
          note: 'Estimated motion region only. This is not pixel segmentation; local material motion is kept inside the region.',
        };
      }
      if (!mask?.region || mask.confidence === 'unavailable') {
        if (providerResult) {
          closeSegmentation(segmentation);
          segmentation = null;
        }
        continue;
      }

      let maskInfo: MaskCanvases | null = null;
      try {
        maskInfo = await createMaskCanvases(mask, source.width, source.height, providerResult?.alphaBitmap);
      } catch {
        // Invalid or unsupported masks do not prevent the pristine source scene from rendering.
      } finally {
        if (providerResult) {
          closeSegmentation(segmentation);
          segmentation = null;
        }
      }
      throwIfAborted(signal);
      if (!maskInfo) continue;

      const trusted = isReliableMask(mask);
      const mayMove = trusted && maskAreaRatio(mask) < 0.48;
      let repair: HTMLCanvasElement | null = null;
      let cutout: HTMLCanvasElement | null = null;
      if (mayMove) {
        try {
          repair = createDiffusedRepair(source, maskInfo.bounds, maskInfo.maskCanvas);
          cutout = repair ? createSubjectCutout(source, maskInfo) : null;
        } catch {
          repair = null;
          cutout = null;
        }
      }
      const canMoveIndependently = Boolean(repair && cutout);
      if (canMoveIndependently && repair) {
        backgroundContext.drawImage(repair, maskInfo.bounds.x, maskInfo.bounds.y, maskInfo.bounds.width, maskInfo.bounds.height);
      } else if (repair) {
        repair.width = 1;
        repair.height = 1;
      }
      subjects.set(layer.id, { layerId: layer.id, mask, maskInfo, cutout, repair: canMoveIndependently ? repair : null, canMoveIndependently });
    }

    throwIfAborted(signal);
    const primaryPrepared = primaryLayer ? subjects.get(primaryLayer.id) : undefined;
    const subjectIsolationStatus: SubjectIsolationStatus = primaryPrepared?.canMoveIndependently
      ? primaryPrepared.mask.source === 'segmentation' ? 'segmented' : 'trusted-mask'
      : primaryPrepared?.mask.region
        ? isReliableMask(primaryPrepared.mask) ? 'repair-unavailable' : 'estimated-fallback'
        : 'unavailable';
    return {
      source,
      backgroundPlate,
      subjects,
      sourceWidth: source.width,
      sourceHeight: source.height,
      primarySubjectId: primaryLayer?.id ?? null,
      subjectIsolationStatus,
      disposed: false,
    };
  } catch (error) {
    closeSegmentation(segmentation);
    bitmap?.close();
    if (source) {
      source.width = 1;
      source.height = 1;
    }
    if (backgroundPlate) {
      backgroundPlate.width = 1;
      backgroundPlate.height = 1;
    }
    for (const subject of subjects.values()) releasePreparedSubject(subject);
    subjects.clear();
    throw error;
  }
}

export function disposeRenderRuntime(runtime: RenderRuntime) {
  runtime.disposed = true;
  runtime.source.width = 1;
  runtime.source.height = 1;
  runtime.backgroundPlate.width = 1;
  runtime.backgroundPlate.height = 1;
  for (const subject of runtime.subjects.values()) releasePreparedSubject(subject);
  runtime.subjects.clear();
}

function drawRectForFit(settings: EditorSettings, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const fitScale = settings.fit === 'fit'
    ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : settings.fit === 'center'
      ? Math.min(1, targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * fitScale;
  const height = sourceHeight * fitScale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

function drawCheckerboard(context: CanvasRenderingContext2D, width: number, height: number) {
  const size = 16;
  context.fillStyle = '#15171c';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#20232a';
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) context.fillRect(x, y, size, size);
    }
  }
}

function drawParticles(context: CanvasRenderingContext2D, width: number, height: number, time: number, settings: EditorSettings, plan: MotionPlan) {
  if (!settings.particlesEnabled || !plan.effects.particlesEnabled || settings.priorities.particleStrength <= 0) return;
  const particleLayer = plan.layers.find((layer) => layer.kind === 'particles');
  if (particleLayer && !particleLayer.visible) return;
  const count = Math.round(8 + 84 * settings.priorities.particleStrength * Math.max(0.3, plan.effects.particleStrength));
  const phase = time * settings.speed;
  const ctx = context;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let index = 0; index < count; index += 1) {
    // Integer hash, stable across frames and renders (no per-frame random allocation).
    const hash = (index * 2654435761) >>> 0;
    const x0 = ((hash & 0xffff) / 0xffff) * width;
    const y0 = (((hash >>> 8) & 0xffff) / 0xffff) * height;
    const drift = 8 + ((hash >>> 16) & 0xff) / 255 * 24;
    const x = (x0 + Math.sin(phase * 0.14 + index) * drift + width) % width;
    const y = (y0 - phase * (2 + (index % 5)) + height * 4) % height;
    const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase * 1.4 + index));
    const radius = 0.7 + ((hash >>> 20) & 0xf) / 16 * 1.8;
    ctx.globalAlpha = twinkle * settings.priorities.particleStrength * 0.65;
    ctx.fillStyle = settings.particleType === 'technology' ? '#72d6ff' : settings.particleType === 'energy' ? '#9e8bff' : settings.particleType === 'stars' ? '#e9efff' : '#fff3d4';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLightSweep(context: CanvasRenderingContext2D, width: number, height: number, progress: number, settings: EditorSettings, plan: MotionPlan) {
  if (!settings.effectsEnabled || settings.priorities.effectsStrength <= 0) return;
  const lightingLayer = plan.layers.find((layer) => layer.kind === 'lighting');
  const effectsLayer = plan.layers.find((layer) => layer.kind === 'effect');
  if ((lightingLayer && !lightingLayer.visible) || (effectsLayer && !effectsLayer.visible)) return;
  const lightState = plan.layers.find((layer) => layer.kind === 'lighting');
  const value = lightState?.keyframes.length ? Math.sin(progress * Math.PI * 2) : Math.cos(progress * Math.PI * 2);
  const centerX = width * (0.5 + value * 0.32);
  const gradient = context.createLinearGradient(centerX - width * 0.28, 0, centerX + width * 0.28, height);
  gradient.addColorStop(0, 'rgba(95, 173, 255, 0)');
  gradient.addColorStop(0.5, `rgba(125, 187, 255, ${0.025 + settings.priorities.effectsStrength * 0.055})`);
  gradient.addColorStop(1, 'rgba(95, 173, 255, 0)');
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function clipToEstimatedMask(
  context: CanvasRenderingContext2D,
  mask: SubjectMask,
  x: number,
  y: number,
  width: number,
  height: number,
  drawRect: ReturnType<typeof drawRectForFit>,
) {
  const region = mask.region;
  if (!region) return;
  context.beginPath();
  if (mask.mode === 'ellipse') {
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if (mask.mode === 'polygon' && mask.polygon && mask.polygon.length >= 3) {
    mask.polygon.forEach((point, index) => {
      const pointX = drawRect.x + point.x * drawRect.width;
      const pointY = drawRect.y + point.y * drawRect.height;
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    });
    context.closePath();
  } else {
    context.rect(x, y, width, height);
  }
  context.clip();
}

function drawApproximateSubjectMotion(
  context: CanvasRenderingContext2D,
  prepared: PreparedSubject,
  state: ReturnType<typeof evaluateScene>['layers'] extends Map<string, infer T> ? T : never,
  drawRect: ReturnType<typeof drawRectForFit>,
  runtime: RenderRuntime,
  progress: number,
) {
  const bounds = prepared.maskInfo.bounds;
  const x = drawRect.x + (bounds.x / runtime.sourceWidth) * drawRect.width;
  const y = drawRect.y + (bounds.y / runtime.sourceHeight) * drawRect.height;
  const width = (bounds.width / runtime.sourceWidth) * drawRect.width;
  const height = (bounds.height / runtime.sourceHeight) * drawRect.height;
  if (maskAreaRatio(prepared.mask) > 0.58 || width < 2 || height < 2) return;

  // Estimated regions are never cut out or moved. Animate a restrained material highlight clipped to
  // the declared subject region; the pristine source/background stays beneath it and outside the region.
  const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
  const energy = Math.min(1, Math.abs(state.x) * 2 + Math.abs(state.y) * 2 + Math.abs(state.rotation) / 12
    + Math.abs(state.scale - 1) + state.wave * 0.8 + state.glow + Math.abs(state.light) * 0.5 + pulse * 0.2);
  if (energy < 0.025) return;
  const travel = ((progress * 0.82 + state.x * 2 + state.y + state.rotation / 90) % 1 + 1) % 1;
  const centerX = x + width * travel;
  const centerY = y + height * (0.5 + Math.sin(progress * Math.PI * 2 + state.y * 8) * 0.08);
  const angle = state.rotation * Math.PI / 180;
  const reachX = Math.max(8, width * 0.34);
  const reachY = Math.max(4, height * 0.12);

  context.save();
  clipToEstimatedMask(context, prepared.mask, x, y, width, height, drawRect);
  context.globalCompositeOperation = 'screen';
  context.globalAlpha = Math.min(0.17, 0.025 + energy * 0.24) * state.opacity;
  const highlight = context.createLinearGradient(
    centerX - Math.cos(angle) * reachX, centerY - Math.sin(angle) * reachY,
    centerX + Math.cos(angle) * reachX, centerY + Math.sin(angle) * reachY,
  );
  highlight.addColorStop(0, 'rgba(126, 190, 255, 0)');
  highlight.addColorStop(0.5, 'rgba(178, 222, 255, 0.75)');
  highlight.addColorStop(1, 'rgba(126, 190, 255, 0)');
  context.fillStyle = highlight;
  context.fillRect(x, y, width, height);
  context.restore();
}

function drawSubject(
  context: CanvasRenderingContext2D,
  prepared: PreparedSubject,
  state: ReturnType<typeof evaluateScene>['layers'] extends Map<string, infer T> ? T : never,
  drawRect: ReturnType<typeof drawRectForFit>,
  runtime: RenderRuntime,
  targetWidth: number,
  targetHeight: number,
  progress: number,
) {
  const bounds = prepared.maskInfo.bounds;
  const x = drawRect.x + (bounds.x / runtime.sourceWidth) * drawRect.width;
  const y = drawRect.y + (bounds.y / runtime.sourceHeight) * drawRect.height;
  const width = (bounds.width / runtime.sourceWidth) * drawRect.width;
  const height = (bounds.height / runtime.sourceHeight) * drawRect.height;
  if (!prepared.canMoveIndependently || !prepared.cutout) {
    drawApproximateSubjectMotion(context, prepared, state, drawRect, runtime, progress);
    return;
  }
  const localX = state.x * targetWidth;
  const localY = state.y * targetHeight;
  const rotation = state.rotation * Math.PI / 180;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  context.save();
  context.translate(centerX + localX, centerY + localY);
  context.rotate(rotation);
  context.scale(state.scale, state.scale);
  context.globalAlpha = state.opacity;
  context.imageSmoothingQuality = 'high';
  if (state.wave > 0.015) {
    const slices = 12;
    const sourceSlice = prepared.cutout.height / slices;
    const destinationSlice = height / slices;
    const amplitude = Math.min(width, height) * 0.018 * state.wave;
    for (let index = 0; index < slices; index += 1) {
      const sourceY = index * sourceSlice;
      const destinationY = -height / 2 + index * destinationSlice;
      const offset = Math.sin(progress * Math.PI * 2 + index / slices * Math.PI * 2) * amplitude;
      context.drawImage(prepared.cutout, 0, sourceY, prepared.cutout.width, sourceSlice + 1, -width / 2 + offset, destinationY, width, destinationSlice + 1);
    }
  } else {
    context.drawImage(prepared.cutout, -width / 2, -height / 2, width, height);
  }

  if (state.glow > 0.02) {
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = Math.min(0.3, state.glow * 0.22);
    context.filter = `blur(${Math.max(2, Math.min(width, height) * 0.03)}px)`;
    context.drawImage(prepared.cutout, -width / 2, -height / 2, width, height);
    context.filter = 'none';
  }
  context.restore();
}

/** Render the complete scene at one absolute time in seconds. No React state updates occur in this loop. */
export function renderScene(scene: RenderScene, currentTime: number): void {
  const { canvas, plan, settings, runtime } = scene;
  if (runtime.disposed) return;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const evaluated = evaluateScene(plan, settings, currentTime);
  const backgroundLayer = plan.layers.find((layer) => layer.kind === 'background');
  const cameraLayer = plan.layers.find((layer) => layer.kind === 'camera');
  const useCamera = settings.cameraEnabled && (!cameraLayer || cameraLayer.visible);
  const camera = useCamera ? evaluated.camera : { x: 0, y: 0, zoom: 1, rotation: 0 };
  const drawRect = drawRectForFit(settings, runtime.sourceWidth, runtime.sourceHeight, width, height);

  context.clearRect(0, 0, width, height);
  if (settings.greenScreen.enabled) {
    if (scene.showTransparencyGrid !== false) drawCheckerboard(context, width, height);
  } else {
    context.fillStyle = '#111318';
    context.fillRect(0, 0, width, height);
  }

  const anyHiddenSubjects = plan.layers.some((layer) => layer.kind === 'subject' && !layer.visible);
  const backgroundSource = runtime.backgroundPlate;
  if (!backgroundLayer || backgroundLayer.visible) {
    context.save();
    context.translate(width / 2 + camera.x, height / 2 + camera.y);
    context.rotate(camera.rotation * Math.PI / 180);
    context.scale(camera.zoom, camera.zoom);
    context.translate(-width / 2, -height / 2);
    context.imageSmoothingQuality = 'high';
    if (settings.style === 'Line Art') context.filter = 'grayscale(0.55) contrast(1.16)';
    else if (settings.style === '3D') context.filter = 'contrast(1.04) saturate(1.08)';
    // Background-layer transforms are intentionally ignored; the original plate is the stable base.
    context.drawImage(backgroundSource, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
    context.filter = 'none';

    for (const layer of plan.layers.filter((entry) => entry.kind === 'subject' && entry.visible)) {
      const prepared = runtime.subjects.get(layer.id);
      const state = evaluated.layers.get(layer.id);
      if (!prepared || !state) continue;
      drawSubject(context, prepared, state, drawRect, runtime, width, height, evaluated.progress);
    }

    // Restore any hidden subject patch so visibility means visible/invisible instead of a hole in the plate.
    if (anyHiddenSubjects) {
      for (const layer of plan.layers.filter((entry) => entry.kind === 'subject' && !entry.visible)) {
        const prepared = runtime.subjects.get(layer.id);
        if (!prepared?.cutout || !prepared.canMoveIndependently) continue;
        const bounds = prepared.maskInfo.bounds;
        const x = drawRect.x + (bounds.x / runtime.sourceWidth) * drawRect.width;
        const y = drawRect.y + (bounds.y / runtime.sourceHeight) * drawRect.height;
        const w = (bounds.width / runtime.sourceWidth) * drawRect.width;
        const h = (bounds.height / runtime.sourceHeight) * drawRect.height;
        context.globalCompositeOperation = 'source-over';
        context.drawImage(prepared.cutout, x, y, w, h);
      }
    }
    context.restore();
  }

  drawLightSweep(context, width, height, evaluated.progress, settings, plan);
  drawParticles(context, width, height, currentTime, settings, plan);

  if (settings.style === '3D') {
    const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.18, width / 2, height / 2, Math.max(width, height) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.16)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
  }
}
