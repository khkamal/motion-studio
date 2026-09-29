import { describe, expect, it } from 'vitest';
import { applyLocalMotionPrompt } from '../engine/manualEdits';
import { buildFallbackPlan } from '../engine/planBuilder';
import { DEFAULT_SETTINGS } from '../types/motion';

describe('manual plan refinement', () => {
  it('removes particles without replacing the motion plan', () => {
    const plan = buildFallbackPlan({ fileName: 'oak-tree.png', width: 1920, height: 1080, duration: 8, fps: 30, style: '2D' });
    const result = applyLocalMotionPrompt(plan, structuredClone(DEFAULT_SETTINGS), 'Remove particles.');
    expect(result.changed).toBe(true);
    expect(result.plan.subjectAnalysis.mainSubject).toBe(plan.subjectAnalysis.mainSubject);
    expect(result.plan.layers.find((layer) => layer.kind === 'subject')?.keyframes).toEqual(plan.layers.find((layer) => layer.kind === 'subject')?.keyframes);
    expect(result.plan.effects.particlesEnabled).toBe(false);
    expect(result.settings.particlesEnabled).toBe(false);
  });

  it('can keep the camera static while preserving main-subject keyframes', () => {
    const plan = buildFallbackPlan({ fileName: 'product-shot.png', width: 1080, height: 1350, duration: 8, fps: 30, style: '3D' });
    const result = applyLocalMotionPrompt(plan, structuredClone(DEFAULT_SETTINGS), 'Keep the camera static.');
    expect(result.changed).toBe(true);
    expect(result.settings.cameraEnabled).toBe(false);
    expect(result.settings.priorities.cameraMotionStrength).toBe(0);
    expect(result.plan.layers.find((layer) => layer.kind === 'subject')?.keyframes).toEqual(plan.layers.find((layer) => layer.kind === 'subject')?.keyframes);
  });

  it('reduces subject motion on the existing plan when requested', () => {
    const plan = buildFallbackPlan({ fileName: 'car.jpg', width: 1920, height: 1080, duration: 8, fps: 30, style: '2D' });
    const result = applyLocalMotionPrompt(plan, structuredClone(DEFAULT_SETTINGS), 'Reduce subject motion by 50%.');
    const before = plan.layers.find((layer) => layer.kind === 'subject')!;
    const after = result.plan.layers.find((layer) => layer.kind === 'subject')!;
    expect(result.changed).toBe(true);
    expect(after.motions[0].intensity).toBeCloseTo(before.motions[0].intensity * 0.5);
    expect(result.settings.priorities.subjectMotionStrength).toBeCloseTo(0.2);
    expect(after.id).toBe(before.id);
  });

  it('does not claim to understand unrecognized free-form prompts offline', () => {
    const plan = buildFallbackPlan({ fileName: 'unknown.png', width: 1000, height: 1000, duration: 8, fps: 30, style: '2D' });
    const result = applyLocalMotionPrompt(plan, structuredClone(DEFAULT_SETTINGS), 'Make the city lights sparkle in a cinematic rhythm.');
    expect(result.changed).toBe(false);
    expect(result.plan).toBe(plan);
    expect(result.message).toContain('Add a Gemini key');
  });
});
