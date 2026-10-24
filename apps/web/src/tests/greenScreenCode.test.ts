import { describe, expect, it } from 'vitest';
import { applyGreenScreenBackground } from '../services/greenScreenCode';

describe('generated-code green-screen background', () => {
  it('injects a visible green background into api.svg and restores the original source when disabled', () => {
    const source = `export default function createAnimation(api) { const root = api.svg(Math.min(1920, width), height, { background: palette.bg, transparent: true }); return { duration: 8, render() { return root.render(0); } }; }`;
    const enabled = applyGreenScreenBackground(source, true);
    expect(enabled).toContain('background: "#00ff00"');
    expect(enabled).toContain('transparent: false');
    expect(enabled).toContain('...({ background: palette.bg, transparent: true })');
    expect(applyGreenScreenBackground(enabled, false)).toBe(source);
  });

  it('adds SVG options when the generated code omitted them and leaves unrelated API calls unchanged', () => {
    const source = `const root = api.svg(800, 450); api.rect(root, 0, 0, 20, 20, {});`;
    const enabled = applyGreenScreenBackground(source, true);
    expect(enabled).toContain('api.svg(800, 450, { ...({}), /*__MOTION_STUDIO_GREEN_SCREEN_NO_OPTIONS__*/ background: "#00ff00", transparent: false })');
    expect(applyGreenScreenBackground(enabled, false)).toBe(source);
  });

  it('overrides and restores the background fill in Canvas renderFrame code', () => {
    const source = `function renderFrame(time, frame, fps, ctx, width, height) { ctx.fillStyle = '#060607'; ctx.fillRect(0, 0, width, height); }`;
    const enabled = applyGreenScreenBackground(source, true);
    expect(enabled).toContain('ctx.fillStyle = /*__MOTION_STUDIO_CANVAS_BG:');
    expect(enabled).toContain('"#00ff00"; ctx.fillRect(0, 0, width, height)');
    expect(applyGreenScreenBackground(enabled, false)).toBe(source);
  });

  it('adds a pure green backing fill to Canvas animations without an explicit background', () => {
    const source = `function renderFrame(time, frame, fps, ctx, width, height) { ctx.fillStyle = '#ff00ff'; ctx.fillRect(10, 10, 20, 20); }`;
    const enabled = applyGreenScreenBackground(source, true);
    expect(enabled).toContain('ctx.fillStyle="#00ff00";ctx.fillRect(0,0,width,height)');
    expect(applyGreenScreenBackground(enabled, false)).toBe(source);
  });
});
