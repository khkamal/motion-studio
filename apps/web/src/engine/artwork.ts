import { RecreateSceneSchema, type RecreateScene } from './recreate';

/**
 * Local, deterministic artwork pipeline for symbols / logos / illustrations on a plain background.
 * It never asks an AI model to draw geometry: it keeps the real pixels, separates them into colour
 * layers, and the Recreate engine animates those layers (depth, float, shine, light running around).
 */
export interface PartInfo {
  role: 'shell' | 'inner' | 'free' | 'whole';
  area: number;
  /** centre and bounding box, 0..1 inside the cropped artwork canvas */
  cx: number; cy: number; x: number; y: number; w: number; h: number;
  color: string;
}

export interface ArtworkData {
  width: number;
  height: number;
  /** Background colours estimated from the image border (top and bottom edge). */
  bg: { top: string; bottom: string };
  /** All foreground pixels (true colours, soft alpha), cropped to the artwork with a margin. */
  cutout: HTMLCanvasElement;
  /** Colour-separated layers, same size as `cutout`. Empty when the art is single-coloured. */
  layers: HTMLCanvasElement[];
  /** Layer colours, largest first (same order as `layers`). */
  colors: string[];
  /** Foreground centroid, 0..1 inside the cropped canvas. */
  center: { x: number; y: number };
  coverage: number;
  uniformBg: number;
  viable: boolean;
  /** Present when extracted with extractParts: one entry per layer, same order. */
  parts?: PartInfo[];
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const median = (list: number[]) => { if (!list.length) return 0; const s = [...list].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

interface Prepared {
  W: number; H: number; data: Uint8ClampedArray; alpha: Uint8Array;
  bgTop: number[]; bgBottom: number[]; bgAt: (y: number, c: number) => number;
  x0: number; y0: number; cw: number; ch: number; coverage: number; uniformBg: number;
}

function prepare(source: CanvasImageSource, sw: number, sh: number): Prepared | null {
  if (typeof document === 'undefined' || sw < 8 || sh < 8) return null;
  const scale = Math.min(1, 1600 / Math.max(sw, sh));
  const W = Math.max(1, Math.round(sw * scale));
  const H = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(source, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H).data;

  // ── background model: median colour of the border, top half vs bottom half (handles soft gradients)
  const ring = Math.max(2, Math.round(Math.min(W, H) * 0.03));
  const top: number[][] = [[], [], []]; const bottom: number[][] = [[], [], []];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (!(y < ring || y >= H - ring || x < ring || x >= W - ring)) continue;
      const i = (y * W + x) * 4;
      const bucket = y < H / 2 ? top : bottom;
      bucket[0].push(data[i]); bucket[1].push(data[i + 1]); bucket[2].push(data[i + 2]);
    }
  }
  const bgTop = [median(top[0]), median(top[1]), median(top[2])];
  const bgBottom = bottom[0].length ? [median(bottom[0]), median(bottom[1]), median(bottom[2])] : bgTop;
  const bgAt = (y: number, c: number) => bgTop[c] + (bgBottom[c] - bgTop[c]) * (y / Math.max(1, H - 1));

  // ── soft foreground alpha = distance from the local background colour
  const alpha = new Uint8Array(W * H);
  let borderTotal = 0; let borderClose = 0; let fgCount = 0;
  let minX = W; let minY = H; let maxX = -1; let maxY = -1;
  for (let y = 0; y < H; y++) {
    const br = bgAt(y, 0); const bgc = bgAt(y, 1); const bb = bgAt(y, 2);
    const bgLight = br * br + bgc * bgc + bb * bb > 60 * 60 * 3 ? br * br + bgc * bgc + bb * bb : 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dist = Math.hypot(data[i] - br, data[i + 1] - bgc, data[i + 2] - bb);
      let a = Math.round(255 * smooth(14, 46, dist));
      if (a > 0 && bgLight > 0) {
        // a drop shadow is the background colour made darker, not new artwork: keep it out of the layers
        const k = (data[i] * br + data[i + 1] * bgc + data[i + 2] * bb) / bgLight;
        const res = Math.hypot(data[i] - k * br, data[i + 1] - k * bgc, data[i + 2] - k * bb);
        if (res < 12 && k >= 0.55 && k < 0.985) a = 0;
      }
      alpha[y * W + x] = a;
      if (y < ring || y >= H - ring || x < ring || x >= W - ring) { borderTotal++; if (dist < 22) borderClose++; }
      if (a > 128) fgCount++;
      if (a > 90) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;
  const coverage = fgCount / (W * H);
  const uniformBg = borderTotal ? borderClose / borderTotal : 0;

  // ── crop to the artwork with a margin so it fills the frame
  const mx = Math.round((maxX - minX) * 0.12); const my = Math.round((maxY - minY) * 0.12);
  const x0 = Math.max(0, minX - mx); const y0 = Math.max(0, minY - my);
  const x1 = Math.min(W - 1, maxX + mx); const y1 = Math.min(H - 1, maxY + my);
  const cw = x1 - x0 + 1; const ch = y1 - y0 + 1;
  return { W, H, data, alpha, bgTop, bgBottom, bgAt, x0, y0, cw, ch, coverage, uniformBg };
}

export function extractArtwork(source: CanvasImageSource, sw: number, sh: number): ArtworkData | null {
  const prep = prepare(source, sw, sh);
  if (!prep) return null;
  const { W, data, alpha, bgTop, bgBottom, bgAt, x0, y0, cw, ch, coverage, uniformBg } = prep;
  const x1 = x0 + cw - 1; const y1 = y0 + ch - 1;

  // ── colour clustering (deterministic farthest-point init + a few Lloyd steps)
  const samples: number[][] = [];
  const stride = Math.max(1, Math.floor((cw * ch) / 5000));
  let n = 0; let sumX = 0; let sumY = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (alpha[y * W + x] < 200) continue;
      sumX += x - x0; sumY += y - y0; n++;
      if ((n % stride) === 0) { const i = (y * W + x) * 4; samples.push([data[i], data[i + 1], data[i + 2]]); }
    }
  }
  const K = 4;
  const centers: number[][] = [];
  if (samples.length) {
    const mean = [0, 1, 2].map((c) => samples.reduce((s, p) => s + p[c], 0) / samples.length);
    const d2 = (p: number[], q: number[]) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
    centers.push(samples.reduce((best, p) => (d2(p, mean) > d2(best, mean) ? p : best), samples[0]));
    while (centers.length < K) {
      centers.push(samples.reduce((best, p) => {
        const dp = Math.min(...centers.map((c) => d2(p, c))); const db = Math.min(...centers.map((c) => d2(best, c)));
        return dp > db ? p : best;
      }, samples[0]));
    }
    for (let iter = 0; iter < 6; iter++) {
      const acc = centers.map(() => [0, 0, 0, 0]);
      for (const p of samples) {
        let bi = 0; let bd = Infinity;
        centers.forEach((c, i) => { const dd = d2(p, c); if (dd < bd) { bd = dd; bi = i; } });
        acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2] += p[2]; acc[bi][3]++;
      }
      acc.forEach((a, i) => { if (a[3] > 0) centers[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
  }
  const nearest = (r: number, gg: number, b: number, set: number[][]) => {
    let bi = 0; let bd = Infinity;
    set.forEach((c, i) => { const dd = (r - c[0]) ** 2 + (gg - c[1]) ** 2 + (b - c[2]) ** 2; if (dd < bd) { bd = dd; bi = i; } });
    return bi;
  };

  // drop tiny / near-duplicate clusters
  const counts = centers.map(() => 0);
  for (const p of samples) counts[nearest(p[0], p[1], p[2], centers)]++;
  const keep = centers.map((c, i) => ({ c, i, count: counts[i] }))
    .filter((e) => e.count > samples.length * 0.03)
    .sort((a, b) => b.count - a.count);
  const kept: number[][] = [];
  for (const e of keep) if (kept.every((k) => Math.hypot(k[0] - e.c[0], k[1] - e.c[1], k[2] - e.c[2]) > 34)) kept.push(e.c);

  // ── build the cutout and per-colour layers with true colours (edge halo of the background removed)
  const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const cutout = mk();
  const cutImg = new ImageData(cw, ch);
  const layerImgs = kept.length > 1 ? kept.map(() => new ImageData(cw, ch)) : [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = x + x0; const sy = y + y0;
      const a = alpha[sy * W + sx];
      if (a < 6) continue;
      const i = (sy * W + sx) * 4; const o = (y * cw + x) * 4;
      const af = a / 255;
      const r = Math.min(255, Math.max(0, (data[i] - (1 - af) * bgAt(sy, 0)) / Math.max(af, 0.25)));
      const gg = Math.min(255, Math.max(0, (data[i + 1] - (1 - af) * bgAt(sy, 1)) / Math.max(af, 0.25)));
      const b = Math.min(255, Math.max(0, (data[i + 2] - (1 - af) * bgAt(sy, 2)) / Math.max(af, 0.25)));
      cutImg.data[o] = r; cutImg.data[o + 1] = gg; cutImg.data[o + 2] = b; cutImg.data[o + 3] = a;
      if (layerImgs.length) {
        const li = nearest(data[i], data[i + 1], data[i + 2], kept);
        const t = layerImgs[li].data;
        t[o] = r; t[o + 1] = gg; t[o + 2] = b; t[o + 3] = a;
      }
    }
  }
  cutout.getContext('2d')?.putImageData(cutImg, 0, 0);
  const layers = layerImgs.map((img) => { const c = mk(); c.getContext('2d')?.putImageData(img, 0, 0); return c; });

  return {
    width: cw, height: ch,
    bg: { top: toHex(bgTop[0], bgTop[1], bgTop[2]), bottom: toHex(bgBottom[0], bgBottom[1], bgBottom[2]) },
    cutout, layers,
    colors: kept.map((c) => toHex(c[0], c[1], c[2])),
    center: { x: n ? sumX / n / cw : 0.5, y: n ? sumY / n / ch : 0.5 },
    coverage, uniformBg,
    viable: uniformBg >= 0.55 && coverage >= 0.02 && coverage <= 0.8,
  };
}

/**
 * Splits an icon into its real parts (connected pieces: e.g. cloud outline + two arrows) so each part can be
 * animated on its own. Pixels stay true to the source (gradients and silhouette preserved); the background is removed.
 */
export function extractParts(source: CanvasImageSource, sw: number, sh: number): ArtworkData | null {
  const prep = prepare(source, sw, sh);
  if (!prep) return null;
  const { W, data, alpha, bgTop, bgBottom, bgAt, x0, y0, cw, ch, coverage, uniformBg } = prep;
  const al = (x: number, y: number) => alpha[(y + y0) * W + x + x0];

  // 1) connected components of the foreground (8-connected)
  const labels = new Int32Array(cw * ch).fill(-1);
  const comps: Array<{ area: number; sx: number; sy: number }> = [];
  const stack: number[] = [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const idx = y * cw + x;
      if (labels[idx] !== -1 || al(x, y) < 40) continue;
      const id = comps.length;
      const c = { area: 0, sx: 0, sy: 0 };
      labels[idx] = id; stack.push(idx);
      while (stack.length) {
        const cur = stack.pop() as number;
        const px = cur % cw; const py = (cur - px) / cw;
        c.area++; c.sx += px; c.sy += py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx; const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const ni = ny * cw + nx;
          if (labels[ni] === -1 && al(nx, ny) >= 40) { labels[ni] = id; stack.push(ni); }
        }
      }
      comps.push(c);
    }
  }
  if (!comps.length) return null;

  // 2) keep the significant pieces (max 6); specks are merged into the nearest kept piece
  const total = comps.reduce((s, c) => s + c.area, 0);
  const order = comps.map((_c, i) => i).sort((a, b) => comps[b].area - comps[a].area);
  const keep = order.filter((i, rank) => rank < 6 && comps[i].area >= Math.max(30, total * 0.006));
  if (!keep.length) keep.push(order[0]);
  const remap = new Int32Array(comps.length);
  comps.forEach((c, i) => {
    const k = keep.indexOf(i);
    if (k >= 0) { remap[i] = k; return; }
    let best = 0; let bd = Infinity;
    keep.forEach((ki, kk) => { const d = Math.hypot(c.sx / c.area - comps[ki].sx / comps[ki].area, c.sy / c.area - comps[ki].sy / comps[ki].area); if (d < bd) { bd = d; best = kk; } });
    remap[i] = best;
  });
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) labels[i] = remap[labels[i]];

  // 3) soft anti-aliased fringe joins the neighbouring piece (two growth passes)
  for (let pass = 0; pass < 2; pass++) {
    const next = labels.slice();
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const idx = y * cw + x;
      if (labels[idx] !== -1 || al(x, y) < 6) continue;
      let got = -1;
      for (let dy = -1; dy <= 1 && got < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const l = labels[ny * cw + nx];
        if (l >= 0) { got = l; break; }
      }
      if (got >= 0) next[idx] = got;
    }
    labels.set(next);
  }

  // 4) per-piece stats and roles
  const n = keep.length;
  const st = Array.from({ length: n }, () => ({ area: 0, sx: 0, sy: 0, minX: cw, minY: ch, maxX: -1, maxY: -1, r: 0, g: 0, b: 0, cn: 0 }));
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const l = labels[y * cw + x];
    if (l < 0) continue;
    const s = st[l]; s.area++; s.sx += x; s.sy += y;
    if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x; if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y;
    if (al(x, y) > 200) { const i = ((y + y0) * W + x + x0) * 4; s.r += data[i]; s.g += data[i + 1]; s.b += data[i + 2]; s.cn++; }
  }
  const bbArea = (s: (typeof st)[number]) => (s.maxX - s.minX + 1) * (s.maxY - s.minY + 1);
  const centre = (s: (typeof st)[number]) => ({ x: s.sx / Math.max(1, s.area), y: s.sy / Math.max(1, s.area) });
  const inside = (outer: (typeof st)[number], inner: (typeof st)[number]) => { const c = centre(inner); return c.x > outer.minX && c.x < outer.maxX && c.y > outer.minY && c.y < outer.maxY; };
  let shell = -1;
  st.forEach((s, i) => { if (st.some((o, j) => j !== i && inside(s, o)) && (shell < 0 || bbArea(s) > bbArea(st[shell]))) shell = i; });
  const roleOf = (i: number): PartInfo['role'] => (n === 1 ? 'whole' : i === shell ? 'shell' : shell >= 0 && inside(st[shell], st[i]) ? 'inner' : 'free');
  const ucx = st.reduce((s, p) => s + centre(p).x, 0) / n; const ucy = st.reduce((s, p) => s + centre(p).y, 0) / n;
  const rank = (i: number) => { const r = roleOf(i); const base = r === 'shell' || r === 'whole' ? 0 : r === 'inner' ? 1 : 2; const c = centre(st[i]); return base * 10 + (base === 1 ? (Math.atan2(c.y - ucy, c.x - ucx) + Math.PI) / (2 * Math.PI) : 1 - st[i].area / total); };
  const final = st.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  const newIndex = new Int32Array(n); final.forEach((oldI, k) => { newIndex[oldI] = k; });

  // 5) build canvases with true colours (background halo removed)
  const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const cutImg = new ImageData(cw, ch);
  const layerImgs = Array.from({ length: n }, () => new ImageData(cw, ch));
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const l = labels[y * cw + x];
    if (l < 0) continue;
    const a = al(x, y);
    if (a < 6) continue;
    const sy = y + y0; const sx = x + x0;
    const i = (sy * W + sx) * 4; const o = (y * cw + x) * 4; const af = a / 255;
    const r = Math.min(255, Math.max(0, (data[i] - (1 - af) * bgAt(sy, 0)) / Math.max(af, 0.25)));
    const g = Math.min(255, Math.max(0, (data[i + 1] - (1 - af) * bgAt(sy, 1)) / Math.max(af, 0.25)));
    const b = Math.min(255, Math.max(0, (data[i + 2] - (1 - af) * bgAt(sy, 2)) / Math.max(af, 0.25)));
    cutImg.data[o] = r; cutImg.data[o + 1] = g; cutImg.data[o + 2] = b; cutImg.data[o + 3] = a;
    const t = layerImgs[newIndex[l]].data; t[o] = r; t[o + 1] = g; t[o + 2] = b; t[o + 3] = a;
  }
  const cutout = mk(); cutout.getContext('2d')?.putImageData(cutImg, 0, 0);
  const layers = layerImgs.map((img) => { const c = mk(); c.getContext('2d')?.putImageData(img, 0, 0); return c; });
  const parts: PartInfo[] = final.map((oldI) => {
    const s = st[oldI]; const c = centre(s);
    return { role: roleOf(oldI), area: s.area / total, cx: c.x / cw, cy: c.y / ch, x: s.minX / cw, y: s.minY / ch, w: (s.maxX - s.minX + 1) / cw, h: (s.maxY - s.minY + 1) / ch, color: toHex(s.r / Math.max(1, s.cn), s.g / Math.max(1, s.cn), s.b / Math.max(1, s.cn)) };
  });
  return {
    width: cw, height: ch,
    bg: { top: toHex(bgTop[0], bgTop[1], bgTop[2]), bottom: toHex(bgBottom[0], bgBottom[1], bgBottom[2]) },
    cutout, layers, parts, colors: parts.map((p) => p.color),
    center: { x: ucx / cw, y: ucy / ch },
    coverage, uniformBg,
    viable: uniformBg >= 0.55 && coverage >= 0.01 && coverage <= 0.85,
  };
}

const cache = new WeakMap<object, { colors?: ArtworkData | null; parts?: ArtworkData | null }>();
/** Lazily extracts and caches artwork for a render source (same canvas = same result). */
export function artworkFor(source: HTMLCanvasElement | ImageBitmap, mode: 'colors' | 'parts' = 'colors'): ArtworkData | null {
  const entry = cache.get(source) ?? {};
  if (entry[mode] !== undefined) return entry[mode] as ArtworkData | null;
  const art = mode === 'parts' ? extractParts(source, source.width, source.height) : extractArtwork(source, source.width, source.height);
  entry[mode] = art;
  cache.set(source, entry);
  return art;
}

/** Deterministic, layered motion for the extracted artwork. Pure: no canvas needed. */
export function buildArtworkScene(art: Pick<ArtworkData, 'width' | 'height' | 'bg' | 'colors' | 'layers'>, duration: number): RecreateScene {
  const aspect = art.width / art.height;
  let h = 0.8; let w = h * aspect * (9 / 16);
  if (w > 0.9) { w = 0.9; h = (w * 16) / (9 * aspect); }
  const x = (1 - w) / 2; const y = (1 - h) / 2;
  const accent = art.colors[0] ?? '#ffffff';
  const base = { rotation: 0, opacity: 1, blur: 0, follow: null, x, y, w, h };
  const noExit = { preset: 'none', at: 999, dur: 0.5, ease: 'cubicInOut' };
  const noLoop = { preset: 'none', amount: 0.4, speed: 1 };
  const enters = ['popBack', 'slideLeft', 'slideRight', 'fadeUp', 'scaleIn'] as const;

  const layers = art.layers.map((_, i) => ({
    ...base, id: `layer${i}`, kind: 'artwork', layer: i, z: 4 + i,
    shadow: { color: '#000000', alpha: 0.32, blur: 0.018, dx: 0.004, dy: 0.012 + i * 0.002 },
    enter: { preset: enters[i % enters.length], at: 0.35 + i * 0.28, dur: 1.0, ease: i % 2 ? 'expoOut' : 'backOut', split: 'none', stagger: 0 },
    exit: noExit,
    loop: { preset: 'float', amount: 0.25 + 0.05 * i, speed: 0.55 + 0.12 * i },
  }));

  return RecreateSceneSchema.parse({
    version: 1, title: 'Layered artwork', duration, palette: art.colors,
    concept: 'Real artwork split into colour layers with depth, floating motion, a light sweep and light running around the shape.',
    background: { type: 'linear', colors: [art.bg.top, art.bg.bottom], angle: 90, grain: 0.15, vignette: 0.3 },
    elements: [
      { ...base, id: 'glow', kind: 'shape', shape: 'ellipse', fill: accent, fill2: null, gradientAngle: 90, stroke: null, strokeWidth: 0, radius: 0, z: 0, opacity: 0.22, blur: 0.09, x: 0.15, y: 0, w: 0.7, h: 1, enter: { preset: 'fade', at: 0, dur: 1.4, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: { preset: 'pulse', amount: 0.4, speed: 0.5 } },
      { ...base, id: 'base', kind: 'artwork', layer: -1, z: 2, shadow: { color: '#000000', alpha: 0.2, blur: 0.03, dx: 0, dy: 0.014 }, enter: { preset: 'fade', at: 0.05, dur: 0.8, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: noLoop },
      ...layers,
      { ...base, id: 'sweep', kind: 'shine', mode: 'linear', angle: 24, width: 0.2, speed: 0.28, color: '#ffffff', intensity: 0.55, z: 20, enter: { preset: 'fade', at: 1.4, dur: 0.6, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: noLoop },
      { ...base, id: 'orbit', kind: 'shine', mode: 'conic', angle: 0, width: 0.16, speed: 0.22, color: '#ffffff', intensity: 0.5, z: 21, enter: { preset: 'fade', at: 1.8, dur: 0.6, ease: 'cubicOut', split: 'none', stagger: 0 }, exit: noExit, loop: noLoop },
    ],
    notes: 'Generated locally from the real pixels of the reference image.',
  });
}
