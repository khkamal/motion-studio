import { describe, expect, it } from 'vitest';
import { fitPreviewScale, fitPreviewToBounds } from '../utils/previewLayout';

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

  it('returns an empty size until the preview has measurable bounds', () => {
    expect(fitPreviewScale(0, 600, 1920, 1080)).toBe(0);
    expect(fitPreviewToBounds(0, 600, 1920, 1080)).toEqual({ width: 0, height: 0 });
  });
});
