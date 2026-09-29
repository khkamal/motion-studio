import type { EditorSettings, MotionKeyframe, MotionLayer, MotionPlan, MotionPrimitive, Easing } from '../types/motion';

export interface LayerTransform {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  opacity: number;
  wave: number;
  glow: number;
  light: number;
}

export interface EvaluatedScene {
  progress: number;
  camera: { x: number; y: number; zoom: number; rotation: number };
  layers: Map<string, LayerTransform>;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function easeProgress(value: number, easing: Easing): number {
  const t = clamp(value);
  switch (easing) {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'cubicInOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'spring': {
      const damped = 1 - Math.exp(-6 * t) * Math.cos(9 * t);
      return clamp(damped, 0, 1);
    }
    case 'sineInOut':
    default: return -(Math.cos(Math.PI * t) - 1) / 2;
  }
}

export function interpolateKeyframes(
  keyframes: MotionKeyframe[],
  property: MotionKeyframe['property'],
  progress: number,
  fallback = 0,
): number {
  const frames = keyframes.filter((keyframe) => keyframe.property === property).sort((a, b) => a.at - b.at);
  if (!frames.length) return fallback;
  const t = clamp(progress);
  if (t <= frames[0].at) return frames[0].value;
  if (t >= frames[frames.length - 1].at) return frames[frames.length - 1].value;
  const rightIndex = frames.findIndex((frame) => frame.at >= t);
  const right = frames[rightIndex];
  const left = frames[rightIndex - 1];
  const span = Math.max(0.000001, right.at - left.at);
  const local = easeProgress((t - left.at) / span, left.easing);
  return left.value + (right.value - left.value) * local;
}

function layerStrength(layer: MotionLayer, settings: EditorSettings): number {
  if (layer.kind === 'subject') {
    return layer.importance >= 8
      ? settings.priorities.subjectMotionStrength
      : settings.priorities.secondaryMotionStrength;
  }
  if (layer.kind === 'camera') return settings.cameraEnabled ? settings.priorities.cameraMotionStrength : 0;
  if (layer.kind === 'particles') return settings.particlesEnabled ? settings.priorities.particleStrength : 0;
  if (layer.kind === 'lighting' || layer.kind === 'effect') return settings.effectsEnabled ? settings.priorities.effectsStrength : 0;
  return 0;
}

function activeMotionProgress(motion: MotionPrimitive, progress: number): number | null {
  if (!motion.enabled || progress < motion.startAt || progress > motion.endAt) return null;
  const span = Math.max(0.000001, motion.endAt - motion.startAt);
  return easeProgress((progress - motion.startAt) / span, motion.easing);
}

function directionSign(direction: MotionPrimitive['direction']): number {
  if (direction === 'left' || direction === 'down' || direction === 'out' || direction === 'counterclockwise') return -1;
  if (direction === 'right' || direction === 'up' || direction === 'in' || direction === 'clockwise') return 1;
  return 0;
}

function applyProceduralMotion(
  transform: LayerTransform,
  layer: MotionLayer,
  plan: MotionPlan,
  settings: EditorSettings,
  progress: number,
) {
  const strength = layerStrength(layer, settings);
  for (const motion of layer.motions) {
    const local = activeMotionProgress(motion, progress);
    if (local === null) continue;
    const phase = progress * Math.PI * 2;
    const wave = Math.sin(phase);
    const directional = directionSign(motion.direction);
    const amount = motion.intensity * (motion.type === 'parallax' ? settings.parallaxStrength : strength);
    switch (motion.type) {
      case 'translation':
      case 'drift':
        transform.x += (directional || 1) * local * 0.045 * amount;
        break;
      case 'rotation':
      case 'swing':
      case 'sway':
        transform.rotation += wave * (motion.type === 'rotation' ? 2.2 : 1.4) * amount;
        break;
      case 'scale':
      case 'pulse':
        transform.scale += wave * 0.035 * amount;
        break;
      case 'float':
        transform.y += wave * 0.012 * amount;
        break;
      case 'wave':
        transform.wave += Math.abs(wave) * amount;
        break;
      case 'bounce':
        transform.y -= Math.abs(wave) * 0.018 * amount;
        break;
      case 'spring':
        transform.scale += Math.sin(local * Math.PI * 3) * (1 - local) * 0.06 * amount;
        break;
      case 'orbit':
        transform.x += Math.cos(phase) * 0.018 * amount;
        transform.y += Math.sin(phase) * 0.018 * amount;
        break;
      case 'glowPulse':
        transform.glow += (0.5 + 0.5 * wave) * amount;
        break;
      case 'lightSweep':
      case 'reflectionSweep':
        transform.light += Math.sin(local * Math.PI * 2) * amount;
        break;
      case 'parallax':
        // Parallax is deliberately a small background/secondary contribution.
        transform.x += directional * local * 0.012 * amount;
        break;
      case 'cameraPush':
        if (settings.cameraEnabled) transform.scale += local * 0.08 * amount * plan.camera.strength;
        break;
      case 'cameraPan':
      case 'cameraTrack':
        if (settings.cameraEnabled) transform.x += directional * local * 0.04 * amount * plan.camera.strength;
        break;
      case 'cameraTilt':
        if (settings.cameraEnabled) transform.rotation += directional * local * 1.2 * amount * plan.camera.strength;
        break;
    }
  }
}

function evaluateLayer(layer: MotionLayer, plan: MotionPlan, settings: EditorSettings, progress: number): LayerTransform {
  const strength = layerStrength(layer, settings);
  const transform: LayerTransform = {
    x: interpolateKeyframes(layer.keyframes, 'x', progress) * strength,
    y: interpolateKeyframes(layer.keyframes, 'y', progress) * strength,
    rotation: interpolateKeyframes(layer.keyframes, 'rotation', progress) * strength,
    scale: 1 + interpolateKeyframes(layer.keyframes, 'scale', progress) * strength,
    opacity: clamp(interpolateKeyframes(layer.keyframes, 'opacity', progress, 1), 0, 1),
    wave: interpolateKeyframes(layer.keyframes, 'wave', progress) * strength,
    glow: interpolateKeyframes(layer.keyframes, 'glow', progress) * strength,
    light: interpolateKeyframes(layer.keyframes, 'light', progress) * strength,
  };
  applyProceduralMotion(transform, layer, plan, settings, progress);
  transform.scale = clamp(transform.scale, 0.5, 1.5);
  transform.opacity = clamp(transform.opacity, 0, 1);
  transform.glow = clamp(transform.glow, 0, 1);
  transform.wave = clamp(transform.wave, 0, 1);
  return transform;
}

/** Evaluate all layer properties for one absolute preview/export time in seconds. */
export function evaluateScene(plan: MotionPlan, settings: EditorSettings, currentTime: number): EvaluatedScene {
  const rawProgress = clamp(Math.max(0, currentTime) / Math.max(0.001, settings.duration));
  // Timing is warped across the selected clip rather than changing video metadata or truncating the plan.
  // Faster values reach later keyframes sooner while still landing on the planned end pose at clip end.
  const progress = clamp(Math.pow(rawProgress, 1 / Math.max(0.25, settings.speed)));
  const layers = new Map<string, LayerTransform>();
  for (const layer of plan.layers) layers.set(layer.id, evaluateLayer(layer, plan, settings, progress));

  const cameraLayer = plan.layers.find((layer) => layer.kind === 'camera');
  const cameraTransform = cameraLayer ? layers.get(cameraLayer.id) : undefined;
  const camera: EvaluatedScene['camera'] = {
    x: (cameraTransform?.x ?? 0) * settings.width,
    y: (cameraTransform?.y ?? 0) * settings.height,
    zoom: cameraTransform?.scale ?? 1,
    rotation: cameraTransform?.rotation ?? 0,
  };
  return { progress, camera, layers };
}

export function totalFrames(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(duration * fps);
}

export function frameTime(frameIndex: number, fps: number): number {
  return Math.max(0, frameIndex) / Math.max(1, fps);
}

export function formatTime(timeSeconds: number, includeMilliseconds = false): string {
  const safe = Math.max(0, timeSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const fraction = Math.floor((safe - Math.floor(safe)) * 1000);
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return includeMilliseconds ? `${base}.${String(fraction).padStart(3, '0')}` : base;
}
