import { describe, expect, it } from 'vitest';
import { ensureStandaloneSvg } from '../services/codeFrameRenderer';

describe('code animation SVG rasterization input', () => {
  it('adds the SVG namespace before turning iframe markup into an image blob', () => {
    expect(ensureStandaloneSvg('<svg viewBox="0 0 800 450"><path d="M0 0L1 1"/></svg>'))
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><path d="M0 0L1 1"/></svg>');
  });

  it('preserves existing namespaces and rejects non-SVG frames clearly', () => {
    const namespaced = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>';
    expect(ensureStandaloneSvg(namespaced)).toBe(namespaced);
    expect(() => ensureStandaloneSvg('<canvas></canvas>')).toThrow('not an SVG document');
  });
});
