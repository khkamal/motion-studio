import { RecreateSceneSchema, type RecreateScene } from './recreate';
import type { PartsMeta } from './parts';

/**
 * "Animate icon": the icon's OWN parts (cloud outline, each arrow ...) become rigid groups and get the motion the
 * person asked for. Colours, gradients and silhouette are never redrawn or recoloured.
 * The plan (which part moves how) comes from a vision model or, offline, from the words of the prompt.
 */
export type MotionType = 'spin' | 'pulse' | 'float' | 'sway' | 'bounce' | 'none';
export interface MotionSpec { type: MotionType; amount?: number; period?: number; dps?: number; direction?: 'cw' | 'ccw' }
export interface IconGroup { name: string; components: number[]; motions: MotionSpec[] }
export type IconBackground = 'keep' | 'dark' | 'light' | 'colorful';
export interface IconPlan { name?: string; background?: IconBackground; entrance?: 'pop' | 'fade' | 'draw' | 'none'; groups: IconGroup[]; /** true when the person (or the AI reading their words) specified the motion */ described?: boolean; /** whole-silhouette effects the description asked for */ effects?: IconEffect[] }
export type IconEffect = 'light' | 'echo' | 'sparkles' | 'tilt';
const EFFECTS: IconEffect[] = ['light', 'echo', 'sparkles', 'tilt'];

/** Effects that work on ANY silhouette, so even a one-piece icon (no parts to move) never ends up static. */
export interface IconFx { shine: number; conic: number; echo: number; tilt: number; sparkles: number }
export const FX_SUBTLE: IconFx = { shine: 0.3, conic: 0, echo: 0, tilt: 0, sparkles: 0 };
export const FX_RICH: IconFx = { shine: 0.6, conic: 0.55, echo: 0.8, tilt: 16, sparkles: 8 };

/** What brings an icon to life when the person did not describe a motion. Described motion is never overridden. */
export function pickFx(plan: IconPlan, rand: () => number = Math.random, boost = false): IconFx {
  if (plan.described) { // honour what was described: only the effects it named, nothing extra
    const e = plan.effects ?? [];
    return { shine: e.includes('light') ? 0.6 : FX_SUBTLE.shine, conic: e.includes('light') ? 0.5 : 0, echo: e.includes('echo') ? 0.8 : 0, tilt: e.includes('tilt') ? 16 : 0, sparkles: e.includes('sparkles') ? 7 : 0 };
  }
  if (boost) return FX_RICH;
  if (plan.groups.length <= 1) { // a single piece: nothing inside can move, so the whole silhouette gets the life
    const r = rand();
    if (r < 0.34) return { shine: 0.6, conic: 0.5, echo: 0.8, tilt: 0, sparkles: 6 };
    if (r < 0.67) return { shine: 0.55, conic: 0, echo: 0, tilt: 18, sparkles: 5 };
    return { shine: 0.5, conic: 0.55, echo: 0.5, tilt: 12, sparkles: 7 };
  }
  return { shine: 0.5, conic: rand() < 0.5 ? 0.4 : 0, echo: 0, tilt: 0, sparkles: rand() < 0.5 ? 5 : 0 };
}

const MOTION_TYPES: MotionType[] = ['spin', 'pulse', 'float', 'sway', 'bounce', 'none'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ───────── grouping ───────── */

type Meta = Pick<PartsMeta, 'comps'>;

/** Largest solid piece = body. Pieces fully inside the body (arrows, a glyph, see-through shapes) = detail. */
export function defaultGrouping(meta: Meta): IconGroup[] {
  const solids = meta.comps.filter((c) => !c.hole);
  const body = [...(solids.length ? solids : meta.comps)].sort((a, b) => b.area - a.area)[0];
  if (!body) return [];
  const inx = body.bbox.w * 0.08; const iny = body.bbox.h * 0.08;
  const inside = (c: Meta['comps'][number]) => c.id !== body.id
    && c.bbox.x >= body.bbox.x + inx && c.bbox.y >= body.bbox.y + iny
    && c.bbox.x + c.bbox.w <= body.bbox.x + body.bbox.w - inx && c.bbox.y + c.bbox.h <= body.bbox.y + body.bbox.h - iny;
  const inner = meta.comps.filter(inside).map((c) => c.id);
  const rest = meta.comps.filter((c) => c.id === body.id || !inner.includes(c.id)).map((c) => c.id);
  if (!inner.length) return [{ name: 'icon', components: meta.comps.map((c) => c.id), motions: [] }];
  return [{ name: 'body', components: rest, motions: [] }, { name: 'inner', components: inner, motions: [] }];
}

/* ───────── keyword planner (works without any AI key) ───────── */

const RX = {
  inner: /\b(arrows?|inner|inside|centre|center|gears?|wheel|sync|refresh|symbol|needle|hands?|dots?|sparkles?|star|bolt|check|tick|glyph)\b/i,
  base: /\b(cloud|outer|body|frame|outline|container|shell|shape|badge|shield|card|bubble)\b/i,
  all: /\b(icon|logo|whole|entire|everything|image|all)\b/i,
  spin: /\b(spin\w*|rotat\w*|revolv\w*|turn\w*|whirl\w*)\b/i,
  pulse: /\b(puls\w*|breath\w*|throb\w*|expand\w*|contract\w*|heartbeat)\b/i,
  float: /\b(float\w*|hover\w*|levitat\w*|drift\w*|bob\w*)\b/i,
  sway: /\b(sway\w*|swing\w*|wobbl\w*|tilt\w*|rock\w*|oscillat\w*)\b/i,
  bounce: /\b(bounc\w*|hop\w*|jump\w*)\b/i,
  slow: /\b(slow\w*|gentle|gently|subtle|soft\w*|calm|barely)\b/i,
  veryLight: /\b(very subtle|barely|slight\w*)\b/i,
  fast: /\b(fast|quick\w*|rapid\w*|energetic|snappy)\b/i,
  ccw: /\b(counter[- ]?clockwise|anti[- ]?clockwise|reverse\w*|backward\w*)\b/i,
  draw: /\b(draw\w*|trac\w*|reveal\w*|strok\w*|write|writes|writing|start to (finish|end)|beginning to (the )?end)\b/i,
  light: /\b(light|shin\w*|glow\w*|glint\w*|sweep\w*|flow\w*|travel\w*|highlight\w*)\b/i,
  echo: /\b(ripple\w*|echo\w*|rings?|shockwave\w*)\b/i,
  sparkles: /\b(sparkl\w*|particles?|glitter\w*|dust)\b/i,
  tilt: /\b(3d|tilt\w*|flip\w*|turntable)\b/i,
};

export function backgroundFromText(text: string): IconBackground | undefined {
  if (/\b(dark|black|night|neon|cyber)\b/i.test(text)) return 'dark';
  if (/\b(colou?rful|vibrant|gradient background)\b/i.test(text)) return 'colorful';
  if (/\b(light|bright|pastel|soft background)\b/i.test(text)) return 'light';
  if (/\b(keep|same|original|white|transparent)\b.*\bbackground\b/i.test(text)) return 'keep';
  return undefined;
}

export function planFromKeywords(prompt: string, meta: Meta): IconPlan {
  const groups = defaultGrouping(meta);
  const plan: IconPlan = { groups, background: backgroundFromText(prompt) };
  const innerGroup = groups.find((g) => g.name === 'inner');
  const bodyGroup = groups.find((g) => g.name === 'body') ?? groups[0];
  let any = false;
  for (const sentence of prompt.split(/[.;\n!]+/)) {
    const found: Array<{ key: 'inner' | 'base' | 'all'; at: number }> = [];
    for (const key of ['inner', 'base', 'all'] as const) { const m = RX[key].exec(sentence); if (m) found.push({ key, at: m.index }); }
    found.sort((a, b) => a.at - b.at);
    const target = found[0]?.key ?? 'all';
    const targets = target === 'inner' ? [innerGroup ?? bodyGroup] : target === 'base' ? [bodyGroup] : groups;
    const light = RX.slow.test(sentence); const veryLight = RX.veryLight.test(sentence); const quick = RX.fast.test(sentence);
    const add = (spec: MotionSpec) => { any = true; for (const g of targets) if (g) g.motions.push({ ...spec }); };
    if (RX.spin.test(sentence)) add({ type: 'spin', dps: quick ? 180 : light ? 45 : 90, direction: RX.ccw.test(sentence) ? 'ccw' : 'cw' });
    if (RX.pulse.test(sentence)) add({ type: 'pulse', amount: veryLight ? 0.025 : quick ? 0.08 : light ? 0.035 : 0.05, period: quick ? 2 : 4 });
    if (RX.float.test(sentence)) add({ type: 'float', amount: quick ? 0.03 : 0.018, period: quick ? 2 : 4 });
    if (RX.sway.test(sentence)) add({ type: 'sway', amount: quick ? 12 : 7, period: quick ? 2 : 4 });
    if (RX.bounce.test(sentence)) add({ type: 'bounce', amount: 0.05, period: 1 });
  }
  if (!any) { // nothing described: a gentle, tasteful default
    if (innerGroup) { bodyGroup.motions.push({ type: 'pulse', amount: 0.03, period: 4 }); innerGroup.motions.push({ type: 'sway', amount: 6, period: 4 }); } else bodyGroup.motions.push({ type: 'pulse', amount: 0.03, period: 4 }, { type: 'float', amount: 0.012, period: 4 });
  }
  const effects = EFFECTS.filter((e) => RX[e === 'light' ? 'light' : e === 'echo' ? 'echo' : e === 'sparkles' ? 'sparkles' : 'tilt'].test(prompt));
  const drawn = RX.draw.test(prompt);
  if (drawn) plan.entrance = 'draw';
  plan.effects = effects;
  plan.described = any || effects.length > 0 || drawn;
  return plan;
}

/* ───────── AI plan sanitiser ───────── */

export function normalizePlan(raw: unknown, meta: Meta): IconPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const validIds = new Set(meta.comps.map((c) => c.id));
  const used = new Set<number>();
  const groups: IconGroup[] = [];
  for (const g of Array.isArray(p.groups) ? p.groups : []) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const components = (Array.isArray(o.components) ? o.components : []).map(Number).filter((i) => Number.isInteger(i) && validIds.has(i) && !used.has(i));
    if (!components.length) continue;
    components.forEach((i) => used.add(i));
    const motions: MotionSpec[] = [];
    for (const m of Array.isArray(o.motions) ? o.motions : []) {
      if (!m || typeof m !== 'object') continue;
      const mm = m as Record<string, unknown>;
      const type = String(mm.type ?? 'none').toLowerCase() as MotionType;
      if (!MOTION_TYPES.includes(type) || type === 'none') continue;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      motions.push({ type, amount: num(mm.amount), period: num(mm.periodSeconds) ?? num(mm.period), dps: num(mm.degreesPerSecond) ?? num(mm.dps), direction: String(mm.direction ?? '').toLowerCase() === 'ccw' ? 'ccw' : 'cw' });
    }
    groups.push({ name: typeof o.name === 'string' ? o.name.slice(0, 40) : `group${groups.length + 1}`, components, motions });
  }
  if (!groups.length) return null;
  const missing = meta.comps.map((c) => c.id).filter((i) => !used.has(i));
  if (missing.length) groups[0].components.push(...missing); // every pixel of the icon stays in the scene
  const bg = String(p.background ?? '').toLowerCase();
  const ent = String(p.entrance ?? '').toLowerCase();
  return {
    name: typeof p.name === 'string' ? p.name.slice(0, 60) : undefined,
    background: (['keep', 'dark', 'light', 'colorful'] as const).find((b) => b === bg),
    entrance: (['pop', 'fade', 'draw', 'none'] as const).find((e) => e === ent),
    groups,
    effects: (Array.isArray(p.effects) ? p.effects : []).map((e) => String(e).toLowerCase()).filter((e): e is IconEffect => (EFFECTS as string[]).includes(e)),
    described: groups.some((g) => g.motions.length > 0) || ent === 'draw' || (Array.isArray(p.effects) && p.effects.length > 0),
  };
}

/* ───────── colour helpers (background design) ───────── */

function hexRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hueOf(hex: string): number {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  if (d === 0) return 220;
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

const snapPeriod = (p: number, duration: number) => duration / Math.max(1, Math.round(duration / clamp(p, 0.5, duration)));

/** Motion specs -> engine motion, snapped so every loop closes exactly at the end of the scene (seamless looping). */
export function motionFor(specs: MotionSpec[], duration: number) {
  const m: Record<string, number> = {};
  for (const s of specs) {
    if (s.type === 'spin') {
      const sign = s.direction === 'ccw' ? -1 : 1;
      const dps = s.dps ?? (s.period ? 360 / s.period : 90);
      const turns = Math.max(1, Math.round((Math.abs(dps) * duration) / 360));
      m.spin = (sign * 360 * turns) / duration;
    } else if (s.type === 'pulse') { m.pulse = clamp(s.amount ?? 0.04, 0.005, 0.3); m.pulsePeriod = snapPeriod(s.period ?? 4, duration); }
    else if (s.type === 'float') { m.float = clamp(s.amount ?? 0.015, 0.002, 0.1); m.floatPeriod = snapPeriod(s.period ?? 4, duration); }
    else if (s.type === 'sway') { m.sway = clamp(s.amount ?? 6, 0.5, 40); m.swayPeriod = snapPeriod(s.period ?? 4, duration); }
    else if (s.type === 'bounce') { m.bounce = clamp(s.amount ?? 0.05, 0.005, 0.2); m.bouncePeriod = snapPeriod(s.period ?? 1, duration); }
  }
  return m;
}

/* ───────── scene ───────── */

export function buildIconScene(meta: PartsMeta, plan: IconPlan, duration: number, aspect = 16 / 9, fx: IconFx = FX_SUBTLE): RecreateScene {
  const ar = meta.width / meta.height;
  let h = 0.66; let w = (h * ar) / aspect;
  if (w > 0.84) { w = 0.84; h = (w * aspect) / ar; }
  const x = (1 - w) / 2; const y = (1 - h) / 2;
  const compById = new Map(meta.comps.map((c) => [c.id, c]));
  const main = [...meta.comps].filter((c) => !c.hole).sort((a, b) => b.area - a.area)[0] ?? meta.comps[0];
  const hue = hueOf(main.color);
  const bgKind: IconBackground = plan.background ?? 'keep';
  const noExit = { preset: 'none', at: 999, dur: 0.5, ease: 'cubicInOut' };

  const background = bgKind === 'dark' ? { type: 'radial', colors: [hsl(hue, 0.45, 0.14), hsl(hue + 10, 0.5, 0.04)], angle: 160, grain: 0.2, vignette: 0.5 }
    : bgKind === 'colorful' ? { type: 'linear', colors: [hsl(hue, 0.7, 0.32), hsl(hue + 30, 0.75, 0.14)], angle: 125, grain: 0.18, vignette: 0.35 }
      : bgKind === 'light' ? { type: 'linear', colors: [hsl(hue, 0.4, 0.97), hsl(hue + 12, 0.45, 0.9)], angle: 160, grain: 0.05, vignette: 0.1 }
        : { type: 'linear', colors: [meta.bg.top, meta.bg.bottom], angle: 90, grain: 0, vignette: 0 };

  // paint order: the group holding the biggest solid piece first, then by size
  const weight = (g: IconGroup) => g.components.reduce((s, i) => s + (compById.get(i)?.area ?? 0) * (i === main.id ? 100 : 1), 0);
  const ordered = [...plan.groups].sort((a, b) => weight(b) - weight(a));
  const enterOf = (gi: number) => {
    if (plan.entrance === 'none') return { preset: 'fade', at: 0, dur: 0.25, ease: 'cubicOut' };
    if (plan.entrance === 'fade') return { preset: 'fade', at: 0.1 + gi * 0.25, dur: 0.9, ease: 'cubicOut' };
    if (plan.entrance === 'draw') return { preset: 'drawOn', at: 0.2 + gi * 0.6, dur: ordered.length === 1 ? 2.6 : 1.8, ease: 'cubicInOut' }; // drawn from its start to its end
    return gi === 0 ? { preset: 'scaleIn', at: 0.1, dur: 0.9, ease: 'expoOut' } : { preset: 'popBack', at: 0.45 + 0.18 * gi, dur: 0.9, ease: 'backOut' };
  };

  const els: Array<Record<string, unknown>> = [];
  els.push({
    id: 'glow', kind: 'shape', shape: 'ellipse', fill: main.color, fill2: null, stroke: null, x: x - w * 0.15, y: y - h * 0.1, w: w * 1.3, h: h * 1.2, z: 0,
    opacity: bgKind === 'dark' || bgKind === 'colorful' ? 0.28 : 0.1, blur: 0.09, rotation: 0,
    enter: { preset: 'fade', at: 0, dur: 1.4, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: { preset: 'pulse', amount: 0.4, speed: 0.5 }, follow: null,
  });
  ordered.forEach((g, gi) => {
    const comps = g.components.map((i) => compById.get(i)).filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (!comps.length) return;
    const total = comps.reduce((s, c) => s + c.area, 0) || 1;
    const cx = comps.reduce((s, c) => s + c.centroid.x * c.area, 0) / total;
    const cy = comps.reduce((s, c) => s + c.centroid.y * c.area, 0) / total;
    els.push({
      id: `part${gi}`, kind: 'part', comps: g.components, motion: { ...motionFor(g.motions, duration), shine: fx.shine, conic: fx.conic, shineAt: plan.entrance === 'draw' ? (ordered.length === 1 ? 3.0 : 2.4 + 0.6 * ordered.length) : 1.2, shineSpeed: 2 / duration, ...(ordered.length === 1 ? { echo: fx.echo, tilt: fx.tilt, tiltPeriod: snapPeriod(6, duration) } : {}) },
      x, y, w, h, z: 10 + gi, opacity: 1, blur: 0, rotation: 0, pivot: { x: x + cx * w, y: y + cy * h }, follow: null,
      enter: { ...enterOf(gi), split: 'none', stagger: 0 }, exit: noExit, loop: { preset: 'none', amount: 0.4, speed: 1 },
    });
  });

  // the light sweep / travelling light is part of each part's own motion (so it can never drift off a pulsing edge)
  const sparkleColor = bgKind === 'light' ? main.color : '#ffffff';
  for (let i = 0; i < fx.sparkles; i++) {
    const a = Math.random() * Math.PI * 2; const rr = 0.62 + Math.random() * 0.4; const d = 0.012 + Math.random() * 0.014;
    els.push({
      id: `spark${i}`, kind: 'shape', shape: 'ellipse', fill: sparkleColor, fill2: null, stroke: null, z: 50, rotation: 0, blur: 0.004, follow: null,
      x: x + w / 2 + Math.cos(a) * w * rr * 0.5 - d / aspect / 2, y: y + h / 2 + Math.sin(a) * h * rr * 0.5 - d / 2, w: d / aspect, h: d, opacity: 0.55 + Math.random() * 0.4,
      enter: { preset: 'fade', at: 0.8 + Math.random() * 2.2, dur: 0.8, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: { preset: Math.random() < 0.5 ? 'shimmer' : 'float', amount: 0.6, speed: 0.4 + Math.random() * 0.6 },
    });
  }

  const describe = ordered.map((g) => `${g.name}: ${g.motions.length ? g.motions.map((m) => m.type).join(' + ') : 'still'}`).join(' · ');
  return RecreateSceneSchema.parse({
    version: 1, title: plan.name?.trim() || 'Icon animation', duration, palette: meta.comps.slice(0, 4).map((c) => c.color),
    concept: `The icon's own parts, animated (${describe}). Colours and silhouette are untouched.`,
    background, camera: { push: 0, drift: 0 }, elements: els,
    notes: 'Built from the reference icon\'s real pixels, split into parts. Edit the direction to change which part moves.',
  });
}
