export interface PreviewSize {
  width: number;
  height: number;
}

/** Uniformly scale a fixed composition to fit the available CSS-pixel box. */
export function fitPreviewScale(
  availableWidth: number,
  availableHeight: number,
  compositionWidth: number,
  compositionHeight: number,
): number {
  if (![availableWidth, availableHeight, compositionWidth, compositionHeight].every(Number.isFinite)
    || availableWidth <= 0 || availableHeight <= 0 || compositionWidth <= 0 || compositionHeight <= 0) {
    return 0;
  }
  return Math.min(availableWidth / compositionWidth, availableHeight / compositionHeight);
}

/** Apply a bounded user zoom to the auto-fit scale without changing composition/export dimensions. */
export function scalePreviewZoom(fitScale: number, zoomFactor: number): number {
  if (!Number.isFinite(fitScale) || !Number.isFinite(zoomFactor) || fitScale <= 0) return 0;
  return fitScale * Math.min(2, Math.max(0.5, zoomFactor));
}

/** Return rounded display dimensions for the same fixed-aspect-ratio fit. */
export function fitPreviewToBounds(
  availableWidth: number,
  availableHeight: number,
  compositionWidth: number,
  compositionHeight: number,
): PreviewSize {
  const scale = fitPreviewScale(availableWidth, availableHeight, compositionWidth, compositionHeight);
  if (scale <= 0) return { width: 0, height: 0 };
  return {
    width: Math.max(1, Math.floor(compositionWidth * scale)),
    height: Math.max(1, Math.floor(compositionHeight * scale)),
  };
}
