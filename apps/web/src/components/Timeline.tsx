import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatTime, totalFrames } from '../engine/motionEngine';
import { useEditorStore } from '../store/editorStore';
import type { MotionLayer } from '../types/motion';
import { Icon } from './Icon';

interface DragKeyframe {
  layerId: string;
  keyframeId: string;
  at: number;
}

const defaultRows: Array<Pick<MotionLayer, 'id' | 'name' | 'kind' | 'visible' | 'locked' | 'keyframes'>> = [
  { id: 'background', name: 'Background', kind: 'background', visible: true, locked: true, keyframes: [] },
  { id: 'subject_1', name: 'Main Subject', kind: 'subject', visible: true, locked: false, keyframes: [] },
  { id: 'camera', name: 'Camera', kind: 'camera', visible: true, locked: false, keyframes: [] },
  { id: 'lighting', name: 'Lighting', kind: 'lighting', visible: true, locked: false, keyframes: [] },
  { id: 'particles', name: 'Particles', kind: 'particles', visible: true, locked: false, keyframes: [] },
  { id: 'effects', name: 'Effects', kind: 'effect', visible: true, locked: false, keyframes: [] },
];

function trackIcon(kind: MotionLayer['kind']) {
  if (kind === 'background') return 'image' as const;
  if (kind === 'subject') return 'move' as const;
  if (kind === 'camera') return 'film' as const;
  if (kind === 'lighting') return 'sparkles' as const;
  if (kind === 'particles') return 'grid' as const;
  return 'wand' as const;
}

export function Timeline() {
  const plan = useEditorStore((state) => state.plan);
  const settings = useEditorStore((state) => state.settings);
  const currentTime = useEditorStore((state) => state.currentTime);
  const activeLayerId = useEditorStore((state) => state.activeLayerId);
  const graphRef = useRef<HTMLDivElement>(null);
  const [dragKeyframe, setDragKeyframe] = useState<DragKeyframe | null>(null);
  const rows = useMemo(() => plan ? [...plan.layers].sort((a, b) => a.zIndex - b.zIndex) : [], [plan]);
  const duration = settings.duration;
  const frameCount = totalFrames(duration, settings.fps);
  const graphWidth = Math.max(500, Math.round(560 * settings.timelineZoom));
  const playheadPercent = Math.max(0, Math.min(100, currentTime / duration * 100));

  const percentFromEvent = (clientX: number) => {
    const bounds = graphRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  };
  const snapProgress = (progress: number) => settings.snap
    ? Math.round(progress * frameCount) / Math.max(1, frameCount)
    : progress;
  const scrubAt = (clientX: number) => {
    useEditorStore.getState().setIsPlaying(false);
    useEditorStore.getState().setCurrentTime(snapProgress(percentFromEvent(clientX)) * duration);
  };
  const onGraphPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.keyframe-marker')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubAt(event.clientX);
  };
  const onGraphPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragKeyframe) return;
    setDragKeyframe({ ...dragKeyframe, at: snapProgress(percentFromEvent(event.clientX)) });
  };
  const onGraphPointerUp = () => {
    if (!dragKeyframe || !plan) return;
    const { layerId, keyframeId, at } = dragKeyframe;
    useEditorStore.getState().updatePlan((current) => ({
      ...current,
      layers: current.layers.map((layer) => layer.id === layerId
        ? { ...layer, keyframes: layer.keyframes.map((keyframe) => keyframe.id === keyframeId ? { ...keyframe, at } : keyframe) }
        : layer),
    }));
    setDragKeyframe(null);
  };

  const toggleVisible = (layerId: string) => useEditorStore.getState().updatePlan((current) => ({
    ...current, layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, visible: !layer.visible } : layer),
  }), false);
  const toggleLock = (layerId: string) => useEditorStore.getState().updatePlan((current) => ({
    ...current, layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, locked: !layer.locked } : layer),
  }), false);

  const ticks = Array.from({ length: Math.floor(duration) + 1 }, (_, index) => index).filter((value) => value <= duration);
  return (
    <section className="timeline-panel">
      <div className="timeline-header">
        <div className="timeline-heading"><Icon name="layers" size={15} /><strong>MOTION TIMELINE</strong><span className="timeline-frame-count">{frameCount} frames</span></div>
        <div className="timeline-tools">
          <label className="snap-toggle"><input type="checkbox" checked={settings.snap} onChange={(event) => useEditorStore.getState().updateSettings({ snap: event.target.checked })} /><span /> Snap</label>
          <span className="timeline-zoom-label">−</span>
          <input className="timeline-zoom-slider" type="range" min="0.5" max="2.5" step="0.1" value={settings.timelineZoom} onChange={(event) => useEditorStore.getState().updateSettings({ timelineZoom: Number(event.target.value) })} aria-label="Timeline zoom" />
          <span className="timeline-zoom-label">+</span>
          <span className="timeline-fps-badge">{settings.fps} FPS</span>
        </div>
      </div>
      <div className="timeline-content">
        <div className="track-label-column">
          <div className="track-label-ruler">TRACKS</div>
          {(rows.length ? rows : defaultRows).map((layer) => (
            <div key={layer.id} className={`track-label-row ${activeLayerId === layer.id ? 'selected' : ''}`} onClick={() => useEditorStore.getState().setActiveLayer(layer.id)}>
              <button className="track-eye-button" title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={(event) => { event.stopPropagation(); if (plan) toggleVisible(layer.id); }}><Icon name={layer.visible ? 'eye' : 'eyeOff'} size={12} /></button>
              <Icon name={trackIcon(layer.kind)} size={13} className={`track-type-icon track-${layer.kind}`} />
              <span className="track-name" title={layer.name}>{layer.name}</span>
              <button className="track-lock-button" title={layer.locked ? 'Unlock layer' : 'Lock layer'} onClick={(event) => { event.stopPropagation(); if (plan) toggleLock(layer.id); }}><Icon name={layer.locked ? 'lock' : 'unlock'} size={11} /></button>
            </div>
          ))}
        </div>
        <div className="timeline-scroll-area">
          <div className="timeline-ruler" style={{ width: `${graphWidth}px` }}>
            {ticks.map((second) => <span key={second} className="ruler-tick" style={{ left: `${second / duration * 100}%` }}>{second}s</span>)}
          </div>
          <div
            className={`timeline-track-grid ${dragKeyframe ? 'is-dragging' : ''}`}
            ref={graphRef}
            style={{ width: `${graphWidth}px` }}
            onPointerDown={onGraphPointerDown}
            onPointerMove={onGraphPointerMove}
            onPointerUp={onGraphPointerUp}
            onPointerCancel={onGraphPointerUp}
          >
            {(rows.length ? rows : defaultRows).map((layer) => {
              const markers = layer.keyframes.reduce((result: Array<{ id: string; at: number; property: string }>, keyframe) => {
                if (!result.some((entry) => entry.id === keyframe.id)) result.push({ id: keyframe.id, at: keyframe.at, property: keyframe.property });
                return result;
              }, []);
              return (
                <div className={`timeline-track-row track-${layer.kind} ${activeLayerId === layer.id ? 'selected' : ''}`} key={layer.id} onClick={() => useEditorStore.getState().setActiveLayer(layer.id)}>
                  {markers.map((marker) => {
                    const at = dragKeyframe?.layerId === layer.id && dragKeyframe.keyframeId === marker.id ? dragKeyframe.at : marker.at;
                    return <button
                      key={marker.id}
                      className={`keyframe-marker ${layer.kind === 'subject' ? 'primary-keyframe' : ''}`}
                      style={{ left: `${at * 100}%` }}
                      title={`${layer.name} · ${marker.property} · ${formatTime(at * duration, true)}. Drag to retime.`}
                      aria-label={`Keyframe for ${layer.name} at ${Math.round(at * 100)} percent`}
                      onPointerDown={(event) => { event.stopPropagation(); if (layer.locked) return; event.currentTarget.parentElement?.setPointerCapture(event.pointerId); setDragKeyframe({ layerId: layer.id, keyframeId: marker.id, at: marker.at }); }}
                    />;
                  })}
                </div>
              );
            })}
            <div className="timeline-playhead" style={{ left: `${playheadPercent}%` }}><span className="playhead-handle" /><span className="playhead-line" /></div>
          </div>
        </div>
      </div>
      <div className="timeline-footnote"><span>{plan ? `${plan.subjectAnalysis.mainSubject} · subject track has ${plan.layers.find((layer) => layer.kind === 'subject' && layer.importance >= 8)?.keyframes.length ?? 0} keyframes` : 'Generate a motion plan to populate editable tracks.'}</span><span>Drag diamonds to retime · click track to scrub</span></div>
    </section>
  );
}
