import { describe, expect, it } from 'vitest';
import { fitPreviewScale, fitPreviewToBounds, scalePreviewZoom } from '../utils/previewLayout';

describe('responsive preview sizing', () => {
  it('fits a landscape composition inside a wide but short viewport without cropping', () => {
    const scale = fitPreviewScale(1200, 500, 1920, 1080);
    expect(scale).toBeCloseTo(500 / 1080);
    const size = fitPreviewToBounds(1200, 500, 1920, 1080);
    expect(size).toEqual({ width: 888, height: 500 });
    expect(size.width).toBeLessThanOrEqual(1200);
    expect(size.height).toBeLessThanOrEqual(500);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
  });

  it('preserves portrait and square composition ratios in narrow preview boxes', () => {
    expect(fitPreviewToBounds(320, 700, 1080, 1920)).toEqual({ width: 320, height: 568 });
    expect(fitPreviewToBounds(300, 200, 500, 500)).toEqual({ width: 200, height: 200 });
  });

  it('recalculates a smaller uniform scale when the parent box shrinks', () => {
    const wideScale = fitPreviewScale(1200, 700, 1920, 1080);
    const narrowScale = fitPreviewScale(520, 300, 1920, 1080);
    expect(wideScale).toBeCloseTo(1200 / 1920);
    expect(narrowScale).toBeCloseTo(520 / 1920);
    expect(narrowScale).toBeLessThan(wideScale);
    expect(1920 * narrowScale).toBeLessThanOrEqual(520);
    expect(1080 * narrowScale).toBeLessThanOrEqual(300);
  });

  it('applies bounded in-preview zoom on top of the responsive auto-fit scale', () => {
    expect(scalePreviewZoom(0.5, 1)).toBe(0.5);
    expect(scalePreviewZoom(0.5, 1.5)).toBe(0.75);
    expect(scalePreviewZoom(0.5, 3)).toBe(1);
    expect(scalePreviewZoom(0.5, 0.1)).toBe(0.25);
    expect(scalePreviewZoom(0, 1)).toBe(0);
  });

  it('fits the fixed logical code composition into larger and smaller viewports without changing its ratio', () => {
    expect(fitPreviewScale(1200, 900, 533, 299)).toBeCloseTo(1200 / 533);
    expect(fitPreviewScale(320, 180, 533, 299)).toBeCloseTo(Math.min(320 / 533, 180 / 299));
    expect(fitPreviewScale(320, 180, 533, 299) * 533).toBeCloseTo(320);
    expect(fitPreviewScale(320, 180, 533, 299) * 299).toBeLessThanOrEqual(180);
  });

  it('returns an empty size until the preview has measurable bounds', () => {
    expect(fitPreviewScale(0, 600, 1920, 1080)).toBe(0);
    expect(fitPreviewToBounds(0, 600, 1920, 1080)).toEqual({ width: 0, height: 0 });
  });
});
