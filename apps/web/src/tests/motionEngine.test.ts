import { describe, expect, it } from 'vitest';
import { buildFallbackPlan, normalizePlan } from '../engine/planBuilder';
import { evaluateScene, frameTime, interpolateKeyframes, totalFrames } from '../engine/motionEngine';
import { MotionPlanSchema, DEFAULT_SETTINGS } from '../types/motion';

const cases = [
  { file: 'portrait.jpg', hint: 'auto', type: 'portrait', property: 'rotation' as const },
  { file: 'car-night.png', hint: 'auto', type: 'car', property: 'x' as const },
  { file: 'oak-tree.webp', hint: 'auto', type: 'tree', property: 'wave' as const },
  { file: 'studio-product.png', hint: 'auto', type: 'product', property: 'rotation' as const },
  { file: 'tech-circuit.jpg', hint: 'auto', type: 'technology', property: 'glow' as const },
  { file: 'abstract-shapes.png', hint: 'auto', type: 'abstract object', property: 'glow' as const },
];

describe('subject-first deterministic motion plan', () => {
  it.each(cases)('$file produces a category-specific animated subject layer', ({ file, hint, type, property }) => {
    const plan = buildFallbackPlan({ fileName: file, width: 1600, height: 900, duration: 8, fps: 30, style: '2D', selectedType: hint });
    const main = plan.layers.find((layer) => layer.kind === 'subject' && layer.importance >= 8);
    expect(plan.subjectAnalysis.subjectType).toBe(type);
    expect(main).toBeDefined();
    expect(main!.motions.length).toBeGreaterThan(0);
    expect(main!.keyframes.length).toBeGreaterThanOrEqual(3);
    expect(main!.keyframes.some((frame) => frame.property === property)).toBe(true);
    expect(main!.mask?.confidence).toBe('approximate');
    expect(main!.mask?.source).not.toBe('segmentation');
    expect(plan.layers.find((layer) => layer.kind === 'camera')?.motions.length).toBeGreaterThan(0);
  });

  it.each(cases)('$file changes the main subject state over the selected clip', ({ file, hint, property }) => {
    const plan = buildFallbackPlan({ fileName: file, width: 1920, height: 1080, duration: 8, fps: 30, style: '2D', selectedType: hint });
    const subjectLayer = plan.layers.find((layer) => layer.kind === 'subject')!;
    const start = evaluateScene(plan, DEFAULT_SETTINGS, 0).layers.get(subjectLayer.id)!;
    const middle = evaluateScene(plan, DEFAULT_SETTINGS, 4).layers.get(subjectLayer.id)!;
    const end = evaluateScene(plan, DEFAULT_SETTINGS, 7.96).layers.get(subjectLayer.id)!;
    const read = (state: typeof start) => state[property];
    expect(Math.abs(read(start) - read(middle)) + Math.abs(read(middle) - read(end))).toBeGreaterThan(0.0001);
  });

  it('declares image-specific moving regions and holds the background layer static', () => {
    const plan = buildFallbackPlan({ fileName: 'oak-tree.webp', width: 1600, height: 900, duration: 8, fps: 30, style: '2D' });
    const main = plan.layers.find((layer) => layer.kind === 'subject' && layer.importance === 10)!;
    const background = plan.layers.find((layer) => layer.kind === 'background')!;
    expect(plan.subjectAnalysis.backgroundStableByDefault).toBe(true);
    expect(plan.subjectAnalysis.movingRegions.some((region) => region.subjectId === main.id && region.region)).toBe(true);
    expect(plan.subjectAnalysis.stableRegions.some((region) => region.id === 'stable-background')).toBe(true);
    expect(background.motions).toHaveLength(0);
    expect(background.keyframes).toHaveLength(0);
    expect(main.keyframes.filter((frame) => frame.at === 0 || frame.at === 0.5 || frame.at === 1).length).toBeGreaterThanOrEqual(3);
    expect(main.motions.some((motion) => motion.enabled && motion.intensity > 0)).toBe(true);
    expect(main.motions.some((motion) => ['wave', 'glowPulse', 'lightSweep', 'reflectionSweep'].includes(motion.type))).toBe(true);
    expect(DEFAULT_SETTINGS.cameraEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.particlesEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.effectsEnabled).toBe(false);
  });

  it('keeps camera and particles subordinate to the subject defaults', () => {
    const plan = buildFallbackPlan({ fileName: 'car.jpg', width: 1920, height: 1080, duration: 8, fps: 30, style: '2D' });
    expect(DEFAULT_SETTINGS.priorities.subjectMotionStrength).toBe(0.4);
    expect(DEFAULT_SETTINGS.priorities.cameraMotionStrength).toBe(0.2);
    expect(DEFAULT_SETTINGS.priorities.effectsStrength).toBe(0.2);
    expect(DEFAULT_SETTINGS.priorities.particleStrength).toBe(0.15);
    expect(plan.camera.strength).toBeLessThan(0.5);
    expect(plan.effects.particleStrength).toBeLessThan(0.2);
    const cameraStart = evaluateScene(plan, DEFAULT_SETTINGS, 0).camera.zoom;
    const cameraEnd = evaluateScene(plan, DEFAULT_SETTINGS, 7.9).camera.zoom;
    expect(Math.abs(cameraEnd - cameraStart)).toBeLessThan(0.03);
  });

  it('warps animation timing for speed without changing the selected endpoint', () => {
    const plan = buildFallbackPlan({ fileName: 'car.jpg', width: 1920, height: 1080, duration: 8, fps: 30, style: '2D' });
    const subjectId = plan.layers.find((layer) => layer.kind === 'subject')!.id;
    const normalScene = evaluateScene(plan, { ...structuredClone(DEFAULT_SETTINGS), speed: 1 }, 4);
    const fasterScene = evaluateScene(plan, { ...structuredClone(DEFAULT_SETTINGS), speed: 2 }, 4);
    const slowerScene = evaluateScene(plan, { ...structuredClone(DEFAULT_SETTINGS), speed: 0.5 }, 4);
    const normal = normalScene.layers.get(subjectId)!;
    const faster = fasterScene.layers.get(subjectId)!;
    const slower = slowerScene.layers.get(subjectId)!;
    expect(fasterScene.progress).toBeGreaterThan(normalScene.progress);
    expect(slowerScene.progress).toBeLessThan(normalScene.progress);
    expect(faster.glow).not.toBeCloseTo(normal.glow, 3);
    expect(slower.glow).not.toBeCloseTo(normal.glow, 3);
    expect(evaluateScene(plan, { ...structuredClone(DEFAULT_SETTINGS), speed: 2 }, 8).progress).toBe(1);
  });

  it('uses exact selected duration and frame-rate counts', () => {
    expect(totalFrames(8, 30)).toBe(240);
    expect(totalFrames(10, 30)).toBe(300);
    expect(totalFrames(15, 30)).toBe(450);
    expect(frameTime(239, 30)).toBeCloseTo(7.9666, 3);
    expect(frameTime(239, 30)).toBeLessThan(8);
  });

  it('normalizes a generated subject plan to the selected duration and FPS', () => {
    const plan = buildFallbackPlan({ fileName: 'product.png', width: 1600, height: 900, duration: 8, fps: 30, style: '2D' });
    const normalized = normalizePlan(plan, 11, 60, 'edited');
    expect(normalized.duration).toBe(11);
    expect(normalized.fps).toBe(60);
    expect(totalFrames(normalized.duration, normalized.fps)).toBe(660);
    const main = normalized.layers.find((layer) => layer.kind === 'subject' && layer.importance === 10)!;
    const end = evaluateScene(normalized, { ...structuredClone(DEFAULT_SETTINGS), duration: 11, fps: 60 }, 11).layers.get(main.id)!;
    expect(Number.isFinite(end.x + end.y + end.rotation + end.scale)).toBe(true);
  });

  it('interpolates keyframes with the requested easing', () => {
    const plan = buildFallbackPlan({ fileName: 'car.jpg', width: 1920, height: 1080, duration: 8, fps: 30, style: '2D' });
    const frames = plan.layers.find((layer) => layer.kind === 'subject')!.keyframes;
    const x = interpolateKeyframes(frames, 'x', 0.5);
    expect(x).toBeCloseTo(0.045, 4);
  });

  it('never treats a Gemini-estimated box as segmentation or lets it animate the background', () => {
    const plan = buildFallbackPlan({ fileName: 'product.png', width: 1000, height: 1000, duration: 8, fps: 30, style: '2D' });
    const aiLike = structuredClone(plan);
    aiLike.source = 'gemini';
    aiLike.subjectAnalysis.backgroundStableByDefault = false;
    aiLike.layers.find((layer) => layer.kind === 'background')!.motions.push({
      id: 'unsafe-background-parallax', targetId: 'background', type: 'parallax', intensity: 0.8, startAt: 0, endAt: 1,
      direction: 'left', easing: 'linear', reason: 'unsafe', maskRequired: false, enabled: true,
    });
    aiLike.subjects[0].mask = { ...aiLike.subjects[0].mask, source: 'segmentation', confidence: 'high', alphaMaskDataUrl: 'data:image/png;base64,AA==' };
    aiLike.layers.find((layer) => layer.kind === 'subject')!.mask = structuredClone(aiLike.subjects[0].mask);
    const normalized = normalizePlan(aiLike, 8, 30, 'gemini');
    const background = normalized.layers.find((layer) => layer.kind === 'background')!;
    expect(normalized.subjects[0].mask.source).toBe('model-estimate');
    expect(normalized.subjects[0].mask.confidence).toBe('approximate');
    expect(normalized.subjects[0].mask.alphaMaskDataUrl).toBeNull();
    expect(normalized.subjectAnalysis.backgroundStableByDefault).toBe(true);
    expect(background.motions).toHaveLength(0);
    expect(background.keyframes).toHaveLength(0);
  });

  it('strictly rejects unsafe or malformed plan data', () => {
    const plan = buildFallbackPlan({ fileName: 'portrait.jpg', width: 1080, height: 1920, duration: 8, fps: 30, style: '2D' });
    expect(MotionPlanSchema.safeParse(plan).success).toBe(true);
    const unsafe = { ...plan, generatedCode: 'alert(1)' };
    expect(MotionPlanSchema.safeParse(unsafe).success).toBe(false);
    const malformed = { ...plan, duration: -1 };
    expect(MotionPlanSchema.safeParse(malformed).success).toBe(false);
  });
});
