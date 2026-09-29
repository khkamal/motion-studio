import type { BrowserCapabilities } from '../types/motion';
import { Icon } from './Icon';

interface TopBarProps {
  projectName: string;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  capabilities: BrowserCapabilities | null;
  onNameChange: (name: string) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenKeys: () => void;
  onExport: () => void;
}

export function TopBar(props: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-mark"><span className="brand-glyph"><Icon name="sparkles" size={17} /></span><span>motion<span className="brand-light">studio</span></span></div>
      <div className="topbar-divider" />
      <label className="project-title-wrap">
        <span className="project-name-label">PROJECT</span>
        <input className="project-name-input" value={props.projectName} onChange={(event) => props.onNameChange(event.target.value)} aria-label="Project name" />
        <span className={`save-dot ${props.isDirty ? 'is-dirty' : ''}`} title={props.isDirty ? 'Unsaved changes' : 'Saved locally'} />
      </label>
      <div className="topbar-actions">
        <div className="history-controls">
          <button className="icon-button" disabled={!props.canUndo} title="Undo (Ctrl/Cmd+Z)" onClick={props.onUndo}><Icon name="undo" /></button>
          <button className="icon-button" disabled={!props.canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" onClick={props.onRedo}><Icon name="redo" /></button>
        </div>
        <span className="topbar-separator" />
        <button className="text-button" onClick={props.onNew}><Icon name="plus" size={15} /> New</button>
        <button className="text-button" onClick={props.onOpen}><Icon name="folder" size={15} /> Open</button>
        <button className="text-button" onClick={props.onSave}><Icon name="save" size={15} /> Save</button>
        <div className="capability-pill" title={props.capabilities ? `WebGL${props.capabilities.webgl2 ? '2' : ''} ${props.capabilities.webgl ? 'available' : 'unavailable'} · MP4 ${props.capabilities.supportedMp4 ? 'available' : 'not available'} · WebM ${props.capabilities.supportedWebm ? 'available' : 'not available'} · Local subject segmentation ${props.capabilities.subjectSegmentation ? 'available' : 'fallback only'}${props.capabilities.deviceMemoryGb === undefined ? '' : ` · ${props.capabilities.deviceMemoryGb} GB memory`}${props.capabilities.hardwareConcurrency ? ` · ${props.capabilities.hardwareConcurrency} CPU threads` : ''}` : 'Detecting browser capabilities'}>
          <span className={`status-dot ${props.capabilities?.webgl ? 'online' : ''}`} />
          {props.capabilities?.supportedMp4 ? 'MP4 ready' : props.capabilities?.supportedWebm ? 'WebM ready' : 'Checking'}
        </div>
        <button className="api-key-button" onClick={props.onOpenKeys}><Icon name="key" size={15} /> Gemini</button>
        <button className="button-primary export-top-button" onClick={props.onExport}><Icon name="film" size={15} /> Export</button>
      </div>
    </header>
  );
}
