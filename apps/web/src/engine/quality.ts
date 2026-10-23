import { renderRecreate, type RecreateScene } from './recreate';
import type { PartsData } from './parts';

/** Mean absolute difference between two RGBA frames, 0..1. */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / ((n / 4) * 3 * 255);
}

/**
 * How much the picture actually changes over the clip (0 = frozen). Renders a handful of small frames with the
 * real renderer, so it measures what the person will see rather than what the scene description promises.
 */
export function motionEnergy(scene: RecreateScene, parts: PartsData | null = null): number {
  if (typeof document === 'undefined') return 1;
  const W = 192; const H = 108;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 1;
  const times: number[] = [];
  for (let t = 1.6; t < scene.duration - 0.4; t += 0.45) times.push(t);
  let previous: Uint8ClampedArray | null = null; let total = 0; let pairs = 0;
  for (const t of times) {
    renderRecreate({ ctx, width: W, height: H, scene, time: t, editorDuration: scene.duration, source: null, sourceWidth: 1, sourceHeight: 1, parts });
    const data = ctx.getImageData(0, 0, W, H).data;
    if (previous) { total += frameDifference(previous, data); pairs++; }
    previous = data;
  }
  return pairs ? total / pairs : 0;
}
