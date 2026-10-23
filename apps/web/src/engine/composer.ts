import { RecreateSceneSchema, curveAspect, CURVES, type RecreateScene } from './recreate';

/**
 * Art-director + composer. A reference image (or a typed direction) becomes a BRIEF: what the thing is,
 * which motifs suit it, mood, style, palette. The composer then builds a NEW scene from built-in vector
 * glyphs, backgrounds and layouts. Geometry is never copied from the reference and never drawn by an AI,
 * and a new seed gives a different design every time.
 */
export const GLYPHS = ['card', 'coin', 'wallet', 'shield', 'lock', 'bolt', 'heart', 'star', 'orb', 'globe', 'check'] as const;
export const LAYOUTS = ['hero', 'trio', 'orbit', 'cascade', 'ribbon'] as const;
type Glyph = (typeof GLYPHS)[number];
type Layout = (typeof LAYOUTS)[number];

export interface Brief {
  subject?: string;
  concept?: string;
  motifs?: string[];
  mood?: string;
  style?: string;
  background?: string;
  palette: string[];
  layout?: string;
  curve?: string;
}

/* ───────── small colour + random helpers ───────── */

const HEX6 = /^#[0-9a-f]{6}$/i;
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hexToRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2; const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const f = (n: number) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}
const shade = (hex: string, dl: number) => { const [h, s, l] = rgbToHsl(...hexToRgb(hex)); return hslToHex(h, s, l + dl); };
const pick = <T,>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];

interface Pal { h: number; p0: string; p1: string; p2: string; dark1: string; dark2: string; tint1: string; tint2: string; pale: string }
function derivePalette(list: string[], rng: () => number): Pal {
  const valid = list.filter((c) => HEX6.test(c));
  let h = rng() * 360; let s = 0.75;
  if (valid.length) { const [hh, ss] = rgbToHsl(...hexToRgb(valid[0])); h = hh; s = Math.max(0.55, ss); }
  return {
    h,
    p0: valid[0] ?? hslToHex(h, s, 0.52),
    p1: valid[1] ?? hslToHex(h + 22, s, 0.4),
    p2: valid[2] ?? hslToHex(h + (rng() > 0.5 ? 40 : -40), Math.min(1, s + 0.1), 0.62),
    dark1: hslToHex(h, Math.min(0.6, s * 0.7), 0.05), dark2: hslToHex(h + 12, Math.min(0.65, s * 0.75), 0.13),
    tint1: hslToHex(h, 0.55, 0.95), tint2: hslToHex(h + 14, 0.6, 0.87), pale: hslToHex(h, 0.7, 0.93),
  };
}

/* ───────── typed direction → brief overrides (works offline, also overrides the AI where the user was explicit) ───────── */

const COLOR_WORDS: Record<string, string> = {
  red: '#ef4444', lal: '#ef4444', orange: '#f97316', komola: '#f97316', yellow: '#facc15', holud: '#facc15', gold: '#f59e0b', golden: '#f59e0b',
  green: '#22c55e', sobuj: '#22c55e', teal: '#14b8a6', blue: '#3b82f6', nil: '#3b82f6', purple: '#8b5cf6', beguni: '#8b5cf6', violet: '#8b5cf6', pink: '#ec4899', golapi: '#ec4899',
};
const MOTIF_WORDS: Record<string, Glyph> = {
  card: 'card', credit: 'card', debit: 'card', coin: 'coin', coins: 'coin', money: 'coin', cash: 'coin', dollar: 'coin', taka: 'coin', wallet: 'wallet',
  shield: 'shield', secure: 'shield', security: 'shield', safe: 'shield', protect: 'shield', lock: 'lock', privacy: 'lock',
  bolt: 'bolt', lightning: 'bolt', speed: 'bolt', power: 'bolt', energy: 'bolt', heart: 'heart', love: 'heart', health: 'heart',
  star: 'star', stars: 'star', rating: 'star', premium: 'star', globe: 'globe', world: 'globe', earth: 'globe', global: 'globe',
  check: 'check', tick: 'check', done: 'check', success: 'check', verified: 'check', orb: 'orb', sphere: 'orb', ball: 'orb', bubble: 'orb',
};
const LAYOUT_WORDS: Record<string, Layout> = { ribbon: 'ribbon', loop: 'ribbon', infinity: 'ribbon', orbit: 'orbit', planet: 'orbit', satellite: 'orbit', cascade: 'cascade', rain: 'cascade', falling: 'cascade', trio: 'trio', three: 'trio', hero: 'hero', single: 'hero' };

export function briefFromDirection(text: string, base: Brief): Brief {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const out: Brief = { ...base };
  const motifs: string[] = [];
  const colors: string[] = [];
  for (const w of words) {
    if (COLOR_WORDS[w] && !colors.includes(COLOR_WORDS[w])) colors.push(COLOR_WORDS[w]);
    if (MOTIF_WORDS[w] && !motifs.includes(MOTIF_WORDS[w])) motifs.push(MOTIF_WORDS[w]);
    if (LAYOUT_WORDS[w]) out.layout = LAYOUT_WORDS[w];
    if (['dark', 'night', 'black', 'kalo'].includes(w)) out.background = 'dark';
    if (['light', 'white', 'bright', 'clean', 'sada'].includes(w)) out.background = 'light';
    if (['colorful', 'vibrant', 'gradient', 'rongin'].includes(w)) out.background = 'colorful';
    if (w === 'neon' || w === 'glow') { out.style = 'neon'; out.background = 'dark'; }
    if (w === 'glass') out.style = 'glass';
    if (['flat', 'minimal', 'simple'].includes(w)) out.style = 'flat';
    if (['glossy', 'shiny', 'luxury'].includes(w)) out.style = 'glossy';
    if (['calm', 'slow', 'soft'].includes(w)) out.mood = 'calm';
    if (['fast', 'energetic', 'dynamic', 'bold'].includes(w)) out.mood = 'energetic';
    if (['elegant', 'premium', 'luxury'].includes(w)) out.mood = 'elegant';
  }
  if (motifs.length) out.motifs = motifs;
  if (colors.length) out.palette = colors;
  return out;
}

/* ───────── scene composition ───────── */

type El = Record<string, unknown>;

export function composeScene(brief: Brief, duration: number, seed: number, aspect = 16 / 9): RecreateScene {
  const rng = mulberry32(seed * 7919 + 17);
  const P = derivePalette(brief.palette, rng);
  const mood = ['calm', 'elegant', 'energetic'].includes(brief.mood ?? '') ? (brief.mood as string) : pick(rng, ['calm', 'elegant', 'elegant', 'energetic']);
  const style = ['glossy', 'glass', 'neon', 'flat'].includes(brief.style ?? '') ? (brief.style as string) : pick(rng, ['glossy', 'glossy', 'glass', 'flat']);
  const bgKind: 'dark' | 'light' | 'colorful' = ['dark', 'light', 'colorful'].includes(brief.background ?? '') ? (brief.background as 'dark' | 'light' | 'colorful')
    : style === 'neon' ? 'dark' : (() => { const r = rng(); return r < 0.45 ? 'dark' : r < 0.78 ? 'colorful' : 'light'; })();
  const layout: Layout = (LAYOUTS as readonly string[]).includes(brief.layout ?? '') ? (brief.layout as Layout) : pick(rng, LAYOUTS);
  const motifs: Glyph[] = (brief.motifs ?? []).filter((m): m is Glyph => (GLYPHS as readonly string[]).includes(m));
  const pool: Glyph[] = motifs.length ? motifs : ['orb', 'star', 'bolt', 'globe'];
  const motif = (i: number): Glyph => pool[i % pool.length];

  const speed = mood === 'energetic' ? 1 : 0.5; // float speeds that loop seamlessly in 8s scenes
  const amp = mood === 'calm' ? 0.3 : mood === 'energetic' ? 0.55 : 0.4;
  const noExit = { preset: 'none', at: 999, dur: 0.5, ease: 'cubicInOut' };
  const dark = bgKind !== 'light';
  const accent = dark ? P.p2 : P.p0;
  let uid = 0;
  const id = (p: string) => `${p}${uid++}`;
  const els: El[] = [];
  const nx = (px: number) => px / aspect; // pixels-in-H-units → canvas x fraction

  /* background */
  const background = bgKind === 'dark'
    ? { type: rng() > 0.5 ? 'radial' : 'linear', colors: [P.dark2, P.dark1], angle: 160, grain: 0.3, vignette: 0.5 }
    : bgKind === 'colorful'
      ? { type: 'linear', colors: [hslToHex(P.h, 0.7, 0.3), hslToHex(P.h + 28, 0.75, 0.13)], angle: 120 + rng() * 80, grain: 0.22, vignette: 0.4 }
      : { type: 'linear', colors: [P.tint1, P.tint2], angle: 160, grain: 0.08, vignette: 0.12 };
  const glow = (fill: string, x: number, y: number, w: number, h: number, op: number, at: number) => ({
    id: id('glow'), kind: 'shape', shape: 'ellipse', fill, fill2: null, stroke: null, x, y, w, h, z: 0, opacity: op, blur: 0.09, rotation: 0,
    enter: { preset: 'fade', at, dur: 1.6, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: { preset: 'pulse', amount: 0.5, speed: 0.5 }, follow: null,
  });
  els.push(glow(P.p0, -0.05, 0.1, 0.6, 0.9, bgKind === 'light' ? 0.3 : 0.28, 0), glow(P.p2, 0.45, -0.05, 0.6, 0.9, bgKind === 'light' ? 0.28 : 0.2, 0.3));
  const sparkles = 10 + Math.floor(rng() * 8);
  for (let i = 0; i < sparkles; i++) {
    const sz = 0.006 + rng() * 0.012;
    els.push({
      id: id('sp'), kind: 'shape', shape: 'ellipse', fill: bgKind === 'light' ? P.p0 : i % 3 ? '#ffffff' : P.p2, fill2: null, stroke: null,
      x: 0.03 + rng() * 0.94, y: 0.05 + rng() * 0.9, w: nx(sz), h: sz, z: 1, opacity: 0.35 + rng() * 0.45, blur: 0.003, rotation: 0,
      enter: { preset: 'fade', at: 0.4 + rng() * 3, dur: 1, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit,
      loop: { preset: rng() > 0.5 ? 'pulse' : 'float', amount: 0.8, speed: pick(rng, [0.5, 1, 1, 2]) }, follow: null,
    });
  }

  /* glyph library: each glyph is several shapes that share a pivot, enter and loop, so it moves as one object */
  const body = (extra: Partial<Record<string, unknown>> = {}) => ({ fill: shade(P.p0, 0.1), fill2: shade(P.p1, -0.08), gradientAngle: 135, ...extra });
  const glyph = (kind: Glyph, cx: number, cy: number, s: number, at: number, o: { z?: number; enter?: string; ease?: string; follow?: unknown; amp?: number; speed?: number; blur?: number; dur?: number } = {}): El[] => {
    const ar = kind === 'card' ? 1.6 : kind === 'wallet' ? 1.25 : kind === 'shield' ? 0.9 : kind === 'lock' ? 0.85 : kind === 'bolt' ? 0.75 : 1;
    const gw = (s * ar) / aspect; const gh = s; const gx = cx - gw / 2; const gy = cy - gh / 2;
    const sub = (fx: number, fy: number, fw: number, fh: number) => ({ x: gx + fx * gw, y: gy + fy * gh, w: fw * gw, h: fh * gh });
    const zBase = o.z ?? 10;
    const gid = id(kind);
    const mot = {
      enter: { preset: o.enter ?? 'popBack', at, dur: o.dur ?? 1.0, ease: o.ease ?? 'backOut', split: 'none', stagger: 0 },
      loop: { preset: 'float', amount: o.amp ?? amp, speed: o.speed ?? speed }, exit: noExit, pivot: { x: cx, y: cy }, follow: o.follow ?? null, rotation: 0, blur: o.blur ?? 0,
    };
    let zi = 0;
    const shape = (shp: string, b: ReturnType<typeof sub>, extra: Record<string, unknown>): El => ({ id: `${gid}_${zi}`, kind: 'shape', shape: shp, stroke: null, strokeWidth: 0, radius: 0.15, fill2: null, opacity: 1, ...b, z: zBase + 0.01 * zi++, ...mot, ...extra });
    const path = (d: string, b: ReturnType<typeof sub>, extra: Record<string, unknown>): El => ({ id: `${gid}_${zi}`, kind: 'path', d, fill: null, fill2: null, stroke: null, strokeWidth: 0, opacity: 1, ...b, z: zBase + 0.01 * zi++, ...mot, ...extra });
    const white = (op: number) => ({ fill: '#ffffff', opacity: op });
    switch (kind) {
      case 'card': return [
        shape('roundRect', sub(0, 0, 1, 1), { ...body(), radius: 0.12 }), shape('roundRect', sub(0, 0, 1, 0.5), { ...white(0.14), radius: 0.2 }),
        shape('rect', sub(0, 0.2, 1, 0.17), { fill: '#000000', opacity: 0.35 }), shape('roundRect', sub(0.1, 0.5, 0.2, 0.22), { fill: '#fde68a', fill2: '#f59e0b', radius: 0.2 }),
        shape('roundRect', sub(0.1, 0.82, 0.45, 0.06), { ...white(0.7), radius: 0.5 }), shape('roundRect', sub(0.62, 0.82, 0.25, 0.06), { ...white(0.5), radius: 0.5 }),
      ];
      case 'coin': return [
        shape('ellipse', sub(0, 0, 1, 1), { fill: '#fde68a', fill2: '#d97706', gradientAngle: 135 }),
        shape('ellipse', sub(0.1, 0.1, 0.8, 0.8), { fill: '#fbbf24', fill2: '#f59e0b', gradientAngle: 135, stroke: '#b45309', strokeWidth: 0.004 }),
        { id: `${gid}_t`, kind: 'text', text: '$', font: 'sans', weight: 800, size: s * 0.5, color: '#b45309', align: 'center', ...sub(0.1, 0.1, 0.8, 0.8), z: zBase + 0.5, ...mot },
      ];
      case 'wallet': return [
        shape('roundRect', sub(0, 0.12, 1, 0.84), { ...body(), radius: 0.14 }), shape('roundRect', sub(0.04, 0.02, 0.82, 0.34), { fill: shade(P.p1, -0.12), fill2: shade(P.p0, -0.1), gradientAngle: 90, radius: 0.18 }),
        shape('roundRect', sub(0, 0.12, 1, 0.3), { ...white(0.1), radius: 0.2 }), shape('roundRect', sub(0.62, 0.45, 0.4, 0.3), { ...white(0.92), radius: 0.4 }),
        shape('ellipse', sub(0.76, 0.52, 0.11, 0.16), { fill: shade(P.p1, -0.05) }),
      ];
      case 'shield': return [
        path('M50 4 L90 18 V50 C90 74 72 90 50 98 C28 90 10 74 10 50 V18 Z', sub(0, 0, 1, 1), { fill: shade(P.p0, 0.08), fill2: shade(P.p1, -0.1), gradientAngle: 90 }),
        path('M30 52 L45 67 L72 36', sub(0, 0, 1, 1), { stroke: '#ffffff', strokeWidth: s * 0.07, cap: 'round' }),
      ];
      case 'lock': return [
        path('M28 46 V32 C28 16 38 8 50 8 C62 8 72 16 72 32 V46', sub(0.1, 0, 0.8, 0.6), { stroke: shade(P.p0, 0.25), strokeWidth: s * 0.1, cap: 'round' }),
        shape('roundRect', sub(0, 0.38, 1, 0.62), { ...body(), radius: 0.16 }), shape('ellipse', sub(0.405, 0.56, 0.19, 0.16), { fill: '#000000', opacity: 0.45 }), shape('roundRect', sub(0.46, 0.66, 0.08, 0.16), { fill: '#000000', opacity: 0.45, radius: 0.4 }),
      ];
      case 'bolt': return [path('M58 2 L16 56 H44 L38 98 L84 40 H56 Z', sub(0, 0, 1, 1), { fill: shade(P.p2, 0.22), fill2: P.p0, gradientAngle: 90 })];
      case 'heart': return [
        path('M50 92 C8 62 4 30 26 18 C40 10 50 22 50 32 C50 22 60 10 74 18 C96 30 92 62 50 92 Z', sub(0, 0, 1, 1), { fill: shade(P.p0, 0.1), fill2: shade(P.p1, -0.08), gradientAngle: 100 }),
        shape('ellipse', sub(0.16, 0.16, 0.22, 0.14), { ...white(0.35), rotation: -25 }),
      ];
      case 'star': {
        const pts: string[] = [];
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 20 : 48; const a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push(`${(50 + r * Math.cos(a)).toFixed(1)} ${(54 + r * Math.sin(a)).toFixed(1)}`); }
        return [path(`M${pts.join(' L')} Z`, sub(0, 0, 1, 1), { fill: shade(P.p2, 0.2), fill2: P.p0, gradientAngle: 90 })];
      }
      case 'globe': return [
        shape('ellipse', sub(0, 0, 1, 1), { fill: shade(P.p1, 0.05), fill2: shade(P.p1, -0.22), gradientAngle: 135 }),
        shape('ellipse', sub(0.25, 0, 0.5, 1), { fill: 'rgba(0,0,0,0)', stroke: shade(P.p2, 0.2), strokeWidth: 0.004 }), shape('ellipse', sub(0, 0.25, 1, 0.5), { fill: 'rgba(0,0,0,0)', stroke: shade(P.p2, 0.2), strokeWidth: 0.004 }),
        shape('line', sub(0.02, 0.5, 0.96, 0.001), { fill: '#ffffff', stroke: shade(P.p2, 0.2), strokeWidth: 0.004 }), shape('ellipse', sub(0.15, 0.1, 0.4, 0.26), { ...white(0.22), rotation: -30 }),
      ];
      case 'check': return [
        shape('ellipse', sub(0, 0, 1, 1), body()), shape('ellipse', sub(0.12, 0.08, 0.5, 0.3), { ...white(0.2), rotation: -20 }),
        path('M28 52 L44 68 L74 34', sub(0, 0, 1, 1), { stroke: '#ffffff', strokeWidth: s * 0.08, cap: 'round' }),
      ];
      default: return [
        shape('ellipse', sub(0, 0, 1, 1), body()), shape('ellipse', sub(0.16, 0.1, 0.4, 0.28), { ...white(0.4), blur: 0.006 }), shape('ellipse', sub(0.3, 0.78, 0.4, 0.14), { fill: P.p2, opacity: 0.4, blur: 0.012 }),
      ];
    }
  };

  const halo = (cx: number, cy: number, d: number, at: number, op: number) => ({
    id: id('halo'), kind: 'shape', shape: 'ellipse', fill: 'rgba(0,0,0,0)', stroke: accent, strokeWidth: 0.003, x: cx - nx(d) / 2, y: cy - d / 2, w: nx(d), h: d, z: 3, opacity: op, blur: 0, rotation: 0,
    enter: { preset: 'scaleIn', at, dur: 1.4, ease: 'expoOut', split: 'none', stagger: 0 }, exit: noExit, loop: { preset: 'pulse', amount: 0.5, speed: speed }, follow: null,
  });
  const orbitPath = (rx: number, ry: number, rot: number) => {
    const a = (rot * Math.PI) / 180; const pt = (x: number, y: number) => [50 + x * Math.cos(a) - y * Math.sin(a), 50 + x * Math.sin(a) + y * Math.cos(a)].map((v) => v.toFixed(2));
    const [x1, y1] = pt(-rx, 0); const [x2, y2] = pt(rx, 0);
    return `M${x1} ${y1} A${rx} ${ry} ${rot} 1 0 ${x2} ${y2} A${rx} ${ry} ${rot} 1 0 ${x1} ${y1} Z`;
  };
  const orbit = (cx: number, cy: number, L: number, rx: number, ry: number, rot: number, at: number): { track: El; ref: string } => {
    const trackId = id('orbit');
    return { ref: trackId, track: { id: trackId, kind: 'path', d: orbitPath(rx, ry, rot), fill: null, stroke: accent, strokeWidth: 0.002, x: cx - nx(L) / 2, y: cy - L / 2, w: nx(L), h: L, z: 2, opacity: 0.22, rotation: 0, blur: 0, enter: { preset: 'fade', at, dur: 1.2, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: { preset: 'none', amount: 0.4, speed: 1 }, follow: null } };
  };
  const enters = ['popBack', 'scaleIn', 'rotateIn', 'fadeUp', 'blurIn'];
  const heroSize = (g: Glyph) => (g === 'card' ? 0.3 : g === 'wallet' ? 0.4 : 0.44);

  /* layouts */
  if (layout === 'hero' || layout === 'orbit') {
    const g = motif(0); const hs = layout === 'hero' ? heroSize(g) : heroSize(g) * 0.7;
    els.push(glow(accent, 0.5 - nx(hs * 1.7) / 2, 0.5 - hs * 0.85, nx(hs * 1.7), hs * 1.7, 0.35, 0.2), halo(0.5, 0.5, hs * 1.5, 0.5, 0.35), halo(0.5, 0.5, hs * 2.05, 0.8, 0.2));
    els.push(...glyph(g, 0.5, 0.5, hs, 0.35, { enter: 'popBack' }));
    const orbits = layout === 'orbit' ? 3 : 2;
    for (let i = 0; i < orbits; i++) {
      const L = hs * (2.2 + i * 0.55); const o = orbit(0.5, 0.5, L, 44, 22 + i * 7 + rng() * 6, -30 + rng() * 60, 0.8 + i * 0.2);
      els.push(o.track);
      const sats = layout === 'orbit' ? 2 : 1;
      for (let k = 0; k < sats; k++) {
        const sg = motif(1 + i * 2 + k); const dir = rng() > 0.5 ? 1 : -1;
        els.push(...glyph(sg, 0.5, 0.5, 0.09 + rng() * 0.05, 1.0 + i * 0.3 + k * 0.2, { z: 9, enter: 'scaleIn', amp: 0.2, follow: { path: o.ref, speed: (dir * (rng() > 0.5 ? 1 : 2)) / duration, offset: k / sats + rng() * 0.2, align: false } }));
      }
    }
  } else if (layout === 'trio') {
    const g = motif(0); const spread = Math.min(0.27, 0.15 * aspect);
    els.push(halo(0.5, 0.5, 0.78, 0.5, 0.25));
    els.push(...glyph(motif(1), 0.5 - spread, 0.58, 0.26, 0.9, { enter: 'fadeUp', z: 9, speed: speed, amp: amp + 0.1 }));
    els.push(...glyph(motif(2), 0.5 + spread, 0.44, 0.26, 1.15, { enter: 'fadeUp', z: 9, speed: speed, amp: amp + 0.1 }));
    els.push(...glyph(g, 0.5, 0.5, heroSize(g) * 1.05, 0.35, { enter: 'popBack', z: 11 }));
  } else if (layout === 'cascade') {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const g = motif(i); const near = i % 3 === 0;
      const s = near ? 0.26 + rng() * 0.1 : 0.12 + rng() * 0.08;
      const col = i / (n - 1); const cx = 0.1 + col * 0.8 + (rng() - 0.5) * 0.06; const cy = 0.2 + ((i * 0.37 + rng() * 0.3) % 0.62);
      els.push(...glyph(g, cx, cy, s, 0.3 + i * 0.22, { z: near ? 11 : 6 + i * 0.01, enter: pick(rng, enters), blur: near ? 0 : 0.004, amp: 0.6 + rng() * 0.6, speed: pick(rng, [0.5, 1, 1]) }));
    }
  } else {
    const g = motif(0); const curve = (CURVES as readonly string[]).includes(brief.curve ?? '') ? (brief.curve as string) : pick(rng, ['infinity', 'trefoil', 'rose', 'lissajous', 'circle']);
    const ca = curveAspect(curve); let bw = 0.78 * (9 / 16) * ca * (aspect / (16 / 9)) ** 0 ; let bh = 0.78;
    if (nx(bh) * 0 + bw > 0.9) { bw = 0.9; bh = (bw * aspect) / ca; }
    const strands = 2 + Math.floor(rng() * 2);
    els.push({
      id: id('ribbon'), kind: 'ribbon', curve, strands, thickness: Math.min(0.07, 0.17 / (strands + 0.5)), spread: 1.05, braid: 0.4 + rng() * 0.5, braidFreq: 2 + Math.floor(rng() * 3),
      colors: [P.p0, P.p1, P.p2], flow: (rng() > 0.5 ? 1 : -1) * (mood === 'energetic' ? 0.2 : 0.1), gloss: style === 'flat' ? 0.1 : 0.7, shadow: dark ? 0.2 : 0.5, glow: style === 'neon' ? 0.9 : 0.25, sway: 0.4, sparkles: 8, seed: seed % 100000,
      x: (1 - bw) / 2, y: (1 - bh) / 2, w: bw, h: bh, z: 5, opacity: 1, rotation: 0, blur: 0, enter: { preset: 'drawOn', at: 0.3, dur: 2.2, ease: 'cubicInOut', split: 'none', stagger: 0 }, exit: noExit, loop: { preset: 'none', amount: 0.4, speed: 1 }, follow: null,
    });
    els.push(...glyph(g, 0.5, 0.5, 0.26, 1.4, { z: 12, enter: 'popBack' }));
  }

  const subjectName = brief.subject?.trim();
  return RecreateSceneSchema.parse({
    version: 1, title: `${subjectName ? `${subjectName} · ` : ''}${layout}`, duration, palette: [P.p0, P.p1, P.p2],
    concept: brief.concept || `New ${style} ${mood} motion (${layout}, ${bgKind} background) built from the reference's idea.`,
    background, camera: { push: mood === 'energetic' ? 0.12 : mood === 'calm' ? 0.04 : 0.07, drift: 0.01 }, elements: els,
    notes: `Procedural, seed ${seed}. Generate again for a different design.`,
  });
}
