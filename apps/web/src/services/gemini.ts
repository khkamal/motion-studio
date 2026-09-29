import { MotionPlanSchema, type ApiKeyConfig, type MotionPlan } from '../types/motion';
import { normalizePlan } from '../engine/planBuilder';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_IMAGE_EDGE = 1400;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string; status?: string };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const stride = 0x8000;
  for (let index = 0; index < bytes.length; index += stride) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + stride, bytes.length)));
  }
  return btoa(binary);
}

async function makeVisionPayload(blob: Blob): Promise<{ mimeType: string; data: string }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let compressed: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the image for Gemini vision.');
      context.drawImage(bitmap, 0, 0, width, height);
      compressed = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not prepare the image for Gemini vision.');
      canvas.width = width;
      canvas.height = height;
      context.drawImage(bitmap, 0, 0, width, height);
      compressed = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Image compression failed.')), 'image/jpeg', 0.82);
      });
    }
    return { mimeType: 'image/jpeg', data: bytesToBase64(new Uint8Array(await compressed.arrayBuffer())) };
  } finally {
    bitmap.close();
  }
}

function planInstructions(duration: number, fps: number, style: string): string {
  return `You are the visual motion director for an image-to-motion graphics editor. Analyze the supplied image itself and return exactly one JSON object matching the MotionPlan contract described below. Do not return Markdown or prose outside the JSON. The application validates every field and never executes code from you.

Creative and safety rules:
- Analyze the actual image pixels: name one main subject, list visible secondary subjects, describe the background, and identify image-coordinate regions that may move versus regions that must remain still.
- The main subject's own motion leads. Give it a dedicated subject layer, at least 3 meaningfully varying keyframes spanning normalized time 0 to 1, and at least one subject-specific motion primitive. Full-frame zoom, parallax, particles, or lighting never count as primary motion.
- Add one subject record/layer for every visible main or secondary subject; use importance 10 for the main subject and 1–7 for secondary subjects. Link each movingRegions record to the corresponding subject layer.
- Set backgroundStableByDefault to true, describe the unmodified source as the stable background, and give the background layer no motions or keyframes. Put only plausible, image-specific subject/material regions in movingRegions; put unanimated surroundings and objects in stableRegions.
- Secondary subject/material motion is next; camera is restrained; effects and particles are optional supporting accents.
- Choose motion that makes sense for THIS image. Prefer subtle, physically plausible movement over generic presets.
- A single still cannot reveal hidden surfaces. Do not invent unseen anatomy, text, object detail, or a perfect segmentation result.
- Every AI-estimated mask must use source "model-estimate" and confidence "approximate". Use coarse regions only when visually reasonable. If isolation is unreliable, say so in mask.note and limitations, avoid claiming independent cut-out motion, and choose conservative local material/light motion.
- Do not animate the whole image as if it were the subject. Avoid extreme camera movement, shake, deformations, or dense particles.
- Set duration exactly to ${duration} seconds, fps exactly to ${fps}, style exactly to "${style}", and source to "gemini".

Return this exact data shape (all fields required; no extra fields). Enum fields must contain one actual allowed value; never include pipe characters such as "low|medium|high": 
{
  "version":"1.0",
  "subjectAnalysis":{"mainSubject":"Primary subject label","subjectType":"specific category string","motionPotential":"medium","description":"Image-specific analysis","secondarySubjects":[],"foreground":"string","middleGround":"string","background":"describe the stable source background","backgroundStableByDefault":true,"movingRegions":[{"id":"moving-subject-1","subjectId":"subject_1","label":"main subject region","region":{"x":0.2,"y":0.2,"width":0.5,"height":0.6},"reason":"image-specific motion reason"}],"stableRegions":[{"id":"stable-background","label":"source background outside declared subject regions","region":null,"reason":"preserve the background pixels"}],"composition":"string","palette":["string"],"lighting":"string","materials":["string"],"staticAreas":["string"],"limitations":["string"]},
  "subjects":[{"id":"subject_1","name":"Main subject","type":"specific category string","importance":10,"motionPotential":"medium","description":"string","region":{"x":0.2,"y":0.2,"width":0.5,"height":0.6},"mask":{"mode":"ellipse","source":"model-estimate","confidence":"approximate","region":{"x":0.2,"y":0.2,"width":0.5,"height":0.6},"polygon":null,"alphaMaskDataUrl":null,"feather":0.02,"note":"coarse estimate, not pixel segmentation"}}],
  "motionOpportunities":[{"targetId":"subject_1","motionType":"sway","intensity":0.4,"direction":"alternate","reason":"image-specific reason","maskRequired":true,"plausibility":"medium"}],
  "layers":[{"id":"background","name":"Background","kind":"background","subjectId":null,"importance":0,"zIndex":0,"visible":true,"locked":true,"mask":null,"motions":[],"keyframes":[]},{"id":"subject_1","name":"Main Subject","kind":"subject","subjectId":"subject_1","importance":10,"zIndex":2,"visible":true,"locked":false,"mask":{"mode":"ellipse","source":"model-estimate","confidence":"approximate","region":{"x":0.2,"y":0.2,"width":0.5,"height":0.6},"polygon":null,"alphaMaskDataUrl":null,"feather":0.02,"note":"estimated"},"motions":[{"id":"subject-motion","targetId":"subject_1","type":"sway","intensity":0.4,"startAt":0,"endAt":1,"direction":"alternate","easing":"sineInOut","reason":"reason","maskRequired":true,"enabled":true}],"keyframes":[{"id":"key-0","at":0,"property":"x","value":0,"easing":"sineInOut"},{"id":"key-mid","at":0.5,"property":"x","value":0.02,"easing":"sineInOut"},{"id":"key-end","at":1,"property":"x","value":0.04,"easing":"sineInOut"}]},{"id":"camera","name":"Camera","kind":"camera","subjectId":null,"importance":2,"zIndex":3,"visible":true,"locked":false,"mask":null,"motions":[],"keyframes":[]},{"id":"lighting","name":"Lighting","kind":"lighting","subjectId":null,"importance":1,"zIndex":4,"visible":true,"locked":false,"mask":null,"motions":[],"keyframes":[]},{"id":"particles","name":"Particles","kind":"particles","subjectId":null,"importance":0,"zIndex":5,"visible":true,"locked":false,"mask":null,"motions":[],"keyframes":[]},{"id":"effects","name":"Effects","kind":"effect","subjectId":null,"importance":1,"zIndex":6,"visible":true,"locked":false,"mask":null,"motions":[],"keyframes":[]}],
  "camera":{"motion":[],"strength":0.2,"description":"restrained camera description"},
  "effects":{"motion":[],"particlesEnabled":true,"particleType":"dust","particleStrength":0.15,"description":"supporting effects"},
  "concept":{"summary":"image-specific motion concept","primary":"primary subject motion","secondary":"secondary material/subject motion","supporting":"optional effects","camera":"camera motion"},
  "duration":${duration},"fps":${fps},"style":"${style}","source":"gemini"
}

Supported motion types: translation, rotation, scale, swing, float, drift, orbit, wave, sway, pulse, bounce, spring, lightSweep, reflectionSweep, glowPulse, parallax, cameraPush, cameraPan, cameraTilt, cameraTrack.
Supported layer kinds: background, subject, camera, lighting, particles, effect. Main subject ID must match its subject layer ID; every motion.targetId must match the containing layer ID. Every movingRegions.subjectId must reference a subject layer. Keyframe values for x/y are normalized scene offsets, rotation is degrees, scale is a delta from 1, opacity is 0..1, and wave/glow/light are normalized values. Keep numeric changes subtle and non-static. The background layer must have no motions/keyframes. For every visible secondary subject, add a subject and matching subject layer (subject_2, etc.) and identify its moving/stable image regions. A model-estimated mask is never pixel segmentation: without a registered trusted mask provider, the renderer keeps its background intact and applies only clipped local material/light motion within the estimated region.`;
}

function getResponseText(response: GeminiResponse): string {
  if (response.error?.message) throw new Error(response.error.message);
  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) {
    const reason = candidate?.finishReason;
    throw new Error(reason ? `Gemini returned no motion plan (${reason}).` : 'Gemini returned no motion plan.');
  }
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function validateAndNormalize(text: string, duration: number, fps: MotionPlan['fps']): MotionPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned malformed JSON. Try again or use the local fallback plan.');
  }
  const validation = MotionPlanSchema.safeParse(parsed);
  if (!validation.success) {
    const details = validation.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'plan'}: ${issue.message}`).join('; ');
    throw new Error(`Gemini motion plan did not match the required schema. ${details}`);
  }
  const rawPlan = parsed as Record<string, unknown>;
  const rawAnalysis = rawPlan.subjectAnalysis && typeof rawPlan.subjectAnalysis === 'object'
    ? rawPlan.subjectAnalysis as Record<string, unknown>
    : null;
  const rawMovingRegions = rawAnalysis?.movingRegions;
  const rawStableRegions = rawAnalysis?.stableRegions;
  const main = validation.data.subjects.find((subject) => subject.name.toLowerCase() === validation.data.subjectAnalysis.mainSubject.toLowerCase())
    ?? validation.data.subjects.find((subject) => subject.importance === 10)
    ?? [...validation.data.subjects].sort((a, b) => b.importance - a.importance)[0];
  const hasMainMotionRegion = validation.data.subjectAnalysis.movingRegions.some((region) => region.subjectId === main?.id);
  const hasWholeBackgroundRegion = validation.data.subjectAnalysis.stableRegions.some((region) => region.region === null);
  if (rawAnalysis?.backgroundStableByDefault !== true
    || typeof rawAnalysis.background !== 'string'
    || !rawAnalysis.background.trim()
    || !Array.isArray(rawMovingRegions)
    || rawMovingRegions.length === 0
    || !Array.isArray(rawStableRegions)
    || rawStableRegions.length === 0
    || !hasWholeBackgroundRegion
    || !hasMainMotionRegion
    || !Array.isArray(rawAnalysis.secondarySubjects)
    || rawAnalysis.secondarySubjects.length !== validation.data.subjects.length - 1) {
    throw new Error('Gemini plan omitted the required image-specific moving/stable regions, background stability, or secondary-subject analysis.');
  }
  return normalizePlan(validation.data, duration, fps, 'gemini');
}

async function requestGemini(config: ApiKeyConfig, parts: Array<Record<string, unknown>>, signal?: AbortSignal, json = true): Promise<GeminiResponse> {
  const model = config.model.trim().replace(/^models\//, '');
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error('Model name contains unsupported characters.');
  const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.key,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: json
        ? { temperature: 0.25, responseMimeType: 'application/json', maxOutputTokens: 8192 }
        : { temperature: 0, maxOutputTokens: 32 },
    }),
    signal,
  });
  const payload = await response.json() as GeminiResponse;
  if (!response.ok) {
    const safeMessage = payload.error?.message ?? `Gemini request failed with HTTP ${response.status}.`;
    throw new Error(safeMessage.slice(0, 400));
  }
  return payload;
}

export async function generateGeminiMotionPlan(
  config: ApiKeyConfig,
  input: { blob: Blob; fileName: string; width: number; height: number; duration: number; fps: MotionPlan['fps']; style: string; subjectHint?: string },
  signal?: AbortSignal,
): Promise<MotionPlan> {
  const image = await makeVisionPayload(input.blob);
  const prompt = `${planInstructions(input.duration, input.fps, input.style)}\n\nImage metadata (file name is context only; analyze the pixels): ${JSON.stringify({ name: input.fileName, width: input.width, height: input.height, subjectHint: input.subjectHint && input.subjectHint !== 'auto' ? input.subjectHint : undefined })}`;
  const response = await requestGemini(config, [
    { text: prompt },
    { inline_data: { mime_type: image.mimeType, data: image.data } },
  ], signal);
  return validateAndNormalize(getResponseText(response), input.duration, input.fps);
}

export async function reviseGeminiMotionPlan(
  config: ApiKeyConfig,
  currentPlan: MotionPlan,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<MotionPlan> {
  const instruction = `Modify the existing motion plan according to the user's request. Do not redesign unrelated parts or replace the concept unnecessarily. Preserve subject analysis, movingRegions, stableRegions, layer IDs, masks, duration, FPS and style unless the request explicitly asks to change them. Keep backgroundStableByDefault true and the background layer free of motions/keyframes. Keep primary-subject motion stronger and more important than camera, particles, or effects. Estimated masks are not segmentation; without a trusted provider, prefer local material motion over shifting the subject cut-out. Return the full updated MotionPlan JSON only, with all fields valid.\n\nCurrent plan JSON:\n${JSON.stringify(currentPlan)}\n\nUser change request:\n${userPrompt}`;
  const response = await requestGemini(config, [{ text: instruction }], signal);
  return validateAndNormalize(getResponseText(response), currentPlan.duration, currentPlan.fps);
}

export async function testGeminiConfiguration(config: ApiKeyConfig, signal?: AbortSignal): Promise<string> {
  const response = await requestGemini(config, [{ text: 'Reply with exactly READY.' }], signal, false);
  const text = getResponseText(response);
  if (!text.toUpperCase().includes('READY')) throw new Error('Gemini responded, but the test phrase was not returned.');
  return `Connected to ${config.model}`;
}
