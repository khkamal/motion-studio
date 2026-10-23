import type { ApiKeyConfig, MediaAsset } from '../types/motion';
import { briefFromDirection, composeScene, type Brief } from '../engine/composer';
import { backgroundFromText, buildIconScene, defaultGrouping, normalizePlan, pickFx, planFromKeywords, type IconPlan } from '../engine/iconScene';
import { motionEnergy } from '../engine/quality';
import { annotatedImage, extractParts, partsMeta, type PartsData, type PartsMeta } from '../engine/parts';
import { extractPalette, type RefPalette } from '../engine/ribbonScene';
import { RecreateSceneSchema, type RecreateScene } from '../engine/recreate';
import { getResponseText, makeVisionPayload, requestGemini } from './gemini';

function instructions(duration: number, userNote: string): string {
  return `You are a senior motion designer. The image is a REFERENCE DESIGN (poster, logo, symbol, line art, illustration, thumbnail, UI, infographic...). Rebuild it as an animated scene of vector elements and choreograph the motion so it looks professionally animated. Work for ANY kind of image: first decide what the design is and which motion best expresses it, then build exactly that.

Return ONE JSON object only (no markdown). Coordinates are normalized to the canvas (0..1): x,y = top-left of the element box, w,h = box size. Text size is a fraction of canvas HEIGHT. Colors are CSS hex.

{
 "version":1,"title":"short name","concept":"one sentence: what the design is and what motion fits it","duration":${duration},"palette":["#hex"],
 "background":{"type":"solid|linear|radial","colors":["#hex","#hex"],"angle":160,"grain":0-1,"vignette":0-1},
 "elements":[
  {"id":"a","kind":"path","d":"M10 50 C 10 10, 50 10, 50 50 S 90 90, 90 50","fill":null,"fill2":null,"stroke":"#hex","stroke2":"#hex highlight that runs along the line","strokeWidth":0.02,"cap":"round",
   "x":0.2,"y":0.1,"w":0.6,"h":0.8,"z":2,"rotation":0,"opacity":1,"blur":0,
   "enter":{"preset":"drawOn","at":0.3,"dur":1.4,"ease":"cubicInOut","split":"none","stagger":0},
   "exit":{"preset":"none","at":999,"dur":0.5,"ease":"cubicInOut"},
   "loop":{"preset":"flow","amount":0.5,"speed":1},"follow":null},
  {"id":"dot","kind":"shape","shape":"ellipse","fill":"#hex","blur":0.01,"x":0,"y":0,"w":0.03,"h":0.03,"z":9,"enter":{"preset":"scaleIn","at":1.5,"dur":0.5},"loop":{"preset":"pulse"},"follow":{"path":"a","speed":0.12,"offset":0,"align":false}},
  {"kind":"shape","shape":"rect|roundRect|ellipse|line|triangle","fill":"#hex","fill2":"#hex or null","gradientAngle":90,"stroke":null,"strokeWidth":0,"radius":0.1, ...common fields},
  {"kind":"text","text":"exact text","font":"sans|serif|display|mono|script","weight":700,"size":0.08,"color":"#hex","align":"left|center|right","letterSpacing":0,"lineHeight":1.1,"uppercase":false,"italic":false,"shadow":false, ...common fields},
  {"kind":"crop","sx":0,"sy":0,"sw":1,"sh":1,"radius":0.05,"zoom":1.05, ...common fields}
 ]
}

Presets. Enter: fade, fadeUp, fadeDown, slideLeft, slideRight, scaleIn, popBack, wipeRight, wipeUp, blurIn, rotateIn, drawOn (paths and lines), none. Exit: none, fade, fadeUp, slideLeft, slideRight, scaleOut. Loop: none, float, pulse, sway, spin, shimmer, flow (paths: a highlight travels along the stroke). Easing: linear, sineInOut, cubicOut, cubicInOut, expoOut, backOut, elasticOut, bounceOut. split (text only): none, word, char, line.

Path rules: "d" is SVG path data (M, L, C, S, Q, A, Z) drawn in a 0..100 x 0..100 box that is scaled uniformly into the element box and centered, so choose a box whose pixel aspect is about square (w*canvasWidth ~ h*canvasHeight) for undistorted shapes. strokeWidth is a fraction of canvas height (0.01-0.04 typical).

Decide the design type, then:
- SYMBOL / LOGO / LINE ART / LOOPS / ABSTRACT SHAPES: trace each strand, band, petal or stroke as its own "path" element in the reference colors. Do NOT invent text. Animate by drawing the strands on one after another (drawOn with stagger in "at"), then loop "flow" with a bright stroke2 so color visibly runs along every line, and add 2-4 glowing dots (ellipse shapes with follow) travelling along the strands. For interlocking or crossing strands, split them into separate path segments and give each its own z so one strand clearly passes over the other where they cross.
- DETAILED ARTWORK THAT CANNOT BE REDRAWN FAITHFULLY (papercut, 3D render, textured, photo-real): keep the real artwork as a "crop" base layer (zoom 1.03-1.08, gentle float), then overlay animated "path" strands that trace its main lines with "flow" highlights, glow ellipses, and travelling dots, so it looks like light moving through the artwork.
- TYPOGRAPHY POSTER / TITLE CARD: rebuild text exactly (any language incl. Bengali) with split word/char reveals, plus accent shapes and bars.
- PHOTO / UI / INFOGRAPHIC: separate regions as crop or shape layers with staggered wipes/slides and subtle parallax; text as in the image.
General: add text ONLY if the reference contains text. Use 8-30 elements. Use blurred low-opacity ellipses for ambient glow. Time everything within ${duration}s: Beat 1 (0-1.5s) background and main structure enter; Beat 2 (1-4s) details, secondary elements, highlights; Beat 3 hold with continuous loops (flow/float/pulse) so it never looks frozen. Vary enter presets and easing; never use the same preset for everything. Higher z = on top.
${userNote ? `\nExtra direction from the user: ${userNote}\n` : ''}`;
}

async function callOnce(config: ApiKeyConfig, asset: MediaAsset, duration: number, note: string, signal?: AbortSignal, feedback = ''): Promise<RecreateScene> {
  const image = await makeVisionPayload(asset.blob);
  const prompt = `${instructions(duration, note)}${feedback ? `\n\nYour previous answer was rejected: ${feedback}\nReturn a corrected full JSON.` : ''}\n\nReference image size: ${asset.width}x${asset.height}.`;
  const response = await requestGemini(config, [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: image.data } }], signal);
  const text = getResponseText(response);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Gemini returned malformed JSON.'); }
  const result = RecreateSceneSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Scene did not validate: ${result.error.issues.slice(0, 2).map((i) => i.message).join('; ')}`);
  if (result.data.elements.length < 3) throw new Error('Scene had fewer than 3 usable elements.');
  return { ...result.data, duration };
}

async function referencePalette(asset: MediaAsset): Promise<RefPalette | null> {
  try {
    const bitmap = await createImageBitmap(asset.blob);
    try { return extractPalette(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
  } catch { return null; }
}

const SYMBOLIC_TYPES = ['symbol', 'logo', 'icon', 'illustration', 'abstract', 'artwork', 'shape'];
const HEX = /^#[0-9a-f]{6}$/i;

interface Understanding { type: string; hasText: boolean; brief: Brief }

/** One small vision call: what is this image about, and what kind of new design suits it. Only steers the composer; no geometry is copied or drawn by the model. */
async function understandReference(config: ApiKeyConfig, asset: MediaAsset, userText: string, signal?: AbortSignal): Promise<Understanding | null> {
  try {
    const image = await makeVisionPayload(asset.blob);
    const prompt = `Look at this reference image and return JSON only:
{"type":"symbol|logo|icon|illustration|abstract|typography|photo|ui|infographic|other",
 "hasText":true|false (true only if readable words are a meaningful part of the design),
 "subject":"what it is, 1-4 words (e.g. green wallet icon)",
 "concept":"one sentence: the idea or meaning of the design",
 "motifs":[1-4 names from: card,coin,wallet,shield,lock,bolt,heart,star,orb,globe,check] (the closest matches to the subject and its idea),
 "layout":"hero|trio|orbit|cascade|ribbon" (the motion composition that suits it),
 "curve":"infinity|circle|trefoil|heart|wave|rose|lissajous|none" (only when the main shape is a line or loop),
 "mood":"calm|elegant|energetic","style":"glossy|glass|neon|flat",
 "background":"dark|colorful|light" (what makes the subject pop; do not just copy a plain white background),
 "palette":["#rrggbb",...] (3-5 main colours of the subject itself, not of the background)}${userText.trim() ? `\nThe person also wrote this direction. Follow it where it matters: "${userText.trim().slice(0, 400)}"` : ''}`;
    const response = await requestGemini(config, [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: image.data } }], signal);
    const p = JSON.parse(getResponseText(response)) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : undefined);
    return {
      type: str(p.type) ?? 'other',
      hasText: p.hasText === true,
      brief: {
        subject: typeof p.subject === 'string' ? p.subject.trim().slice(0, 60) : undefined,
        concept: typeof p.concept === 'string' ? p.concept.trim().slice(0, 240) : undefined,
        motifs: Array.isArray(p.motifs) ? p.motifs.filter((m): m is string => typeof m === 'string').map((m) => m.toLowerCase()) : undefined,
        layout: str(p.layout), curve: str(p.curve), mood: str(p.mood), style: str(p.style), background: str(p.background),
        palette: Array.isArray(p.palette) ? p.palette.filter((c): c is string => typeof c === 'string' && HEX.test(c)) : [],
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

/** Brief + the person's typed direction (their words win) -> a NEW scene. A fresh seed on every call, so no two designs are the same. */
function composeFrom(base: Brief, userText: string, duration: number, aspect: number): RecreateScene {
  const brief = userText.trim() ? briefFromDirection(userText, base) : base;
  return composeScene(brief, duration, Math.floor(Math.random() * 1_000_000), aspect);
}

/* ───────── Animate icon: the icon's own parts get the motion the person describes ───────── */

const FAITHFUL = /\b(preserve[sd]?|silhouette|exact(ly)?|same (icon|logo|design|colou?rs?)|keep (the )?(icon|logo|colou?rs?|shape|silhouette)|this (icon|logo)|image_?\d*(\.png)?|animate (the |this |my )?(icon|logo))\b/i;
const PART_MOTION = /\b(spin\w*|rotat\w*|puls\w*|breath\w*|bounc\w*|sway\w*|wobbl\w*|swing\w*|hover\w*|float\w*)\b/i;
/** True when the typed direction describes motion of the icon itself, which a freshly composed design can never honour. */
export const wantsFaithful = (note: string) => FAITHFUL.test(note) || PART_MOTION.test(note);

async function planIcon(config: ApiKeyConfig, asset: MediaAsset, pieces: PartsData, note: string, signal?: AbortSignal): Promise<IconPlan | null> {
  try {
    const bitmap = await createImageBitmap(asset.blob);
    let annotated: Blob | null = null;
    try { annotated = await annotatedImage(bitmap, bitmap.width, bitmap.height, pieces); } finally { bitmap.close(); }
    const original = await makeVisionPayload(asset.blob);
    const list = pieces.comps.map((c) => ({
      id: c.id, kind: c.hole ? 'see-through shape' : 'solid piece',
      box: [pieces.crop.x + c.bbox.x * pieces.crop.w, pieces.crop.y + c.bbox.y * pieces.crop.h, pieces.crop.x + (c.bbox.x + c.bbox.w) * pieces.crop.w, pieces.crop.y + (c.bbox.y + c.bbox.h) * pieces.crop.h].map((v) => Math.round(v * 1000)),
      areaPercent: Math.round(c.area * 1000) / 10, color: c.color,
    }));
    const prompt = `You are a motion designer rigging an icon. Image 1 is the original icon. Image 2 is the same icon with numbered boxes on the detected components (dashed box = see-through / negative-space shape). Boxes are [x0,y0,x1,y1] in 0-1000 image coordinates.
Components: ${JSON.stringify(list)}
The person's request: "${note.trim().slice(0, 600) || '(none, choose a gentle, tasteful motion)'}"
Return JSON only:
{"name":"short name of the icon","background":"keep|dark|light|colorful","entrance":"pop|fade|draw|none",
 "groups":[{"name":"e.g. cloud","components":[component ids],"motions":[{"type":"spin|pulse|float|sway|bounce","amount":0.04,"periodSeconds":4,"degreesPerSecond":90,"direction":"cw|ccw"}]}]}
Rules: every component id belongs to exactly one group. Put pieces that must move together in one group (for example both arrows of a refresh symbol). Give motions only to the parts the request names, exactly as described; groups that should stay still get "motions":[]. amount for pulse is the scale change (0.03 = 3%), for float a fraction of the icon height, for sway degrees. background is "keep" unless the request asks for another one. Never change colours or shapes.`;
    const response = await requestGemini(config, [{ text: prompt }, { inline_data: { mime_type: original.mimeType, data: original.data } }, ...(annotated ? [{ inline_data: { mime_type: 'image/png', data: (await makeVisionPayload(annotated)).data } }] : [])], signal);
    return normalizePlan(JSON.parse(getResponseText(response)), partsMeta(pieces));
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

/** Measured on the real renderer; a frozen-looking icon scored about 0.013, a clearly alive one 0.018+. */
const MIN_MOTION_ENERGY = 0.016;

/** Contrast-aware backdrop for the icon: dark or tinted-light, different from one click to the next. */
function designedBackground(meta: { comps: Array<{ color: string; area: number; hole: boolean }> }): 'dark' | 'light' | 'colorful' {
  const solids = meta.comps.filter((c) => !c.hole);
  const total = solids.reduce((s, c) => s + c.area, 0) || 1;
  const lum = solids.reduce((s, c) => { const n = parseInt(c.color.slice(1), 16); return s + (c.area / total) * ((0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255); }, 0);
  const r = Math.random();
  if (lum < 0.3) return 'light';
  if (lum < 0.62) return r < 0.7 ? 'dark' : 'light';
  return r < 0.6 ? 'dark' : 'colorful';
}

async function animateIcon(config: ApiKeyConfig | null, asset: MediaAsset, duration: number, note: string, aspect: number, signal?: AbortSignal): Promise<RecreateScene | null> {
  let pieces: PartsData | null = null;
  try {
    const bitmap = await createImageBitmap(asset.blob);
    try { pieces = extractParts(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
  } catch { return null; }
  if (!pieces || !pieces.viable) return null; // not a clean icon on a plain background: let the other pipelines handle it
  const meta = partsMeta(pieces);
  const plan = (config ? await planIcon(config, asset, pieces, note, signal) : null) ?? planFromKeywords(note, meta);
  const bg = backgroundFromText(note);
  if (bg) plan.background = bg; // the person's own words about the background always win
  else if (!plan.background || plan.background === 'keep') plan.background = designedBackground(meta); // never just copy the plain white page behind the icon
  // quality gate: when the person did not describe a motion, a frozen-looking result is never acceptable
  let scene = buildIconScene(meta, plan, duration, aspect, pickFx(plan));
  if (!plan.described && motionEnergy(scene, pieces) < MIN_MOTION_ENERGY) scene = buildIconScene(meta, plan, duration, aspect, pickFx(plan, Math.random, true));
  return scene;
}

const WANTS_TEXT = /["“”]|\b(text|title|headline|caption|poster|quote|slogan)\b/i;

export async function generateRecreateScene(config: ApiKeyConfig, asset: MediaAsset, duration: number, note = '', signal?: AbortSignal, aspect = 16 / 9, forceIcon = false): Promise<RecreateScene> {
  if (forceIcon || wantsFaithful(note)) {
    const icon = await animateIcon(config, asset, duration, note, aspect, signal);
    if (icon) return icon;
  }
  const pal = await referencePalette(asset);
  const understood = await understandReference(config, asset, note, signal);
  const symbolic = understood !== null && SYMBOLIC_TYPES.includes(understood.type) && !understood.hasText;
  // icons / logos / symbols / abstract art: compose a NEW design from the idea, never reuse or redraw the reference
  if (understood && symbolic && !WANTS_TEXT.test(note)) return composeFrom(understood.brief, note, duration, aspect);
  try {
    return await callOnce(config, asset, duration, note, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    try {
      return await callOnce(config, asset, duration, note, signal, error instanceof Error ? error.message : 'invalid output');
    } catch (second) {
      if (understood) return composeFrom(understood.brief, note, duration, aspect);
      if (pal) return composeFrom({ palette: pal.colors }, note, duration, aspect);
      throw second;
    }
  }
}

export async function reviseRecreateScene(config: ApiKeyConfig, scene: RecreateScene, request: string, signal?: AbortSignal): Promise<RecreateScene> {
  const prompt = `Modify this motion-graphics scene JSON according to the request. Keep the same schema, element ids and everything not mentioned. Timings must stay within duration ${scene.duration}s. Return the full updated JSON only.\n\nScene:\n${JSON.stringify(scene)}\n\nRequest:\n${request}`;
  const response = await requestGemini(config, [{ text: prompt }], signal);
  const parsed = JSON.parse(getResponseText(response)) as unknown;
  const result = RecreateSceneSchema.safeParse(parsed);
  if (!result.success || result.data.elements.length < 1) throw new Error('Revised scene did not validate.');
  return { ...result.data, duration: scene.duration };
}

/** Offline draft: sampled palette + framed photo + animated title. Clearly a draft, no vision model involved. */
export async function buildLocalRecreateScene(asset: MediaAsset, duration: number, note = '', aspect = 16 / 9, forceIcon = false): Promise<RecreateScene> {
  if (forceIcon || wantsFaithful(note)) {
    const icon = await animateIcon(null, asset, duration, note, aspect);
    if (icon) return icon;
  }
  const pal = await referencePalette(asset);
  // offline: colours come from the reference, everything else from the typed direction (or a fresh random design)
  if (pal?.viable || note.trim()) return composeFrom({ palette: pal?.colors ?? [] }, note, duration, aspect);
  const bitmap = await createImageBitmap(asset.blob);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  let top = '#1b1f3b'; let bottom = '#0b0d1a'; let accent = '#ffcf5a';
  const hex = (d: Uint8ClampedArray, f: (v: number) => number) => `#${[d[0], d[1], d[2]].map((v) => Math.max(0, Math.min(255, Math.round(f(v)))).toString(16).padStart(2, '0')).join('')}`;
  if (g) {
    g.drawImage(bitmap, 0, 0, 16, 16);
    top = hex(g.getImageData(8, 2, 1, 1).data, (v) => v * 0.45);
    bottom = hex(g.getImageData(8, 13, 1, 1).data, (v) => v * 0.3);
    accent = hex(g.getImageData(8, 8, 1, 1).data, (v) => v * 1.2 + 30);
  }
  const srcAspect = bitmap.width / bitmap.height;
  bitmap.close();
  // Draft only: shows the real artwork with ambient light. It never invents text; a Gemini scene replaces it.
  const boxH = 0.78;
  const boxW = Math.min(0.9, boxH * srcAspect * (9 / 16));
  const base = { z: 1, rotation: 0, opacity: 1, blur: 0, follow: null, exit: { preset: 'none' as const, at: 999, dur: 0.5, ease: 'cubicInOut' as const }, loop: { preset: 'none' as const, amount: 0.4, speed: 1 } };
  const enter = (preset: 'fade' | 'scaleIn' | 'popBack', at: number, dur = 0.9) => ({ preset, at, dur, ease: 'expoOut' as const, split: 'none' as const, stagger: 0 });
  const dot = (id: string, x: number, y: number, at: number) => ({ ...base, id, kind: 'shape', shape: 'ellipse', fill: accent, fill2: null, gradientAngle: 90, stroke: null, strokeWidth: 0, radius: 0, x, y, w: 0.07, h: 0.12, z: 6, opacity: 0.6, blur: 0.05, enter: enter('fade', at, 1.2), loop: { preset: 'pulse' as const, amount: 0.8, speed: 0.8 } });
  return RecreateSceneSchema.parse({
    version: 1, title: 'Local draft', concept: 'Local draft: artwork with ambient light.', duration, palette: [top, bottom, accent],
    background: { type: 'linear', colors: [top, bottom], angle: 160, grain: 0.35, vignette: 0.5 },
    elements: [
      { ...base, id: 'glow', kind: 'shape', shape: 'ellipse', fill: accent, fill2: null, gradientAngle: 90, stroke: null, strokeWidth: 0, radius: 0, x: 0.2, y: 0.0, w: 0.6, h: 1.0, opacity: 0.3, blur: 0.08, z: 0, enter: enter('fade', 0, 1.4), loop: { preset: 'float', amount: 0.6, speed: 0.6 } },
      { ...base, id: 'art', kind: 'crop', sx: 0, sy: 0, sw: 1, sh: 1, radius: 0.04, zoom: 1.04, x: (1 - boxW) / 2, y: (1 - boxH) / 2, w: boxW, h: boxH, z: 3, enter: enter('scaleIn', 0.2, 1.2), loop: { preset: 'float', amount: 0.35, speed: 0.6 } },
      dot('l1', 0.18, 0.15, 0.8), dot('l2', 0.74, 0.62, 1.2), dot('l3', 0.46, 0.78, 1.6),
    ],
    notes: 'Local draft. Gemini was not available, so this only shows the artwork with ambient light.',
  });
}


/* ───────── Motion idea: written automatically when an image is uploaded; the person can edit it ───────── */

export interface MotionIdea { text: string; source: 'ai' | 'local' }

type IdeaMeta = Pick<PartsMeta, 'comps'>;

const pickOne = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** The same kind of sentence a person would type, phrased so the planner and the AI both read it correctly. */
export function localIdea(meta: IdeaMeta | null, previous: string): string {
  if (!meta) return 'A slow, cinematic push-in. Soft light sweeps across the picture and a few sparkles drift through the air. Keep it calm and elegant.';
  const bgWord = { dark: 'A dark gradient background makes the colours pop.', light: 'A soft light background.', colorful: 'A colorful gradient background.' }[designedBackground(meta)];
  const groups = defaultGrouping(meta);
  const body = [...meta.comps].filter((c) => !c.hole).sort((a, b) => b.area - a.area)[0];
  const fill = body ? body.area / Math.max(0.01, body.bbox.w * body.bbox.h) : 1; // outline / loop shapes fill little of their box
  let options: string[];
  if (groups.length > 1) {
    options = [
      `The inner shapes spin smoothly and continuously in a clean cycle. The outer shape pulses very gently. Keep the original colours and silhouette. ${bgWord}`,
      `The outer shape pops in. The inner shapes rotate slowly. A soft light sweeps across the icon. ${bgWord}`,
      `The inner shapes float gently. The outer shape breathes slowly. Light travels around the icon and a few sparkles drift nearby. ${bgWord}`,
    ];
  } else if (fill < 0.5) {
    options = [
      `The symbol is drawn on from start to end along its stroke, then a soft light flows around it continuously. Keep the original colours. ${bgWord}`,
      `The symbol is drawn on along its stroke. Then ghost echo rings expand from its outline while a light sweeps across it. ${bgWord}`,
      `The symbol pops in, then flips gently like a 3D card while light travels around it and a few sparkles drift nearby. ${bgWord}`,
    ];
  } else {
    options = [
      `The icon pops in. Ghost echo rings expand from its silhouette while a soft light sweeps across it. ${bgWord}`,
      `The icon flips gently like a 3D card while light travels around it and a few sparkles drift nearby. ${bgWord}`,
      `The icon floats gently and pulses very slowly while a soft light sweeps across it. Keep the original colours. ${bgWord}`,
    ];
  }
  for (let i = 0; i < 4; i++) { const t = pickOne(options); if (t !== previous.trim()) return t; }
  return options[0];
}

async function ideaFromGemini(config: ApiKeyConfig, asset: MediaAsset, pieces: PartsData | null, meta: IdeaMeta | null, previous: string, signal?: AbortSignal): Promise<string | null> {
  const original = await makeVisionPayload(asset.blob);
  let annotated: Blob | null = null;
  if (pieces && pieces.comps.length > 1) {
    try { const bitmap = await createImageBitmap(asset.blob); try { annotated = await annotatedImage(bitmap, bitmap.width, bitmap.height, pieces); } finally { bitmap.close(); } } catch { annotated = null; }
  }
  const facts = meta
    ? `Detected ${meta.comps.length} separate piece(s): ${meta.comps.map((c) => `#${c.id} ${c.hole ? 'see-through shape' : 'solid piece'} ${c.color}, ${Math.round(c.area * 1000) / 10}% of the icon`).join('; ')}.${meta.comps.length === 1 ? ' It is one single piece, so nothing inside it can move on its own.' : ''}`
    : 'This does not look like a clean icon on a plain background.';
  const prompt = `You are a motion designer. Write ONE motion idea for animating this uploaded image: 2-4 plain sentences, concrete and buildable.
Our engine animates the image's OWN pixels (its colours and silhouette never change). It can: spin or rotate a part continuously; pulse (gently expand and contract); float; sway; bounce; draw the shape on from its start to its end along its stroke (best for line, loop, ring or outline symbols); light sweeping across it; light travelling around it; ghost echo rings expanding from its silhouette; sparkles; a slow 3D-card flip; and a dark, light or colorful gradient background.
${facts}
Rules: name parts by what they are (for example "the two arrows", "the cloud outline", "the loop"), never by number. Say which part does what, how (slow, subtle, fast) and suggest a background. Suit THIS image and do not invent objects. For a one-piece symbol, make the whole shape the hero (draw-on, travelling light, echo, flip) instead of imagining inner parts. Write one separate sentence per part. Do not describe motion we cannot do.${previous.trim() ? `\nDo NOT repeat this earlier idea; choose a clearly different approach: "${previous.trim().slice(0, 500)}"` : ''}
Return JSON only: {"idea":"..."}`;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }, { inline_data: { mime_type: original.mimeType, data: original.data } }];
  if (annotated) parts.push({ inline_data: { mime_type: 'image/png', data: (await makeVisionPayload(annotated)).data } });
  const response = await requestGemini(config, parts, signal);
  const idea = (JSON.parse(getResponseText(response)) as { idea?: unknown }).idea;
  if (typeof idea !== 'string') return null;
  const text = idea.replace(/\s+/g, ' ').trim();
  return text.length >= 20 && text.length <= 700 ? text : null;
}

/** Called right after an upload (and by "New idea"): Gemini reads the image and proposes a motion; without a key a local idea is written. */
export async function suggestIdea(config: ApiKeyConfig | null, asset: MediaAsset, previous = '', signal?: AbortSignal): Promise<MotionIdea> {
  let pieces: PartsData | null = null;
  try {
    const bitmap = await createImageBitmap(asset.blob);
    try { pieces = extractParts(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
  } catch { pieces = null; }
  const meta = pieces?.viable ? partsMeta(pieces) : null;
  if (config) {
    try {
      const text = await ideaFromGemini(config, asset, pieces, meta, previous, signal);
      if (text) return { text, source: 'ai' };
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return { text: localIdea(meta, previous), source: 'local' };
}
