import { useMemo, useState } from 'react';
import { applyPreset, createPreset, deletePreset, duplicatePreset, getPresets, PRESET_CATEGORIES, renamePreset, savePreset, type MotionPreset, type PresetCategory } from '../services/presets';
import { suggestSeo } from '../engine/planBuilder';
import { useEditorStore, type InspectorTab } from '../store/editorStore';
import type { EditorSettings, MotionPlan } from '../types/motion';
import { Icon } from './Icon';

interface InspectorProps {
  isGenerating: boolean;
  apiConfigured: boolean;
  onGenerate: () => void;
  onManualPrompt: (prompt: string) => void;
  onOpenKeys: () => void;
}

function PrioritySlider({ label, value, onChange, detail, color = 'blue', onStart }: { label: string; value: number; onChange: (value: number) => void; detail: string; color?: string; onStart?: () => void }) {
  return <label className="priority-slider" style={{ ['--slider-accent' as string]: color }}>
    <span className="priority-slider-top"><span>{label}</span><strong>{Math.round(value * 100)}%</strong></span>
    <input type="range" min="0" max="100" value={Math.round(value * 100)} onPointerDown={onStart} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) onStart?.(); }} onChange={(event) => onChange(Number(event.target.value) / 100)} aria-label={label} />
    <span className="priority-slider-detail">{detail}</span>
  </label>;
}

function MotionPanel({ isGenerating, apiConfigured, onGenerate, onManualPrompt, onOpenKeys }: InspectorProps) {
  const plan = useEditorStore((state) => state.plan);
  const settings = useEditorStore((state) => state.settings);
  const [prompt, setPrompt] = useState('');
  const updatePriority = (key: keyof EditorSettings['priorities'], value: number) => useEditorStore.getState().setPriority(key, value, false);
  const captureHistory = () => useEditorStore.getState().captureHistory();
  const updatePlan = (updater: (current: MotionPlan) => MotionPlan, recordHistory = true) => useEditorStore.getState().updatePlan(updater, recordHistory);
  const mainLayer = plan?.layers.find((layer) => layer.kind === 'subject' && layer.importance >= 8) ?? plan?.layers.find((layer) => layer.kind === 'subject');
  const mask = mainLayer?.mask;
  const trustedMask = Boolean(mask && mask.confidence === 'high' && (mask.mode === 'alpha'
    ? Boolean(mask.alphaMaskDataUrl) && (mask.source === 'segmentation' || mask.source === 'user')
    : mask.source === 'user'));
  const subjectType = plan?.subjectAnalysis.subjectType ?? 'not detected';

  const submitPrompt = () => {
    const text = prompt.trim();
    if (!text || !plan) return;
    onManualPrompt(text);
    setPrompt('');
  };

  return <div className="inspector-scroll motion-inspector">
    <div className="inspector-headline"><div><span className="panel-eyebrow"><span>02</span> MOTION DIRECTION</span><h2>Make it move.</h2></div><span className={`vision-badge ${plan?.source === 'gemini' ? 'vision-ai' : ''}`}><Icon name={plan?.source === 'gemini' ? 'sparkles' : 'wand'} size={12} />{plan?.source === 'gemini' ? 'VISION PLAN' : 'LOCAL DRAFT'}</span></div>

    <button className="generate-motion-button" onClick={onGenerate} disabled={isGenerating || !useEditorStore.getState().asset}>
      {isGenerating ? <span className="loading-spinner small" /> : <Icon name="sparkles" size={16} />}
      <span>{isGenerating ? 'Analyzing image…' : 'Generate Motion'}</span>
      {!isGenerating && <span className="generate-arrow"><Icon name="arrow" size={14} /></span>}
    </button>
    {!apiConfigured && <div className="inline-ai-notice"><span className="status-dot" /><span>Using deterministic local draft. <button onClick={onOpenKeys}>Add Gemini key</button> for vision analysis.</span></div>}

    {plan && <>
      <div className="motion-concept-card">
        <div className="concept-card-top"><span className="concept-spark"><Icon name="sparkles" size={13} /></span><span>MOTION CONCEPT</span><span className="concept-type-chip">{subjectType}</span></div>
        <p>{plan.concept.summary}</p>
        <div className="concept-motion-list">
          <div><span className="concept-dot primary" /><strong>Primary</strong><span>{plan.concept.primary}</span></div>
          <div><span className="concept-dot secondary" /><strong>Secondary</strong><span>{plan.concept.secondary || 'No secondary movement selected.'}</span></div>
          <div><span className="concept-dot support" /><strong>Supporting</strong><span>{plan.concept.supporting}</span></div>
          <div><span className="concept-dot camera" /><strong>Camera</strong><span>{plan.concept.camera}</span></div>
        </div>
      </div>

      <section className="inspector-section">
        <div className="section-title-row"><h3>MOTION PRIORITY</h3><span className="section-chip">SUBJECT FIRST</span></div>
        <PrioritySlider label="Subject Motion" value={settings.priorities.subjectMotionStrength} onChange={(value) => updatePriority('subjectMotionStrength', value)} detail={trustedMask ? 'Independent transform on the trusted subject layer.' : 'Local subject material motion; no estimated cut-out is shifted.'} color="#86a7ff" onStart={captureHistory} />
        <PrioritySlider label="Secondary Motion" value={settings.priorities.secondaryMotionStrength} onChange={(value) => updatePriority('secondaryMotionStrength', value)} detail="Supporting subjects and materials." color="#70d2c0" onStart={captureHistory} />
        <PrioritySlider label="Camera Motion" value={settings.priorities.cameraMotionStrength} onChange={(value) => updatePriority('cameraMotionStrength', value)} detail="Push, pan, tilt, or tracking." color="#ac8cff" onStart={captureHistory} />
        <PrioritySlider label="Depth / Parallax" value={settings.parallaxStrength} onChange={(value) => useEditorStore.getState().updateSettings({ parallaxStrength: value }, false)} detail="Secondary depth offset; set to zero to disable." color="#6796c7" onStart={captureHistory} />
        <PrioritySlider label="Effects" value={settings.priorities.effectsStrength} onChange={(value) => updatePriority('effectsStrength', value)} detail="Lighting, reflections, and glow." color="#edb46f" onStart={captureHistory} />
        <PrioritySlider label="Particles" value={settings.priorities.particleStrength} onChange={(value) => updatePriority('particleStrength', value)} detail="Optional atmosphere, never the main motion." color="#d88ddd" onStart={captureHistory} />
      </section>

      <section className="inspector-section compact-section">
        <div className="section-title-row"><h3>RENDER STYLE</h3></div>
        <div className="segmented-control style-segmented">
          {(['2D', '3D', 'Line Art'] as const).map((style) => <button key={style} className={settings.style === style ? 'active' : ''} onClick={() => {
            const store = useEditorStore.getState();
            store.captureHistory();
            store.updateSettings({ style }, false);
            updatePlan((current) => ({ ...current, style, source: current.source === 'gemini' ? 'edited' : current.source }), false);
          }}>{style}</button>)}
        </div>
      </section>

      <section className="inspector-section effect-controls">
        <div className="section-title-row"><h3>SUPPORTING LAYERS</h3><span className="section-note">optional</span></div>
        <label className="switch-row"><span><strong>Camera</strong><small>Keep movement subordinate</small></span><input type="checkbox" checked={settings.cameraEnabled} onChange={(event) => useEditorStore.getState().updateSettings({ cameraEnabled: event.target.checked })} /><i /></label>
        <label className="switch-row"><span><strong>Effects & lighting</strong><small>Highlight and reflection movement</small></span><input type="checkbox" checked={settings.effectsEnabled} onChange={(event) => useEditorStore.getState().updateSettings({ effectsEnabled: event.target.checked })} /><i /></label>
        <label className="switch-row"><span><strong>Particles</strong><small>Atmospheric accent only</small></span><input type="checkbox" checked={settings.particlesEnabled} onChange={(event) => {
          const store = useEditorStore.getState();
          store.captureHistory();
          store.updateSettings({ particlesEnabled: event.target.checked }, false);
          updatePlan((current) => ({ ...current, effects: { ...current.effects, particlesEnabled: event.target.checked } }), false);
        }} /><i /></label>
        <label className="select-row"><span>Particle type</span><select className="select-control compact-select" value={settings.particleType} onChange={(event) => {
          const particleType = event.target.value as EditorSettings['particleType'];
          const store = useEditorStore.getState();
          store.captureHistory();
          store.updateSettings({ particleType }, false);
          updatePlan((current) => ({ ...current, effects: { ...current.effects, particleType } }), false);
        }}><option value="dust">Dust</option><option value="sparkles">Sparkles</option><option value="stars">Stars</option><option value="technology">Technology</option><option value="energy">Energy</option><option value="abstract">Abstract</option></select></label>
      </section>

      <section className="inspector-section mask-inspector">
        <div className="section-title-row"><h3>SUBJECT ISOLATION</h3><span className={`mask-status ${trustedMask ? 'mask-good' : ''}`}>{trustedMask ? 'TRUSTED MASK' : mask?.region ? 'APPROXIMATE' : 'NO MASK'}</span></div>
        <div className="mask-copy"><span className="mask-shape-icon"><Icon name="move" size={14} /></span><p>{mask?.note || 'No pixel mask is available; a declared motion region can still receive a conservative local material highlight.'}</p></div>
        {mask?.region && <div className="mask-region-line">{mask.mode.toUpperCase()} REGION <span>{Math.round(mask.region.width * 100)}% × {Math.round(mask.region.height * 100)}%</span></div>}
        <div className="mask-region-line">MAY MOVE <span>{plan.subjectAnalysis.movingRegions.slice(0, 2).map((region) => region.label).join(' · ') || 'No localized region'}</span></div>
        <div className="mask-region-line">STAYS STABLE <span>{plan.subjectAnalysis.stableRegions.slice(0, 2).map((region) => region.label).join(' · ') || 'Background plate'}</span></div>
        <p className="mask-disclaimer">Gemini boxes and polygons are prompts, never trusted masks. The browser may create a local pixel mask for the primary subject; if it is unavailable or fails safety checks, the source stays intact and only restrained material motion runs. Background cover is conservative edge-color diffusion, not inpainting; thin details and touching objects may be imperfect, and hidden pixels are not reconstructed.</p>
      </section>

      <section className="inspector-section green-screen-section">
        <div className="section-title-row"><h3>CHROMA KEY</h3><label className="tiny-switch"><input type="checkbox" checked={settings.greenScreen.enabled} onChange={(event) => useEditorStore.getState().updateSettings({ greenScreen: { enabled: event.target.checked } })} /><span /></label></div>
        <p className="field-help">Key a matching source color to transparency in preview; not universal AI background removal. Export alpha depends on codec support.</p>
        {settings.greenScreen.enabled && <>
          <div className="green-screen-colors">{(['green', 'blue', 'custom'] as const).map((color) => <button key={color} className={settings.greenScreen.color === color ? 'active' : ''} onClick={() => useEditorStore.getState().updateSettings({ greenScreen: { color } })}><i className={`key-color key-${color}`} />{color}</button>)}</div>
          {settings.greenScreen.color === 'custom' && <input className="color-input" type="color" value={settings.greenScreen.customColor} onChange={(event) => useEditorStore.getState().updateSettings({ greenScreen: { customColor: event.target.value } })} aria-label="Custom chroma key color" />}
          <PrioritySlider label="Tolerance" value={settings.greenScreen.tolerance} onChange={(value) => useEditorStore.getState().updateSettings({ greenScreen: { tolerance: value } }, false)} detail="Color distance to remove." color="#70c985" onStart={captureHistory} />
          <PrioritySlider label="Softness" value={settings.greenScreen.softness} onChange={(value) => useEditorStore.getState().updateSettings({ greenScreen: { softness: value } }, false)} detail="Edge transition." color="#70c985" onStart={captureHistory} />
        </>}
      </section>

      <section className="inspector-section manual-prompt-section">
        <div className="section-title-row"><h3>REFINE WITH A PROMPT</h3><span className="section-note">modify current plan</span></div>
        <textarea className="manual-prompt-input" maxLength={600} placeholder={'“Keep the camera static and make the tree sway more naturally.”'} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitPrompt(); }} disabled={!plan || isGenerating} />
        <div className="prompt-footer"><span>{apiConfigured ? 'AI edits existing motion plan' : 'Local prompt controls · no key needed'}</span><button className="prompt-submit" onClick={submitPrompt} disabled={!prompt.trim() || !plan || isGenerating}><Icon name="arrow" size={15} /></button></div>
        <div className="prompt-examples">Try: <button onClick={() => setPrompt('Keep the camera static.')}>static camera</button><button onClick={() => setPrompt('Remove particles.')}>remove particles</button></div>
      </section>

      <div className="subject-summary-row"><span><Icon name="move" size={13} /> {plan.subjects.length} subject{plan.subjects.length === 1 ? '' : 's'} · {mainLayer?.motions.length ?? 0} primary motions</span><span>{plan.source === 'gemini' ? 'AI vision' : 'offline draft'}</span></div>
    </>}
    {!plan && <div className="inspector-empty"><Icon name="sparkles" size={19} /><p>Upload an image to create a scene-specific motion plan.</p></div>}
  </div>;
}

function PresetsPanel() {
  const plan = useEditorStore((state) => state.plan);
  const settings = useEditorStore((state) => state.settings);
  const [presets, setPresets] = useState<MotionPreset[]>(() => getPresets());
  const [category, setCategory] = useState<string>('All');
  const [name, setName] = useState('');
  const [saveCategory, setSaveCategory] = useState<PresetCategory>('Abstract');
  const [notice, setNotice] = useState('');
  const filtered = useMemo(() => category === 'All' ? presets : presets.filter((preset) => preset.category === category), [presets, category]);

  const refresh = () => setPresets(getPresets());
  const apply = (preset: MotionPreset) => {
    if (!plan) return;
    const store = useEditorStore.getState();
    store.captureHistory();
    store.setPlan(applyPreset(plan, preset), false);
    store.updateSettings(preset.settings, false);
    setNotice(`Applied “${preset.name}” to the current subject.`);
  };
  const saveCurrent = () => {
    if (!plan) return;
    try {
      const preset = createPreset(name || `${plan.subjectAnalysis.mainSubject} motion`, saveCategory, plan, settings);
      savePreset(preset);
      setName('');
      refresh();
      setNotice('Preset saved locally. API keys are never included.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save preset.');
    }
  };
  const randomPreset = () => {
    const candidates = presets.filter((preset) => preset.category !== 'Medical');
    if (candidates.length) apply(candidates[Math.floor(Math.random() * candidates.length)]);
  };
  const rename = (preset: MotionPreset) => {
    const nextName = window.prompt('Rename preset', preset.name);
    if (!nextName?.trim() || preset.builtIn) return;
    savePreset(renamePreset(preset, nextName));
    refresh();
  };
  const duplicate = (preset: MotionPreset) => {
    const copy = duplicatePreset(preset);
    savePreset(copy);
    refresh();
    setNotice(`Duplicated “${preset.name}”.`);
  };
  const remove = (preset: MotionPreset) => {
    if (preset.builtIn || !window.confirm(`Delete preset “${preset.name}”?`)) return;
    deletePreset(preset.id);
    refresh();
  };

  return <div className="inspector-scroll presets-panel">
    <div className="inspector-headline"><div><span className="panel-eyebrow"><span>03</span> MOTION LIBRARY</span><h2>Presets</h2></div><button className="small-outline-button" onClick={randomPreset}><Icon name="refresh" size={13} /> Random</button></div>
    <p className="inspector-intro">Presets retarget subject motion to your current scene. Your image and Gemini configuration are not stored.</p>
    <div className="preset-category-strip"><button className={category === 'All' ? 'active' : ''} onClick={() => setCategory('All')}>All</button>{PRESET_CATEGORIES.map((entry) => <button key={entry} className={category === entry ? 'active' : ''} onClick={() => setCategory(entry)}>{entry}</button>)}</div>
    <div className="preset-grid">
      {filtered.map((preset) => <article className="preset-card" key={preset.id} style={{ ['--preset-accent' as string]: preset.accentColor }}>
        <div className="preset-card-top"><span className="preset-symbol"><Icon name="sparkles" size={15} /></span><span className="preset-category-label">{preset.category}</span>{preset.builtIn && <span className="builtin-badge">BUILT IN</span>}</div>
        <h3>{preset.name}</h3><p>{preset.plan.concept.primary}</p>
        <div className="preset-card-footer"><span>{preset.plan.style} · {preset.settings.particleType}</span><button className="preset-apply-button" onClick={() => apply(preset)}>Apply <Icon name="arrow" size={13} /></button></div>
        <div className="preset-more-actions"><button title="Duplicate preset" onClick={() => duplicate(preset)}><Icon name="copy" size={12} /></button>{!preset.builtIn && <><button title="Rename preset" onClick={() => rename(preset)}><Icon name="edit" size={12} /></button><button title="Delete preset" onClick={() => remove(preset)}><Icon name="trash" size={12} /></button></>}</div>
      </article>)}
    </div>
    <div className="save-preset-card"><div className="section-title-row"><h3>SAVE CURRENT LOOK</h3><Icon name="save" size={14} /></div><input className="text-input" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Name this preset" /><select className="select-control" value={saveCategory} onChange={(event) => setSaveCategory(event.target.value as PresetCategory)}>{PRESET_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}</select><button className="button-secondary full-width" disabled={!plan} onClick={saveCurrent}><Icon name="plus" size={14} /> Save Preset</button></div>
    {notice && <p className="inline-notice">{notice}</p>}
  </div>;
}

function SeoPanel() {
  const settings = useEditorStore((state) => state.settings);
  const plan = useEditorStore((state) => state.plan);
  const update = (key: keyof EditorSettings['seo'], value: string) => useEditorStore.getState().updateSettings({ seo: { [key]: value } });
  const suggest = () => {
    if (!plan) return;
    const generated = suggestSeo(plan, useEditorStore.getState().asset?.name ?? 'motion');
    useEditorStore.getState().updateSettings({ seo: generated });
  };
  return <div className="inspector-scroll seo-panel">
    <div className="inspector-headline"><div><span className="panel-eyebrow"><span>04</span> DISCOVERY METADATA</span><h2>SEO power-up</h2></div><button className="small-outline-button" disabled={!plan} onClick={suggest}><Icon name="sparkles" size={13} /> Suggest</button></div>
    <p className="inspector-intro">Editable publishing metadata based on the current motion plan. No technical media metadata is inferred.</p>
    <label className="form-field"><span>Title</span><input className="text-input" value={settings.seo.title} maxLength={200} onChange={(event) => update('title', event.target.value)} placeholder="Project title" /></label>
    <label className="form-field"><span>Description</span><textarea className="text-input seo-textarea" value={settings.seo.description} maxLength={1000} onChange={(event) => update('description', event.target.value)} placeholder="Describe the motion graphic…" /></label>
    <label className="form-field"><span>Keywords</span><input className="text-input" value={settings.seo.keywords} maxLength={1000} onChange={(event) => update('keywords', event.target.value)} placeholder="motion graphics, nature…" /></label>
    <label className="form-field"><span>Tags</span><input className="text-input" value={settings.seo.tags} maxLength={1000} onChange={(event) => update('tags', event.target.value)} placeholder="Add comma-separated tags" /></label>
    <label className="form-field"><span>Category suggestion</span><input className="text-input" value={settings.seo.category} maxLength={200} onChange={(event) => update('category', event.target.value)} placeholder="Nature, technology…" /></label>
    <label className="form-field"><span>Content description</span><textarea className="text-input seo-textarea" value={settings.seo.contentDescription} maxLength={1500} onChange={(event) => update('contentDescription', event.target.value)} placeholder="What's visually happening?" /></label>
    <label className="form-field"><span>Filename suggestion</span><div className="filename-input-wrap"><input className="text-input" value={settings.seo.filename} maxLength={200} onChange={(event) => update('filename', event.target.value)} /><span>.webm</span></div></label>
    <label className="form-field"><span>AI-generated content disclosure</span><textarea className="text-input seo-textarea short" value={settings.seo.aiDisclosure} maxLength={500} onChange={(event) => update('aiDisclosure', event.target.value)} placeholder="Optional disclosure text" /></label>
    <div className="seo-disclaimer"><Icon name="info" size={14} /><span>Suggestions are editable. Dimensions, codec and duration are read from export settings, not generated as SEO metadata.</span></div>
  </div>;
}

const TABS: Array<{ id: InspectorTab; label: string; icon: 'wand' | 'grid' | 'edit' }> = [
  { id: 'motion', label: 'Motion', icon: 'wand' }, { id: 'presets', label: 'Presets', icon: 'grid' }, { id: 'seo', label: 'SEO', icon: 'edit' },
];

export function Inspector(props: InspectorProps) {
  const tab = useEditorStore((state) => state.inspectorTab);
  return <aside className="inspector-panel">
    <nav className="inspector-tabs">{TABS.map((entry) => <button key={entry.id} className={tab === entry.id ? 'active' : ''} onClick={() => useEditorStore.getState().setInspectorTab(entry.id)}><Icon name={entry.icon} size={14} />{entry.label}</button>)}</nav>
    {tab === 'motion' && <MotionPanel {...props} />}
    {tab === 'presets' && <PresetsPanel />}
    {tab === 'seo' && <SeoPanel />}
  </aside>;
}
