import { z } from 'zod';
import { MotionPlanSchema, type EditorSettings, type MediaAsset, type MotionPlan } from '../types/motion';

const STORE = 'projects';
const DB_NAME = 'motion-studio-projects';
const SETTINGS_SCHEMA = z.object({
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3', '3:2', '2:3', '21:9', 'custom']),
  fit: z.enum(['fit', 'fill', 'crop', 'center']),
  duration: z.number().min(1).max(120),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
  speed: z.number().min(0.25).max(3),
  style: z.enum(['2D', '3D', 'Line Art']),
  priorities: z.object({
    subjectMotionStrength: z.number().min(0).max(1), secondaryMotionStrength: z.number().min(0).max(1),
    cameraMotionStrength: z.number().min(0).max(1), effectsStrength: z.number().min(0).max(1), particleStrength: z.number().min(0).max(1),
  }).strict(),
  particlesEnabled: z.boolean(),
  particleType: z.enum(['dust', 'sparkles', 'stars', 'technology', 'energy', 'abstract']),
  cameraEnabled: z.boolean(),
  parallaxStrength: z.number().min(0).max(1),
  effectsEnabled: z.boolean(),
  loop: z.boolean(),
  snap: z.boolean(),
  timelineZoom: z.number().min(0.25).max(4),
  greenScreen: z.object({ enabled: z.boolean(), color: z.enum(['green', 'blue', 'custom']), customColor: z.string().max(20), tolerance: z.number().min(0).max(1), softness: z.number().min(0).max(1) }).strict(),
  export: z.object({ resolution: z.enum(['preview', '720p', '1080p', '1440p', '4K', 'custom']), width: z.number().int().min(16).max(7680), height: z.number().int().min(16).max(7680), format: z.enum(['webm', 'mp4']), quality: z.number().min(0.1).max(1) }).strict(),
  seo: z.object({ title: z.string().max(200), description: z.string().max(1000), keywords: z.string().max(1000), tags: z.string().max(1000), category: z.string().max(200), contentDescription: z.string().max(1500), filename: z.string().max(200), aiDisclosure: z.string().max(500) }).strict(),
}).strict();

const ProjectFileSchema = z.object({
  format: z.literal('motion-studio-project'),
  version: z.literal(1),
  name: z.string().min(1).max(200),
  savedAt: z.string().max(80),
  asset: z.object({ name: z.string().max(255), type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']), width: z.number().int().positive().max(30_000), height: z.number().int().positive().max(30_000), dataUrl: z.string().max(140_000_000) }).strict().nullable(),
  plan: MotionPlanSchema.nullable(),
  settings: SETTINGS_SCHEMA,
}).strict().superRefine((project, ctx) => {
  if (project.asset && !project.asset.dataUrl.startsWith(`data:${project.asset.type};base64,`)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['asset', 'dataUrl'], message: 'Project image MIME type does not match its asset metadata.' });
  }
});

export interface SavedProject {
  id: string;
  name: string;
  updatedAt: number;
  asset: { name: string; type: string; width: number; height: number; blob: Blob } | null;
  plan: MotionPlan | null;
  settings: EditorSettings;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open project storage.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Project storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Project storage was interrupted.'));
  });
}

export async function saveAutosave(project: SavedProject): Promise<void> {
  const database = await openDb();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(project);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadAutosave(): Promise<SavedProject | null> {
  const database = await openDb();
  try {
    const transaction = database.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get('autosave');
    const result = await new Promise<SavedProject | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as SavedProject | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not restore the project.'));
    });
    if (!result) return null;
    const parsedPlan = result.plan ? MotionPlanSchema.safeParse(result.plan) : { success: true as const, data: null };
    const parsedSettings = SETTINGS_SCHEMA.safeParse(result.settings);
    if (!parsedPlan.success || !parsedSettings.success) return null;
    return { ...result, plan: parsedPlan.data, settings: parsedSettings.data };
  } finally {
    database.close();
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length))));
  }
  return btoa(chunks.join(''));
}

export async function exportProjectFile(input: {
  name: string;
  asset: MediaAsset | null;
  plan: MotionPlan | null;
  settings: EditorSettings;
}): Promise<Blob> {
  const asset = input.asset ? {
    name: input.asset.name,
    type: input.asset.type,
    width: input.asset.width,
    height: input.asset.height,
    dataUrl: `data:${input.asset.type};base64,${arrayBufferToBase64(await input.asset.blob.arrayBuffer())}`,
  } : null;
  const file = {
    format: 'motion-studio-project' as const,
    version: 1 as const,
    name: input.name,
    savedAt: new Date().toISOString(),
    asset,
    plan: input.plan,
    settings: input.settings,
  };
  const checked = ProjectFileSchema.parse(file);
  return new Blob([JSON.stringify(checked)], { type: 'application/vnd.motion-studio.project+json' });
}

function decodeBase64(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) throw new Error('The project image data is invalid.');
  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function importProjectFile(file: File): Promise<{
  name: string;
  asset: { name: string; type: string; width: number; height: number; blob: Blob } | null;
  plan: MotionPlan | null;
  settings: EditorSettings;
}> {
  if (file.size > 140 * 1024 * 1024) throw new Error('Project files must be smaller than 140 MB.');
  const raw: unknown = JSON.parse(await file.text());
  const project = ProjectFileSchema.parse(raw);
  return {
    name: project.name,
    asset: project.asset ? { ...project.asset, blob: decodeBase64(project.asset.dataUrl) } : null,
    plan: project.plan,
    settings: project.settings,
  };
}
