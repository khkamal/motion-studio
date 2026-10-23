/**
 * Splits an icon / logo into separately movable parts, locally and deterministically:
 *  - every connected piece of artwork becomes a component (cloud outline, each arrow, a dot ...)
 *  - see-through shapes enclosed by a solid component (a white arrow cut into a solid cloud) become
 *    "hole" components, and the solid component underneath is inpainted, so the hole shape can move on its own
 * At rest all components composite back to the original pixels (colours un-matted from the background).
 */
export interface PartBox { x: number; y: number; w: number; h: number }
export interface PartComp {
  id: number;
  hole: boolean;
  canvas: HTMLCanvasElement;
  bbox: PartBox;
  centroid: { x: number; y: number };
  area: number;
  color: string;
}
export interface PartsData {
  width: number;
  height: number;
  /** Crop of the artwork inside the original image, normalised 0..1 (used to map boxes for the AI). */
  crop: PartBox;
  bg: { top: string; bottom: string; light: boolean };
  comps: PartComp[];
  groupCache: Map<string, HTMLCanvasElement>;
  viable: boolean;
  coverage: number;
  uniformBg: number;
}
/** Everything the scene builder needs; no canvases. */
export type PartsMeta = Pick<PartsData, 'width' | 'height' | 'crop' | 'bg'> & { comps: Array<Omit<PartComp, 'canvas'>> };

const MAX_SIDE = 1024;
const MAX_COMPS = 12;
const MAX_HOLES = 6;

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const median = (list: number[]) => { if (!list.length) return 0; const s = [...list].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const N8: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export function extractParts(source: CanvasImageSource, sw: number, sh: number): PartsData | null {
  if (typeof document === 'undefined' || sw < 8 || sh < 8) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const W = Math.max(1, Math.round(sw * scale));
  const H = Math.max(1, Math.round(sh * scale));
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  const g = full.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(source, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H).data;

  /* background model: median of the border, top half vs bottom half */
  const ring = Math.max(2, Math.round(Math.min(W, H) * 0.03));
  const top: number[][] = [[], [], []]; const bot: number[][] = [[], [], []];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (!(y < ring || y >= H - ring || x < ring || x >= W - ring)) continue;
    const i = (y * W + x) * 4; const b = y < H / 2 ? top : bot;
    b[0].push(data[i]); b[1].push(data[i + 1]); b[2].push(data[i + 2]);
  }
  const bgTop = [median(top[0]), median(top[1]), median(top[2])];
  const bgBot = bot[0].length ? [median(bot[0]), median(bot[1]), median(bot[2])] : bgTop;
  const bgAt = (y: number, c: number) => bgTop[c] + (bgBot[c] - bgTop[c]) * (y / Math.max(1, H - 1));

  /* soft foreground alpha (distance from the background, drop shadows excluded) */
  const alphaFull = new Uint8Array(W * H);
  let borderTotal = 0; let borderClose = 0; let strong = 0;
  let minX = W; let minY = H; let maxX = -1; let maxY = -1;
  for (let y = 0; y < H; y++) {
    const br = bgAt(y, 0); const bg = bgAt(y, 1); const bb = bgAt(y, 2);
    const bgDot = br * br + bg * bg + bb * bb;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dist = Math.hypot(data[i] - br, data[i + 1] - bg, data[i + 2] - bb);
      let a = Math.round(255 * smooth(14, 46, dist));
      if (a > 0 && bgDot > 3 * 60 * 60) {
        const k = (data[i] * br + data[i + 1] * bg + data[i + 2] * bb) / bgDot;
        const res = Math.hypot(data[i] - k * br, data[i + 1] - k * bg, data[i + 2] - k * bb);
        if (res < 12 && k >= 0.55 && k < 0.985) a = 0; // a darker copy of the background is a shadow, not artwork
      }
      alphaFull[y * W + x] = a;
      if (y < ring || y >= H - ring || x < ring || x >= W - ring) { borderTotal++; if (dist < 22) borderClose++; }
      if (a >= 110) strong++;
      if (a > 90) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;
  const coverage = strong / (W * H);
  const uniformBg = borderTotal ? borderClose / borderTotal : 0;

  /* crop to the artwork with a margin */
  const mx = Math.max(4, Math.round((maxX - minX) * 0.08)); const my = Math.max(4, Math.round((maxY - minY) * 0.08));
  const x0 = Math.max(0, minX - mx); const y0 = Math.max(0, minY - my);
  const x1 = Math.min(W - 1, maxX + mx); const y1 = Math.min(H - 1, maxY + my);
  const cw = x1 - x0 + 1; const ch = y1 - y0 + 1; const N = cw * ch;
  const A = new Uint8Array(N);
  const R = new Float32Array(N); const G = new Float32Array(N); const B = new Float32Array(N); // un-matted artwork colour
  const BGR = new Float32Array(N); const BGG = new Float32Array(N); const BGB = new Float32Array(N); // raw pixel (used for see-through holes)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const p = y * cw + x; const sx = x + x0; const sy = y + y0; const i = (sy * W + sx) * 4;
    const a = alphaFull[sy * W + sx]; const af = a / 255;
    A[p] = a;
    const d = Math.max(af, 0.25);
    R[p] = Math.min(255, Math.max(0, (data[i] - (1 - af) * bgAt(sy, 0)) / d));
    G[p] = Math.min(255, Math.max(0, (data[i + 1] - (1 - af) * bgAt(sy, 1)) / d));
    B[p] = Math.min(255, Math.max(0, (data[i + 2] - (1 - af) * bgAt(sy, 2)) / d));
    BGR[p] = data[i]; BGG[p] = data[i + 1]; BGB[p] = data[i + 2];
  }

  /* connected components of the strong artwork (8-connectivity) */
  const label = new Int32Array(N).fill(-1);
  const rawAreas: number[] = []; const rawSumX: number[] = []; const rawSumY: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (A[s] < 110 || label[s] !== -1) continue;
    const id = rawAreas.length; rawAreas.push(0); rawSumX.push(0); rawSumY.push(0);
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop() as number; const px = p % cw; const py = (p - px) / cw;
      rawAreas[id]++; rawSumX[id] += px; rawSumY[id] += py;
      for (const [dx, dy] of N8) {
        const nx = px + dx; const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const q = ny * cw + nx;
        if (A[q] >= 110 && label[q] === -1) { label[q] = id; stack.push(q); }
      }
    }
  }
  if (!rawAreas.length) return null;
  const minArea = Math.max(10, Math.round(strong * 0.0015));
  const order = rawAreas.map((area, id) => ({ id, area })).sort((a, b) => b.area - a.area || a.id - b.id);
  const keepIds = order.filter((o) => o.area >= minArea).slice(0, MAX_COMPS).map((o) => o.id);
  if (!keepIds.length) keepIds.push(order[0].id);
  const remap = new Map<number, number>();
  keepIds.forEach((id, i) => remap.set(id, i));
  for (const o of order) { // small specks join the nearest kept component, so no artwork pixel is lost
    if (remap.has(o.id)) continue;
    const cx = rawSumX[o.id] / o.area; const cy = rawSumY[o.id] / o.area;
    let best = 0; let bd = Infinity;
    keepIds.forEach((kid, i) => { const d = Math.hypot(rawSumX[kid] / rawAreas[kid] - cx, rawSumY[kid] / rawAreas[kid] - cy); if (d < bd) { bd = d; best = i; } });
    remap.set(o.id, best);
  }
  for (let p = 0; p < N; p++) if (label[p] !== -1) label[p] = remap.get(label[p]) as number;
  const nShape = keepIds.length;

  /* soft edge pixels join the neighbouring component (3 passes) */
  for (let pass = 0; pass < 3; pass++) {
    const next = label.slice();
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const p = y * cw + x;
      if (label[p] !== -1 || A[p] < 12) continue;
      for (const [dx, dy] of N8) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const l = label[ny * cw + nx];
        if (l !== -1) { next[p] = l; break; }
      }
    }
    label.set(next);
  }

  /* see-through holes: enclosed background regions whose whole boundary belongs to ONE solid component */
  const outside = new Uint8Array(N);
  const bfs: number[] = [];
  for (let x = 0; x < cw; x++) for (const y of [0, ch - 1]) { const p = y * cw + x; if (label[p] === -1 && !outside[p]) { outside[p] = 1; bfs.push(p); } }
  for (let y = 0; y < ch; y++) for (const x of [0, cw - 1]) { const p = y * cw + x; if (label[p] === -1 && !outside[p]) { outside[p] = 1; bfs.push(p); } }
  while (bfs.length) {
    const p = bfs.pop() as number; const px = p % cw; const py = (p - px) / cw;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = px + dx; const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const q = ny * cw + nx;
      if (label[q] === -1 && !outside[q]) { outside[q] = 1; bfs.push(q); }
    }
  }
  interface Hole { pixels: number[]; host: number; minX: number; minY: number; maxX: number; maxY: number }
  const holes: Hole[] = [];
  const seen = new Uint8Array(N);
  for (let s = 0; s < N && holes.length < MAX_HOLES; s++) {
    if (label[s] !== -1 || outside[s] || seen[s]) continue;
    const pixels: number[] = []; const hostVotes = new Map<number, number>();
    let hx0 = cw; let hy0 = ch; let hx1 = 0; let hy1 = 0;
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const p = stack.pop() as number; const px = p % cw; const py = (p - px) / cw;
      pixels.push(p);
      if (px < hx0) hx0 = px; if (px > hx1) hx1 = px; if (py < hy0) hy0 = py; if (py > hy1) hy1 = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx; const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const q = ny * cw + nx;
        if (label[q] === -1) { if (!seen[q] && !outside[q]) { seen[q] = 1; stack.push(q); } } else hostVotes.set(label[q], (hostVotes.get(label[q]) ?? 0) + 1);
      }
    }
    const total = [...hostVotes.values()].reduce((a, b) => a + b, 0);
    const [host, votes] = [...hostVotes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [-1, 0];
    const frac = pixels.length / N;
    if (host >= 0 && total > 0 && votes / total >= 0.85 && frac >= 0.004 && frac <= 0.12) holes.push({ pixels, host, minX: hx0, minY: hy0, maxX: hx1, maxY: hy1 });
  }

  /* canvases */
  const nTotal = nShape + holes.length;
  const imgs = Array.from({ length: nTotal }, () => new ImageData(cw, ch));
  const sumA = new Float64Array(nTotal); const sumR = new Float64Array(nTotal); const sumG = new Float64Array(nTotal); const sumB = new Float64Array(nTotal);
  const boxes = Array.from({ length: nTotal }, () => ({ x0: cw, y0: ch, x1: -1, y1: -1, cx: 0, cy: 0, n: 0 }));
  const put = (c: number, p: number, r: number, gg: number, b: number, a: number) => {
    const d = imgs[c].data; const o = p * 4;
    d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = a;
  };
  for (let p = 0; p < N; p++) if (label[p] !== -1 && A[p] >= 12) put(label[p], p, R[p], G[p], B[p], A[p]);

  // hole layers (negative space keeps its own pixels) and the solid host filled underneath
  holes.forEach((h, hi) => {
    const c = nShape + hi;
    const region = new Uint8Array(N);
    for (const p of h.pixels) region[p] = 1;
    const band = new Set<number>(); // hole pixels plus a 2px skirt of soft edge pixels
    for (const p of h.pixels) {
      band.add(p);
      const px = p % cw; const py = (p - px) / cw;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = px + dx; const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const q = ny * cw + nx;
        if (label[q] === h.host) band.add(q);
      }
    }
    const hostImg = imgs[h.host].data;
    const known = new Uint8Array(N);
    const unknown: number[] = [];
    for (const p of band) {
      if (region[p]) {
        put(c, p, BGR[p], BGG[p], BGB[p], 255);
        unknown.push(p);
      } else {
        const hy = Math.floor(p / cw) + y0;
        put(c, p, bgAt(hy, 0), bgAt(hy, 1), bgAt(hy, 2), 255 - A[p]);
        put(h.host, p, R[p], G[p], B[p], 255); // fully solid so the hole layer above reproduces the original edge
        known[p] = 1;
      }
    }
    for (let p = 0; p < N; p++) if (!known[p] && !region[p] && hostImg[p * 4 + 3] > 60) known[p] = 1;
    // diffusion inpaint: fill the hole in the host layer from its surroundings, ring by ring
    let frontier = unknown;
    while (frontier.length) {
      const nextF: number[] = []; const fills: Array<[number, number, number, number]> = [];
      for (const p of frontier) {
        const px = p % cw; const py = (p - px) / cw;
        let r = 0; let gg = 0; let b = 0; let n = 0;
        for (const [dx, dy] of N8) {
          const nx = px + dx; const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const q = ny * cw + nx;
          if (known[q]) { r += hostImg[q * 4]; gg += hostImg[q * 4 + 1]; b += hostImg[q * 4 + 2]; n++; }
        }
        if (n) fills.push([p, r / n, gg / n, b / n]); else nextF.push(p);
      }
      if (!fills.length) break;
      for (const [p, r, gg, b] of fills) { put(h.host, p, r, gg, b, 255); known[p] = 1; }
      frontier = nextF;
    }
  });

  const comps: PartComp[] = [];
  for (let c = 0; c < nTotal; c++) {
    const d = imgs[c].data; const bx = boxes[c];
    for (let p = 0; p < N; p++) {
      const a = d[p * 4 + 3]; if (a < 40) continue;
      const px = p % cw; const py = (p - px) / cw;
      if (px < bx.x0) bx.x0 = px; if (px > bx.x1) bx.x1 = px; if (py < bx.y0) bx.y0 = py; if (py > bx.y1) bx.y1 = py;
      bx.cx += px; bx.cy += py; bx.n++;
      sumA[c] += a; sumR[c] += d[p * 4] * a; sumG[c] += d[p * 4 + 1] * a; sumB[c] += d[p * 4 + 2] * a;
    }
    if (bx.n < 6) continue;
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d')?.putImageData(imgs[c], 0, 0);
    comps.push({
      id: comps.length, hole: c >= nShape, canvas,
      bbox: { x: bx.x0 / cw, y: bx.y0 / ch, w: (bx.x1 - bx.x0 + 1) / cw, h: (bx.y1 - bx.y0 + 1) / ch },
      centroid: { x: bx.cx / bx.n / cw, y: bx.cy / bx.n / ch },
      area: bx.n / N,
      color: toHex(sumR[c] / sumA[c], sumG[c] / sumA[c], sumB[c] / sumA[c]),
    });
  }
  if (!comps.length) return null;
  const lum = (0.2126 * bgTop[0] + 0.7152 * bgTop[1] + 0.0722 * bgTop[2]) / 255;
  return {
    width: cw, height: ch,
    crop: { x: x0 / W, y: y0 / H, w: cw / W, h: ch / H },
    bg: { top: toHex(bgTop[0], bgTop[1], bgTop[2]), bottom: toHex(bgBot[0], bgBot[1], bgBot[2]), light: lum > 0.6 },
    comps, groupCache: new Map(), coverage, uniformBg,
    viable: uniformBg >= 0.55 && coverage >= 0.01 && coverage <= 0.85,
  };
}

/** One canvas holding several components drawn together (solid components first, see-through shapes on top). */
export function groupCanvas(parts: PartsData, ids: number[]): HTMLCanvasElement | null {
  const valid = ids.filter((i) => parts.comps[i]);
  if (!valid.length) return null;
  const key = [...valid].sort((a, b) => a - b).join(',');
  const hit = parts.groupCache.get(key);
  if (hit) return hit;
  if (valid.length === 1) { const only = parts.comps[valid[0]].canvas; parts.groupCache.set(key, only); return only; }
  const canvas = document.createElement('canvas');
  canvas.width = parts.width; canvas.height = parts.height;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const sorted = [...valid].sort((a, b) => Number(parts.comps[a].hole) - Number(parts.comps[b].hole) || a - b);
  for (const i of sorted) g.drawImage(parts.comps[i].canvas, 0, 0);
  parts.groupCache.set(key, canvas);
  return canvas;
}

const cache = new WeakMap<object, PartsData | null>();
export function partsFor(source: HTMLCanvasElement | ImageBitmap): PartsData | null {
  const hit = cache.get(source);
  if (hit !== undefined) return hit;
  const parts = extractParts(source, source.width, source.height);
  cache.set(source, parts);
  return parts;
}

export function partsMeta(parts: PartsData): PartsMeta {
  return { width: parts.width, height: parts.height, crop: parts.crop, bg: parts.bg, comps: parts.comps.map(({ canvas: _canvas, ...rest }) => rest) };
}

/** The original image with numbered boxes, so a vision model can say which component is which. */
export async function annotatedImage(source: CanvasImageSource, sw: number, sh: number, parts: PartsData): Promise<Blob | null> {
  const scale = Math.min(1, 1024 / Math.max(sw, sh));
  const W = Math.round(sw * scale); const H = Math.round(sh * scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(source, 0, 0, W, H);
  const palette = ['#ff2d55', '#007aff', '#ff9500', '#34c759', '#af52de', '#00c7be', '#ffcc00', '#5856d6'];
  g.lineWidth = Math.max(2, W / 300); g.font = `bold ${Math.max(14, Math.round(W / 28))}px sans-serif`; g.textBaseline = 'top';
  parts.comps.forEach((comp) => {
    const col = palette[comp.id % palette.length];
    const x = (parts.crop.x + comp.bbox.x * parts.crop.w) * W; const y = (parts.crop.y + comp.bbox.y * parts.crop.h) * H;
    const w = comp.bbox.w * parts.crop.w * W; const h = comp.bbox.h * parts.crop.h * H;
    g.strokeStyle = col; g.setLineDash(comp.hole ? [6, 4] : []); g.strokeRect(x, y, w, h);
    g.fillStyle = col; g.fillRect(x, y, g.measureText(String(comp.id)).width + 8, Math.max(14, Math.round(W / 28)) + 4);
    g.fillStyle = '#fff'; g.fillText(String(comp.id), x + 4, y + 2);
  });
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}
