import { describe, expect, it } from 'vitest';
import { CODE_RUNTIME_VERSION, STARTER_ANIMATION, validateAnimationCode } from '../services/codeRuntime';

describe('generated animation contract v1', () => {
  it('identifies its runtime version and accepts the complete starter factory', () => {
    expect(CODE_RUNTIME_VERSION).toBe(1);
    expect(validateAnimationCode(STARTER_ANIMATION)).toBeNull();
  });
  it('rejects empty/oversized source and incomplete factories before execution', () => {
    expect(validateAnimationCode('')).toMatch(/empty/);
    expect(validateAnimationCode('export default function createAnimation(api) { return {}; }')).toMatch(/render/);
    expect(validateAnimationCode('x'.repeat(80_001))).toMatch(/80 KB/);
  });
});
