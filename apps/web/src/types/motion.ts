import { z } from 'zod';

export const SUBJECT_TYPES = [
  'person', 'portrait', 'face', 'animal', 'bird', 'car', 'vehicle', 'product',
  'machine', 'building', 'architecture', 'tree', 'plant', 'flower', 'landscape',
  'ocean', 'water', 'cloud', 'planet', 'space', 'brain', 'technology', 'device',
  'abstract object', 'geometric object', 'illustration', 'logo-like graphic', 'unknown',
] as const;

export const MOTION_TYPES = [
  'translation', 'rotation', 'scale', 'swing', 'float', 'drift', 'orbit', 'wave',
  'sway', 'pulse', 'bounce', 'spring', 'lightSweep', 'reflectionSweep', 'glowPulse',
  'parallax', 'cameraPush', 'cameraPan', 'cameraTilt', 'cameraTrack',
] as const;

export const EASINGS = [
  'linear', 'sineInOut', 'easeIn', 'easeOut', 'easeInOut', 'cubicInOut', 'spring',
] as const;

export const SUBJECT_TYPE_SCHEMA = z.string().min(1).max(48);
export const MOTION_TYPE_SCHEMA = z.enum(MOTION_TYPES);
export const EASING_SCHEMA = z.enum(EASINGS);

export const NormalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
}).strict();

export const SubjectRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().refine((region) => region.x + region.width <= 1.0001 && region.y + region.height <= 1.0001, {
  message: 'Normalized region must stay within image bounds',
});

export const SubjectMaskSchema = z.object({
  mode: z.enum(['rect', 'polygon', 'ellipse', 'alpha']),
  source: z.enum(['model-estimate', 'heuristic', 'user', 'segmentation', 'none']),
  confidence: z.enum(['high', 'approximate', 'unavailable']),
  region: SubjectRegionSchema.nullable(),
  polygon: z.array(NormalizedPointSchema).max(64).nullable(),
  alphaMaskDataUrl: z.string().max(8_000_000).nullable(),
  feather: z.number().min(0).max(0.12),
  note: z.string().max(240),
}).strict();

export const SubjectSchema = z.object({
  id: z.string().min(1).max(48),
  name: z.string().min(1).max(80),
  type: SUBJECT_TYPE_SCHEMA,
  importance: z.number().int().min(1).max(10),
  motionPotential: z.enum(['low', 'medium', 'high']),
  description: z.string().max(500),
  region: SubjectRegionSchema.nullable(),
  mask: SubjectMaskSchema,
}).strict();

export const MotionPrimitiveSchema = z.object({
  id: z.string().min(1).max(64),
  targetId: z.string().min(1).max(48),
  type: MOTION_TYPE_SCHEMA,
  intensity: z.number().min(0).max(1),
  startAt: z.number().min(0).max(1),
  endAt: z.number().min(0).max(1),
  direction: z.enum(['left', 'right', 'up', 'down', 'in', 'out', 'clockwise', 'counterclockwise', 'alternate', 'none']),
  easing: EASING_SCHEMA,
  reason: z.string().max(240),
  maskRequired: z.boolean(),
  enabled: z.boolean(),
}).strict().refine((motion) => motion.endAt > motion.startAt, {
  message: 'Motion endAt must be greater than startAt',
});

export const MotionKeyframeSchema = z.object({
  id: z.string().min(1).max(64),
  at: z.number().min(0).max(1),
  property: z.enum(['x', 'y', 'rotation', 'scale', 'opacity', 'wave', 'glow', 'light']),
  value: z.number().min(-2).max(2),
  easing: EASING_SCHEMA,
}).strict();

export const MotionLayerSchema = z.object({
  id: z.string().min(1).max(48),
  name: z.string().min(1).max(80),
  kind: z.enum(['background', 'subject', 'camera', 'lighting', 'particles', 'effect']),
  subjectId: z.string().min(1).max(48).nullable(),
  importance: z.number().int().min(0).max(10),
  zIndex: z.number().int().min(0).max(100),
  visible: z.boolean(),
  locked: z.boolean(),
  mask: SubjectMaskSchema.nullable(),
  motions: z.array(MotionPrimitiveSchema).max(32),
  keyframes: z.array(MotionKeyframeSchema).max(128),
}).strict();

export const MotionOpportunitySchema = z.object({
  targetId: z.string().min(1).max(48),
  motionType: MOTION_TYPE_SCHEMA,
  intensity: z.number().min(0).max(1),
  direction: z.enum(['left', 'right', 'up', 'down', 'in', 'out', 'clockwise', 'counterclockwise', 'alternate', 'none']),
  reason: z.string().min(1).max(240),
  maskRequired: z.boolean(),
  plausibility: z.enum(['high', 'medium', 'low']),
}).strict();

export const SceneMotionRegionSchema = z.object({
  id: z.string().min(1).max(48),
  subjectId: z.string().min(1).max(48),
  label: z.string().min(1).max(120),
  region: SubjectRegionSchema,
  reason: z.string().max(240),
}).strict();

export const StableSceneRegionSchema = z.object({
  id: z.string().min(1).max(48),
  label: z.string().min(1).max(120),
  /** Null means the full image/background plate rather than a local rectangle. */
  region: SubjectRegionSchema.nullable(),
  reason: z.string().max(240),
}).strict();

export const SubjectAnalysisSchema = z.object({
  mainSubject: z.string().min(1).max(120),
  subjectType: SUBJECT_TYPE_SCHEMA,
  motionPotential: z.enum(['low', 'medium', 'high']),
  description: z.string().min(1).max(700),
  secondarySubjects: z.array(z.string().max(120)).max(8),
  foreground: z.string().max(300),
  middleGround: z.string().max(300),
  background: z.string().max(300),
  backgroundStableByDefault: z.boolean().default(true),
  movingRegions: z.array(SceneMotionRegionSchema).max(16).default([]),
  stableRegions: z.array(StableSceneRegionSchema).max(24).default([]),
  composition: z.string().max(300),
  palette: z.array(z.string().max(40)).max(8),
  lighting: z.string().max(240),
  materials: z.array(z.string().max(60)).max(8),
  staticAreas: z.array(z.string().max(160)).max(8),
  limitations: z.array(z.string().max(200)).max(8),
}).strict();

export const MotionPlanSchema = z.object({
  version: z.literal('1.0'),
  subjectAnalysis: SubjectAnalysisSchema,
  subjects: z.array(SubjectSchema).min(1).max(9),
  motionOpportunities: z.array(MotionOpportunitySchema).max(24),
  layers: z.array(MotionLayerSchema).min(2).max(24),
  camera: z.object({
    motion: z.array(MotionPrimitiveSchema).max(8),
    strength: z.number().min(0).max(1),
    description: z.string().max(300),
  }).strict(),
  effects: z.object({
    motion: z.array(MotionPrimitiveSchema).max(12),
    particlesEnabled: z.boolean(),
    particleType: z.enum(['dust', 'sparkles', 'stars', 'technology', 'energy', 'abstract']),
    particleStrength: z.number().min(0).max(1),
    description: z.string().max(300),
  }).strict(),
  concept: z.object({
    summary: z.string().min(1).max(420),
    primary: z.string().min(1).max(240),
    secondary: z.string().max(240),
    supporting: z.string().max(240),
    camera: z.string().max(240),
  }).strict(),
  duration: z.number().min(1).max(120),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
  style: z.enum(['2D', '3D', 'Line Art']),
  source: z.enum(['gemini', 'local-fallback', 'edited']),
}).strict().superRefine((plan, ctx) => {
  const subjectLayers = plan.layers.filter((layer) => layer.kind === 'subject');
  const layerIds = new Set(plan.layers.map((layer) => layer.id));
  for (const subject of plan.subjects) {
    const layer = plan.layers.find((candidate) => candidate.id === subject.id);
    if (!layerIds.has(subject.id) || layer?.kind !== 'subject' || layer.subjectId !== subject.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subjects'], message: `Subject ${subject.id} must have a matching subject layer` });
    }
  }
  if (!plan.layers.some((layer) => layer.kind === 'background')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['layers'], message: 'A stable background layer is required' });
  }
  if (!subjectLayers.some((layer) => layer.importance >= 8)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['layers'], message: 'A primary subject animation layer is required' });
  }
  for (const region of plan.subjectAnalysis.movingRegions) {
    if (!subjectLayers.some((layer) => layer.id === region.subjectId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subjectAnalysis', 'movingRegions'], message: `Moving region ${region.id} targets a missing subject layer` });
    }
  }
  for (const layer of plan.layers) {
    for (const motion of layer.motions) {
      if (motion.targetId !== layer.id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Motion target ${motion.targetId} does not match layer ${layer.id}` });
      }
    }
  }
});

export type SubjectType = string;
export type MotionType = (typeof MOTION_TYPES)[number];
export type Easing = (typeof EASINGS)[number];
export type SubjectRegion = z.infer<typeof SubjectRegionSchema>;
export type SubjectMask = z.infer<typeof SubjectMaskSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type MotionPrimitive = z.infer<typeof MotionPrimitiveSchema>;
export type MotionKeyframe = z.infer<typeof MotionKeyframeSchema>;
export type MotionLayer = z.infer<typeof MotionLayerSchema>;
export type MotionOpportunity = z.infer<typeof MotionOpportunitySchema>;
export type MotionPlan = z.infer<typeof MotionPlanSchema>;

export type AspectRatioPreset = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '3:2' | '2:3' | '21:9' | 'custom';
export type ImageFit = 'fit' | 'fill' | 'crop' | 'center';
export type VisualStyle = '2D' | '3D' | 'Line Art';
export type VideoFormat = 'webm' | 'mp4';
export type ResolutionPreset = 'preview' | '720p' | '1080p' | '1440p' | '4K' | 'custom';

export interface MotionPriorities {
  subjectMotionStrength: number;
  secondaryMotionStrength: number;
  cameraMotionStrength: number;
  effectsStrength: number;
  particleStrength: number;
}

export interface EditorSettings {
  width: number;
  height: number;
  aspectRatio: AspectRatioPreset;
  fit: ImageFit;
  duration: number;
  fps: 24 | 25 | 30 | 50 | 60;
  speed: number;
  style: VisualStyle;
  priorities: MotionPriorities;
  particlesEnabled: boolean;
  particleType: 'dust' | 'sparkles' | 'stars' | 'technology' | 'energy' | 'abstract';
  cameraEnabled: boolean;
  parallaxStrength: number;
  effectsEnabled: boolean;
  loop: boolean;
  snap: boolean;
  timelineZoom: number;
  greenScreen: {
    enabled: boolean;
    color: 'green' | 'blue' | 'custom';
    customColor: string;
    tolerance: number;
    softness: number;
  };
  export: {
    resolution: ResolutionPreset;
    width: number;
    height: number;
    format: VideoFormat;
    quality: number;
  };
  seo: {
    title: string;
    description: string;
    keywords: string;
    tags: string;
    category: string;
    contentDescription: string;
    filename: string;
    aiDisclosure: string;
  };
}

export type EditorSettingsPatch = Omit<Partial<EditorSettings>, 'priorities' | 'greenScreen' | 'export' | 'seo'> & {
  priorities?: Partial<EditorSettings['priorities']>;
  greenScreen?: Partial<EditorSettings['greenScreen']>;
  export?: Partial<EditorSettings['export']>;
  seo?: Partial<EditorSettings['seo']>;
};

export interface MediaAsset {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  blob: Blob;
  objectUrl: string;
}

export interface ApiKeyConfig {
  id: string;
  label: string;
  key: string;
  model: string;
  enabled: boolean;
}

export interface ExportProgress {
  active: boolean;
  cancelled: boolean;
  currentFrame: number;
  totalFrames: number;
  startedAt: number;
  message: string;
  outputUrl?: string;
}

export interface BrowserCapabilities {
  webgl: boolean;
  webgl2: boolean;
  webCodecs: boolean;
  offscreenCanvas: boolean;
  mediaRecorder: boolean;
  supportedMp4: boolean;
  supportedWebm: boolean;
  subjectSegmentation: boolean;
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  width: 1920,
  height: 1080,
  aspectRatio: '16:9',
  fit: 'fit',
  duration: 8,
  fps: 30,
  speed: 1,
  style: '2D',
  priorities: {
    subjectMotionStrength: 0.4,
    secondaryMotionStrength: 0.3,
    cameraMotionStrength: 0.2,
    effectsStrength: 0.2,
    particleStrength: 0.15,
  },
  particlesEnabled: false,
  particleType: 'dust',
  cameraEnabled: false,
  parallaxStrength: 0.2,
  effectsEnabled: false,
  loop: false,
  snap: true,
  timelineZoom: 1,
  greenScreen: {
    enabled: false,
    color: 'green',
    customColor: '#00ff00',
    tolerance: 0.25,
    softness: 0.12,
  },
  export: {
    resolution: '1080p',
    width: 1920,
    height: 1080,
    format: 'webm',
    quality: 0.85,
  },
  seo: {
    title: '',
    description: '',
    keywords: '',
    tags: '',
    category: '',
    contentDescription: '',
    filename: 'motion-studio-export',
    aiDisclosure: '',
  },
};
