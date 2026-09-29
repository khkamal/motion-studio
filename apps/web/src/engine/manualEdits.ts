import { MotionPlanSchema, type EditorSettings, type MotionPlan } from '../types/motion';
import { normalizePlan } from './planBuilder';

export interface LocalPromptResult {
  plan: MotionPlan;
  settings: EditorSettings;
  changed: boolean;
  message: string;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function applyLocalMotionPrompt(plan: MotionPlan, settings: EditorSettings, prompt: string): LocalPromptResult {
  const text = prompt.toLowerCase();
  const nextPlan = structuredClone(plan);
  const nextSettings: EditorSettings = structuredClone(settings);
  const main = nextPlan.layers.find((layer) => layer.kind === 'subject' && layer.importance >= 8)
    ?? nextPlan.layers.find((layer) => layer.kind === 'subject');
  const notices: string[] = [];
  let changed = false;

  if (/keep|make|set|leave/.test(text) && /camera (static|still|off)|no camera|static camera/.test(text)) {
    nextSettings.cameraEnabled = false;
    nextSettings.priorities.cameraMotionStrength = 0;
    notices.push('camera held static');
    changed = true;
  } else if (/camera/.test(text) && /reduce|less|subtle|weaker/.test(text)) {
    nextSettings.priorities.cameraMotionStrength = clamp(nextSettings.priorities.cameraMotionStrength * 0.5);
    notices.push('camera motion reduced');
    changed = true;
  }

  if (/remove|no|disable|turn off/.test(text) && /particles|sparkles|dust|stars/.test(text)) {
    nextSettings.particlesEnabled = false;
    nextPlan.effects.particlesEnabled = false;
    nextPlan.effects.particleStrength = 0;
    notices.push('particles removed');
    changed = true;
  } else if (/more|increase|add/.test(text) && /particles|sparkles|dust|stars/.test(text)) {
    nextSettings.particlesEnabled = true;
    nextPlan.effects.particlesEnabled = true;
    nextPlan.effects.particleStrength = Math.min(0.28, Math.max(0.1, nextPlan.effects.particleStrength + 0.06));
    nextSettings.priorities.particleStrength = Math.min(0.3, nextSettings.priorities.particleStrength + 0.04);
    notices.push('a sparse particle accent was increased');
    changed = true;
  }

  if (main && /reduce|less|subtle|softer/.test(text) && /subject|motion/.test(text)) {
    main.motions = main.motions.map((motion) => ({ ...motion, intensity: clamp(motion.intensity * 0.5) }));
    main.keyframes = main.keyframes.map((frame) => ({ ...frame, value: frame.property === 'opacity' ? frame.value : frame.value * 0.5 }));
    nextSettings.priorities.subjectMotionStrength = clamp(nextSettings.priorities.subjectMotionStrength * 0.5);
    notices.push('primary subject motion reduced by about 50%');
    changed = true;
  } else if (main && /faster|more motion|stronger|increase/.test(text) && /subject|move|motion/.test(text)) {
    main.motions = main.motions.map((motion) => ({ ...motion, intensity: clamp(motion.intensity * 1.2) }));
    nextSettings.priorities.subjectMotionStrength = Math.min(1, nextSettings.priorities.subjectMotionStrength * 1.15);
    nextSettings.speed = Math.min(3, nextSettings.speed * 1.15);
    notices.push('subject movement made more pronounced and faster');
    changed = true;
  }

  if (main && /slower|slow down/.test(text)) {
    nextSettings.speed = Math.max(0.25, nextSettings.speed * 0.75);
    notices.push('animation timing slowed');
    changed = true;
  }

  if (main && /sway|leaves|branches|tree|natural/.test(text) && /tree|plant|nature|leaf|branch/.test(nextPlan.subjectAnalysis.subjectType)) {
    const sway = main.motions.find((motion) => ['sway', 'wave'].includes(motion.type));
    if (sway) sway.intensity = Math.min(0.72, sway.intensity + 0.12);
    else main.motions.push({ id: `${main.id}-natural-sway`, targetId: main.id, type: 'sway', intensity: 0.28, startAt: 0, endAt: 1, direction: 'alternate', easing: 'sineInOut', reason: 'A user-requested natural foliage sway.', maskRequired: true, enabled: true });
    main.keyframes = main.keyframes.map((frame) => ({ ...frame, easing: 'sineInOut' }));
    notices.push('foliage sway softened with a natural easing');
    changed = true;
  }

  if (main && /rotate|tilt/.test(text) && /product|object|subject/.test(text)) {
    const rotationFrames = main.keyframes.filter((frame) => frame.property === 'rotation');
    if (rotationFrames.length) main.keyframes = main.keyframes.map((frame) => frame.property === 'rotation' ? { ...frame, value: clamp(frame.value * 1.2, -4, 4) } : frame);
    else main.keyframes.push(
      { id: `${main.id}-rotation-0`, at: 0, property: 'rotation', value: 0, easing: 'sineInOut' },
      { id: `${main.id}-rotation-mid`, at: 0.5, property: 'rotation', value: 1.2, easing: 'sineInOut' },
      { id: `${main.id}-rotation-end`, at: 1, property: 'rotation', value: 0.25, easing: 'sineInOut' },
    );
    if (!main.motions.some((motion) => motion.type === 'rotation')) main.motions.push({ id: `${main.id}-rotation`, targetId: main.id, type: 'rotation', intensity: 0.18, startAt: 0, endAt: 1, direction: 'alternate', easing: 'sineInOut', reason: 'A small user-requested independent subject tilt.', maskRequired: Boolean(main.mask), enabled: true });
    notices.push('subject tilt added');
    changed = true;
  }

  if (/increase|more|stronger/.test(text) && /pulse|neural|glow/.test(text)) {
    if (main) {
      main.motions = main.motions.map((motion) => ['pulse', 'glowPulse'].includes(motion.type) ? { ...motion, intensity: Math.min(0.85, motion.intensity + 0.16) } : motion);
      main.keyframes = main.keyframes.map((frame) => frame.property === 'glow' ? { ...frame, value: Math.min(1, frame.value + 0.15) } : frame);
    }
    nextSettings.priorities.effectsStrength = Math.min(0.65, nextSettings.priorities.effectsStrength + 0.08);
    notices.push('internal pulse and glow increased');
    changed = true;
  }

  if (!changed) {
    return { plan, settings, changed: false, message: 'Local prompt controls could not safely interpret that request. Add a Gemini key for free-form edits to the existing plan.' };
  }
  nextPlan.source = 'edited';
  const normalized = normalizePlan(MotionPlanSchema.parse(nextPlan), settings.duration, settings.fps, 'edited');
  return { plan: normalized, settings: nextSettings, changed: true, message: `Applied locally: ${notices.join('; ')}.` };
}
