import { CURVES, RecreateSceneSchema, curveAspect, type RecreateScene } from './recreate';

/** What we keep from a reference image: its idea (colours, mood, rough form), never its pixels. */
export interface RefPalette {
  colors: string[];
  bg: { top: string; bottom: string };
  /** width / height of the main shape */
  aspect: number;
  bgIsLight: boolean;
  /** plain background + compact subject: safe to treat as a symbol/logo */
  viable: boolean;
}

const hex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const median = (list: number[]) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

export function extractPalette(source: CanvasImageSource, sw: number, sh: number): RefPalette | null {
  if (typeof document === 'undefined' || sw < 4 || sh < 4) return null;
  const scale = Math.min(1, 160 / Math.max(sw, sh));
  const W = Math.max(2, Math.round(sw * scale)); const H = Math.max(2, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(source, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;

  const ring = Math.max(1, Math.round(Math.min(W, H) * 0.04));
  const top: number[][] = [[], [], []]; const bottom: number[][] = [[], [], []];
  let borderTotal = 0;
  const border: number[][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!(y < ring || y >= H - ring || x < ring || x >= W - ring)) continue;
    const i = (y * W + x) * 4; const bucket = y < H / 2 ? top : bottom;
    bucket[0].push(d[i]); bucket[1].push(d[i + 1]); bucket[2].push(d[i + 2]);
    border.push([d[i], d[i + 1], d[i + 2]]); borderTotal++;
  }
  const bgTop = [median(top[0]), median(top[1]), median(top[2])];
  const bgBottom = bottom[0].length ? [median(bottom[0]), median(bottom[1]), median(bottom[2])] : bgTop;
  const near = border.filter((p) => dist(p, bgTop) < 26 || dist(p, bgBottom) < 26).length;
  const uniform = borderTotal ? near / borderTotal : 0;

  // dominant colours of everything that is not background (4-bit buckets)
  const buckets = new Map<number, { sum: number[]; n: number }>();
  let minX = W; let maxX = -1; let minY = H; let maxY = -1; let fg = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const p = [d[i], d[i + 1], d[i + 2]];
    const bg = y < H / 2 ? bgTop : bgBottom;
    if (dist(p, bg) < 40) continue;
    // a drop shadow is just the background made darker: it is not part of the artwork's colours
    const bb = bg[0] * bg[0] + bg[1] * bg[1] + bg[2] * bg[2];
    if (bb > 10800) {
      const k = (p[0] * bg[0] + p[1] * bg[1] + p[2] * bg[2]) / bb;
      if (k >= 0.4 && k < 0.985 && Math.hypot(p[0] - k * bg[0], p[1] - k * bg[1], p[2] - k * bg[2]) < 16) continue;
    }
    fg++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const key = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
    const e = buckets.get(key) ?? { sum: [0, 0, 0], n: 0 };
    e.sum[0] += p[0]; e.sum[1] += p[1]; e.sum[2] += p[2]; e.n++;
    buckets.set(key, e);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map((e) => e.sum.map((v) => v / e.n));
  const picked: number[][] = [];
  for (const c of ranked) { if (picked.length >= 5) break; if (picked.every((p) => dist(p, c) > 70)) picked.push(c); }
  // order as a smooth gradient: start with the biggest, then always the nearest unused colour
  const ordered: number[][] = picked.length ? [picked[0]] : [];
  const rest = picked.slice(1);
  while (rest.length) {
    const last = ordered[ordered.length - 1];
    rest.sort((a, b) => dist(a, last) - dist(b, last));
    ordered.push(rest.shift() as number[]);
  }
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const coverage = fg / (W * H);
  return {
    colors: ordered.length ? ordered.map(hex) : ['#ff3b5c', '#7c3aed', '#2563eb'],
    bg: { top: hex(bgTop), bottom: hex(bgBottom) },
    aspect: maxX >= 0 ? (maxX - minX + 1) / (maxY - minY + 1) : sw / sh,
    bgIsLight: lum(bgTop) > 120,
    viable: uniform >= 0.55 && coverage >= 0.02 && coverage <= 0.8,
  };
}

export interface ArtDirection {
  curve?: string;
  strands?: number;
  mood?: string;
  style?: string;
  colors: string[];
  bg: { top: string; bottom: string };
  bgIsLight: boolean;
  aspect: number;
}

const darken = (c: string, k: number) => { const m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; const n = parseInt(m[1], 16); return hex([(n >> 16) * k, ((n >> 8) & 255) * k, (n & 255) * k]); };

/**
 * New vector motion generated from the reference's idea. `seed` changes strand count, braiding,
 * flow direction and extras, so pressing Generate again gives a different design, not the same one.
 */
export function buildRibbonScene(dir: ArtDirection, duration: number, seed: number): RecreateScene {
  const r = (n: number) => hash(seed * 13.37 + n);
  const known = (CURVES as readonly string[]).includes(dir.curve ?? '') ? (dir.curve as string) : null;
  const curve = known ?? (dir.aspect > 1.9 ? 'infinity' : dir.aspect > 1.3 ? 'wave' : (['circle', 'trefoil', 'rose', 'lissajous'] as const)[Math.floor(r(1) * 4)]);
  const style = ['glossy', 'glass', 'neon', 'flat'].includes(dir.style ?? '') ? (dir.style as string) : 'glossy';
  const mood = ['calm', 'elegant', 'energetic'].includes(dir.mood ?? '') ? (dir.mood as string) : 'elegant';
  const strands = Math.max(1, Math.min(5, Math.round(dir.strands ?? 1 + Math.floor(r(2) * 3))));
  const colors = dir.colors.length ? dir.colors : ['#ff3b5c', '#7c3aed', '#2563eb'];
  const neon = style === 'neon';
  const th = neon ? 0.016 : Math.min(0.075, 0.17 / (strands + 0.5));
  const flowSpeed = mood === 'energetic' ? 0.22 : mood === 'calm' ? 0.07 : 0.13;
  const flow = (r(4) > 0.5 ? 1 : -1) * flowSpeed;

  const boxH = 0.78;
  let boxW = boxH * (9 / 16) * curveAspect(curve);
  let boxHH = boxH;
  if (boxW > 0.9) { boxW = 0.9; boxHH = (boxW * 16) / (9 * curveAspect(curve)); }
  const box = { x: (1 - boxW) / 2, y: (1 - boxHH) / 2, w: boxW, h: boxHH };

  const bgTop = neon ? darken(colors[0], 0.14) : dir.bg.top;
  const bgBottom = neon ? '#04050c' : dir.bg.bottom;
  const noExit = { preset: 'none', at: 999, dur: 0.5, ease: 'cubicInOut' };
  const noLoop = { preset: 'none', amount: 0.4, speed: 1 };
  const fade = (at: number, dur = 1.2) => ({ preset: 'fade', at, dur, ease: 'cubicOut', split: 'none', stagger: 0 });
  const base = { rotation: 0, opacity: 1, blur: 0, follow: null, exit: noExit, loop: noLoop };
  const glowShape = (id: string, fill: string, x: number, y: number, w: number, h: number, at: number) => ({
    ...base, id, kind: 'shape', shape: 'ellipse', fill, fill2: null, gradientAngle: 90, stroke: null, strokeWidth: 0, radius: 0,
    x, y, w, h, z: 0, opacity: neon ? 0.35 : 0.2, blur: 0.09, enter: fade(at, 1.6), loop: { preset: 'pulse', amount: 0.5, speed: 0.45 },
  });
  const ribbon = (id: string, over: Record<string, unknown>) => ({
    ...base, id, kind: 'ribbon', curve, colors, seed, ...box, strands,
    thickness: th, spread: neon ? 1.8 : 1.05, braid: 0.35 + r(5) * 0.6, braidFreq: 2 + Math.floor(r(6) * 3),
    flow, gloss: style === 'glass' ? 1 : style === 'glossy' ? 0.7 : style === 'flat' ? 0.1 : 0,
    shadow: neon ? 0 : style === 'flat' ? 0.25 : 0.5, glow: neon ? 0.9 : 0.2, sway: mood === 'calm' ? 0.25 : 0.5,
    sparkles: mood === 'energetic' ? 18 : 9, z: 5,
    enter: { preset: 'drawOn', at: 0.2, dur: 2.2, ease: 'cubicInOut', split: 'none', stagger: 0 },
    ...over,
  });

  const elements: unknown[] = [
    glowShape('glowA', colors[0], 0.02, 0.1, 0.55, 0.9, 0),
    glowShape('glowB', colors[colors.length - 1], 0.43, 0.0, 0.55, 0.9, 0.3),
  ];
  if (r(7) > 0.45 || mood === 'energetic') {
    elements.push(ribbon('ring', { curve: 'circle', strands: 1, thickness: 0.006, spread: 0, braid: 0, gloss: 0, shadow: 0, glow: 0.5, sparkles: 0, opacity: 0.22, x: 0.5 - 0.5 * (9 / 16), y: 0.0, w: 1 * (9 / 16), h: 1, z: 1, flow: -flow, enter: fade(0.6, 1.5), loop: { preset: 'spin', amount: 0.25, speed: 1 } }));
  }
  if (r(8) > 0.3) {
    const k = 1.12;
    elements.push(ribbon('echo', { strands: 1, thickness: th * 0.3, spread: 0, braid: 0, gloss: 0, shadow: 0, glow: 0.4, sparkles: 0, opacity: 0.5, flow: -flow * 1.4, sway: 1, z: 2, x: box.x - (box.w * (k - 1)) / 2, y: box.y - (box.h * (k - 1)) / 2, w: box.w * k, h: box.h * k, enter: { preset: 'drawOn', at: 1.0, dur: 2.6, ease: 'cubicInOut', split: 'none', stagger: 0 } }));
  }
  elements.push(ribbon('main', {}));

  return RecreateSceneSchema.parse({
    version: 1, title: `${curve} ribbon`, duration, palette: colors,
    concept: `New ${style} ribbon motion (${curve}, ${strands} strands) built from the reference's colours and idea.`,
    background: { type: 'linear', colors: [bgTop, bgBottom], angle: 90, grain: neon ? 0.35 : 0.12, vignette: neon ? 0.5 : 0.25 },
    elements,
    notes: `Procedural, seed ${seed}. Generate again for a different variation.`,
  });
}
