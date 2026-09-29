import { SUBJECT_TYPES, type AspectRatioPreset, type EditorSettings, type ImageFit, type MediaAsset } from '../types/motion';
import { Icon } from './Icon';

const RATIOS: Array<[AspectRatioPreset, string, number, number]> = [
  ['16:9', '16:9', 1920, 1080], ['9:16', '9:16', 1080, 1920], ['1:1', '1:1', 1080, 1080],
  ['4:5', '4:5', 1080, 1350], ['4:3', '4:3', 1440, 1080], ['3:2', '3:2', 1620, 1080],
  ['2:3', '2:3', 1080, 1620], ['21:9', '21:9', 2520, 1080], ['custom', 'Custom', 1920, 1080],
];

interface SourcePanelProps {
  asset: MediaAsset | null;
  settings: EditorSettings;
  subjectType: string;
  onPick: () => void;
  onRemove: () => void;
  onTypeChange: (type: string) => void;
  onSettingsChange: (settings: Partial<EditorSettings>) => void;
}

export function SourcePanel({ asset, settings, subjectType, onPick, onRemove, onTypeChange, onSettingsChange }: SourcePanelProps) {
  const setRatio = (ratio: AspectRatioPreset) => {
    const selected = RATIOS.find(([key]) => key === ratio);
    if (!selected) return;
    onSettingsChange({ aspectRatio: ratio, ...(ratio === 'custom' ? {} : { width: selected[2], height: selected[3] }) });
  };
  const setCustomDimension = (key: 'width' | 'height', value: number) => {
    if (!Number.isFinite(value)) return;
    const safe = Math.max(16, Math.min(7680, Math.round(value)));
    onSettingsChange({ aspectRatio: 'custom', [key]: safe });
  };
  return (
    <aside className="source-panel">
      <div className="panel-eyebrow"><span>01</span> SOURCE IMAGE</div>
      {asset ? (
        <div className="source-card">
          <div className="source-image-frame">
            <img src={asset.objectUrl} alt={`Uploaded image ${asset.name}`} />
            <span className="source-type-badge">{asset.type.replace('image/', '').toUpperCase().replace('JPEG', 'JPG')}</span>
            <button className="source-replace" onClick={onPick} title="Replace image"><Icon name="refresh" size={14} /></button>
          </div>
          <div className="source-file-line">
            <span className="source-file-name" title={asset.name}>{asset.name}</span>
            <button className="subtle-icon-button" onClick={onRemove} title="Remove image"><Icon name="trash" size={14} /></button>
          </div>
          <div className="source-meta">{asset.width.toLocaleString()} × {asset.height.toLocaleString()} <span>·</span> {(asset.blob.size / (1024 * 1024)).toFixed(asset.blob.size > 1_000_000 ? 1 : 2)} MB</div>
        </div>
      ) : (
        <button className="upload-drop-card" onClick={onPick}>
          <span className="upload-icon-circle"><Icon name="upload" size={19} /></span>
          <strong>Drop your image here</strong>
          <span>or browse files</span>
          <small>PNG · JPG · WebP · SVG</small>
        </button>
      )}

      <div className="panel-section source-options">
        <div className="field-label-row"><label htmlFor="subject-type">SUBJECT HINT</label><span className="field-note">optional</span></div>
        <select id="subject-type" className="select-control" value={subjectType} onChange={(event) => onTypeChange(event.target.value)}>
          <option value="auto">Auto-detect with Gemini</option>
          {SUBJECT_TYPES.filter((type) => type !== 'unknown').map((type) => <option key={type} value={type}>{type.replace(/^./, (letter) => letter.toUpperCase())}</option>)}
          <option value="unknown">Unknown / abstract</option>
        </select>
        <p className="field-help">Used as a hint only. Gemini vision analyzes the uploaded pixels when configured.</p>
      </div>

      <div className="panel-section source-options">
        <div className="field-label-row"><label htmlFor="aspect-ratio">CANVAS</label><span className="dimension-total">{settings.width} × {settings.height}</span></div>
        <select id="aspect-ratio" className="select-control" value={settings.aspectRatio} onChange={(event) => setRatio(event.target.value as AspectRatioPreset)}>
          {RATIOS.map(([key, label]) => <option key={key} value={key}>{label}{key !== 'custom' ? ` · ${RATIOS.find((entry) => entry[0] === key)?.[2]}×${RATIOS.find((entry) => entry[0] === key)?.[3]}` : ''}</option>)}
        </select>
        {settings.aspectRatio === 'custom' && (
          <div className="dimension-inputs">
            <label><span>W</span><input type="number" min={16} max={7680} value={settings.width} onChange={(event) => setCustomDimension('width', Number(event.target.value))} /></label>
            <span className="dimension-x">×</span>
            <label><span>H</span><input type="number" min={16} max={7680} value={settings.height} onChange={(event) => setCustomDimension('height', Number(event.target.value))} /></label>
          </div>
        )}
        <div className="field-label-row field-label-secondary"><label htmlFor="image-fit">IMAGE PLACEMENT</label></div>
        <select id="image-fit" className="select-control" value={settings.fit} onChange={(event) => onSettingsChange({ fit: event.target.value as ImageFit })}>
          <option value="fit">Fit · show full image</option>
          <option value="fill">Fill · cover canvas</option>
          <option value="crop">Crop · centered cover</option>
          <option value="center">Center · native scale</option>
        </select>
        <p className="field-help">Source image is never stretched. Fill and crop may trim edges.</p>
      </div>

      <div className="source-hint-box">
        <span className="hint-icon"><Icon name="info" size={14} /></span>
        <p>Motion is rendered locally from your image. Gemini proposes a plan; the renderer and export stay in your browser.</p>
      </div>
    </aside>
  );
}
