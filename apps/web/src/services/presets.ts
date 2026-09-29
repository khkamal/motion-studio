import { z } from 'zod';
import { buildFallbackPlan, normalizePlan } from '../engine/planBuilder';
import { MotionPlanSchema, type EditorSettings, type MotionPlan, type VisualStyle } from '../types/motion';

export const PRESET_CATEGORIES = [
  'Abstract', 'Technology', 'Business', 'Nature', 'Science', 'Medical', 'Background',
  'Light', 'Particles', 'Minimal', 'Geometric', 'Line Art', '3D Abstract',
] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

export interface MotionPreset {
  id: string;
  name: string;
  category: PresetCategory;
  builtIn: boolean;
  plan: MotionPlan;
  settings: Pick<EditorSettings, 'priorities' | 'particlesEnabled' | 'particleType' | 'cameraEnabled' | 'parallaxStrength' | 'effectsEnabled' | 'speed' | 'style' | 'fit'>;
  accentColor: string;
}

const PresetSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  category: z.enum(PRESET_CATEGORIES),
  builtIn: z.literal(false),
  plan: MotionPlanSchema,
  settings: z.object({
    priorities: z.object({ subjectMotionStrength: z.number().min(0).max(1), secondaryMotionStrength: z.number().min(0).max(1), cameraMotionStrength: z.number().min(0).max(1), effectsStrength: z.number().min(0).max(1), particleStrength: z.number().min(0).max(1) }).strict(),
    particlesEnabled: z.boolean(), particleType: z.enum(['dust', 'sparkles', 'stars', 'technology', 'energy', 'abstract']), cameraEnabled: z.boolean(),
    parallaxStrength: z.number().min(0).max(1), effectsEnabled: z.boolean(), speed: z.number().min(0.25).max(3), style: z.enum(['2D', '3D', 'Line Art']), fit: z.enum(['fit', 'fill', 'crop', 'center']),
  }).strict(),
  accentColor: z.string().max(30),
}).strict();

const STORAGE_KEY = 'motion-studio-presets.v1';
const BUILTIN_DEFS: Array<{ id: string; name: string; category: PresetCategory; type: string; particle: MotionPreset['settings']['particleType']; style: VisualStyle; accentColor: string }> = [
  { id: 'builtin-tech-pulse', name: 'Neural Pulse', category: 'Technology', type: 'brain', particle: 'technology', style: '3D', accentColor: '#64c9ff' },
  { id: 'builtin-canopy', name: 'Canopy Breeze', category: 'Nature', type: 'tree', particle: 'dust', style: '2D', accentColor: '#7ed6a7' },
  { id: 'builtin-product', name: 'Product Hero', category: 'Business', type: 'product', particle: 'sparkles', style: '3D', accentColor: '#ffca86' },
  { id: 'builtin-cosmos', name: 'Quiet Orbit', category: 'Science', type: 'planet', particle: 'stars', style: '3D', accentColor: '#9b93ff' },
  { id: 'builtin-minimal', name: 'Minimal Drift', category: 'Minimal', type: 'abstract object', particle: 'dust', style: '2D', accentColor: '#88a8ff' },
  { id: 'builtin-line', name: 'Contour Study', category: 'Line Art', type: 'geometric object', particle: 'abstract', style: 'Line Art', accentColor: '#d3d9ed' },
  { id: 'builtin-energy', name: 'Energy Field', category: 'Abstract', type: 'technology', particle: 'energy', style: '3D', accentColor: '#e184ff' },
  { id: 'builtin-medical', name: 'Soft Clinical', category: 'Medical', type: 'brain', particle: 'sparkles', style: '2D', accentColor: '#80d7de' },
  { id: 'builtin-background', name: 'Ambient Background', category: 'Background', type: 'landscape', particle: 'dust', style: '2D', accentColor: '#80a8dc' },
  { id: 'builtin-light', name: 'Light Sweep', category: 'Light', type: 'product', particle: 'sparkles', style: '3D', accentColor: '#ffe092' },
  { id: 'builtin-particles', name: 'Sparse Starlight', category: 'Particles', type: 'planet', particle: 'stars', style: '3D', accentColor: '#aaadff' },
  { id: 'builtin-geometry', name: 'Geometric Motion', category: 'Geometric', type: 'geometric object', particle: 'abstract', style: '2D', accentColor: '#95d5ff' },
  { id: 'builtin-3d', name: 'Soft 3D Depth', category: '3D Abstract', type: 'abstract object', particle: 'energy', style: '3D', accentColor: '#8d88ff' },
];

function makePreset(definition: typeof BUILTIN_DEFS[number]): MotionPreset {
  const plan = buildFallbackPlan({ fileName: definition.type, width: 1920, height: 1080, duration: 8, fps: 30, style: definition.style, selectedType: definition.type });
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    builtIn: true,
    plan,
    settings: {
      priorities: { subjectMotionStrength: 0.42, secondaryMotionStrength: 0.26, cameraMotionStrength: 0.16, effectsStrength: 0.24, particleStrength: 0.12 },
      particlesEnabled: true,
      particleType: definition.particle,
      cameraEnabled: true,
      parallaxStrength: 0.16,
      effectsEnabled: true,
      speed: 1,
      style: definition.style,
      fit: 'fit',
    },
    accentColor: definition.accentColor,
  };
}

export function getPresets(): MotionPreset[] {
  const builtIn = BUILTIN_DEFS.map(makePreset);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return builtIn;
    const parsed: unknown = JSON.parse(raw);
    const custom = z.array(PresetSchema).max(100).safeParse(parsed);
    return custom.success ? [...builtIn, ...custom.data] : builtIn;
  } catch {
    return builtIn;
  }
}

function saveCustomPresets(presets: MotionPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.filter((preset) => !preset.builtIn)));
  } catch {
    throw new Error('The browser could not save this preset locally.');
  }
}

export function createPreset(name: string, category: PresetCategory, plan: MotionPlan, settings: EditorSettings, accentColor = '#8199ff'): MotionPreset {
  return {
    id: crypto.randomUUID(), name: name.trim().slice(0, 100), category, builtIn: false,
    plan: structuredClone(plan),
    settings: {
      priorities: structuredClone(settings.priorities), particlesEnabled: settings.particlesEnabled, particleType: settings.particleType,
      cameraEnabled: settings.cameraEnabled, parallaxStrength: settings.parallaxStrength, effectsEnabled: settings.effectsEnabled,
      speed: settings.speed, style: settings.style, fit: settings.fit,
    },
    accentColor,
  };
}

export function savePreset(preset: MotionPreset) {
  if (preset.builtIn) throw new Error('Built-in presets cannot be overwritten. Duplicate it first.');
  PresetSchema.parse(preset);
  const presets = getPresets().filter((entry) => !entry.builtIn && entry.id !== preset.id);
  saveCustomPresets([...presets, preset]);
}

export function deletePreset(id: string) {
  const presets = getPresets().filter((entry) => !entry.builtIn && entry.id !== id);
  saveCustomPresets(presets);
}

export function renamePreset(preset: MotionPreset, name: string): MotionPreset {
  return { ...preset, name: name.trim().slice(0, 100) || preset.name };
}

export function duplicatePreset(preset: MotionPreset, name = `${preset.name} copy`): MotionPreset {
  return { ...preset, id: crypto.randomUUID(), name: name.trim().slice(0, 100), builtIn: false };
}

export function applyPreset(currentPlan: MotionPlan, preset: MotionPreset): MotionPlan {
  const next = structuredClone(currentPlan);
  const presetMain = preset.plan.layers.find((layer) => layer.kind === 'subject' && layer.importance >= 8)
    ?? preset.plan.layers.find((layer) => layer.kind === 'subject');
  const currentMain = next.layers.find((layer) => layer.kind === 'subject' && layer.importance >= 8)
    ?? next.layers.find((layer) => layer.kind === 'subject');
  for (const layer of next.layers) {
    const source = preset.plan.layers.find((candidate) => candidate.kind === layer.kind && candidate.kind !== 'subject');
    if (source) {
      layer.motions = source.motions.map((motion) => ({ ...motion, targetId: layer.id }));
      layer.keyframes = structuredClone(source.keyframes);
    }
  }
  if (currentMain && presetMain) {
    currentMain.motions = presetMain.motions.map((motion) => ({ ...motion, targetId: currentMain.id }));
    currentMain.keyframes = structuredClone(presetMain.keyframes);
  }
  next.camera = { ...structuredClone(preset.plan.camera), motion: next.layers.find((layer) => layer.kind === 'camera')?.motions ?? [] };
  next.effects = structuredClone(preset.plan.effects);
  next.effects.motion = next.effects.motion.map((motion) => ({ ...motion, targetId: 'effects' }));
  next.concept = {
    ...next.concept,
    summary: `${preset.name} applied to ${next.subjectAnalysis.mainSubject}. ${next.concept.summary}`,
    supporting: preset.plan.concept.supporting,
    camera: preset.plan.concept.camera,
  };
  return normalizePlan(next, currentPlan.duration, currentPlan.fps, 'edited');
}
