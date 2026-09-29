import { useEffect, useRef, useState } from 'react';
import { exportMotionVideo, type ExportResult } from '../services/exporter';
import { normalizePlan } from '../engine/planBuilder';
import { useEditorStore } from '../store/editorStore';
import type { EditorSettings, ResolutionPreset, VideoFormat } from '../types/motion';
import type { BrowserCapabilities } from '../types/motion';
import { Icon } from './Icon';

const DURATION_CHOICES = [5, 6, 7, 8, 9, 10, 12, 15, 20, 30];
const FPS_CHOICES = [24, 25, 30, 50, 60] as const;

function even(value: number) {
  return Math.max(16, Math.round(value / 2) * 2);
}

function outputDimensions(preset: ResolutionPreset, canvasWidth: number, canvasHeight: number) {
  const ratio = canvasWidth / canvasHeight;
  if (preset === 'custom') return null;
  if (preset === 'preview') {
    const scale = Math.min(1, 1280 / Math.max(canvasWidth, canvasHeight));
    return { width: even(canvasWidth * scale), height: even(canvasHeight * scale) };
  }
  if (preset === '4K') {
    const maxEdge = 3840;
    return ratio >= 1 ? { width: maxEdge, height: even(maxEdge / ratio) } : { width: even(maxEdge * ratio), height: maxEdge };
  }
  const maxEdge = preset === '720p' ? 720 : preset === '1080p' ? 1080 : 1440;
  return ratio >= 1 ? { width: even(maxEdge * ratio), height: maxEdge } : { width: maxEdge, height: even(maxEdge / ratio) };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  capabilities: BrowserCapabilities | null;
}

export function ExportModal({ open, onClose, capabilities }: ExportModalProps) {
  const asset = useEditorStore((state) => state.asset);
  const plan = useEditorStore((state) => state.plan);
  const settings = useEditorStore((state) => state.settings);
  const progress = useEditorStore((state) => state.exportProgress);
  const controllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  const output = settings.export;
  const selectedFrames = Math.round(settings.duration * settings.fps);
  const codecLabel = output.format === 'mp4' ? 'H.264 · WebCodecs' : 'VP9 / VP8 · browser encoder';
  const supported = output.format === 'mp4' ? Boolean(capabilities?.supportedMp4) : Boolean(capabilities?.supportedWebm);
  const durationValue = DURATION_CHOICES.includes(settings.duration) ? String(settings.duration) : 'custom';
  const canStart = Boolean(asset && plan && supported && !progress?.active);
  const qualityLabel = output.quality > 0.82 ? 'High' : output.quality > 0.56 ? 'Balanced' : 'Compact';

  useEffect(() => {
    if (!result) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(result.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  useEffect(() => {
    if (open) {
      setError('');
      setResult(null);
    } else {
      controllerRef.current?.abort();
      setResult(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || output.resolution === 'custom') return;
    const dimensions = outputDimensions(output.resolution, settings.width, settings.height);
    if (dimensions && (dimensions.width !== output.width || dimensions.height !== output.height)) {
      useEditorStore.getState().updateSettings({ export: dimensions });
    }
  }, [open, settings.width, settings.height, output.resolution, output.width, output.height]);

  const updateDuration = (value: string) => {
    if (!value || value === 'custom') return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const duration = Math.max(1, Math.min(120, parsed));
    const store = useEditorStore.getState();
    store.updateSettings({ duration });
    if (store.plan) store.setPlan(normalizePlan(store.plan, duration, store.settings.fps), false);
    store.setCurrentTime(Math.min(store.currentTime, duration));
  };
  const updateFps = (fps: number) => {
    const store = useEditorStore.getState();
    store.updateSettings({ fps: fps as EditorSettings['fps'] });
    if (store.plan) store.setPlan(normalizePlan(store.plan, store.settings.duration, fps as EditorSettings['fps']), false);
  };
  const updateResolution = (resolution: ResolutionPreset) => {
    const dims = outputDimensions(resolution, settings.width, settings.height);
    useEditorStore.getState().updateSettings({ export: { resolution, ...(dims ?? {}) } });
  };
  const updateFormat = (format: VideoFormat) => useEditorStore.getState().updateSettings({ export: { format } });

  const startExport = async () => {
    const state = useEditorStore.getState();
    if (!state.asset || !state.plan) {
      setError('Upload an image and generate a motion plan before exporting.');
      return;
    }
    if (!supported) {
      setError(output.format === 'mp4' ? 'MP4 is not supported by the current browser and codec configuration. Choose WebM; the requested format will not be silently substituted.' : 'WebM capture is not supported by this browser.');
      return;
    }
    setError('');
    setResult(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    const totalFrames = Math.round(state.settings.duration * state.settings.fps);
    useEditorStore.getState().setExportProgress({ active: true, cancelled: false, currentFrame: 0, totalFrames, startedAt: performance.now(), message: 'Preparing renderer…' });
    try {
      const exported = await exportMotionVideo({
        asset: state.asset,
        plan: state.plan,
        settings: state.settings,
        format: state.settings.export.format,
        width: state.settings.export.width,
        height: state.settings.export.height,
        duration: state.settings.duration,
        fps: state.settings.fps,
        quality: state.settings.export.quality,
        signal: controller.signal,
        onProgress: (currentFrame, frames, elapsedMs) => {
          const stride = Math.max(1, Math.floor(frames / 80));
          if (currentFrame === 1 || currentFrame === frames || currentFrame % stride === 0) {
            useEditorStore.getState().setExportProgress({ active: true, cancelled: false, currentFrame, totalFrames: frames, startedAt: performance.now() - elapsedMs, message: `Rendering ${currentFrame} / ${frames}` });
          }
        },
      });
      setResult(exported);
      const base = state.settings.seo.filename.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'motion-studio-export';
      saveBlob(exported.blob, `${base}.${exported.extension}`);
      useEditorStore.getState().setExportProgress({ active: false, cancelled: false, currentFrame: exported.totalFrames, totalFrames: exported.totalFrames, startedAt: performance.now() - exported.elapsedMs, message: 'Export complete' });
    } catch (cause) {
      const cancelled = cause instanceof DOMException && cause.name === 'AbortError';
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'The video could not be exported.');
      useEditorStore.getState().setExportProgress({ active: false, cancelled, currentFrame: 0, totalFrames, startedAt: 0, message: cancelled ? 'Export cancelled' : 'Export failed' });
    } finally {
      controllerRef.current = null;
    }
  };

  const cancelExport = () => controllerRef.current?.abort();
  const close = () => {
    controllerRef.current?.abort();
    onClose();
  };
  if (!open) return null;
  const percent = progress?.totalFrames ? Math.round(progress.currentFrame / progress.totalFrames * 100) : 0;
  const elapsedSeconds = progress?.startedAt ? Math.max(0, (performance.now() - progress.startedAt) / 1000) : result ? result.elapsedMs / 1000 : 0;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !progress?.active) close(); }}>
    <section className="modal-card export-modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
      <div className="modal-header"><div><span className="panel-eyebrow">FINAL RENDER</span><h2 id="export-modal-title">Export video</h2></div><button className="icon-button" onClick={close} aria-label="Close export settings" disabled={Boolean(progress?.active)}><Icon name="close" /></button></div>
      <div className="export-settings-grid">
        <label className="form-field"><span>Duration</span><select className="select-control" value={durationValue} onChange={(event) => updateDuration(event.target.value)}>{DURATION_CHOICES.map((duration) => <option key={duration} value={duration}>{duration} seconds</option>)}{durationValue === 'custom' && <option value="custom">Custom · {settings.duration}s</option>}</select></label>
        {durationValue === 'custom' && <label className="form-field"><span>Custom duration · seconds</span><input className="text-input" type="number" min={1} max={120} step={1} value={settings.duration} onChange={(event) => updateDuration(event.target.value)} /></label>}
        <label className="form-field"><span>Resolution</span><select className="select-control" value={output.resolution} onChange={(event) => updateResolution(event.target.value as ResolutionPreset)}><option value="preview">Preview · {Math.max(output.width, output.height)} px max</option><option value="720p">720p</option><option value="1080p">1080p</option><option value="1440p">1440p</option><option value="4K">4K · max 3840 px</option><option value="custom">Custom</option></select></label>
        {output.resolution === 'custom' && <div className="custom-export-dimensions"><label className="form-field"><span>Width</span><input className="text-input" type="number" min={16} max={7680} step={2} value={output.width} onChange={(event) => useEditorStore.getState().updateSettings({ export: { width: even(Number(event.target.value)) } })} /></label><label className="form-field"><span>Height</span><input className="text-input" type="number" min={16} max={7680} step={2} value={output.height} onChange={(event) => useEditorStore.getState().updateSettings({ export: { height: even(Number(event.target.value)) } })} /></label></div>}
        <label className="form-field"><span>Frame rate</span><select className="select-control" value={settings.fps} onChange={(event) => updateFps(Number(event.target.value))}>{FPS_CHOICES.map((fps) => <option key={fps} value={fps}>{fps} FPS</option>)}</select></label>
        <label className="form-field"><span>Format</span><select className="select-control" value={output.format} onChange={(event) => updateFormat(event.target.value as VideoFormat)}><option value="webm" disabled={!capabilities?.supportedWebm}>WebM {capabilities?.supportedWebm ? '' : '— unsupported'}</option><option value="mp4" disabled={!capabilities?.supportedMp4}>MP4 {capabilities?.supportedMp4 ? '' : '— unsupported'}</option></select></label>
        <div className="form-field"><span>Codec</span><div className="codec-readout"><Icon name="film" size={14} />{codecLabel}</div></div>
        <label className="form-field quality-field"><span>Quality <strong>{qualityLabel}</strong></span><input type="range" min="35" max="100" value={Math.round(output.quality * 100)} onPointerDown={() => useEditorStore.getState().captureHistory()} onChange={(event) => useEditorStore.getState().updateSettings({ export: { quality: Number(event.target.value) / 100 } }, false)} /></label>
      </div>
      <div className="export-summary-strip"><span><Icon name="clock" size={14} />{settings.duration}s duration</span><span><Icon name="grid" size={14} />{selectedFrames} frames</span><span>{output.width} × {output.height}</span><span>{settings.fps} FPS</span></div>
      {output.format === 'mp4' && !capabilities?.supportedMp4 && <div className="warning-callout"><Icon name="alert" size={15} /><span>MP4/H.264 WebCodecs is unavailable here. Select WebM instead. Motion Studio will not rename a different format to MP4.</span></div>}
      {output.format === 'webm' && !capabilities?.supportedWebm && <div className="warning-callout"><Icon name="alert" size={15} /><span>This browser has no supported WebM encoder/capture API.</span></div>}
      {settings.greenScreen.enabled && <div className="warning-callout"><Icon name="info" size={15} /><span>Chroma-keyed pixels are transparent in the render canvas. MP4/H.264 usually composites transparency as black; WebM transparency depends on browser encoder support. Review the rendered file.</span></div>}
      {error && <div className="export-error"><Icon name="alert" size={15} /><span>{error}</span></div>}
      {progress?.active && <div className="export-progress-card"><div className="progress-title"><span>{progress.message || `Rendering ${progress.currentFrame} / ${progress.totalFrames}`}</span><button className="text-button tiny danger-text" onClick={cancelExport}>Cancel</button></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="progress-meta"><span>{percent}% · {progress.currentFrame} / {progress.totalFrames} frames</span><span>Elapsed {elapsedSeconds.toFixed(1)}s</span></div></div>}
      {result && previewUrl && <div className="export-result-card"><div className="export-result-head"><span><Icon name="check" size={14} /> Export complete · {result.extension.toUpperCase()}</span><small>{result.duration}s · {result.totalFrames} frames · {result.width} × {result.height} · {result.fps} FPS</small></div><video className="export-result-video" controls playsInline src={previewUrl} /><p>Review the rendered motion before closing this panel. The file was also downloaded.</p></div>}
      <div className="export-footer"><span>{supported ? `Browser-supported ${output.format.toUpperCase()} export` : 'Select a browser-supported format'}</span><div>{progress?.active ? <button className="button-secondary" onClick={cancelExport}>Cancel render</button> : <button className="button-primary" onClick={startExport} disabled={!canStart}><Icon name={result ? 'refresh' : 'download'} size={15} />{result ? 'Render again' : 'Render video'}</button>}</div></div>
    </section>
  </div>;
}
