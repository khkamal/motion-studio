export interface PreviewSize {
  width: number;
  height: number;
}

/** Fit a fixed-aspect-ratio composition inside the preview's available CSS-pixel box. */
export function fitPreviewToBounds(
  availableWidth: number,
  availableHeight: number,
  compositionWidth: number,
  compositionHeight: number,
): PreviewSize {
  if (![availableWidth, availableHeight, compositionWidth, compositionHeight].every(Number.isFinite)
    || availableWidth <= 0 || availableHeight <= 0 || compositionWidth <= 0 || compositionHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(availableWidth / compositionWidth, availableHeight / compositionHeight);
  return {
    width: Math.max(1, Math.floor(compositionWidth * scale)),
    height: Math.max(1, Math.floor(compositionHeight * scale)),
  };
}
