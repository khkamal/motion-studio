import { z } from 'zod';
import type { ApiKeyConfig } from '../types/motion';

const STORAGE_KEY = 'motion-studio.gemini-configs.v1';
const ConfigSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  key: z.string().min(8).max(256),
  model: z.string().min(1).max(100),
  enabled: z.boolean(),
}).strict();

export interface SavedApiConfigs {
  configs: ApiKeyConfig[];
  activeId: string | null;
}

export function loadApiConfigs(): SavedApiConfigs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { configs: [], activeId: null };
    const parsed = JSON.parse(raw) as { configs?: unknown; activeId?: unknown };
    const configs = z.array(ConfigSchema).max(30).safeParse(parsed.configs);
    if (!configs.success) return { configs: [], activeId: null };
    const activeId = typeof parsed.activeId === 'string' && configs.data.some((entry) => entry.id === parsed.activeId && entry.enabled)
      ? parsed.activeId
      : configs.data.find((entry) => entry.enabled)?.id ?? null;
    return { configs: configs.data, activeId };
  } catch {
    return { configs: [], activeId: null };
  }
}

export function saveApiConfigs(configs: ApiKeyConfig[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ configs, activeId }));
  } catch {
    throw new Error('The browser could not store Gemini settings locally. Check available storage space.');
  }
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${'•'.repeat(12)}${key.slice(-4)}`;
}
