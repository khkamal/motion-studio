import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { TopBar } from '../components/TopBar';
import { SourcePanel } from '../components/SourcePanel';
import { PreviewStage } from '../components/PreviewStage';
import { Timeline } from '../components/Timeline';
import { Inspector } from '../components/Inspector';
import { ApiKeysModal } from '../components/ApiKeysModal';
import { ExportModal } from '../components/ExportModal';
import { applyLocalMotionPrompt } from '../engine/manualEdits';
import { buildFallbackPlan, normalizePlan, suggestSeo } from '../engine/planBuilder';
import { detectBrowserCapabilities } from '../services/capabilities';
import { generateGeminiMotionPlan, reviseGeminiMotionPlan } from '../services/gemini';
import { loadApiConfigs, saveApiConfigs } from '../services/keyStorage';
import { exportProjectFile, importProjectFile, loadAutosave, saveAutosave } from '../services/projectStorage';
import { useEditorStore, selectActiveApiConfig } from '../store/editorStore';
import type { BrowserCapabilities, EditorSettingsPatch, MediaAsset } from '../types/motion';
import { createMediaAsset, imageFilesFromClipboard, isEditableField } from '../utils/image';
import { Icon } from '../components/Icon';

function downloadProject(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'motion-studio-project'}.motion`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function App() {
  const asset = useEditorStore((state) => state.asset);
  const plan = useEditorStore((state) => state.plan);
  const settings = useEditorStore((state) => state.settings);
  const selectedSubjectType = useEditorStore((state) => state.selectedSubjectType);
  const projectName = useEditorStore((state) => state.projectName);
  const isDirty = useEditorStore((state) => state.isDirty);
  const apiKeys = useEditorStore((state) => state.apiKeys);
  const activeApiId = useEditorStore((state) => state.activeApiId);
  const generationError = useEditorStore((state) => state.generationError);
  const isGenerating = useEditorStore((state) => state.isGenerating);
  const undoCount = useEditorStore((state) => state.undoStack.length);
  const redoCount = useEditorStore((state) => state.redoStack.length);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const [capabilities, setCapabilities] = useState<BrowserCapabilities | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState('');
  const [storageWarning, setStorageWarning] = useState('');

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? '' : current), 3600);
  }, []);

  useEffect(() => {
    const savedKeys = loadApiConfigs();
    useEditorStore.getState().setApiKeys(savedKeys.configs, savedKeys.activeId);
    detectBrowserCapabilities().then(setCapabilities).catch(() => setCapabilities({ webgl: false, webgl2: false, webCodecs: false, offscreenCanvas: false, mediaRecorder: false, supportedMp4: false, supportedWebm: false, subjectSegmentation: false, hardwareConcurrency: 0 }));
    let cancelled = false;
    loadAutosave().then(async (saved) => {
      if (cancelled || !saved) return;
      const restoredPlan = saved.plan ? normalizePlan(saved.plan, saved.settings.duration, saved.settings.fps, saved.plan.source) : null;
      let restoredAsset: MediaAsset | null = null;
      if (saved.asset) {
        const file = new File([saved.asset.blob], saved.asset.name, { type: saved.asset.type });
        restoredAsset = await createMediaAsset(file);
      }
      if (cancelled) {
        if (restoredAsset) URL.revokeObjectURL(restoredAsset.objectUrl);
        return;
      }
      const store = useEditorStore.getState();
      store.setAsset(restoredAsset);
      store.updateSettings(saved.settings);
      store.setPlan(restoredPlan, false);
      store.setProjectName(saved.name);
      store.clearHistory();
      store.setDirty(false);
    }).catch((error: unknown) => {
      if (!cancelled) setStorageWarning(error instanceof Error ? error.message : 'Autosave restore was unavailable.');
    }).finally(() => {
      if (!cancelled) restoredRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!restoredRef.current || !isDirty) return;
    const timer = window.setTimeout(() => {
      const state = useEditorStore.getState();
      const savedAsset = state.asset ? {
        name: state.asset.name,
        type: state.asset.type,
        width: state.asset.width,
        height: state.asset.height,
        blob: state.asset.blob,
      } : null;
      saveAutosave({ id: 'autosave', name: state.projectName, updatedAt: Date.now(), asset: savedAsset, plan: state.plan, settings: state.settings })
        .then(() => {
          const latest = useEditorStore.getState();
          if (latest.plan === state.plan && latest.settings === state.settings && latest.asset === state.asset && latest.projectName === state.projectName) {
            latest.setDirty(false);
          }
          setStorageWarning('');
        })
        .catch((error: unknown) => setStorageWarning(error instanceof Error ? error.message : 'Autosave is unavailable in this browser.'));
    }, 850);
    return () => window.clearTimeout(timer);
  }, [asset, plan, settings, projectName, isDirty]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableField(event.target)) return;
      const files = imageFilesFromClipboard(event);
      if (!files.length) return;
      event.preventDefault();
      void handleImageFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // Rebind the paste handler when the source changes, while reading the latest handler from the render closure.
  }, [asset?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableField(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (event.code === 'Space' && !command) {
        event.preventDefault();
        const state = useEditorStore.getState();
        if (state.isPlaying) state.setIsPlaying(false);
        else {
          if (state.currentTime >= state.settings.duration) state.setCurrentTime(0);
          state.setIsPlaying(true);
        }
      } else if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      } else if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProject();
      } else if (command && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setShowExportModal(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // Keyboard shortcuts are global and resolve editor state at invocation time.
  }, []);

  useEffect(() => () => {
    const current = useEditorStore.getState().asset;
    if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
  }, []);

  const handleImageFiles = useCallback(async (files: File[]) => {
    const file = files.find((candidate) => candidate.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(candidate.name));
    if (!file) {
      notify('Drop or paste a PNG, JPG, JPEG, WebP, or SVG image.');
      return;
    }
    try {
      const nextAsset = await createMediaAsset(file);
      const store = useEditorStore.getState();
      const previous = store.asset;
      if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
      store.setAsset(nextAsset);
      store.clearHistory();
      const fallback = buildFallbackPlan({
        fileName: nextAsset.name,
        width: nextAsset.width,
        height: nextAsset.height,
        duration: store.settings.duration,
        fps: store.settings.fps,
        style: store.settings.style,
        selectedType: store.selectedSubjectType,
      });
      store.setPlan(fallback, false);
      store.updateSettings({ seo: suggestSeo(fallback, nextAsset.name), particleType: fallback.effects.particleType, particlesEnabled: fallback.effects.particlesEnabled }, false);
      store.setGenerationMessage('Local draft ready · Generate Motion to request Gemini vision analysis.');
      store.setActiveLayer('subject_1');
      store.setDirty(true);
      notify(`Loaded ${nextAsset.name} · ${nextAsset.width} × ${nextAsset.height}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The image could not be loaded.');
    }
  }, [notify]);

  const handlePickImage = () => imageInputRef.current?.click();
  const handleRemoveImage = () => {
    const previous = useEditorStore.getState().asset;
    if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
    useEditorStore.getState().clearScene();
    notify('Source image removed.');
  };

  const handleGenerate = async () => {
    const state = useEditorStore.getState();
    if (!state.asset) {
      notify('Upload an image before generating motion.');
      return;
    }
    const sourceAssetId = state.asset.id;
    state.setIsGenerating(true);
    state.setGenerationError('');
    state.setGenerationMessage('Analyzing the image and planning subject motion…');
    const activeConfig = selectActiveApiConfig(state);
    try {
      if (!activeConfig) {
        const fallback = buildFallbackPlan({ fileName: state.asset.name, width: state.asset.width, height: state.asset.height, duration: state.settings.duration, fps: state.settings.fps, style: state.settings.style, selectedType: state.selectedSubjectType });
        const current = useEditorStore.getState();
        current.captureHistory();
        current.setPlan(fallback, false);
        current.updateSettings({ seo: suggestSeo(fallback, state.asset.name), particleType: fallback.effects.particleType, particlesEnabled: fallback.effects.particlesEnabled }, false);
        useEditorStore.getState().setGenerationMessage('Local deterministic plan created. No vision model or semantic segmentation ran.');
        notify('Motion plan created locally · add a Gemini key for image understanding.');
        return;
      }
      const plan = await generateGeminiMotionPlan(activeConfig, {
        blob: state.asset.blob,
        fileName: state.asset.name,
        width: state.asset.width,
        height: state.asset.height,
        duration: state.settings.duration,
        fps: state.settings.fps,
        style: state.settings.style,
        subjectHint: state.selectedSubjectType,
      });
      if (useEditorStore.getState().asset?.id !== sourceAssetId) return;
      const current = useEditorStore.getState();
      current.captureHistory();
      current.setPlan(plan, false);
      current.updateSettings({ seo: suggestSeo(plan, state.asset.name), particleType: plan.effects.particleType, particlesEnabled: plan.effects.particlesEnabled }, false);
      useEditorStore.getState().setGenerationMessage(`Gemini analyzed ${plan.subjectAnalysis.mainSubject}; subject-first motion plan validated.`);
      useEditorStore.getState().setActiveLayer(plan.layers.find((layer) => layer.kind === 'subject')?.id ?? null);
      notify('Gemini vision plan validated and added to the timeline.');
    } catch (error) {
      const current = useEditorStore.getState();
      if (current.asset?.id !== sourceAssetId) return;
      const fallback = buildFallbackPlan({ fileName: current.asset?.name ?? '', width: current.asset?.width ?? 1, height: current.asset?.height ?? 1, duration: current.settings.duration, fps: current.settings.fps, style: current.settings.style, selectedType: current.selectedSubjectType });
      current.captureHistory();
      current.setPlan(fallback, false);
      if (current.asset) current.updateSettings({ seo: suggestSeo(fallback, current.asset.name), particleType: fallback.effects.particleType, particlesEnabled: fallback.effects.particlesEnabled }, false);
      current.setGenerationMessage('Gemini did not return a valid plan; a deterministic local draft is ready instead.');
      current.setGenerationError(error instanceof Error ? error.message : 'Gemini vision analysis failed.');
      notify('Gemini unavailable · local fallback created.');
    } finally {
      useEditorStore.getState().setIsGenerating(false);
    }
  };

  const handleManualPrompt = async (prompt: string) => {
    const state = useEditorStore.getState();
    if (!state.plan) return;
    const activeConfig = selectActiveApiConfig(state);
    state.setIsGenerating(true);
    state.setGenerationError('');
    try {
      if (activeConfig) {
        const revised = await reviseGeminiMotionPlan(activeConfig, state.plan, prompt);
        if (useEditorStore.getState().plan !== state.plan) return;
        useEditorStore.getState().setPlan(revised);
        useEditorStore.getState().setGenerationMessage('Gemini modified the existing motion plan.');
        notify('Existing motion plan updated.');
      } else {
        const result = applyLocalMotionPrompt(state.plan, state.settings, prompt);
        if (result.changed) {
          const current = useEditorStore.getState();
          current.captureHistory();
          current.updateSettings(result.settings, false);
          current.setPlan(result.plan, false);
        }
        useEditorStore.getState().setGenerationMessage(result.message);
        if (!result.changed) useEditorStore.getState().setGenerationError('This prompt needs Gemini for a free-form edit.');
        notify(result.changed ? 'Local motion settings updated.' : 'Add a Gemini key to interpret this prompt.');
      }
    } catch (error) {
      const current = useEditorStore.getState();
      if (current.plan !== state.plan) return;
      const result = current.plan ? applyLocalMotionPrompt(current.plan, current.settings, prompt) : null;
      if (result?.changed) {
        current.captureHistory();
        current.updateSettings(result.settings, false);
        current.setPlan(result.plan, false);
      }
      current.setGenerationMessage(result?.message ?? 'A local fallback was not available for this prompt.');
      current.setGenerationError(error instanceof Error ? `Gemini edit failed; ${result?.changed ? 'a local edit was applied. ' : ''}${error.message}` : 'Gemini edit failed.');
      notify('Gemini edit failed · local controls used where possible.');
    } finally {
      useEditorStore.getState().setIsGenerating(false);
    }
  };

  const saveProject = useCallback(async () => {
    const state = useEditorStore.getState();
    try {
      const blob = await exportProjectFile({ name: state.projectName, asset: state.asset, plan: state.plan, settings: state.settings });
      downloadProject(blob, state.projectName);
      state.setDirty(false);
      notify('Project file saved · API keys are not included.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Project could not be saved.');
    }
  }, [notify]);

  const openProject = () => projectInputRef.current?.click();
  const handleOpenProjectFile = async (file?: File) => {
    if (!file) return;
    try {
      const project = await importProjectFile(file);
      const importedPlan = project.plan ? normalizePlan(project.plan, project.settings.duration, project.settings.fps, project.plan.source) : null;
      let importedAsset: MediaAsset | null = null;
      if (project.asset) {
        importedAsset = await createMediaAsset(new File([project.asset.blob], project.asset.name, { type: project.asset.type }));
      }
      const store = useEditorStore.getState();
      if (store.asset?.objectUrl) URL.revokeObjectURL(store.asset.objectUrl);
      store.setAsset(importedAsset);
      store.updateSettings(project.settings);
      store.setPlan(importedPlan, false);
      store.setProjectName(project.name);
      store.clearHistory();
      store.setDirty(true);
      notify(`Opened project “${project.name}”.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Project file could not be opened.');
    }
  };

  const newProject = () => {
    if (isDirty && !window.confirm('Start a new project? Unsaved changes are saved in local autosave but will not be part of the new project.')) return;
    const current = useEditorStore.getState().asset;
    if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
    useEditorStore.getState().newProject();
    notify('New project created.');
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void handleImageFiles(files);
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes('Files')) setDragging(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => event.preventDefault();

  const changeName = (name: string) => useEditorStore.getState().setProjectName(name.slice(0, 200));
  const updateSettings = (patch: EditorSettingsPatch) => useEditorStore.getState().updateSettings(patch);
  const activeConfig = apiKeys.find((config) => config.id === activeApiId && config.enabled);

  return <div className={`motion-studio-app ${dragging ? 'is-dropping' : ''}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={onDrop}>
    <TopBar
      projectName={projectName}
      isDirty={isDirty}
      canUndo={undoCount > 0}
      canRedo={redoCount > 0}
      capabilities={capabilities}
      onNameChange={changeName}
      onNew={newProject}
      onOpen={openProject}
      onSave={() => void saveProject()}
      onUndo={() => useEditorStore.getState().undo()}
      onRedo={() => useEditorStore.getState().redo()}
      onOpenKeys={() => setShowKeyModal(true)}
      onExport={() => setShowExportModal(true)}
    />
    <main className="studio-grid">
      <SourcePanel asset={asset} settings={settings} subjectType={selectedSubjectType} onPick={handlePickImage} onRemove={handleRemoveImage} onTypeChange={(type) => useEditorStore.getState().setSelectedSubjectType(type)} onSettingsChange={updateSettings} />
      <div className="workspace-and-timeline"><PreviewStage onUpload={handlePickImage} /><Timeline /></div>
      <Inspector isGenerating={isGenerating} apiConfigured={Boolean(activeConfig)} onGenerate={handleGenerate} onManualPrompt={handleManualPrompt} onOpenKeys={() => setShowKeyModal(true)} />
    </main>
    <input ref={imageInputRef} className="hidden-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" onChange={(event) => { const files = event.target.files ? Array.from(event.target.files) : []; if (files.length) void handleImageFiles(files); event.currentTarget.value = ''; }} />
    <input ref={projectInputRef} className="hidden-file-input" type="file" accept=".motion,application/vnd.motion-studio.project+json,application/json" onChange={(event) => { void handleOpenProjectFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
    {(generationError || storageWarning) && <div className="bottom-alert"><Icon name="alert" size={14} /><span>{generationError || storageWarning}</span><button onClick={() => { useEditorStore.getState().setGenerationError(''); setStorageWarning(''); }} aria-label="Dismiss message"><Icon name="close" size={13} /></button></div>}
    {toast && <div className="toast-notification"><span className="toast-check"><Icon name="check" size={13} /></span>{toast}</div>}
    {dragging && <div className="drop-overlay"><div><Icon name="upload" size={22} /><strong>Drop image to replace source</strong><span>PNG · JPG · WebP · SVG</span></div></div>}
    <ApiKeysModal open={showKeyModal} onClose={() => setShowKeyModal(false)} onPersist={(configs, activeId) => {
      try {
        saveApiConfigs(configs, activeId);
        useEditorStore.getState().setApiKeys(configs, activeId);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not save Gemini configuration.');
      }
    }} />
    <ExportModal open={showExportModal} onClose={() => setShowExportModal(false)} capabilities={capabilities} />
  </div>;
}
