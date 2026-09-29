import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorSettings } from '../types/motion';
import { createRenderRuntime, disposeRenderRuntime, renderScene, type RenderRuntime } from '../engine/renderer';
import { formatTime } from '../engine/motionEngine';
import { normalizePlan } from '../engine/planBuilder';
import { useEditorStore } from '../store/editorStore';
import { Icon } from './Icon';

const DURATION_CHOICES = [5, 6, 7, 8, 9, 10, 12, 15, 20, 30];
const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
const SPEED_CHOICES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function previewResolution(width: number, height: number) {
  const scale = Math.min(1, 1280 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function PreviewStage({ onUpload }: { onUpload: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<RenderRuntime | null>(null);
  const asset = useEditorStore((state) => state.asset);
  const plan = useEditorStore((state) => state.plan);
  const settings = useEditorStore((state) => state.settings);
  const currentTime = useEditorStore((state) => state.currentTime);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const message = useEditorStore((state) => state.generationMessage);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [customDuration, setCustomDuration] = useState(false);
  const maskSignature = useMemo(() => JSON.stringify({
    layers: plan?.layers.filter((layer) => layer.kind === 'subject').map((layer) => [layer.id, layer.mask]) ?? [],
    subjects: plan?.subjects.map((subject) => [subject.id, subject.region, subject.mask]) ?? [],
    movingRegions: plan?.subjectAnalysis.movingRegions ?? [],
  }), [plan?.layers, plan?.subjects, plan?.subjectAnalysis.movingRegions]);
  const dimensions = previewResolution(settings.width, settings.height);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
  }, [dimensions.width, dimensions.height]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRuntimeReady(false);
    setRuntimeError('');
    if (runtimeRef.current) disposeRenderRuntime(runtimeRef.current);
    runtimeRef.current = null;
    if (!asset || !plan) {
      return () => controller.abort();
    }
    const prepareTimer = window.setTimeout(() => {
      createRenderRuntime(asset, plan, settings, undefined, controller.signal).then((runtime) => {
        if (cancelled) {
          disposeRenderRuntime(runtime);
          return;
        }
        if (runtimeRef.current) disposeRenderRuntime(runtimeRef.current);
        runtimeRef.current = runtime;
        setRuntimeReady(true);
      }).catch((error: unknown) => {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          setRuntimeError(error instanceof Error ? error.message : 'Could not prepare the preview renderer.');
        }
      });
    }, 70);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(prepareTimer);
    };
    // Masks and chroma-key parameters affect the prepared source buffers; ordinary motion edits do not.
  }, [asset?.id, maskSignature, settings.greenScreen.enabled, settings.greenScreen.color, settings.greenScreen.customColor, settings.greenScreen.tolerance, settings.greenScreen.softness]);

  useEffect(() => () => {
    if (runtimeRef.current) disposeRenderRuntime(runtimeRef.current);
    runtimeRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !asset || !plan || !runtimeReady || !isPlaying) return;
    let animationFrame = 0;
    let lastTimestamp: number | null = null;
    let lastPublish = 0;
    let playhead = useEditorStore.getState().currentTime;
    const tick = (timestamp: number) => {
      const state = useEditorStore.getState();
      const livePlan = state.plan;
      const liveAsset = state.asset;
      if (!state.isPlaying || !livePlan || !liveAsset || liveAsset.id !== asset.id || !runtimeRef.current) return;
      const liveSettings = state.settings;
      if (lastTimestamp !== null) playhead = Math.min(liveSettings.duration, playhead + Math.max(0, timestamp - lastTimestamp) / 1000);
      lastTimestamp = timestamp;
      renderScene({ canvas, plan: livePlan, settings: liveSettings, runtime: runtimeRef.current, showTransparencyGrid: true }, playhead);
      if (timestamp - lastPublish >= 90) {
        useEditorStore.getState().setCurrentTime(playhead);
        lastPublish = timestamp;
      }
      if (playhead >= liveSettings.duration) {
        useEditorStore.getState().setCurrentTime(liveSettings.duration);
        if (liveSettings.loop) playhead = 0;
        else {
          useEditorStore.getState().setIsPlaying(false);
          return;
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [asset?.id, plan, runtimeReady, isPlaying, settings.width, settings.height, settings.fit, settings.style, settings.duration, settings.fps]);

  useEffect(() => {
    if (isPlaying || !asset || !plan || !runtimeReady || !canvasRef.current || !runtimeRef.current) return;
    renderScene({ canvas: canvasRef.current, plan, settings, runtime: runtimeRef.current, showTransparencyGrid: true }, currentTime);
  }, [asset?.id, plan, runtimeReady, isPlaying, settings, currentTime]);

  const updateDuration = (value: string) => {
    if (value === 'custom') {
      setCustomDuration(true);
      return;
    }
    if (!value.trim()) return;
    setCustomDuration(false);
    const parsedDuration = Number(value);
    if (!Number.isFinite(parsedDuration)) return;
    const duration = Math.max(1, Math.min(120, parsedDuration));
    const store = useEditorStore.getState();
    store.updateSettings({ duration });
    if (store.plan) store.setPlan(normalizePlan(store.plan, duration, store.settings.fps), false);
    store.setCurrentTime(Math.min(store.currentTime, duration));
  };

  const updateFps = (value: number) => {
    const store = useEditorStore.getState();
    store.updateSettings({ fps: value as EditorSettings['fps'] });
    if (store.plan) store.setPlan(normalizePlan(store.plan, store.settings.duration, value as EditorSettings['fps']), false);
  };

  const setPlayState = () => {
    const store = useEditorStore.getState();
    if (store.isPlaying) store.setIsPlaying(false);
    else {
      if (store.currentTime >= store.settings.duration) store.setCurrentTime(0);
      store.setIsPlaying(true);
    }
  };
  const setStep = (step: number) => {
    const store = useEditorStore.getState();
    store.setIsPlaying(false);
    store.setCurrentTime(store.currentTime + step / store.settings.fps);
  };

  const durationValue = DURATION_CHOICES.includes(settings.duration) ? String(settings.duration) : 'custom';
  const currentFrame = Math.min(Math.round(currentTime * settings.fps), Math.round(settings.duration * settings.fps) - 1);
  const mainSubject = plan?.subjectAnalysis.mainSubject ?? 'No subject analyzed';
  const isolationNotice = runtimeReady ? runtimeRef.current?.subjectIsolationStatus === 'segmented'
    ? 'Pixel mask ready; background cover is conservative edge diffusion, not inpainting.'
    : runtimeRef.current?.subjectIsolationStatus === 'trusted-mask'
      ? 'Trusted user mask active; background cover is conservative edge diffusion.'
      : runtimeRef.current?.subjectIsolationStatus === 'repair-unavailable'
        ? 'Mask found, but safe background repair was unavailable; the source stays fixed.'
        : runtimeRef.current?.subjectIsolationStatus === 'estimated-fallback'
          ? 'No trusted pixel mask; estimated-region material motion keeps the source background fixed.'
          : 'No safe subject mask or region; the source remains intact.'
    : '';
  const stageStatusMessage = [isolationNotice, message || (plan?.source === 'gemini' ? 'Gemini vision plan' : plan ? 'Local deterministic plan · subject mask is approximate' : 'Ready')]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="workspace-column">
      <div className="stage-toolbar">
        <div className="stage-title-line"><span className="live-indicator" /><span>LIVE PREVIEW</span><span className="stage-separator">/</span><span className="stage-subtitle">{asset ? `${settings.width} × ${settings.height}` : 'Canvas'}</span></div>
        <div className="stage-toolbar-right">
          <span className={`render-status ${runtimeError ? 'render-error' : ''}`} title={runtimeError || isolationNotice || 'Shared Canvas renderer with optional local subject isolation'}>
            <span className="render-status-dot" />{runtimeError ? 'Renderer issue' : runtimeReady ? runtimeRef.current?.subjectIsolationStatus === 'segmented' ? 'Pixel mask ready' : 'Canvas renderer' : asset ? 'Preparing' : 'Waiting for image'}
          </span>
          <span className="stage-divider" />
          <label className="mini-control"><span>FIT</span><select value={settings.fit} onChange={(event) => useEditorStore.getState().updateSettings({ fit: event.target.value as EditorSettings['fit'] })}>
            <option value="fit">Fit</option><option value="fill">Fill</option><option value="crop">Crop</option><option value="center">Center</option>
          </select></label>
        </div>
      </div>

      <div className={`preview-canvas-area ${asset ? '' : 'preview-empty-area'}`}>
        <div className="canvas-surface" style={{ aspectRatio: `${settings.width} / ${settings.height}` }}>
          <canvas ref={canvasRef} aria-label={`Motion preview for ${mainSubject}`} />
          {!asset && <div className="canvas-empty-state"><div className="canvas-empty-orbit"><Icon name="image" size={24} /></div><h2>Bring a still to life.</h2><p>Upload an image to create an editable image-to-motion scene.</p><button className="button-primary" onClick={onUpload}><Icon name="upload" size={15} /> Choose an image</button><span>or drop an image anywhere · Ctrl+V to paste</span></div>}
          {asset && (!plan || !runtimeReady) && <div className="canvas-loading-overlay"><div className="loading-spinner" />{runtimeError || 'Preparing preview and optional local subject mask…'}</div>}
          {asset && settings.greenScreen.enabled && <div className="key-preview-chip"><span /> Chroma key preview</div>}
        </div>
      </div>

      <div className="transport-bar">
        <div className="transport-controls">
          <button className="transport-button" title="Previous frame" onClick={() => setStep(-1)}><Icon name="previous" size={15} /></button>
          <button className={`play-button ${isPlaying ? 'is-playing' : ''}`} onClick={setPlayState} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}><Icon name={isPlaying ? 'pause' : 'play'} size={15} /></button>
          <button className="transport-button" title="Stop" onClick={() => { useEditorStore.getState().setIsPlaying(false); useEditorStore.getState().setCurrentTime(0); }}><Icon name="stop" size={14} /></button>
          <button className="transport-button" title="Next frame" onClick={() => setStep(1)}><Icon name="next" size={15} /></button>
        </div>
        <div className="timecode-group"><span className="timecode-current">{formatTime(currentTime, true)}</span><span className="timecode-divider">/</span><span>{formatTime(settings.duration)}</span><span className="timecode-frame">F{String(currentFrame).padStart(3, '0')}</span></div>
        <div className="transport-settings">
          <label className="transport-select"><span>DURATION</span><select value={durationValue} onChange={(event) => updateDuration(event.target.value)}>
            {DURATION_CHOICES.map((duration) => <option value={duration} key={duration}>{duration}s</option>)}<option value="custom">Custom…</option>
          </select></label>
          {customDuration || durationValue === 'custom' ? <input className="custom-duration-input" aria-label="Custom duration in seconds" type="number" min={1} max={120} step={1} value={settings.duration} onChange={(event) => updateDuration(event.target.value)} /> : null}
          <label className="transport-select"><span>FPS</span><select value={settings.fps} onChange={(event) => updateFps(Number(event.target.value))}>
            {FPS_CHOICES.map((fps) => <option key={fps} value={fps}>{fps}</option>)}
          </select></label>
          <label className="transport-select"><span>SPEED</span><select value={settings.speed} onChange={(event) => useEditorStore.getState().updateSettings({ speed: Number(event.target.value) })}>
            {SPEED_CHOICES.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
          </select></label>
          <button className={`loop-button ${settings.loop ? 'active' : ''}`} title="Toggle playback loop" onClick={() => useEditorStore.getState().updateSettings({ loop: !settings.loop })}><Icon name="refresh" size={14} /></button>
        </div>
      </div>
      <div className="stage-status-line"><span><Icon name="layers" size={13} /> {plan?.layers.filter((layer) => layer.visible).length ?? 0} visible layers</span><span>{Math.round(settings.duration * settings.fps)} frames · {settings.fps} FPS</span><span className="stage-status-message" title={isolationNotice}>{stageStatusMessage}</span></div>
    </section>
  );
}
