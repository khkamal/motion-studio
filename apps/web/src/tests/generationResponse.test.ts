import { describe, expect, it } from 'vitest';
import { readGenerationResponse } from '../services/generationResponse';

describe('generation response handling', () => {
  it('returns generated code from a successful JSON response', async () => {
    await expect(readGenerationResponse(new Response(JSON.stringify({ code: 'export default function createAnimation() {}' }), { status: 200 })))
      .resolves.toMatchObject({ code: 'export default function createAnimation() {}' });
  });

  it('explains an empty service response instead of exposing a JSON parse exception', async () => {
    await expect(readGenerationResponse(new Response('', { status: 502 })))
      .rejects.toThrow('returned no error details (HTTP 502)');
  });

  it('explains a non-JSON service response', async () => {
    await expect(readGenerationResponse(new Response('<html>bad gateway</html>', { status: 502 })))
      .rejects.toThrow('returned an invalid response (HTTP 502), not JSON');
  });

  it('surfaces structured API errors', async () => {
    await expect(readGenerationResponse(new Response(JSON.stringify({ error: 'Gemini key is invalid.' }), { status: 502 })))
      .rejects.toThrow('Gemini key is invalid.');
  });
});
