import { z } from 'zod';
import type { ArtworkData } from './artwork';
import { groupCanvas, type PartsData } from './parts';

/* ───────── Schema (lenient: defaults + clamping so slightly-off Gemini output still renders) ───────── */

const num = (min: number, max: number, fallback: number) => z.coerce.number().catch(fallback).transform((v) => Math.min(max, Math.max(min, v)));
const color = z.string().catch('#ffffff');

export const EASINGS = ['linear', 'sineInOut', 'cubicOut', 'cubicInOut', 'expoOut', 'backOut', 'elasticOut', 'bounceOut'] as const;
export const ENTER_PRESETS = ['none', 'fade', 'fadeUp', 'fadeDown', 'slideLeft', 'slideRight', 'scaleIn', 'popBack', 'wipeRight', 'wipeUp', 'blurIn', 'rotateIn', 'drawOn'] as const;
export const EXIT_PRESETS = ['none', 'fade', 'fadeUp', 'slideLeft', 'slideRight', 'scaleOut'] as const;
export const LOOP_PRESETS = ['none', 'float', 'pulse', 'sway', 'spin', 'shimmer', 'flow'] as const;
export const SPLITS = ['none', 'word', 'char', 'line'] as const;

const oneOf = <T extends readonly [string, ...string[]]>(list: T, fallback: T[number]) =>
  z.string().catch(fallback).transform((v) => ((list as readonly string[]).includes(v) ? (v as T[number]) : fallback));

const EnterSchema = z.object({
  preset: oneOf(ENTER_PRESETS, 'fadeUp'),
  at: num(0, 120, 0),
  dur: num(0.05, 10, 0.7),
  ease: oneOf(EASINGS, 'expoOut'),
  split: oneOf(SPLITS, 'none'),
  stagger: num(0, 1, 0.04),
}).catch({ preset: 'fadeUp', at: 0, dur: 0.7, ease: 'expoOut', split: 'none', stagger: 0.04 });

const ExitSchema = z.object({
  preset: oneOf(EXIT_PRESETS, 'none'),
  at: num(0, 120, 999),
  dur: num(0.05, 10, 0.5),
  ease: oneOf(EASINGS, 'cubicInOut'),
}).catch({ preset: 'none', at: 999, dur: 0.5, ease: 'cubicInOut' });

const LoopSchema = z.object({
  preset: oneOf(LOOP_PRESETS, 'none'), amount: num(0, 1, 0.4),
  /** Negative = reverse direction (spin / flow). */
  speed: num(-4, 4, 1),
  /** true: phase follows the scene clock, so several elements pulse / sway in step regardless of when they entered. */
  sync: z.coerce.boolean().catch(false),
}).catch({ preset: 'none', amount: 0.4, speed: 1, sync: false });

const BaseSchema = z.object({
  id: z.string().catch('el'),
  x: num(-0.5, 1.5, 0.1),
  y: num(-0.5, 1.5, 0.1),
  w: num(0.001, 2, 0.3),
  h: num(0.001, 2, 0.1),
  z: num(0, 100, 1),
  rotation: num(-360, 360, 0),
  opacity: num(0, 1, 1),
  blur: num(0, 0.2, 0),
  enter: EnterSchema,
  exit: ExitSchema,
  loop: LoopSchema,
  /** Optional second loop, e.g. spin + pulse on the same element. */
  loop2: LoopSchema,
  /** Travel along a `path` element (by id): speed = loops per scene-second, offset 0..1. */
  follow: z.object({ path: z.string(), speed: num(-4, 4, 0.15), offset: num(0, 1, 0), align: z.coerce.boolean().catch(false) }).nullable().catch(null),
  /** Shared anchor (canvas 0..1). Elements with the same pivot, enter and loop move/scale/rotate as one rigid group. */
  pivot: z.object({ x: num(-1, 2, 0.5), y: num(-1, 2, 0.5) }).nullable().catch(null),
});

const TextSchema = BaseSchema.extend({
  kind: z.literal('text'),
  text: z.string().catch(''),
  font: oneOf(['sans', 'serif', 'display', 'mono', 'script'] as const, 'sans'),
  weight: num(100, 900, 700),
  size: num(0.01, 0.6, 0.06),
  color,
  align: oneOf(['left', 'center', 'right'] as const, 'left'),
  letterSpacing: num(-0.1, 0.5, 0),
  lineHeight: num(0.8, 2.5, 1.15),
  uppercase: z.coerce.boolean().catch(false),
  italic: z.coerce.boolean().catch(false),
  shadow: z.coerce.boolean().catch(false),
});

const ShapeSchema = BaseSchema.extend({
  kind: z.literal('shape'),
  shape: oneOf(['rect', 'roundRect', 'ellipse', 'line', 'triangle'] as const, 'rect'),
  fill: color,
  fill2: z.string().nullable().catch(null),
  gradientAngle: num(0, 360, 90),
  stroke: z.string().nullable().catch(null),
  strokeWidth: num(0, 0.05, 0),
  radius: num(0, 0.5, 0.1),
});

const CropSchema = BaseSchema.extend({
  kind: z.literal('crop'),
  sx: num(0, 1, 0), sy: num(0, 1, 0), sw: num(0.01, 1, 1), sh: num(0.01, 1, 1),
  radius: num(0, 0.5, 0),
  zoom: num(1, 2, 1),
});

const PathSchema = BaseSchema.extend({
  kind: z.literal('path'),
  /** SVG path data in a 0..100 x 0..100 box, drawn inside the element box (uniform scale, centered). */
  d: z.string().catch(''),
  fill: z.string().nullable().catch(null),
  fill2: z.string().nullable().catch(null),
  gradientAngle: num(0, 360, 90),
  stroke: z.string().nullable().catch('#ffffff'),
  /** Highlight color that runs along the stroke when loop.preset is "flow". */
  stroke2: z.string().nullable().catch(null),
  strokeWidth: num(0, 0.2, 0.012),
  cap: oneOf(['round', 'butt'] as const, 'round'),
  /** evenodd keeps holes open (outline icons, rings). */
  fillRule: oneOf(['nonzero', 'evenodd'] as const, 'nonzero'),
  /** Soft drop shadow under the shape, 0..1. */
  shadow: num(0, 1, 0),
});

const ArtworkElementSchema = BaseSchema.extend({
  kind: z.literal('artwork'),
  /** -1 = whole extracted artwork, 0..n = one colour layer of it. */
  layer: z.coerce.number().int().catch(-1),
  shadow: z.object({ color: z.string().catch('#000000'), alpha: num(0, 1, 0.3), blur: num(0, 0.1, 0.02), dx: num(-0.1, 0.1, 0), dy: num(-0.1, 0.1, 0.01) }).nullable().catch(null),
});

const ShineSchema = BaseSchema.extend({
  kind: z.literal('shine'),
  /** A moving band of light clipped to the artwork: linear sweep, or conic (light running around the shape). */
  mode: oneOf(['linear', 'conic'] as const, 'linear'),
  angle: num(0, 360, 20),
  width: num(0.02, 1, 0.2),
  speed: num(-3, 3, 0.3),
  color,
  intensity: num(0, 1, 0.5),
});

export const CURVES = ['infinity', 'circle', 'trefoil', 'heart', 'wave', 'rose', 'lissajous'] as const;
const int = (min: number, max: number, fallback: number) => z.coerce.number().catch(fallback).transform((v) => Math.min(max, Math.max(min, Math.round(v))));

/** Procedural ribbon: new vector geometry generated from a parametric curve (no reference pixels are reused). */
const RibbonSchema = BaseSchema.extend({
  kind: z.literal('ribbon'),
  curve: oneOf(CURVES, 'infinity'),
  strands: int(1, 6, 2),
  /** thickness as a fraction of canvas height */
  thickness: num(0.003, 0.15, 0.05),
  /** gap between parallel strands, in thickness units */
  spread: num(0, 3, 1),
  /** how strongly strands braid over/under each other (thickness units) and how many times per loop */
  braid: num(0, 2, 0.5),
  braidFreq: num(0.5, 8, 3),
  colors: z.array(z.string()).min(1).max(8).catch(['#ff3b5c', '#7c3aed', '#2563eb']),
  /** colour travel along the ribbon, loops per scene-second (negative = reverse) */
  flow: num(-2, 2, 0.12),
  gloss: num(0, 1, 0.6),
  shadow: num(0, 1, 0.5),
  glow: num(0, 1, 0.2),
  sway: num(0, 1, 0.4),
  sparkles: int(0, 40, 8),
  seed: num(0, 100000, 1),
});

const PART_MOTION_DEFAULT = { spin: 0, pulse: 0, pulsePeriod: 4, float: 0, floatPeriod: 4, sway: 0, swayPeriod: 4, bounce: 0, bouncePeriod: 1, phase: 0, echo: 0, tilt: 0, tiltPeriod: 6, shine: 0, conic: 0, shineAt: 1.2, shineSpeed: 0.25 };
const PartSchema = BaseSchema.extend({
  kind: z.literal('part'),
  /** Components of the extracted icon that move together as one rigid group (indexes into the extracted parts). */
  comps: z.array(z.coerce.number().int().min(0)).min(1).max(24).catch([0]),
  /** Continuous motion applied around the element pivot. spin = degrees per second; amplitudes in fractions. */
  motion: z.object({
    spin: num(-720, 720, 0),
    pulse: num(0, 0.5, 0), pulsePeriod: num(0.5, 60, 4),
    float: num(0, 0.15, 0), floatPeriod: num(0.5, 60, 4),
    sway: num(0, 60, 0), swayPeriod: num(0.5, 60, 4),
    bounce: num(0, 0.3, 0), bouncePeriod: num(0.3, 30, 1),
    phase: num(0, 1, 0),
    /** Ghost copies of the silhouette that expand and fade (works on any shape), 0..1. */
    echo: num(0, 1, 0),
    /** Light sweeping across / running around this part. It lives inside the part, so it pulses, floats and spins together with it. */
    shine: num(0, 1, 0), conic: num(0, 1, 0), shineAt: num(0, 60, 1.2), shineSpeed: num(0.02, 2, 0.25),
    /** Card-turn swing in degrees (squeeze + skew with the silhouette), works on any shape. */
    tilt: num(0, 60, 0), tiltPeriod: num(0.5, 60, 6),
  }).catch(PART_MOTION_DEFAULT),
});

const ElementSchema = z.discriminatedUnion('kind', [TextSchema, ShapeSchema, CropSchema, PathSchema, ArtworkElementSchema, ShineSchema, RibbonSchema, PartSchema]);

const BackgroundSchema = z.object({
  type: oneOf(['solid', 'linear', 'radial'] as const, 'solid'),
  colors: z.array(z.string()).min(1).max(5).catch(['#111318']),
  angle: num(0, 360, 160),
  grain: num(0, 1, 0),
  vignette: num(0, 1, 0),
}).catch({ type: 'solid', colors: ['#111318'], angle: 160, grain: 0, vignette: 0 });

export const RecreateSceneSchema = z.object({
  version: z.literal(1).catch(1),
  title: z.string().catch('Recreated scene'),
  concept: z.string().catch(''),
  duration: num(2, 60, 8),
  palette: z.array(z.string()).catch([]),
  background: BackgroundSchema,
  /** Slow virtual camera: push = extra zoom reached at the end, drift = gentle sideways sway (fraction of width). */
  camera: z.object({ push: num(0, 0.4, 0), drift: num(0, 0.1, 0) }).catch({ push: 0, drift: 0 }),
  elements: z.array(z.unknown()).transform((list) =>
    list.map((raw) => ElementSchema.safeParse(raw)).filter((r) => r.success).map((r) => (r as { data: z.infer<typeof ElementSchema> }).data)
      .filter((el) => el.kind !== 'path' || el.d.trim().length > 3)),
  notes: z.string().catch(''),
});

export type RecreateScene = z.infer<typeof RecreateSceneSchema>;
export type RecreateElement = RecreateScene['elements'][number];
type Ease = (typeof EASINGS)[number];

/* ───────── Easing ───────── */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function ease(name: Ease, input: number): number {
  const t = clamp01(input);
  switch (name) {
    case 'linear': return t;
    case 'sineInOut': return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'cubicOut': return 1 - Math.pow(1 - t, 3);
    case 'cubicInOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'expoOut': return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'backOut': { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
    case 'elasticOut': { if (t === 0 || t === 1) return t; return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1; }
    case 'bounceOut': {
      const n1 = 7.5625; const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) { const u = t - 1.5 / d1; return n1 * u * u + 0.75; }
      if (t < 2.5 / d1) { const u = t - 2.25 / d1; return n1 * u * u + 0.9375; }
      const u = t - 2.625 / d1; return n1 * u * u + 0.984375;
    }
    default: return t;
  }
}

/* ───────── Rendering ───────── */

const FONT_STACKS: Record<string, string> = {
  sans: '"Inter","Hind Siliguri","Noto Sans Bengali","Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  serif: '"Playfair Display","Noto Serif Bengali",Georgia,"Times New Roman",serif',
  display: '"Impact","Arial Black","Noto Sans Bengali",sans-serif',
  mono: '"JetBrains Mono","SFMono-Regular",Menlo,Consolas,monospace',
  script: '"Brush Script MT","Segoe Script","Snell Roundhand",cursive',
};

interface LocalState { p: number; exit: number; tx: number; ty: number; scale: number; rot: number; alpha: number; blur: number; clipX: number; clipY: number; draw: number }

type LoopSpec = z.infer<typeof LoopSchema>;

/** One loop effect. Eased in after the entrance so nothing pops; spin starts from 0 and can run backwards. */
function applyLoop(s: LocalState, loop: LoopSpec, enter: { at: number; dur: number }, t: number, H: number) {
  if (loop.preset === 'none') return;
  const t0 = enter.at + enter.dur * 0.6;
  if (t < t0) return;
  const act = Math.min(1, (t - t0) / 0.6);
  const k = act * act * (3 - 2 * act);
  const w = (loop.sync ? t : t - enter.at) * loop.speed * Math.PI * 2 * 0.25;
  const a = loop.amount;
  if (loop.preset === 'float') s.ty += Math.sin(w) * 0.012 * H * (0.5 + a * 2) * k;
  if (loop.preset === 'pulse') s.scale *= 1 + Math.sin(w * 1.6) * 0.04 * (0.5 + a * 2) * k;
  if (loop.preset === 'sway') s.rot += Math.sin(w) * 3 * (0.5 + a * 2) * k;
  if (loop.preset === 'spin') s.rot += (t - t0) * 40 * loop.speed * a;
  if (loop.preset === 'shimmer') s.alpha *= 1 - k * (1 - (0.82 + 0.18 * (0.5 + 0.5 * Math.sin(w * 2))));
}

function elementState(el: RecreateElement, t: number, unit: number, H: number): LocalState {
  const s: LocalState = { p: 1, exit: 0, tx: 0, ty: 0, scale: 1, rot: 0, alpha: 1, blur: 0, clipX: 1, clipY: 1, draw: 1 };
  const { enter, exit, loop } = el;
  const raw = (t - enter.at - unit) / enter.dur;
  const p = ease(enter.ease, raw);
  s.p = clamp01(raw) === 0 ? 0 : p;
  const inv = 1 - p;
  switch (enter.preset) {
    case 'none': s.p = t >= enter.at ? 1 : 0; break;
    case 'fade': s.alpha = p; break;
    case 'fadeUp': s.alpha = clamp01(raw * 1.6); s.ty = inv * 0.06 * H; break;
    case 'fadeDown': s.alpha = clamp01(raw * 1.6); s.ty = -inv * 0.06 * H; break;
    case 'slideLeft': s.alpha = clamp01(raw * 2); s.tx = inv * 0.12 * H; break;
    case 'slideRight': s.alpha = clamp01(raw * 2); s.tx = -inv * 0.12 * H; break;
    case 'scaleIn': s.alpha = clamp01(raw * 2); s.scale = 0.6 + 0.4 * p; break;
    case 'popBack': s.alpha = clamp01(raw * 3); s.scale = Math.max(0, p); break;
    case 'wipeRight': s.clipX = p; break;
    case 'wipeUp': s.clipY = p; break;
    case 'blurIn': s.alpha = clamp01(raw * 1.5); s.blur = inv * 0.02 * H; break;
    case 'rotateIn': s.alpha = clamp01(raw * 2); s.rot = -inv * 18; s.scale = 0.85 + 0.15 * p; break;
    case 'drawOn': s.draw = p; s.alpha = clamp01(raw * 5); break;
    default: break;
  }
  if (raw <= 0 && enter.preset !== 'none') { s.alpha = 0; s.clipX = enter.preset === 'wipeRight' ? 0 : s.clipX; }

  if (exit.preset !== 'none' && t >= exit.at) {
    const e = ease(exit.ease, (t - exit.at) / exit.dur);
    s.exit = e;
    s.alpha *= 1 - e;
    if (exit.preset === 'fadeUp') s.ty -= e * 0.05 * H;
    if (exit.preset === 'slideLeft') s.tx -= e * 0.12 * H;
    if (exit.preset === 'slideRight') s.tx += e * 0.12 * H;
    if (exit.preset === 'scaleOut') s.scale *= 1 - 0.25 * e;
  }

  applyLoop(s, loop, enter, t, H);
  applyLoop(s, el.loop2, enter, t, H);
  return s;
}

function paintBackground(ctx: CanvasRenderingContext2D, W: number, H: number, scene: RecreateScene, t: number) {
  const bg = scene.background;
  const cols = bg.colors.length ? bg.colors : ['#111318'];
  if (bg.type === 'solid' || cols.length === 1) {
    ctx.fillStyle = cols[0];
  } else if (bg.type === 'radial') {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
    cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c));
    ctx.fillStyle = g;
  } else {
    // slow drift of the gradient angle makes even a static design feel alive
    const a = ((bg.angle + Math.sin(t * 0.35) * 6) * Math.PI) / 180;
    const dx = Math.cos(a) * W / 2; const dy = Math.sin(a) * H / 2;
    const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c));
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, W, H);
  if (bg.vignette > 0) {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.55 * bg.vignette})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }
}

let grainTile: HTMLCanvasElement | null = null;
function paintGrain(ctx: CanvasRenderingContext2D, W: number, H: number, amount: number, frame: number) {
  if (!grainTile) {
    grainTile = document.createElement('canvas');
    grainTile.width = 256; grainTile.height = 256;
    const g = grainTile.getContext('2d');
    if (g) {
      const img = g.createImageData(256, 256);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    }
  }
  ctx.save();
  ctx.globalAlpha = 0.06 * amount;
  ctx.globalCompositeOperation = 'overlay';
  const ox = (frame * 37) % 256; const oy = (frame * 91) % 256;
  for (let x = -ox; x < W; x += 256) for (let y = -oy; y < H; y += 256) ctx.drawImage(grainTile, x, y);
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillStyleFor(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'shape' }>, x: number, y: number, w: number, h: number): string | CanvasGradient {
  if (!el.fill2) return el.fill;
  const a = (el.gradientAngle * Math.PI) / 180;
  const cx = x + w / 2; const cy = y + h / 2;
  const dx = Math.cos(a) * w / 2; const dy = Math.sin(a) * h / 2;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  g.addColorStop(0, el.fill); g.addColorStop(1, el.fill2);
  return g;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Blurred ellipse = soft glow. Drawn as a radial falloff instead of ctx.filter (Safari lacks it; 4K blur is slow). */
function drawGlow(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'shape' }>, w: number, h: number): boolean {
  const rgb = hexToRgb(el.fill);
  if (!rgb || el.shape !== 'ellipse' || el.blur <= 0) return false;
  const [r, g, b] = rgb;
  ctx.save();
  ctx.scale(1, h / w || 1);
  const rad = w / 2;
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
  const solid = Math.max(0, 1 - Math.min(0.95, el.blur * 9));
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(solid * 0.6, `rgba(${r},${g},${b},${0.85})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  return true;
}

function drawShape(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'shape' }>, w: number, h: number, st: LocalState, H: number) {
  const x = -w / 2; const y = -h / 2;
  if (drawGlow(ctx, el, w, h)) return;
  ctx.fillStyle = fillStyleFor(ctx, el, x, y, w, h);
  ctx.strokeStyle = el.stroke ?? 'transparent';
  ctx.lineWidth = el.strokeWidth * H;
  if (st.clipX < 1 || st.clipY < 1) { ctx.beginPath(); ctx.rect(x, y + h * (1 - st.clipY), w * st.clipX, h * st.clipY); ctx.clip(); }
  switch (el.shape) {
    case 'ellipse': ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); if (el.stroke) ctx.stroke(); break;
    case 'roundRect': roundRectPath(ctx, x, y, w, h, el.radius * Math.min(w, h)); ctx.fill(); if (el.stroke) ctx.stroke(); break;
    case 'triangle': ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); if (el.stroke) ctx.stroke(); break;
    case 'line': {
      ctx.strokeStyle = el.stroke ?? (typeof el.fill === 'string' ? el.fill : '#fff');
      ctx.lineWidth = Math.max(1, el.strokeWidth * H || h);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * st.draw, 0); ctx.stroke();
      break;
    }
    default: ctx.fillRect(x, y, w, h);
  }
}

interface PathInfo { len: number; p2d: Path2D | null; svg: SVGPathElement | null }
const pathCache = new Map<string, PathInfo>();

function pathInfo(d: string): PathInfo {
  const hit = pathCache.get(d);
  if (hit) return hit;
  const info: PathInfo = { len: 300, p2d: null, svg: null };
  try { if (typeof Path2D !== 'undefined') info.p2d = new Path2D(d); } catch { /* invalid path data */ }
  try {
    if (typeof document !== 'undefined') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.setAttribute('d', d);
      info.len = Math.max(1, svg.getTotalLength());
      info.svg = svg;
    }
  } catch { /* length falls back to an estimate */ }
  if (pathCache.size > 200) pathCache.clear();
  pathCache.set(d, info);
  return info;
}

function drawPath(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'path' }>, w: number, h: number, st: LocalState, H: number, t: number) {
  const info = pathInfo(el.d);
  if (!info.p2d) return;
  const k = Math.min(w, h) / 100;
  if (k <= 0) return;
  ctx.scale(k, k);
  ctx.translate(-50, -50);
  if (st.clipX < 1 || st.clipY < 1) { ctx.beginPath(); ctx.rect(0, 100 * (1 - st.clipY), 100 * st.clipX, 100 * st.clipY); ctx.clip(); }
  if (el.fill) {
    if (el.fill2) {
      const a = (el.gradientAngle * Math.PI) / 180;
      const g = ctx.createLinearGradient(50 - Math.cos(a) * 50, 50 - Math.sin(a) * 50, 50 + Math.cos(a) * 50, 50 + Math.sin(a) * 50);
      g.addColorStop(0, el.fill); g.addColorStop(1, el.fill2);
      ctx.fillStyle = g;
    } else ctx.fillStyle = el.fill;
    if (el.shadow > 0) { ctx.shadowColor = `rgba(0,0,0,${0.4 * el.shadow})`; ctx.shadowBlur = 0.035 * H * el.shadow; ctx.shadowOffsetY = 0.012 * H * el.shadow; }
    ctx.fill(info.p2d, el.fillRule);
    ctx.shadowColor = 'transparent';
  }
  const lw = (el.strokeWidth * H) / k;
  if (lw <= 0) return;
  ctx.lineCap = el.cap; ctx.lineJoin = 'round'; ctx.lineWidth = lw;
  if (el.stroke) {
    ctx.strokeStyle = el.stroke;
    ctx.setLineDash(st.draw < 1 ? [info.len * st.draw, info.len * 2] : []);
    ctx.stroke(info.p2d);
  }
  if (el.loop.preset === 'flow' && st.draw >= 1) {
    // a highlight that runs along the line, so the strand looks like colour is travelling through it
    const on = info.len * (0.1 + 0.12 * el.loop.amount);
    ctx.setLineDash([on, info.len * 0.25]);
    ctx.lineDashOffset = -(t - el.enter.at) * el.loop.speed * info.len * 0.22;
    ctx.strokeStyle = el.stroke2 ?? 'rgba(255,255,255,0.85)';
    ctx.stroke(info.p2d);
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
}

function followPoint(target: Extract<RecreateElement, { kind: 'path' }>, follow: NonNullable<RecreateElement['follow']>, t: number, W: number, H: number): { x: number; y: number; angle: number } | null {
  const info = pathInfo(target.d);
  if (!info.svg) return null;
  const u = (((follow.offset + t * follow.speed) % 1) + 1) % 1;
  const p = info.svg.getPointAtLength(u * info.len);
  const q = info.svg.getPointAtLength(Math.min(info.len, u * info.len + 1));
  const k = Math.min(target.w * W, target.h * H) / 100;
  const cx = (target.x + target.w / 2) * W; const cy = (target.y + target.h / 2) * H;
  return { x: cx + (p.x - 50) * k, y: cy + (p.y - 50) * k, angle: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI };
}

function drawCrop(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'crop' }>, w: number, h: number, st: LocalState, source: CanvasImageSource, sw: number, sh: number, t: number) {
  const x = -w / 2; const y = -h / 2;
  if (el.radius > 0) roundRectPath(ctx, x, y, w, h, el.radius * Math.min(w, h)); else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  ctx.clip();
  if (st.clipX < 1 || st.clipY < 1) { ctx.beginPath(); ctx.rect(x, y + h * (1 - st.clipY), w * st.clipX, h * st.clipY); ctx.clip(); }
  // slow push-in inside the frame (Ken Burns) so photographic parts never feel frozen
  const push = el.zoom + (el.loop.preset === 'none' ? 0.04 * Math.min(1, t / 8) : 0);
  let cw = el.sw * sw / push; let ch = el.sh * sh / push;
  const boxRatio = w / h;
  if (cw / ch > boxRatio) cw = ch * boxRatio; else ch = cw / boxRatio; // cover-fit: never stretch the artwork
  const cx = el.sx * sw + (el.sw * sw - cw) / 2; const cy = el.sy * sh + (el.sh * sh - ch) / 2;
  ctx.drawImage(source, cx, cy, cw, ch, x, y, w, h);
}

const rgba = (hex: string, a: number) => { const c = hexToRgb(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : `rgba(0,0,0,${a})`; };

function drawArtwork(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'artwork' }>, w: number, h: number, art: ArtworkData, st: LocalState, H: number) {
  const src = el.layer < 0 ? art.cutout : art.layers[el.layer];
  if (!src) return;
  const fit = Math.min(w / art.width, h / art.height);
  const dw = art.width * fit; const dh = art.height * fit;
  if (st.clipX < 1 || st.clipY < 1) { ctx.beginPath(); ctx.rect(-dw / 2, -dh / 2 + dh * (1 - st.clipY), dw * st.clipX, dh * st.clipY); ctx.clip(); }
  if (el.shadow) {
    ctx.shadowColor = rgba(el.shadow.color, el.shadow.alpha);
    ctx.shadowBlur = el.shadow.blur * H;
    ctx.shadowOffsetX = el.shadow.dx * H;
    ctx.shadowOffsetY = el.shadow.dy * H;
  }
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
}

let shineScratch: HTMLCanvasElement | null = null;
type ShineMask = Pick<ArtworkData, 'width' | 'height' | 'cutout' | 'center'>;

/** The union of all icon parts as one alpha mask, so light can sweep across ANY silhouette. */
function partsMask(parts: PartsData): ShineMask | null {
  const cutout = groupCanvas(parts, parts.comps.map((c) => c.id));
  if (!cutout) return null;
  const total = parts.comps.reduce((s, c) => s + c.area, 0) || 1;
  return { width: parts.width, height: parts.height, cutout, center: { x: parts.comps.reduce((s, c) => s + c.centroid.x * c.area, 0) / total, y: parts.comps.reduce((s, c) => s + c.centroid.y * c.area, 0) / total } };
}

function drawShine(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'shine' }>, w: number, h: number, art: ShineMask, t: number) {
  if (typeof document === 'undefined') return;
  if (!shineScratch) shineScratch = document.createElement('canvas');
  if (shineScratch.width !== art.width || shineScratch.height !== art.height) { shineScratch.width = art.width; shineScratch.height = art.height; }
  const sc = shineScratch.getContext('2d');
  if (!sc) return;
  const cw = art.width; const ch = art.height;
  const rgb = hexToRgb(el.color) ?? [255, 255, 255];
  const band = (a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const phase = (((t - el.enter.at) * el.speed) % 1 + 1) % 1;
  sc.globalCompositeOperation = 'source-over';
  sc.clearRect(0, 0, cw, ch);
  const conic = (sc as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
  if (el.mode === 'conic' && conic) {
    const grad = conic.call(sc, Math.PI * 2 * phase + (el.angle * Math.PI) / 180, art.center.x * cw, art.center.y * ch);
    grad.addColorStop(0, band(0));
    grad.addColorStop(el.width / 2, band(el.intensity));
    grad.addColorStop(Math.min(0.999, el.width), band(0));
    grad.addColorStop(1, band(0));
    sc.fillStyle = grad;
  } else {
    const a = (el.angle * Math.PI) / 180;
    const dx = Math.cos(a); const dy = Math.sin(a);
    const len = Math.abs(cw * dx) + Math.abs(ch * dy);
    const cx = cw / 2; const cy = ch / 2;
    const grad = sc.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
    const c = phase * (1 + el.width) - el.width / 2;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    grad.addColorStop(0, band(0));
    grad.addColorStop(clamp(c - el.width / 2), band(0));
    grad.addColorStop(clamp(c), band(el.intensity));
    grad.addColorStop(clamp(c + el.width / 2), band(0));
    grad.addColorStop(1, band(0));
    sc.fillStyle = grad;
  }
  sc.fillRect(0, 0, cw, ch);
  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(art.cutout, 0, 0);
  sc.globalCompositeOperation = 'source-over';
  const fit = Math.min(w / cw, h / ch);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(shineScratch, (-cw * fit) / 2, (-ch * fit) / 2, cw * fit, ch * fit);
  ctx.globalCompositeOperation = 'source-over';
}

/* ───────── Procedural ribbons ───────── */

interface CurveDef { closed: boolean; f: (a: number) => [number, number]; z: (a: number) => number }
const TAU = Math.PI * 2;
const CURVE_DEFS: Record<string, CurveDef> = {
  infinity: { closed: true, f: (a) => { const d = 1 + Math.sin(a) ** 2; return [Math.cos(a) / d, (1.5 * Math.sin(a) * Math.cos(a)) / d]; }, z: (a) => Math.sin(a) },
  circle: { closed: true, f: (a) => [Math.cos(a), Math.sin(a)], z: () => 0 },
  trefoil: { closed: true, f: (a) => [Math.sin(a) + 2 * Math.sin(2 * a), Math.cos(a) - 2 * Math.cos(2 * a)], z: (a) => -Math.sin(3 * a) },
  heart: { closed: true, f: (a) => [16 * Math.sin(a) ** 3, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))], z: () => 0 },
  wave: { closed: false, f: (a) => [a / Math.PI - 1, 0.42 * Math.sin(1.5 * a)], z: (a) => Math.cos(1.5 * a) },
  rose: { closed: true, f: (a) => [Math.cos(3 * a) * Math.cos(a), Math.cos(3 * a) * Math.sin(a)], z: (a) => Math.sin(3 * a) },
  lissajous: { closed: true, f: (a) => [Math.cos(3 * a), Math.sin(2 * a)], z: (a) => Math.sin(5 * a) },
};
const boundsCache = new Map<string, { cx: number; cy: number; hw: number; hh: number }>();
function curveBounds(name: string) {
  const hit = boundsCache.get(name);
  if (hit) return hit;
  const def = CURVE_DEFS[name] ?? CURVE_DEFS.infinity;
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (let i = 0; i <= 256; i++) { const [x, y] = def.f((i / 256) * TAU); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const b = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: Math.max(1e-3, (x1 - x0) / 2), hh: Math.max(1e-3, (y1 - y0) / 2) };
  boundsCache.set(name, b);
  return b;
}
/** width / height of a curve's natural shape; scene builders use it to size the box. */
export function curveAspect(name: string): number { const b = curveBounds(name); return b.hw / b.hh; }

const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const css = (c: number[], a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
function paletteAt(cyc: number[][], v: number): number[] {
  const n = cyc.length;
  if (n === 1) return cyc[0];
  const p = (((v % 1) + 1) % 1) * n;
  const i = Math.floor(p) % n; const f = p - Math.floor(p); const k = f * f * (3 - 2 * f);
  const A = cyc[i]; const B = cyc[(i + 1) % n];
  return [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
}

interface RibbonSeg { x1: number; y1: number; x2: number; y2: number; x2o: number; y2o: number; z: number; col: number[]; strand: number; k: number; cap: boolean }

function drawRibbon(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'ribbon' }>, w: number, h: number, t: number, H: number) {
  const def = CURVE_DEFS[el.curve] ?? CURVE_DEFS.infinity;
  const b = curveBounds(el.curve);
  const scale = Math.min(w / (2 * b.hw), h / (2 * b.hh));
  const th = el.thickness * H;
  const S = el.strands;
  const N = def.closed ? 160 : 130;
  const cols = el.colors.map((c) => hexToRgb(c) ?? [255, 255, 255]);
  const cyc = cols.length > 2 ? [...cols, ...cols.slice(1, -1).reverse()] : cols;
  const sway = el.sway * 0.02 * Math.min(w, h);
  const segs: RibbonSeg[] = [];
  const centre: Array<[number, number]> = [];

  for (let s = 0; s < S; s++) {
    const strandProg = el.enter.preset === 'drawOn' ? ease(el.enter.ease, (t - el.enter.at - s * 0.22) / el.enter.dur) : 1;
    if (strandProg <= 0) continue;
    const pts: Array<{ x: number; y: number; z: number; u: number }> = [];
    for (let k = 0; k <= N; k++) {
      const u = k / N; const a = u * TAU;
      const [x, y] = def.f(a); const [x2, y2] = def.f(a + 0.002);
      let tx = x2 - x; let ty = y2 - y; const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      const nx = -ty; const ny = tx;
      const bp = u * TAU * el.braidFreq + (s * TAU) / S - t * 0.6;
      const off = ((s - (S - 1) / 2) * el.spread + el.braid * Math.sin(bp)) * th + sway * Math.sin(2 * a - t * 1.1 + s);
      const px = (x - b.cx) * scale + nx * off; const py = (y - b.cy) * scale + ny * off;
      pts.push({ x: px, y: py, z: def.z(a) * 2 + (el.braid > 0 ? Math.cos(bp) : 0), u });
      if (s === 0 && k < N) centre.push([(x - b.cx) * scale, (y - b.cy) * scale]);
    }
    if (el.glow > 0) {
      const mid = paletteAt(cyc, 0.4);
      ctx.save();
      ctx.shadowColor = css(mid, 0.55 * el.glow); ctx.shadowBlur = th * 1.6; ctx.strokeStyle = css(mid, 0.0001); ctx.lineWidth = th * 0.6;
      ctx.beginPath();
      pts.forEach((p, k) => { if (p.u <= strandProg) { if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } });
      ctx.stroke();
      ctx.restore();
    }
    for (let k = 0; k < N; k++) {
      const a = pts[k]; const c = pts[k + 1];
      if (a.u >= strandProg) break;
      const col = paletteAt(cyc, a.u + t * el.flow + s * 0.07);
      const ex = (c.x - a.x) * 0.18; const ey = (c.y - a.y) * 0.18; // tiny overlap hides hairline gaps between segments
      const cap = (strandProg < 1 && (k === 0 || c.u >= strandProg)) || (!def.closed && (k === 0 || k === N - 1)); // round only at real line ends
      segs.push({ x1: a.x, y1: a.y, x2: c.x + ex, y2: c.y + ey, x2o: c.x, y2o: c.y, z: (a.z + c.z) / 2, col, strand: s, k, cap });
    }
  }
  if (!segs.length) return;

  // depth bands: shadows of a nearer band fall on bands below it, never on its own body
  let zmin = Infinity; let zmax = -Infinity;
  for (const g of segs) { zmin = Math.min(zmin, g.z); zmax = Math.max(zmax, g.z); }
  const BANDS = 8;
  const bands: RibbonSeg[][] = Array.from({ length: BANDS }, () => []);
  for (const g of segs) bands[Math.min(BANDS - 1, Math.floor(((g.z - zmin) / (zmax - zmin + 1e-6)) * BANDS))].push(g);

  ctx.lineJoin = 'round';
  const line = (g: RibbonSeg) => { ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke(); };
  // consecutive segments of one strand inside one depth band become ONE polyline, so translucent
  // passes (shadow, edge, gloss) are a single stroke each and leave no seams or beads at the joins
  const runsOf = (band: RibbonSeg[]) => {
    const runs: RibbonSeg[][] = [];
    for (const g of band) {
      const run = runs[runs.length - 1];
      const prev = run?.[run.length - 1];
      if (prev && prev.strand === g.strand && prev.k + 1 === g.k) run.push(g); else runs.push([g]);
    }
    return runs;
  };
  const trace = (run: RibbonSeg[], dx = 0, dy = 0) => {
    ctx.beginPath();
    ctx.moveTo(run[0].x1 + dx, run[0].y1 + dy);
    for (const g of run) ctx.lineTo(g.x2o + dx, g.y2o + dy);
    ctx.stroke();
  };
  for (const band of bands) {
    if (!band.length) continue;
    const runs = runsOf(band);
    ctx.lineCap = 'butt'; // round caps at depth-band joints draw dark crescents over the neighbouring segment
    if (el.shadow > 0) { ctx.lineWidth = th * 1.1; ctx.strokeStyle = `rgba(0,0,0,${0.3 * el.shadow})`; for (const run of runs) trace(run, th * 0.12, th * 0.22); }
    ctx.lineWidth = th * 1.07; ctx.strokeStyle = 'rgba(8,8,24,0.5)'; for (const run of runs) trace(run);
    ctx.lineWidth = th * 0.92;
    for (const g of band) { ctx.lineCap = g.cap ? 'round' : 'butt'; ctx.strokeStyle = css(g.col); line(g); }
    ctx.lineCap = 'butt';
    if (el.gloss > 0) { ctx.lineWidth = th * 0.24; ctx.strokeStyle = `rgba(255,255,255,${0.4 * el.gloss})`; for (const run of runs) trace(run, -th * 0.17, -th * 0.2); }
  }

  if (el.sparkles > 0 && centre.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let m = 0; m < el.sparkles; m++) {
      const u = (hash(m + el.seed) + t * (0.03 + 0.07 * hash(m * 3 + el.seed))) % 1;
      const [x, y] = centre[Math.floor(u * (centre.length - 1))];
      const r = th * (0.25 + 0.5 * hash(m * 7 + el.seed)) * (0.65 + 0.35 * Math.sin(t * 3 + m));
      const c = paletteAt(cyc, u + 0.5);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, css(c, 0.55)); g.addColorStop(1, css(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

interface TextUnit { text: string; x: number; line: number; width: number }

function drawText(ctx: CanvasRenderingContext2D, el: Extract<RecreateElement, { kind: 'text' }>, w: number, _h: number, t: number, H: number) {
  const fontSize = el.size * H;
  const style = `${el.italic ? 'italic ' : ''}${Math.round(el.weight)} ${fontSize}px ${FONT_STACKS[el.font] ?? FONT_STACKS.sans}`;
  ctx.font = style;
  ctx.textBaseline = 'alphabetic';
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${el.letterSpacing * fontSize}px`;
  const raw = el.uppercase ? el.text.toUpperCase() : el.text;

  // wrap to the element box width
  const lines: string[] = [];
  for (const para of raw.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(test).width > w * 1.02 && cur) { lines.push(cur); cur = word; } else cur = test;
    }
    lines.push(cur);
  }
  const lh = fontSize * el.lineHeight;
  const total = lines.length * lh;
  const startY = -total / 2 + fontSize * 0.85;
  const units: TextUnit[] = [];
  lines.forEach((line, li) => {
    const lw = ctx.measureText(line).width;
    const baseX = el.align === 'left' ? -w / 2 : el.align === 'right' ? w / 2 - lw : -lw / 2;
    if (el.enter.split === 'none' || el.enter.split === 'line') { units.push({ text: line, x: baseX, line: li, width: lw }); return; }
    if (el.enter.split === 'word') {
      let x = baseX;
      for (const word of line.split(' ')) { const ww = ctx.measureText(`${word} `).width; units.push({ text: word, x, line: li, width: ww }); x += ww; }
    } else {
      let x = baseX;
      for (const ch of Array.from(line)) { const cw = ctx.measureText(ch).width; units.push({ text: ch, x, line: li, width: cw }); x += cw; }
    }
  });
  ctx.fillStyle = el.color;
  if (el.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = fontSize * 0.25; ctx.shadowOffsetY = fontSize * 0.06; }
  units.forEach((u, i) => {
    const delay = el.enter.split === 'line' ? u.line * el.enter.stagger * 4 : i * el.enter.stagger;
    const st = elementState(el, t, el.enter.split === 'none' ? 0 : delay, H);
    const py = startY + u.line * lh;
    ctx.save();
    ctx.globalAlpha *= st.alpha;
    if (st.blur > 0.2) ctx.filter = `blur(${st.blur}px)`;
    if (el.enter.split === 'none') {
      if (st.clipX < 1 || st.clipY < 1) { ctx.beginPath(); ctx.rect(-w / 2 - 20, -total / 2 - fontSize * 0.2 + total * (1 - st.clipY), (w + 40) * st.clipX, total + fontSize * 0.5); ctx.clip(); }
      ctx.fillText(u.text, u.x, py);
    } else {
      const cx = u.x + u.width / 2;
      ctx.translate(cx + st.tx, py + st.ty);
      ctx.rotate((st.rot * Math.PI) / 180);
      ctx.scale(st.scale, st.scale);
      ctx.fillText(u.text, -u.width / 2, 0);
    }
    ctx.restore();
  });
  ctx.shadowColor = 'transparent';
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
}

export interface RecreateRenderInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  scene: RecreateScene;
  /** time in seconds on the editor timeline (0..settings.duration) */
  time: number;
  /** editor duration; scene timings are stretched to fit it */
  editorDuration: number;
  source: CanvasImageSource | null;
  sourceWidth: number;
  sourceHeight: number;
  /** Extracted artwork layers; required for `artwork` and `shine` elements. */
  artwork?: ArtworkData | null;
  /** Extracted icon parts; required for `part` elements. */
  parts?: PartsData | null;
}

type PartEl = Extract<RecreateElement, { kind: 'part' }>;

/** Continuous motion for icon parts. Starts at t = 0 with no jump, so entrances never fight the loop. */
function applyPartMotion(st: LocalState, el: PartEl, t: number, H: number) {
  const m = el.motion; const TAU = Math.PI * 2;
  if (m.spin) st.rot += m.spin * t;
  if (m.pulse) st.scale *= 1 + m.pulse * Math.sin(TAU * (t / m.pulsePeriod + m.phase));
  if (m.float) st.ty += Math.sin(TAU * (t / m.floatPeriod + m.phase)) * m.float * H;
  if (m.sway) st.rot += Math.sin(TAU * (t / m.swayPeriod + m.phase)) * m.sway;
  if (m.bounce) st.ty -= Math.abs(Math.sin(Math.PI * (t / m.bouncePeriod + m.phase))) * m.bounce * H;
}

/* ───────── "drawn from start to finish": a reveal that follows the shape itself ───────── */

interface TraceMap { w: number; h: number; rgba: Uint8ClampedArray; dist: Uint8Array; out: ImageData; scratch: HTMLCanvasElement; last: number }
const traceMaps = new WeakMap<object, TraceMap | null>();
const FEATHER = 0.07;

/**
 * Geodesic distance inside the artwork, measured from one end of each connected piece. Revealing pixels in order of that
 * distance looks like a pen drawing the stroke from its start to its end (a ring is drawn from both sides of the start).
 */
function buildTraceMap(cv: HTMLCanvasElement): TraceMap | null {
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  const w = cv.width; const h = cv.height; const N = w * h;
  const rgba = g.getImageData(0, 0, w, h).data;
  const solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] > 40) solid[i] = 1;
  const dist = new Uint8Array(N).fill(255);
  const queue = new Int32Array(N);
  const tmp = new Int32Array(N);
  const region = new Int32Array(N);
  const seen = new Uint8Array(N);
  const NB = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  const neighbours = (p: number, f: (q: number) => void) => {
    const x = p % w; const y = (p - x) / w;
    for (let k = 0; k < 8; k++) {
      const dx = k === 0 || k === 4 || k === 6 ? -1 : k === 1 || k === 5 || k === 7 ? 1 : 0;
      const dy = k === 2 || k === 4 || k === 5 ? -1 : k === 3 || k === 6 || k === 7 ? 1 : 0;
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = p + NB[k];
      if (solid[q]) f(q);
    }
  };
  // breadth-first distance from `from` over the pixels of one region; returns the farthest pixel and its distance
  const bfs = (from: number, count: number): { far: number; max: number } => {
    for (let i = 0; i < count; i++) tmp[region[i]] = -1;
    let head = 0; let tail = 0; queue[tail++] = from; tmp[from] = 0;
    let far = from; let max = 0;
    while (head < tail) {
      const p = queue[head++]; const d = tmp[p];
      if (d > max) { max = d; far = p; }
      neighbours(p, (q) => { if (tmp[q] === -1) { tmp[q] = d + 1; queue[tail++] = q; } });
    }
    return { far, max };
  };
  tmp.fill(-2);
  let any = false;
  for (let s = 0; s < N; s++) {
    if (!solid[s] || seen[s]) continue;
    let count = 0; let head = 0; let tail = 0; let sx = 0; let sy = 0;
    queue[tail++] = s; seen[s] = 1;
    while (head < tail) { const p = queue[head++]; region[count++] = p; sx += p % w; sy += Math.floor(p / w); neighbours(p, (q) => { if (!seen[q]) { seen[q] = 1; queue[tail++] = q; } }); }
    if (count < 4) continue;
    any = true;
    const cx = sx / count; const cy = sy / count;
    let seed = region[0]; let best = Infinity;
    for (let i = 0; i < count; i++) { const p = region[i]; const d = (p % w - cx) ** 2 + (Math.floor(p / w) - cy) ** 2; if (d < best) { best = d; seed = p; } }
    const a = bfs(seed, count); // farthest pixel from the middle = one end of the shape
    const b = bfs(a.far, count); // distances measured from that end
    const max = Math.max(1, b.max);
    for (let i = 0; i < count; i++) { const p = region[i]; dist[p] = Math.min(254, Math.round((tmp[p] / max) * 254)); }
  }
  if (!any) return null;
  const scratch = document.createElement('canvas');
  scratch.width = w; scratch.height = h;
  return { w, h, rgba, dist, out: new ImageData(w, h), scratch, last: -1 };
}

function drawTraced(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, dw: number, dh: number, progress: number) {
  let m = traceMaps.get(cv);
  if (m === undefined) { m = typeof document === 'undefined' ? null : buildTraceMap(cv); traceMaps.set(cv, m); }
  if (!m) { ctx.drawImage(cv, -dw / 2, -dh / 2, dw, dh); return; }
  const q = Math.round(Math.min(1, Math.max(0, progress)) * 240) / 240;
  if (m.last !== q) {
    const { rgba, dist, out } = m; const o = out.data; const N = m.w * m.h;
    const front = q * (1 + FEATHER);
    for (let i = 0; i < N; i++) {
      const a = rgba[i * 4 + 3];
      const j = i * 4;
      if (!a) { o[j + 3] = 0; continue; }
      const d = dist[i] === 255 ? 1 : dist[i] / 254;
      const r = Math.min(1, Math.max(0, (front - d) / FEATHER));
      if (r <= 0) { o[j + 3] = 0; continue; }
      const glow = q < 1 ? Math.max(0, 1 - Math.abs(front - d - FEATHER * 0.35) / (FEATHER * 1.3)) * 0.55 : 0; // bright pen tip at the front
      o[j] = rgba[j] + (255 - rgba[j]) * glow; o[j + 1] = rgba[j + 1] + (255 - rgba[j + 1]) * glow; o[j + 2] = rgba[j + 2] + (255 - rgba[j + 2]) * glow;
      o[j + 3] = a * r;
    }
    m.scratch.getContext('2d')?.putImageData(out, 0, 0);
    m.last = q;
  }
  ctx.drawImage(m.scratch, -dw / 2, -dh / 2, dw, dh);
}

function drawPart(ctx: CanvasRenderingContext2D, el: PartEl, w: number, h: number, parts: PartsData, t: number, draw = 1) {
  const cv = groupCanvas(parts, el.comps);
  if (!cv) return;
  const fit = Math.min(w / parts.width, h / parts.height);
  const dw = parts.width * fit; const dh = parts.height * fit;
  const m = el.motion;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (draw < 1) { drawTraced(ctx, cv, dw, dh, draw); return; } // still being drawn: no echo / tilt yet
  if (m.echo > 0) { // expanding ghost copies of the silhouette
    const copies = 3;
    for (let i = 0; i < copies; i++) {
      const ph = (t / 3.2 + i / copies) % 1;
      ctx.save();
      ctx.globalAlpha *= m.echo * 0.34 * (1 - ph) * Math.min(1, ph * 6);
      const k = 1 + ph * 0.32;
      ctx.scale(k, k);
      ctx.drawImage(cv, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
  }
  if (m.tilt > 0) { // card-turn: squeeze in x with a little skew, like the icon swinging around its vertical axis
    const th = (Math.sin(Math.PI * 2 * (t / m.tiltPeriod + m.phase)) * m.tilt * Math.PI) / 180;
    ctx.transform(Math.cos(th), Math.sin(th) * 0.1, 0, 1, 0, 0);
  }
  ctx.drawImage(cv, -dw / 2, -dh / 2, dw, dh);
  if (m.shine > 0 || m.conic > 0) {
    const ramp = Math.min(1, Math.max(0, (t - m.shineAt) / 0.6));
    if (ramp > 0) {
      const mask: ShineMask = { width: parts.width, height: parts.height, cutout: cv, center: partsMask(parts)?.center ?? { x: 0.5, y: 0.5 } };
      const base = { kind: 'shine', color: '#ffffff', speed: m.shineSpeed, enter: { at: m.shineAt } } as unknown as Extract<RecreateElement, { kind: 'shine' }>;
      if (m.shine > 0) drawShine(ctx, { ...base, mode: 'linear', angle: 24, width: 0.22, intensity: m.shine * ramp }, w, h, mask, t);
      if (m.conic > 0) drawShine(ctx, { ...base, mode: 'conic', angle: 0, width: 0.14, intensity: m.conic * ramp }, w, h, mask, t);
    }
  }
}

export function renderRecreate(input: RecreateRenderInput): void {
  const { ctx, width: W, height: H, scene, source, sourceWidth, sourceHeight, artwork, parts } = input;
  const t = input.time * (scene.duration / Math.max(0.1, input.editorDuration));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  paintBackground(ctx, W, H, scene, t);

  if (scene.camera.push > 0 || scene.camera.drift > 0) {
    const k = 1 + scene.camera.push * Math.min(1, t / Math.max(0.1, scene.duration));
    ctx.translate(W / 2 + Math.sin(t * 0.35) * scene.camera.drift * W, H / 2 + Math.cos(t * 0.27) * scene.camera.drift * H * 0.5);
    ctx.scale(k, k);
    ctx.translate(-W / 2, -H / 2);
  }
  const sorted = [...scene.elements].sort((a, b) => a.z - b.z);
  const pathById = new Map<string, Extract<RecreateElement, { kind: 'path' }>>();
  for (const e of scene.elements) if (e.kind === 'path') pathById.set(e.id, e);
  for (const el of sorted) {
    const w = el.w * W; const h = el.h * H;
    const baseCx = (el.x + el.w / 2) * W; const baseCy = (el.y + el.h / 2) * H;
    const pvx = el.pivot ? el.pivot.x * W : baseCx; const pvy = el.pivot ? el.pivot.y * H : baseCy;
    let cx = pvx; let cy = pvy; // the anchor that moves / scales / rotates (the element's own centre unless it has a pivot)
    let followRot = 0;
    const target = el.follow ? pathById.get(el.follow.path) : undefined;
    if (el.follow && target) {
      const pos = followPoint(target, el.follow, t, W, H);
      if (pos) { cx = pos.x; cy = pos.y; followRot = el.follow.align ? pos.angle : 0; }
    }
    const textSplit = el.kind === 'text' && el.enter.split !== 'none';
    const st = elementState(el, t, 0, H);
    if (el.kind === 'part') applyPartMotion(st, el, t, H);
    if (!textSplit && st.alpha <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = el.opacity * (textSplit ? 1 : st.alpha);
    ctx.translate(cx + (textSplit ? 0 : st.tx), cy + (textSplit ? 0 : st.ty));
    ctx.rotate(((el.rotation + followRot + (textSplit ? 0 : st.rot)) * Math.PI) / 180);
    if (!textSplit) ctx.scale(st.scale, st.scale);
    if (baseCx !== pvx || baseCy !== pvy) ctx.translate(baseCx - pvx, baseCy - pvy);
    const isGlow = el.kind === 'shape' && el.shape === 'ellipse' && el.blur > 0 && hexToRgb(el.fill) !== null;
    const blurPx = (isGlow ? 0 : el.blur * H) + (textSplit ? 0 : st.blur);
    if (blurPx > 0.3) ctx.filter = `blur(${blurPx}px)`;
    if (el.kind === 'shape') drawShape(ctx, el, w, h, st, H);
    else if (el.kind === 'path') drawPath(ctx, el, w, h, st, H, t);
    else if (el.kind === 'ribbon') drawRibbon(ctx, el, w, h, t, H);
    else if (el.kind === 'part' && parts) drawPart(ctx, el, w, h, parts, t, st.draw);
    else if (el.kind === 'artwork' && artwork) drawArtwork(ctx, el, w, h, artwork, st, H);
    else if (el.kind === 'shine') { const mask = artwork ?? (parts ? partsMask(parts) : null); if (mask) drawShine(ctx, el, w, h, mask, t); }
    else if (el.kind === 'crop' && source) drawCrop(ctx, el, w, h, st, source, sourceWidth, sourceHeight, t);
    else if (el.kind === 'text') {
      if (textSplit) {
        // split text computes per-unit state itself; apply loop/exit alpha at element level
        const outer = elementState({ ...el, enter: { ...el.enter, preset: 'none', at: 0 } }, t, 0, H);
        ctx.globalAlpha = el.opacity * outer.alpha;
        ctx.translate(outer.tx, outer.ty);
        ctx.scale(outer.scale, outer.scale);
      }
      drawText(ctx, el, w, h, t, H);
    }
    ctx.restore();
  }
  if (scene.background.grain > 0) paintGrain(ctx, W, H, scene.background.grain, Math.floor(t * 24));
  ctx.restore();
}
