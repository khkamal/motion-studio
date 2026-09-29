import {
  MotionPlanSchema,
  type MotionKeyframe,
  type MotionLayer,
  type MotionPlan,
  type MotionPrimitive,
  type Subject,
  type SubjectMask,
  type SubjectType,
} from '../types/motion';

export interface FallbackPlanInput {
  fileName: string;
  width: number;
  height: number;
  duration: number;
  fps: MotionPlan['fps'];
  style: MotionPlan['style'];
  selectedType?: string;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function inferType(fileName: string, selectedType?: string): SubjectType {
  if (selectedType && selectedType !== 'auto') return selectedType;
  const name = fileName.toLowerCase();
  const clues: Array<[RegExp, SubjectType]> = [
    [/portrait|person|people|woman|man|face|human/, 'portrait'],
    [/bird|eagle|owl|parrot/, 'bird'],
    [/animal|dog|cat|horse|wildlife/, 'animal'],
    [/car|vehicle|auto|truck|motorcycle/, 'car'],
    [/tree|forest|leaf|leaves|plant|flower|nature/, 'tree'],
    [/product|bottle|shoe|watch|package/, 'product'],
    [/brain|neural|neuron/, 'brain'],
    [/tech|circuit|device|machine|robot|chip/, 'technology'],
    [/planet|moon|space|galaxy|star/, 'planet'],
    [/ocean|sea|water|wave|lake|river/, 'water'],
    [/building|architecture|house|city/, 'architecture'],
    [/abstract|shape|geometric|gradient|logo/, 'abstract object'],
  ];
  return clues.find(([pattern]) => pattern.test(name))?.[1] ?? 'unknown';
}

function regionFor(type: SubjectType) {
  if (/car|vehicle|machine/.test(type)) return { x: 0.19, y: 0.37, width: 0.62, height: 0.34 };
  if (/tree|plant|flower/.test(type)) return { x: 0.33, y: 0.12, width: 0.34, height: 0.76 };
  if (/portrait|person|face/.test(type)) return { x: 0.36, y: 0.08, width: 0.28, height: 0.84 };
  if (/bird|animal/.test(type)) return { x: 0.3, y: 0.22, width: 0.4, height: 0.52 };
  if (/water|ocean|landscape|cloud/.test(type)) return { x: 0.04, y: 0.34, width: 0.92, height: 0.48 };
  return { x: 0.32, y: 0.18, width: 0.36, height: 0.64 };
}

function displayName(type: SubjectType): string {
  const labels: Record<string, string> = {
    portrait: 'Portrait subject', person: 'Person', face: 'Face', bird: 'Bird', animal: 'Animal',
    car: 'Vehicle', vehicle: 'Vehicle', product: 'Product', machine: 'Machine', tree: 'Tree',
    plant: 'Plant', flower: 'Flower', water: 'Water', ocean: 'Ocean', brain: 'Brain',
    technology: 'Technology subject', device: 'Device', planet: 'Planet', space: 'Space object',
    architecture: 'Architecture', building: 'Building', landscape: 'Landscape',
    'abstract object': 'Abstract form', 'geometric object': 'Geometric form',
    illustration: 'Illustrated subject', 'logo-like graphic': 'Graphic mark', unknown: 'Central subject',
  };
  return labels[type] ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function makeMask(type: SubjectType): SubjectMask {
  const region = regionFor(type);
  return {
    mode: 'ellipse',
    source: 'heuristic',
    confidence: 'approximate',
    region,
    polygon: null,
    alphaMaskDataUrl: null,
    feather: 0.025,
    note: 'Estimated center region only. This is not a pixel-accurate segmentation; edit or replace the mask for precise cut-outs.',
  };
}

function keyframe(id: string, at: number, property: MotionKeyframe['property'], value: number): MotionKeyframe {
  return { id, at, property, value, easing: 'sineInOut' };
}

function primitive(
  id: string,
  targetId: string,
  type: MotionPrimitive['type'],
  intensity: number,
  reason: string,
  direction: MotionPrimitive['direction'] = 'alternate',
  maskRequired = false,
): MotionPrimitive {
  return {
    id,
    targetId,
    type,
    intensity: clamp(intensity),
    startAt: 0,
    endAt: 1,
    direction,
    easing: 'sineInOut',
    reason,
    maskRequired,
    enabled: true,
  };
}

function layer(
  id: string,
  name: string,
  kind: MotionLayer['kind'],
  zIndex: number,
  options: Partial<MotionLayer> = {},
): MotionLayer {
  return {
    id,
    name,
    kind,
    subjectId: null,
    importance: 0,
    zIndex,
    visible: true,
    locked: kind === 'background',
    mask: null,
    motions: [],
    keyframes: [],
    ...options,
  };
}

const PRIMARY_SUBJECT_MOTIONS = new Set<MotionPrimitive['type']>([
  'translation', 'rotation', 'scale', 'swing', 'float', 'drift', 'orbit', 'wave', 'sway', 'pulse', 'bounce', 'spring',
  'glowPulse', 'lightSweep', 'reflectionSweep',
]);
const LOCAL_MATERIAL_MOTIONS = new Set<MotionPrimitive['type']>(['wave', 'glowPulse', 'lightSweep', 'reflectionSweep']);
function hasTrustedSubjectMask(mask: SubjectMask | null | undefined) {
  return mask?.confidence === 'high' && (mask.source === 'segmentation' || mask.source === 'user');
}

function ensureSubjectTimelineTrack(layer: MotionLayer, canMoveIndependently: boolean) {
  const properties: MotionKeyframe['property'][] = canMoveIndependently
    ? ['wave', 'glow', 'light', 'x', 'y', 'rotation', 'scale', 'opacity']
    : ['wave', 'glow', 'light', 'rotation', 'x', 'y', 'scale', 'opacity'];
  const dynamicProperty = properties.find((property) => {
    const values = layer.keyframes.filter((frame) => frame.property === property).map((frame) => frame.value);
    return values.length >= 2 && Math.max(...values) - Math.min(...values) > 0.002;
  });
  const property = dynamicProperty ?? (canMoveIndependently ? 'x' : 'glow');
  const seededValues: Record<MotionKeyframe['property'], [number, number, number]> = {
    x: [0, 0.035, 0.008], y: [0, -0.025, 0.005], rotation: [0, 1.2, -0.3], scale: [0, 0.035, 0.008],
    opacity: [0.88, 1, 0.92], wave: [0.12, 0.52, 0.2], glow: [0.06, 0.42, 0.14], light: [-0.18, 0.4, -0.08],
  };
  if (!dynamicProperty) layer.keyframes = layer.keyframes.filter((frame) => frame.property !== property);
  const existingFrames = layer.keyframes.filter((frame) => frame.property === property).sort((a, b) => a.at - b.at);
  const valueAt = (at: number) => {
    if (!existingFrames.length) return seededValues[property][at === 0 ? 0 : at === 1 ? 2 : 1];
    if (at <= existingFrames[0].at) return existingFrames[0].value;
    if (at >= existingFrames[existingFrames.length - 1].at) return existingFrames[existingFrames.length - 1].value;
    const rightIndex = existingFrames.findIndex((frame) => frame.at >= at);
    const left = existingFrames[rightIndex - 1];
    const right = existingFrames[rightIndex];
    const mix = (at - left.at) / Math.max(0.0001, right.at - left.at);
    return left.value + (right.value - left.value) * mix;
  };
  for (const [index, at] of [0, 0.5, 1].entries()) {
    if (!existingFrames.some((frame) => Math.abs(frame.at - at) < 0.01)) {
      layer.keyframes.push(keyframe(`${layer.id}-ensure-${property}-${index}`.slice(0, 64), at, property, valueAt(at)));
    }
  }
}

function motionForType(type: SubjectType) {
  if (/car|vehicle/.test(type)) {
    return {
      main: [primitive('subject-translation', 'subject_1', 'translation', 0.52, 'A restrained forward glide gives the vehicle the primary action.', 'right', true)],
      keyframes: [
        keyframe('sx0', 0, 'x', 0), keyframe('sx1', 0.5, 'x', 0.045), keyframe('sx2', 1, 'x', 0.09),
        keyframe('sr0', 0, 'rotation', 0), keyframe('sr1', 0.55, 'rotation', -0.35), keyframe('sr2', 1, 'rotation', 0.25),
      ],
      camera: 'A very light tracking move follows the subject; the camera stays secondary.',
      subjectReason: 'Vehicle translation is the primary motion; direction is kept small because a single still cannot reveal unseen road or wheel detail.',
      secondaries: ['reflectionSweep', 'lightSweep'] as MotionPrimitive['type'][] ,
    };
  }
  if (/tree|plant|flower/.test(type)) {
    return {
      main: [primitive('subject-sway', 'subject_1', 'sway', 0.48, 'A gentle wind-like sway is plausible for foliage.', 'alternate', true), primitive('subject-wave', 'subject_1', 'wave', 0.34, 'A low-amplitude local wave adds leaf and branch movement without moving the whole frame.', 'alternate', true)],
      keyframes: [
        keyframe('sy0', 0, 'rotation', -0.55), keyframe('sy1', 0.28, 'rotation', 0.8), keyframe('sy2', 0.68, 'rotation', -0.45), keyframe('sy3', 1, 'rotation', 0.3),
        keyframe('sw0', 0, 'wave', 0.2), keyframe('sw1', 0.5, 'wave', 0.62), keyframe('sw2', 1, 'wave', 0.32),
      ],
      camera: 'A restrained push supports the foliage movement without competing with it.',
      subjectReason: 'Branch and leaf sway is the primary motion; trunk and background should remain comparatively steady.',
      secondaries: ['lightSweep'] as MotionPrimitive['type'][] ,
    };
  }
  if (/portrait|person|face/.test(type)) {
    return {
      main: [primitive('subject-float', 'subject_1', 'float', 0.2, 'Only a subtle posture drift is safe without a true portrait segmentation or hidden-view synthesis.', 'alternate', true)],
      keyframes: [
        keyframe('sp0', 0, 'x', 0), keyframe('sp1', 0.5, 'x', 0.008), keyframe('sp2', 1, 'x', 0.002),
        keyframe('sr0', 0, 'rotation', 0), keyframe('sr1', 0.5, 'rotation', 0.3), keyframe('sr2', 1, 'rotation', -0.2),
      ],
      camera: 'Almost static camera; preserving facial geometry takes priority over camera movement.',
      subjectReason: 'The portrait gets only a slight independent posture drift. No unsupported facial expression or eye animation is invented.',
      secondaries: ['lightSweep', 'glowPulse'] as MotionPrimitive['type'][] ,
    };
  }
  if (/bird|animal/.test(type)) {
    return {
      main: [primitive('subject-drift', 'subject_1', 'drift', 0.38, 'A mild body drift provides a readable subject action; wing articulation is not assumed without a wing mask.', 'right', true), primitive('subject-swing', 'subject_1', 'swing', 0.18, 'A tiny counter-swing softens the travel.', 'alternate', true)],
      keyframes: [
        keyframe('sa0', 0, 'x', 0), keyframe('sa1', 0.52, 'x', 0.03), keyframe('sa2', 1, 'x', 0.055),
        keyframe('sab0', 0, 'y', 0), keyframe('sab1', 0.5, 'y', -0.012), keyframe('sab2', 1, 'y', 0.006),
      ],
      camera: 'A small follow movement accompanies the animal without replacing its own drift.',
      subjectReason: 'The animal is animated as its own layer; wing flaps are omitted unless a suitable mask is available.',
      secondaries: ['lightSweep'] as MotionPrimitive['type'][] ,
    };
  }
  if (/product/.test(type)) {
    return {
      main: [primitive('product-tilt', 'subject_1', 'rotation', 0.34, 'A small independent product tilt adds dimensionality without pretending to reconstruct unseen surfaces.', 'alternate', true), primitive('product-float', 'subject_1', 'float', 0.22, 'A restrained float supports the product hero motion.', 'alternate', true)],
      keyframes: [
        keyframe('sd0', 0, 'rotation', -0.45), keyframe('sd1', 0.38, 'rotation', 0.9), keyframe('sd2', 0.72, 'rotation', -0.4), keyframe('sd3', 1, 'rotation', 0.35),
        keyframe('sc0', 0, 'scale', 0), keyframe('sc1', 0.5, 'scale', 0.022), keyframe('sc2', 1, 'scale', 0.006),
      ],
      camera: 'A very soft camera push complements the product tilt.',
      subjectReason: 'The product layer tilts independently while reflections provide secondary movement; no full 3D rotation is implied.',
      secondaries: ['reflectionSweep', 'lightSweep'] as MotionPrimitive['type'][] ,
    };
  }
  if (/brain|technology|device|machine|abstract|geometric/.test(type)) {
    return {
      main: [primitive('subject-pulse', 'subject_1', 'pulse', 0.3, 'A restrained internal pulse is plausible for a technology or abstract subject.', 'alternate', true), primitive('subject-glow', 'subject_1', 'glowPulse', 0.4, 'A localized glow supports the primary subject rather than replacing it.', 'alternate', false)],
      keyframes: [
        keyframe('st0', 0, 'scale', 0), keyframe('st1', 0.5, 'scale', 0.025), keyframe('st2', 1, 'scale', 0.008),
        keyframe('sg0', 0, 'glow', 0.15), keyframe('sg1', 0.42, 'glow', 0.7), keyframe('sg2', 0.82, 'glow', 0.22), keyframe('sg3', 1, 'glow', 0.15),
      ],
      camera: 'A modest push adds depth, subordinate to the subject pulse.',
      subjectReason: 'Localized pulse and glow create internal subject motion. Geometry remains intact rather than being arbitrarily distorted.',
      secondaries: ['lightSweep', 'reflectionSweep'] as MotionPrimitive['type'][] ,
    };
  }
  if (/planet|space/.test(type)) {
    return {
      main: [primitive('planet-rotation', 'subject_1', 'rotation', 0.24, 'A slight rotation is plausible for a planet, but is deliberately not a full orbital spin from one still.', 'clockwise', true), primitive('planet-glow', 'subject_1', 'glowPulse', 0.24, 'A subtle atmospheric rim pulse supports the planet.', 'alternate', false)],
      keyframes: [
        keyframe('spc0', 0, 'rotation', 0), keyframe('spc1', 1, 'rotation', 1.4),
        keyframe('spl0', 0, 'glow', 0.18), keyframe('spl1', 0.55, 'glow', 0.5), keyframe('spl2', 1, 'glow', 0.25),
      ],
      camera: 'A minimal camera push preserves the planet as the visual focus.',
      subjectReason: 'A controlled rotation and atmospheric pulse animate the planet as its own layer; orbiting content remains supporting.',
      secondaries: ['glowPulse'] as MotionPrimitive['type'][] ,
    };
  }
  if (/water|ocean|landscape|cloud/.test(type)) {
    return {
      main: [primitive('environment-wave', 'subject_1', 'wave', 0.34, 'Low-amplitude wave motion suits a water or cloud region; the still background is otherwise preserved.', 'alternate', true)],
      keyframes: [
        keyframe('swv0', 0, 'wave', 0.18), keyframe('swv1', 0.34, 'wave', 0.55), keyframe('swv2', 0.72, 'wave', 0.24), keyframe('swv3', 1, 'wave', 0.42),
        keyframe('sgy0', 0, 'y', 0), keyframe('sgy1', 1, 'y', -0.006),
      ],
      camera: 'A gentle push is the only camera move; the environmental wave remains primary.',
      subjectReason: 'The selected water/sky band moves locally through a modest wave field instead of shifting the entire image.',
      secondaries: ['lightSweep'] as MotionPrimitive['type'][] ,
    };
  }
  return {
    main: [primitive('subject-float', 'subject_1', 'float', 0.18, 'A subtle center-region float is used because the subject cannot be identified confidently offline.', 'alternate', true)],
    keyframes: [
      keyframe('su0', 0, 'x', 0), keyframe('su1', 0.5, 'x', 0.012), keyframe('su2', 1, 'x', 0.025),
      keyframe('suy0', 0, 'y', 0), keyframe('suy1', 0.5, 'y', -0.008), keyframe('suy2', 1, 'y', 0.004),
    ],
    camera: 'The camera push is kept very light while the estimated central subject receives its own drift.',
    subjectReason: 'A conservative local subject drift is generated, but the central region is a heuristic and should be checked before export.',
    secondaries: ['lightSweep'] as MotionPrimitive['type'][] ,
  };
}

export function buildFallbackPlan(input: FallbackPlanInput): MotionPlan {
  const subjectType = inferType(input.fileName, input.selectedType);
  const subjectName = displayName(subjectType);
  const region = regionFor(subjectType);
  const mask = makeMask(subjectType);
  const motion = motionForType(subjectType);
  const subjectMotions = motion.main;
  const subjectKeyframes = motion.keyframes;
  const cameraMotion = primitive('camera-push', 'camera', 'cameraPush', 0.24, motion.camera, 'in');
  const lightMotion = primitive('light-sweep', 'lighting', 'lightSweep', 0.18, 'A soft, slow highlight sweep provides material movement only.', 'right');
  const subject: Subject = {
    id: 'subject_1',
    name: subjectName,
    type: subjectType,
    importance: 10,
    motionPotential: subjectType === 'unknown' ? 'low' : 'medium',
    description: `Local fallback selected ${subjectName.toLowerCase()} from the filename/category hint and image dimensions (${input.width} × ${input.height}). No semantic vision model or pixel segmentation ran.`,
    region,
    mask,
  };
  const layers: MotionLayer[] = [
    layer('background', 'Background', 'background', 0),
    layer('subject_1', 'Main Subject', 'subject', 2, {
      subjectId: 'subject_1', importance: 10, mask, motions: subjectMotions, keyframes: subjectKeyframes,
    }),
    layer('camera', 'Camera', 'camera', 3, {
      motions: [cameraMotion],
      keyframes: [keyframe('cam0', 0, 'scale', 0), keyframe('cam1', 1, 'scale', 0.025)],
    }),
    layer('lighting', 'Lighting', 'lighting', 4, {
      motions: [lightMotion],
      keyframes: [keyframe('light0', 0, 'light', -0.2), keyframe('light1', 0.55, 'light', 0.55), keyframe('light2', 1, 'light', -0.1)],
    }),
    layer('particles', 'Particles', 'particles', 5, {
      motions: [primitive('particles-drift', 'particles', 'drift', 0.08, 'Sparse atmosphere is a supporting accent only.', 'up')],
      keyframes: [],
    }),
    layer('effects', 'Effects', 'effect', 6, {
      motions: motion.secondaries.map((type, index) => primitive(`secondary-${index}`, 'effects', type, 0.14, 'A restrained supporting material effect, kept below subject motion.', 'alternate')),
      keyframes: [keyframe('effect0', 0, 'glow', 0.1), keyframe('effect1', 0.5, 'glow', 0.28), keyframe('effect2', 1, 'glow', 0.12)],
    }),
  ];
  const plan: MotionPlan = {
    version: '1.0',
    subjectAnalysis: {
      mainSubject: subjectName,
      subjectType,
      motionPotential: subject.motionPotential,
      description: `${subject.description} Meaningful local motion is planned conservatively; inspect the estimated region before using a pronounced translation.`,
      secondarySubjects: [],
      foreground: 'Not semantically segmented in local fallback mode.',
      middleGround: 'Not semantically segmented in local fallback mode.',
      background: 'The original image remains the stable background plate; only the estimated subject region is eligible for local material motion.',
      backgroundStableByDefault: true,
      movingRegions: [{ id: 'moving-subject-1', subjectId: 'subject_1', label: subjectName, region, reason: motion.subjectReason }],
      stableRegions: [{ id: 'stable-background', label: 'Unmodified background and image areas outside the moving region', region: null, reason: 'The source plate is held still. The estimated subject region is not pixel segmentation.' }],
      composition: input.width >= input.height ? 'Landscape or square composition based on source dimensions.' : 'Portrait composition based on source dimensions.',
      palette: [],
      lighting: 'Not semantically analyzed offline; a restrained material-light pass is optional.',
      materials: [],
      staticAreas: ['Areas outside the estimated subject region', 'Background composition'],
      limitations: ['No Gemini vision analysis was available.', 'The heuristic mask is approximate and is not pixel segmentation.', 'Single-image motion cannot reveal hidden surfaces.'],
    },
    subjects: [subject],
    motionOpportunities: [
      ...subjectMotions.map((item) => ({
        targetId: 'subject_1', motionType: item.type, intensity: item.intensity, direction: item.direction,
        reason: item.reason, maskRequired: item.maskRequired,
        plausibility: item.maskRequired ? 'medium' as const : 'high' as const,
      })),
      { targetId: 'camera', motionType: 'cameraPush', intensity: 0.24, direction: 'in', reason: 'Camera movement remains secondary to the subject motion.', maskRequired: false, plausibility: 'high' },
    ],
    layers,
    camera: { motion: [cameraMotion], strength: 0.24, description: motion.camera },
    effects: {
      motion: [lightMotion],
      particlesEnabled: true,
      particleType: /brain|tech|device/.test(subjectType) ? 'technology' : /planet|space/.test(subjectType) ? 'stars' : 'dust',
      particleStrength: 0.08,
      description: 'Optional light and particle accents are supporting motion and remain below the main subject.',
    },
    concept: {
      summary: `${subjectName} receives a conservative subject-local motion pass, supported by restrained lighting and a secondary camera move. The region is a heuristic, not segmentation.`,
      primary: subjectMotions.map((item) => item.reason).join(' '),
      secondary: motion.secondaries.map((item) => item.replace(/([A-Z])/g, ' $1').toLowerCase()).join(' and '),
      supporting: 'Subtle light movement; sparse optional particles.',
      camera: motion.camera,
    },
    duration: input.duration,
    fps: input.fps,
    style: input.style,
    source: 'local-fallback',
  };
  return normalizePlan(MotionPlanSchema.parse(plan), input.duration, input.fps, 'local-fallback');
}

export function normalizePlan(plan: MotionPlan, duration = plan.duration, fps = plan.fps, source = plan.source): MotionPlan {
  const copy: MotionPlan = structuredClone(plan);
  copy.duration = duration;
  copy.fps = fps;
  copy.source = source;
  const honestMask = (mask: SubjectMask): SubjectMask => {
    if (source === 'gemini') {
      return {
        ...mask,
        mode: mask.mode === 'alpha' ? 'ellipse' : mask.mode,
        source: 'model-estimate',
        confidence: mask.region ? 'approximate' : 'unavailable',
        alphaMaskDataUrl: null,
        note: `${mask.note} Gemini regions are estimates, not pixel segmentation.`.slice(0, 240),
      };
    }
    if (!mask.region) return { ...mask, confidence: 'unavailable', alphaMaskDataUrl: mask.source === 'user' || mask.source === 'segmentation' ? mask.alphaMaskDataUrl : null };
    if ((mask.source === 'heuristic' || mask.source === 'model-estimate') && mask.confidence === 'high') {
      return { ...mask, confidence: 'approximate', alphaMaskDataUrl: null };
    }
    return { ...mask, alphaMaskDataUrl: mask.source === 'user' || mask.source === 'segmentation' ? mask.alphaMaskDataUrl : null };
  };
  copy.subjects = copy.subjects.map((subject) => ({ ...subject, region: subject.region ?? subject.mask.region, mask: honestMask(subject.mask) }));
  copy.layers = copy.layers.map((candidate) => ({ ...candidate, mask: candidate.mask ? honestMask(candidate.mask) : null }));
  for (const candidate of copy.layers) {
    candidate.keyframes = candidate.keyframes.map((frame) => {
      const limit = candidate.kind === 'subject' ? 0.14 : candidate.kind === 'camera' ? 0.06 : 1;
      const limits: Record<MotionKeyframe['property'], [number, number]> = {
        x: [-limit, limit], y: [-limit, limit], rotation: [candidate.kind === 'subject' ? -5 : -2, candidate.kind === 'subject' ? 5 : 2],
        scale: [-0.15, 0.15], opacity: [0, 1], wave: [0, 1], glow: [0, 1], light: [-1, 1],
      };
      const [min, max] = limits[frame.property];
      return { ...frame, value: clamp(frame.value, min, max) };
    });
    const motionCap = candidate.kind === 'camera' ? 0.35 : candidate.kind === 'particles' ? 0.35 : candidate.kind === 'subject' ? 0.8 : 0.5;
    candidate.motions = candidate.motions.map((motion) => ({ ...motion, intensity: Math.min(motion.intensity, motionCap) }));
    if (candidate.kind === 'background') {
      candidate.visible = true;
      candidate.locked = true;
      candidate.motions = [];
      candidate.keyframes = [];
    }
  }

  const mainSubject = copy.subjects.find((subject) => subject.name.toLowerCase() === copy.subjectAnalysis.mainSubject.toLowerCase())
    ?? copy.subjects.find((subject) => subject.importance === 10)
    ?? [...copy.subjects].sort((a, b) => b.importance - a.importance)[0];
  if (mainSubject) {
    if (!copy.subjects.some((subject) => subject.name.toLowerCase() === copy.subjectAnalysis.mainSubject.toLowerCase())) {
      copy.subjectAnalysis.mainSubject = mainSubject.name;
    }
    for (const subject of copy.subjects) subject.importance = subject.id === mainSubject.id ? 10 : Math.min(subject.importance, 7);
  }
  const main = copy.layers.find((candidate) => candidate.kind === 'subject' && candidate.id === mainSubject?.id)
    ?? copy.layers.find((candidate) => candidate.kind === 'subject');
  const subjectLayers = copy.layers.filter((candidate) => candidate.kind === 'subject');
  for (const subjectLayer of subjectLayers) {
    const subject = copy.subjects.find((entry) => entry.id === subjectLayer.id);
    if (subject) {
      subjectLayer.subjectId = subject.id;
      subjectLayer.mask = structuredClone(subject.mask);
      subjectLayer.importance = subject.id === main?.id ? 10 : Math.min(subject.importance, 7);
    }
    const canMoveIndependently = hasTrustedSubjectMask(subjectLayer.mask);
    if (subjectLayer.id === main?.id) {
      subjectLayer.visible = true;
      subjectLayer.locked = false;
    }
    // Keep intended transforms in the plan so a runtime trusted provider can use them when available.
    // The renderer suppresses independent movement while this layer only has an estimated mask.
    subjectLayer.motions = subjectLayer.motions.filter((motion) => PRIMARY_SUBJECT_MOTIONS.has(motion.type));
    if (!subjectLayer.motions.some((motion) => motion.enabled && motion.intensity > 0)) {
      subjectLayer.motions.push(primitive(`${subjectLayer.id}-safe-motion`, subjectLayer.id, canMoveIndependently ? 'float' : 'glowPulse', canMoveIndependently ? 0.18 : 0.24,
        canMoveIndependently
          ? 'A restrained transform animates the isolated subject layer.'
          : 'A local material/light pulse animates inside the estimated subject region; the cut-out and background remain intact.',
        'alternate', false));
    }
    if (!canMoveIndependently && !subjectLayer.motions.some((motion) => motion.enabled && motion.intensity > 0 && LOCAL_MATERIAL_MOTIONS.has(motion.type))) {
      subjectLayer.motions.push(primitive(`${subjectLayer.id}-material-pulse`, subjectLayer.id, 'glowPulse', 0.24,
        'The estimated region is not treated as a precise cut-out; a local material pulse keeps this subject track active without shifting the background.',
        'alternate', false));
    }
    ensureSubjectTimelineTrack(subjectLayer, canMoveIndependently);
  }
  const independentMask = hasTrustedSubjectMask(main?.mask);
  const approximateSubjectIds = new Set(subjectLayers.filter((layer) => !hasTrustedSubjectMask(layer.mask)).map((layer) => layer.id));
  copy.motionOpportunities = copy.motionOpportunities.filter((opportunity) => {
    if (!approximateSubjectIds.has(opportunity.targetId)) return true;
    return subjectLayers.find((layer) => layer.id === opportunity.targetId)?.motions.some((motion) => motion.type === opportunity.motionType) ?? false;
  });
  for (const layer of subjectLayers) {
    for (const motion of layer.motions) {
      if (copy.motionOpportunities.length >= 24 || copy.motionOpportunities.some((opportunity) => opportunity.targetId === layer.id && opportunity.motionType === motion.type)) continue;
      copy.motionOpportunities.push({
        targetId: layer.id,
        motionType: motion.type,
        intensity: motion.intensity,
        direction: motion.direction,
        reason: motion.reason,
        maskRequired: hasTrustedSubjectMask(layer.mask) && motion.maskRequired,
        plausibility: hasTrustedSubjectMask(layer.mask) ? 'high' : 'medium',
      });
    }
  }
  if (main) {
    const motionReason = main.motions.map((motion) => motion.reason).join(' ') || 'The main subject has a time-varying motion track.';
    copy.concept.primary = independentMask
      ? motionReason.slice(0, 240)
      : `Estimated region: ${motionReason} Rendered as a clipped local material highlight; no cut-out is moved.`.slice(0, 240);
    if (!independentMask) {
      copy.concept.summary = `${mainSubject?.name ?? copy.subjectAnalysis.mainSubject} has its own time-varying subject track. With an estimated mask, transforms drive a clipped local material highlight and the original background stays intact.`.slice(0, 420);
    }
  }

  const backgroundLayer = copy.layers.find((candidate) => candidate.kind === 'background');
  if (backgroundLayer) {
    backgroundLayer.visible = true;
    backgroundLayer.locked = true;
    backgroundLayer.motions = [];
    backgroundLayer.keyframes = [];
  }
  const cameraLayer = copy.layers.find((candidate) => candidate.kind === 'camera');
  if (cameraLayer && cameraLayer.motions.length === 0 && copy.camera.motion.length > 0) {
    cameraLayer.motions = copy.camera.motion.map((motion) => ({ ...motion, targetId: cameraLayer.id, intensity: Math.min(motion.intensity, 0.35) }));
  }
  if (cameraLayer) copy.camera.motion = cameraLayer.motions.map((motion) => ({ ...motion, targetId: cameraLayer.id }));
  const lightingLayer = copy.layers.find((candidate) => candidate.kind === 'lighting');
  const effectLayer = copy.layers.find((candidate) => candidate.kind === 'effect');
  if (lightingLayer && lightingLayer.motions.length === 0) {
    lightingLayer.motions = copy.effects.motion
      .filter((motion) => ['lightSweep', 'reflectionSweep', 'glowPulse'].includes(motion.type))
      .map((motion) => ({ ...motion, targetId: lightingLayer.id }));
  }
  if (effectLayer && effectLayer.motions.length === 0) {
    effectLayer.motions = copy.effects.motion.map((motion) => ({ ...motion, targetId: effectLayer.id }));
  }

  copy.subjectAnalysis.backgroundStableByDefault = true;
  const subjectIds = new Set(copy.subjects.map((subject) => subject.id));
  const movingRegions = copy.subjectAnalysis.movingRegions.filter((region) => subjectIds.has(region.subjectId));
  for (const subject of copy.subjects) {
    if (movingRegions.some((region) => region.subjectId === subject.id)) continue;
    const region = subject.region ?? subject.mask.region;
    if (region) movingRegions.push({ id: `moving-${subject.id}`.slice(0, 48), subjectId: subject.id, label: subject.name, region, reason: subject.description.slice(0, 240) });
  }
  copy.subjectAnalysis.movingRegions = movingRegions.slice(0, 16);
  const stableRegions = copy.subjectAnalysis.stableRegions.filter((region) => region.id !== 'stable-background');
  stableRegions.unshift({ id: 'stable-background', label: 'Background and image areas outside the moving subject region', region: null, reason: 'The source background plate remains still by default; only declared subject regions receive local motion.' });
  copy.subjectAnalysis.stableRegions = stableRegions.slice(0, 24);
  copy.subjectAnalysis.secondarySubjects = copy.subjects.filter((subject) => subject.id !== main?.id).map((subject) => subject.name).slice(0, 8);
  if (main && main.mask?.confidence !== 'high') {
    copy.subjectAnalysis.limitations = [...new Set([...copy.subjectAnalysis.limitations, 'No trusted pixel-accurate subject mask is available; the renderer uses conservative material/light motion within an estimated region and keeps the source background intact.'])].slice(0, 8);
  }

  copy.camera.strength = Math.min(copy.camera.strength, 0.4);
  copy.effects.particleStrength = Math.min(copy.effects.particleStrength, 0.5);
  return MotionPlanSchema.parse(copy);
}

export function suggestSeo(plan: MotionPlan, filename: string) {
  const main = plan.subjectAnalysis.mainSubject;
  const type = plan.subjectAnalysis.subjectType;
  const cleanName = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const title = `${main} Motion Graphic`;
  return {
    title,
    description: plan.concept.summary,
    keywords: [type, 'motion graphics', 'image animation', 'visual design', ...plan.subjectAnalysis.palette].join(', '),
    tags: [type, 'motion graphics', 'animation'].join(', '),
    category: /nature|tree|water|ocean|landscape/.test(type) ? 'Nature' : /brain|tech|device/.test(type) ? 'Technology' : 'Motion Design',
    contentDescription: `${main}; ${plan.subjectAnalysis.description}`,
    filename: cleanName ? `${cleanName}-motion` : 'motion-studio-export',
    aiDisclosure: plan.source === 'gemini' ? 'AI-assisted motion plan; source imagery supplied by the creator.' : 'Procedural motion plan generated locally from available image metadata.',
  };
}
