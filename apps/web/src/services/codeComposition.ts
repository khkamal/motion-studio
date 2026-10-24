export const CODE_COMPOSITION = Object.freeze({ width: 533, height: 299 });

export interface CompositionFit {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Uniform contain mapping from the immutable code-scene coordinates to a render target. */
export function fitCompositionToTarget(
  targetWidth: number,
  targetHeight: number,
  logicalWidth = CODE_COMPOSITION.width,
  logicalHeight = CODE_COMPOSITION.height,
): CompositionFit {
  if (![targetWidth, targetHeight, logicalWidth, logicalHeight].every(Number.isFinite)
    || targetWidth <= 0 || targetHeight <= 0 || logicalWidth <= 0 || logicalHeight <= 0) {
    return { scale: 0, x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.min(targetWidth / logicalWidth, targetHeight / logicalHeight);
  const width = Math.min(targetWidth, logicalWidth * scale);
  const height = Math.min(targetHeight, logicalHeight * scale);
  return { scale, width, height, x: Math.max(0, (targetWidth - width) / 2), y: Math.max(0, (targetHeight - height) / 2) };
}

/** Backing-store dimensions for a logical Canvas surface at device pixel ratio. */
export function compositionBackingSize(devicePixelRatio: number): { width: number; height: number } {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: Math.max(1, Math.round(CODE_COMPOSITION.width * ratio)),
    height: Math.max(1, Math.round(CODE_COMPOSITION.height * ratio)),
  };
}
