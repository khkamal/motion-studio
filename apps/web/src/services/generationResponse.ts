export interface GenerationPayload {
  code: string;
  error?: string;
  model?: string;
}

/** Parse the generation endpoint defensively so empty/proxy error responses don't surface as a raw JSON SyntaxError. */
export async function readGenerationResponse(response: Response): Promise<GenerationPayload> {
  const body = await response.text();
  if (!body.trim()) {
    const detail = response.ok
      ? `The generation service returned an empty response (HTTP ${response.status}). Retry, and check the API deployment if it continues.`
      : `The generation service returned no error details (HTTP ${response.status}). Retry, and check the API deployment if it continues.`;
    throw new Error(detail);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`The generation service returned an invalid response (HTTP ${response.status}), not JSON. Retry, and check the API deployment if it continues.`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`The generation service returned an unexpected response (HTTP ${response.status}).`);
  }
  const result = payload as Partial<GenerationPayload>;
  if (!response.ok) {
    throw new Error(typeof result.error === 'string' && result.error.trim()
      ? result.error
      : `Generation failed (HTTP ${response.status}).`);
  }
  if (typeof result.error === 'string' && result.error.trim()) throw new Error(result.error);
  if (typeof result.code !== 'string' || !result.code.trim()) {
    throw new Error('The generation service returned no animation code. Retry, and check the API deployment if it continues.');
  }
  return result as GenerationPayload;
}
