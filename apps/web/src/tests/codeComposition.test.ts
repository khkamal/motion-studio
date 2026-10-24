import { describe, expect, it } from 'vitest';
import { CODE_COMPOSITION, compositionBackingSize, fitCompositionToTarget } from '../services/codeComposition';

describe('fixed code composition coordinate system', () => {
  it('uses an immutable 533 by 299 logical scene', () => {
    expect(CODE_COMPOSITION).toEqual({ width: 533, height: 299 });
    expect(fitCompositionToTarget(533, 299)).toEqual({ scale: 1, x: 0, y: 0, width: 533, height: 299 });
  });

  it.each([{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }])(
    'uses a uniform contain transform for $width by $height output without changing framing',
    ({ width, height }) => {
      const fit = fitCompositionToTarget(width, height);
      expect(fit.scale).toBeCloseTo(Math.min(width / 533, height / 299));
      expect(fit.x).toBeGreaterThanOrEqual(0);
      expect(fit.y).toBeGreaterThanOrEqual(0);
      expect(fit.width / fit.height).toBeCloseTo(533 / 299);
      expect(fit.width).toBeLessThanOrEqual(width);
      expect(fit.height).toBeLessThanOrEqual(height);
    },
  );

  it('contains non-16:9 output instead of distorting the scene', () => {
    const fit = fitCompositionToTarget(1000, 1000);
    expect(fit.scale).toBeCloseTo(1000 / 533);
    expect(fit.width).toBeCloseTo(1000);
    expect(fit.height).toBeLessThan(1000);
    expect(fit.y).toBeGreaterThan(0);
  });

  it('allocates sharp preview backing pixels at device-pixel ratios without changing logical dimensions', () => {
    expect(compositionBackingSize(1)).toEqual({ width: 533, height: 299 });
    expect(compositionBackingSize(2)).toEqual({ width: 1066, height: 598 });
    expect(compositionBackingSize(0)).toEqual({ width: 533, height: 299 });
  });
});
