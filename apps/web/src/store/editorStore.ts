import { create } from 'zustand';
import type { RecreateScene } from '../engine/recreate';
import { DEFAULT_SETTINGS, type ApiKeyConfig, type EditorSettings, type EditorSettingsPatch, type ExportProgress, type MediaAsset, type MotionPlan } from '../types/motion';

export type InspectorTab = 'motion' | 'presets' | 'seo' | 'export';

export interface HistorySnapshot {
  plan: MotionPlan | null;
  settings: EditorSettings;
}

interface EditorState {
  asset: MediaAsset | null;
  plan: MotionPlan | null;
  recreateScene: RecreateScene | null;
  /** True once the person has run Generate (or opened a saved project). Heavy local masking waits for this. */
  hasGenerated: boolean;
  generationMode: 'recreate' | 'icon' | 'animate';
  /** Typed design direction for Recreate, e.g. "dark neon background, orbit layout, coins". */
  directionPrompt: string;
  /** loading: the AI is writing a motion idea for the uploaded image. ai / local: where the text in the box came from. */
  ideaStatus: 'idle' | 'loading' | 'ai' | 'local';
  /** true once the person has typed in the box, so an automatic idea never replaces their words. */
  ideaEdited: boolean;
  settings: EditorSettings;
  currentTime: number;
  isPlaying: boolean;
  isGenerating: boolean;
  generationMessage: string;
  generationError: string;
  selectedSubjectType: string;
  inspectorTab: InspectorTab;
  activeLayerId: string | null;
  apiKeys: ApiKeyConfig[];
  activeApiId: string | null;
  exportProgress: ExportProgress | null;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
  projectName: string;
  isDirty: boolean;
  setAsset(asset: MediaAsset | null): void;
  clearScene(): void;
  setRecreateScene(scene: RecreateScene | null): void;
  setGenerationMode(mode: 'recreate' | 'icon' | 'animate'): void;
  setDirectionPrompt(value: string): void;
  beginIdea(): void;
  setIdea(text: string, source: 'ai' | 'local'): void;
  setHasGenerated(value: boolean): void;
  setPlan(plan: MotionPlan | null, recordHistory?: boolean): void;
  updatePlan(updater: (plan: MotionPlan) => MotionPlan, recordHistory?: boolean): void;
  updateSettings(patch: EditorSettingsPatch, recordHistory?: boolean): void;
  setPriority(key: keyof EditorSettings['priorities'], value: number, recordHistory?: boolean): void;
  captureHistory(): void;
  clearHistory(): void;
  setCurrentTime(time: number): void;
  setIsPlaying(playing: boolean): void;
  setIsGenerating(generating: boolean): void;
  setGenerationMessage(message: string): void;
  setGenerationError(message: string): void;
  setSelectedSubjectType(type: string): void;
  setInspectorTab(tab: InspectorTab): void;
  setActiveLayer(id: string | null): void;
  setApiKeys(configs: ApiKeyConfig[], activeId: string | null): void;
  setExportProgress(progress: ExportProgress | null): void;
  undo(): void;
  redo(): void;
  setProjectName(name: string): void;
  setDirty(dirty: boolean): void;
  newProject(): void;
}

const cloneSettings = (): EditorSettings => structuredClone(DEFAULT_SETTINGS);
const snapshot = (state: Pick<EditorState, 'plan' | 'settings'>): HistorySnapshot => ({ plan: state.plan, settings: state.settings });
const pushHistory = (stack: HistorySnapshot[], entry: HistorySnapshot) => [...stack.slice(-39), entry];

export const useEditorStore = create<EditorState>((set, get) => ({
  asset: null,
  plan: null,
  recreateScene: null,
  hasGenerated: false,
  generationMode: 'icon',
  directionPrompt: '',
  ideaStatus: 'idle',
  ideaEdited: false,
  settings: cloneSettings(),
  currentTime: 0,
  isPlaying: false,
  isGenerating: false,
  generationMessage: '',
  generationError: '',
  selectedSubjectType: 'auto',
  inspectorTab: 'motion',
  activeLayerId: null,
  apiKeys: [],
  activeApiId: null,
  exportProgress: null,
  undoStack: [],
  redoStack: [],
  projectName: 'Untitled motion',
  isDirty: false,
  setAsset: (asset) => set({ asset, hasGenerated: false, currentTime: 0, isPlaying: false, isDirty: true }),
  setHasGenerated: (hasGenerated) => set({ hasGenerated }),
  setRecreateScene: (recreateScene) => set({ recreateScene, currentTime: 0, isPlaying: false, isDirty: true }),
  setGenerationMode: (generationMode) => set({ generationMode }),
  setDirectionPrompt: (directionPrompt) => set({ directionPrompt: directionPrompt.slice(0, 800), ideaEdited: true }),
  beginIdea: () => set((s) => ({ ideaStatus: 'loading', ideaEdited: false, directionPrompt: s.ideaEdited ? s.directionPrompt : '' })),
  setIdea: (text, source) => set((s) => (s.ideaEdited ? { ideaStatus: source } : { directionPrompt: text.slice(0, 800), ideaStatus: source, ideaEdited: false })),
  clearScene: () => set({ asset: null, plan: null, recreateScene: null, hasGenerated: false, currentTime: 0, isPlaying: false, generationMessage: '', generationError: '', undoStack: [], redoStack: [], isDirty: true }),
  setPlan: (plan, recordHistory = true) => {
    const state = get();
    const undoStack = recordHistory ? pushHistory(state.undoStack, snapshot(state)) : state.undoStack;
    set({ plan, undoStack, redoStack: recordHistory ? [] : state.redoStack, currentTime: 0, isPlaying: false, isDirty: true });
  },
  updatePlan: (updater, recordHistory = true) => {
    const state = get();
    if (!state.plan) return;
    const next = updater(structuredClone(state.plan));
    const undoStack = recordHistory ? pushHistory(state.undoStack, snapshot(state)) : state.undoStack;
    set({ plan: next, undoStack, redoStack: recordHistory ? [] : state.redoStack, isDirty: true });
  },
  updateSettings: (patch, recordHistory = true) => set((state) => ({
    settings: {
      ...state.settings,
      ...patch,
      priorities: { ...state.settings.priorities, ...patch.priorities },
      greenScreen: { ...state.settings.greenScreen, ...patch.greenScreen },
      export: { ...state.settings.export, ...patch.export },
      seo: { ...state.settings.seo, ...patch.seo },
    },
    undoStack: recordHistory ? pushHistory(state.undoStack, snapshot(state)) : state.undoStack,
    redoStack: recordHistory ? [] : state.redoStack,
    isDirty: true,
  })),
  setPriority: (key, value, recordHistory = false) => set((state) => ({
    settings: { ...state.settings, priorities: { ...state.settings.priorities, [key]: Math.min(1, Math.max(0, value)) } },
    undoStack: recordHistory ? pushHistory(state.undoStack, snapshot(state)) : state.undoStack,
    redoStack: recordHistory ? [] : state.redoStack,
    isDirty: true,
  })),
  captureHistory: () => set((state) => ({ undoStack: pushHistory(state.undoStack, snapshot(state)), redoStack: [] })),
  clearHistory: () => set({ undoStack: [], redoStack: [] }),
  setCurrentTime: (time) => set({ currentTime: Math.max(0, Math.min(get().settings.duration, time)) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setGenerationMessage: (generationMessage) => set({ generationMessage, generationError: '' }),
  setGenerationError: (generationError) => set({ generationError }),
  setSelectedSubjectType: (selectedSubjectType) => set({ selectedSubjectType }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),
  setApiKeys: (apiKeys, activeApiId) => set({ apiKeys, activeApiId }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  undo: () => {
    const state = get();
    if (!state.undoStack.length) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    set({
      plan: previous.plan,
      settings: previous.settings,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: pushHistory(state.redoStack, snapshot(state)),
      currentTime: Math.min(state.currentTime, previous.settings.duration),
      isDirty: true,
    });
  },
  redo: () => {
    const state = get();
    if (!state.redoStack.length) return;
    const next = state.redoStack[state.redoStack.length - 1];
    set({
      plan: next.plan,
      settings: next.settings,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: pushHistory(state.undoStack, snapshot(state)),
      currentTime: Math.min(state.currentTime, next.settings.duration),
      isDirty: true,
    });
  },
  setProjectName: (projectName) => set({ projectName, isDirty: true }),
  setDirty: (isDirty) => set({ isDirty }),
  newProject: () => set({
    asset: null,
    plan: null,
    recreateScene: null,
    hasGenerated: false,
    settings: cloneSettings(),
    currentTime: 0,
    isPlaying: false,
    generationMessage: '',
    generationError: '',
    selectedSubjectType: 'auto',
    undoStack: [],
    redoStack: [],
    projectName: 'Untitled motion',
    isDirty: false,
  }),
}));

export function selectActiveApiConfig(state: EditorState): ApiKeyConfig | null {
  return state.apiKeys.find((config) => config.id === state.activeApiId && config.enabled) ?? null;
}

export function selectFrameCount(state: EditorState): number {
  return Math.round(state.settings.duration * state.settings.fps);
}

export function defaultExportProgress(totalFrames: number): ExportProgress {
  return { active: false, cancelled: false, currentFrame: 0, totalFrames, startedAt: 0, message: '' };
}
