import { describe, expect, it } from 'vitest';
import { EASINGS, ease, RecreateSceneSchema } from '../engine/recreate';

describe('recreate scene schema', () => {
  it('accepts a partial Gemini scene and fills safe defaults', () => {
    const scene = RecreateSceneSchema.parse({
      title: 'Poster',
      background: { type: 'weird', colors: ['#000', '#111'] },
      elements: [{ kind: 'text', text: 'Hello', enter: { preset: 'doesNotExist', at: 2 } }],
    });
    expect(scene.background.type).toBe('solid');
    expect(scene.elements).toHaveLength(1);
    const el = scene.elements[0];
    expect(el.enter.preset).toBe('fadeUp');
    expect(el.enter.at).toBe(2);
    expect(el.exit.preset).toBe('none');
  });

  it('drops unusable elements instead of failing the whole scene', () => {
    const scene = RecreateSceneSchema.parse({ elements: [{ kind: 'nope' }, { kind: 'shape', shape: 'ellipse' }, 42] });
    expect(scene.elements).toHaveLength(1);
  });

  it('clamps out-of-range numbers', () => {
    const scene = RecreateSceneSchema.parse({ duration: 9999, elements: [{ kind: 'text', text: 'x', size: 50, opacity: -3 }] });
    expect(scene.duration).toBe(60);
    const el = scene.elements[0];
    if (el.kind !== 'text') throw new Error('expected text');
    expect(el.size).toBe(0.6);
    expect(el.opacity).toBe(0);
  });
});

describe('recreate easing', () => {
  it('every easing starts at 0 and ends at 1', () => {
    for (const name of EASINGS) {
      expect(ease(name, 0)).toBeCloseTo(0, 5);
      expect(ease(name, 1)).toBeCloseTo(1, 5);
    }
  });

  it('backOut overshoots past 1 mid-flight', () => {
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => ease('backOut', i / 49)))).toBeGreaterThan(1.05);
  });
});

describe('recreate path elements', () => {
  it('parses a path with flow loop and a follower, and drops paths without data', () => {
    const scene = RecreateSceneSchema.parse({
      elements: [
        { kind: 'path', id: 'a', d: 'M10 50 C 10 10, 50 10, 50 50', stroke: '#f00', loop: { preset: 'flow' }, enter: { preset: 'drawOn' } },
        { kind: 'path', id: 'empty', d: '' },
        { kind: 'shape', id: 'dot', shape: 'ellipse', follow: { path: 'a', speed: 0.2 } },
      ],
    });
    expect(scene.elements.map((e) => e.id)).toEqual(['a', 'dot']);
    expect(scene.elements[0].loop.preset).toBe('flow');
    expect(scene.elements[1].follow?.path).toBe('a');
  });
});

describe('artwork scene builder', () => {
  it('builds a valid layered scene for any layer count', async () => {
    const { buildArtworkScene } = await import('../engine/artwork');
    const fake = { width: 600, height: 300, bg: { top: '#d7d7d9', bottom: '#cfcfd2' }, colors: ['#d72041', '#4247e0', '#9b32b2'], layers: [{}, {}, {}] as unknown as HTMLCanvasElement[] };
    const scene = buildArtworkScene(fake, 8);
    expect(scene.elements.filter((e) => e.kind === 'artwork')).toHaveLength(4); // base + 3 layers
    expect(scene.elements.filter((e) => e.kind === 'shine')).toHaveLength(2);
    expect(scene.elements.some((e) => e.kind === 'text')).toBe(false);
    expect(scene.elements.every((e) => e.exit.preset === 'none')).toBe(true);
    const single = buildArtworkScene({ ...fake, colors: ['#fff'], layers: [] }, 6);
    expect(single.elements.filter((e) => e.kind === 'artwork')).toHaveLength(1);
  });
});

describe('ribbon scene builder', () => {
  it('builds new, valid ribbon scenes and varies with the seed', async () => {
    const { buildRibbonScene } = await import('../engine/ribbonScene');
    const dir = { curve: 'infinity', colors: ['#e11d2e', '#7c3aed', '#1d6dff'], bg: { top: '#f6f6f8', bottom: '#e4e4ea' }, bgIsLight: true, aspect: 2.3 };
    const a = buildRibbonScene(dir, 8, 11);
    const b = buildRibbonScene(dir, 8, 4242);
    expect(a.elements.some((e) => e.kind === 'ribbon')).toBe(true);
    expect(a.elements.some((e) => e.kind === 'crop' || e.kind === 'artwork')).toBe(false); // never reuses reference pixels
    expect(JSON.stringify(a.elements)).not.toBe(JSON.stringify(b.elements));
    expect(a.elements.every((e) => e.exit.preset === 'none')).toBe(true);
  });
});

describe('composer (art director)', () => {
  const brief = { subject: 'green wallet icon', motifs: ['wallet', 'coin'], palette: ['#4caf20', '#2e8b1e', '#a6d84a'] };

  it('composes valid scenes without reusing reference pixels, and never exits to empty', async () => {
    const { composeScene } = await import('../engine/composer');
    const scene = composeScene(brief, 8, 5, 16 / 9);
    expect(scene.elements.length).toBeGreaterThan(10);
    expect(scene.elements.some((e) => e.kind === 'crop' || e.kind === 'artwork')).toBe(false);
    expect(scene.elements.every((e) => e.exit.preset === 'none')).toBe(true);
  });

  it('gives a different design for different seeds and does not default to a white background', async () => {
    const { composeScene } = await import('../engine/composer');
    const seeds = Array.from({ length: 40 }, (_, i) => i * 97 + 3);
    const scenes = seeds.map((s) => composeScene(brief, 8, s));
    expect(new Set(scenes.map((s) => JSON.stringify(s.elements))).size).toBe(seeds.length);
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
    const light = scenes.filter((s) => lum(s.background.colors[0]) > 0.8).length;
    expect(light).toBeLessThan(seeds.length * 0.5);
  });

  it('lets the typed direction win over the AI brief', async () => {
    const { briefFromDirection } = await import('../engine/composer');
    const out = briefFromDirection('dark neon background, orbit layout, coins and a shield, fast', { ...brief, background: 'light', layout: 'hero' });
    expect(out.background).toBe('dark');
    expect(out.layout).toBe('orbit');
    expect(out.style).toBe('neon');
    expect(out.mood).toBe('energetic');
    expect(out.motifs).toEqual(['coin', 'shield']);
  });
});

describe('animate icon planner', () => {
  const meta = {
    comps: [
      { id: 0, hole: false, bbox: { x: 0, y: 0.1, w: 1, h: 0.8 }, centroid: { x: 0.5, y: 0.5 }, area: 0.3, color: '#3b82f6' },
      { id: 1, hole: false, bbox: { x: 0.35, y: 0.4, w: 0.3, h: 0.3 }, centroid: { x: 0.5, y: 0.55 }, area: 0.03, color: '#6366f1' },
      { id: 2, hole: false, bbox: { x: 0.4, y: 0.45, w: 0.2, h: 0.2 }, centroid: { x: 0.5, y: 0.55 }, area: 0.01, color: '#6366f1' },
    ],
  };
  const prompt = 'The dual arrows inside the cloud smoothly and continuously spin. The cloud itself has a very subtle, slow pulsing effect. The colors and silhouette are preserved.';

  it('sends the spin to the arrows and the gentle pulse to the cloud', async () => {
    const { planFromKeywords } = await import('../engine/iconScene');
    const plan = planFromKeywords(prompt, meta);
    const inner = plan.groups.find((g) => g.name === 'inner');
    const body = plan.groups.find((g) => g.name === 'body');
    expect(inner?.motions.map((m) => m.type)).toContain('spin');
    expect(body?.motions.map((m) => m.type)).toContain('pulse');
    expect(body?.motions.find((m) => m.type === 'pulse')?.amount ?? 1).toBeLessThanOrEqual(0.03);
  });

  it('recognises requests that need the icon itself animated', async () => {
    const { wantsFaithful } = await import('../services/recreateGemini');
    expect(wantsFaithful(prompt)).toBe(true);
    expect(wantsFaithful('dark neon background, orbit layout, coins')).toBe(false);
  });

  it('builds a scene of the icon parts that closes its loops at the end of the clip', async () => {
    const { planFromKeywords, buildIconScene } = await import('../engine/iconScene');
    const scene = buildIconScene({ ...meta, width: 400, height: 300, crop: { x: 0, y: 0, w: 1, h: 1 }, bg: { top: '#ffffff', bottom: '#ffffff', light: true } }, { ...planFromKeywords(prompt, meta), background: 'dark' }, 8, 16 / 9);
    const parts = scene.elements.filter((e) => e.kind === 'part');
    expect(parts.length).toBe(2);
    const spin = parts.map((p) => (p.kind === 'part' ? p.motion.spin : 0)).find((s) => s !== 0) ?? 0;
    expect(Math.abs(spin * 8) % 360).toBeCloseTo(0, 5); // whole turns in 8 s
  });
});

describe('alive-by-default quality gate', () => {
  it('measures frame difference from 0 (identical) to 1 (black vs white)', async () => {
    const { frameDifference } = await import('../engine/quality');
    const a = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const b = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(frameDifference(a, a)).toBe(0);
    expect(frameDifference(a, b)).toBe(1);
  });

  it('lets a one-piece icon move as a whole, but never overrides a described motion', async () => {
    const { pickFx, FX_SUBTLE } = await import('../engine/iconScene');
    const one = { groups: [{ name: 'icon', components: [0], motions: [] }], described: false };
    for (const r of [0.1, 0.5, 0.9]) {
      const fx = pickFx(one, () => r);
      expect(fx.shine + fx.conic + fx.echo + fx.tilt).toBeGreaterThan(1);
    }
    expect(pickFx({ ...one, described: true })).toEqual(FX_SUBTLE);
  });
});

describe('auto motion idea -> plan round trip', () => {
  const comp = (id: number, w: number, h: number, area: number, inner = false) => ({
    id, hole: false, color: '#3b82f6', area,
    bbox: inner ? { x: 0.4, y: 0.4, w, h } : { x: 0, y: 0.1, w, h },
    centroid: { x: 0.5, y: 0.5 },
  });
  const metas = {
    'two-part icon': { comps: [comp(0, 1, 0.8, 0.3), comp(1, 0.3, 0.3, 0.03, true), comp(2, 0.25, 0.25, 0.02, true)] },
    'one-piece outline': { comps: [comp(0, 1, 0.5, 0.1)] },
    'one-piece solid': { comps: [comp(0, 1, 0.5, 0.45)] },
  };

  it('every idea the app writes is understood by the planner, so what you read is what gets built', async () => {
    const { localIdea } = await import('../services/recreateGemini');
    const { planFromKeywords } = await import('../engine/iconScene');
    for (const [name, meta] of Object.entries(metas)) {
      for (let i = 0; i < 12; i++) {
        const idea = localIdea(meta as never, '');
        const plan = planFromKeywords(idea, meta as never);
        expect(plan.described, `${name}: ${idea}`).toBe(true);
      }
    }
  });

  it('a one-piece outline symbol gets drawn on from start to end', async () => {
    const { planFromKeywords } = await import('../engine/iconScene');
    const plan = planFromKeywords('The symbol is drawn on from start to end along its stroke, then a soft light flows around it.', metas['one-piece outline'] as never);
    expect(plan.entrance).toBe('draw');
    expect(plan.effects).toContain('light');
  });

  it('keeps the light inside each part so it cannot drift off a pulsing edge', async () => {
    const { RecreateSceneSchema } = await import('../engine/recreate');
    const scene = RecreateSceneSchema.parse({ elements: [{ kind: 'part', id: 'p', comps: [0], motion: { pulse: 0.03, shine: 0.5, conic: 0.4, shineAt: 2 } }] });
    const el = scene.elements[0];
    if (el.kind !== 'part') throw new Error('expected part');
    expect(el.motion.shine).toBe(0.5);
    expect(el.motion.conic).toBe(0.4);
    expect(el.motion.shineAt).toBe(2);
  });
});
