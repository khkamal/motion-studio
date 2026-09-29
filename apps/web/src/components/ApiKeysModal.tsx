import { useState } from 'react';
import { z } from 'zod';
import { testGeminiConfiguration } from '../services/gemini';
import { maskApiKey } from '../services/keyStorage';
import { useEditorStore } from '../store/editorStore';
import type { ApiKeyConfig } from '../types/motion';
import { Icon } from './Icon';

interface ApiKeysModalProps {
  open: boolean;
  onClose: () => void;
  onPersist: (configs: ApiKeyConfig[], activeId: string | null) => void;
}

const ImportedConfigSchema = z.object({ label: z.string().min(1).max(80), key: z.string().min(8).max(256), model: z.string().optional() }).passthrough();

export function ApiKeysModal({ open, onClose, onPersist }: ApiKeysModalProps) {
  const configs = useEditorStore((state) => state.apiKeys);
  const activeApiId = useEditorStore((state) => state.activeApiId);
  const [label, setLabel] = useState('My Gemini key');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(() => import.meta.env.VITE_GEMINI_MODEL?.trim() || 'gemini-2.5-flash');
  const [importText, setImportText] = useState('');
  const [notice, setNotice] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  if (!open) return null;
  const update = (next: ApiKeyConfig[], activeId = activeApiId) => {
    onPersist(next, activeId);
    setNotice('Configuration saved in this browser.');
  };
  const addConfig = () => {
    if (key.trim().length < 8) {
      setNotice('Enter a valid Gemini API key first.');
      return;
    }
    const entry: ApiKeyConfig = { id: crypto.randomUUID(), label: label.trim() || 'Gemini configuration', key: key.trim(), model: model.trim() || 'gemini-2.5-flash', enabled: true };
    const next = [...configs, entry];
    update(next, activeApiId ?? entry.id);
    setKey('');
  };
  const toggleEnabled = (config: ApiKeyConfig) => {
    const next = configs.map((entry) => entry.id === config.id ? { ...entry, enabled: !entry.enabled } : entry);
    const nextActive = activeApiId === config.id && !config.enabled ? next.find((entry) => entry.enabled)?.id ?? null : activeApiId;
    update(next, nextActive);
  };
  const removeConfig = (config: ApiKeyConfig) => {
    const next = configs.filter((entry) => entry.id !== config.id);
    update(next, activeApiId === config.id ? next.find((entry) => entry.enabled)?.id ?? null : activeApiId);
  };
  const runTest = async (config: ApiKeyConfig) => {
    setTestingId(config.id);
    setTestResult((current) => ({ ...current, [config.id]: 'Testing…' }));
    try {
      const result = await testGeminiConfiguration(config);
      setTestResult((current) => ({ ...current, [config.id]: result }));
    } catch (error) {
      setTestResult((current) => ({ ...current, [config.id]: error instanceof Error ? error.message : 'Test failed.' }));
    } finally {
      setTestingId(null);
    }
  };
  const importConfigs = () => {
    try {
      const parsed: unknown = JSON.parse(importText);
      const checked = z.array(ImportedConfigSchema).max(30).parse(parsed);
      const next = [...configs, ...checked.map((entry) => ({
        id: crypto.randomUUID(), label: entry.label, key: entry.key, model: entry.model?.trim() || 'gemini-2.5-flash', enabled: true,
      }))];
      if (next.length > 30) throw new Error('The limit is 30 configurations.');
      update(next, activeApiId ?? next.find((entry) => entry.enabled)?.id ?? null);
      setImportText('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The JSON configuration list is invalid.');
    }
  };
  const enabledCount = configs.filter((entry) => entry.enabled).length;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card api-keys-modal" role="dialog" aria-modal="true" aria-labelledby="api-modal-title">
      <div className="modal-header"><div><span className="panel-eyebrow">AI CONFIGURATION</span><h2 id="api-modal-title">Gemini API keys</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
      <div className="security-note"><Icon name="lock" size={15} /><p>Keys are stored only in this browser's local storage and sent directly to Google in an HTTPS request. They are never sent to a Motion Studio server or included in project/preset files. Anyone with access to this browser profile can view its local storage.</p></div>
      <div className="key-list-header"><span>CONFIGURATIONS</span><strong>{enabledCount} Active</strong></div>
      <div className="key-config-list">
        {configs.length === 0 && <div className="empty-key-state"><Icon name="key" size={18} /><span>No Gemini keys added yet.</span></div>}
        {configs.map((config) => <div key={config.id} className={`key-config-row ${config.enabled ? '' : 'disabled'}`}>
          <label className="key-radio"><input type="radio" name="active-gemini" checked={activeApiId === config.id} disabled={!config.enabled} onChange={() => update(configs, config.id)} /><span /></label>
          <div className="key-config-main"><div className="key-config-title"><strong>{config.label}</strong><span>{config.model}</span></div><div className="key-mask">{maskApiKey(config.key)}</div>{testResult[config.id] && <small className={testResult[config.id].includes('Connected') ? 'test-good' : 'test-bad'}>{testResult[config.id]}</small>}</div>
          <div className="key-config-actions"><button className="text-button tiny" onClick={() => runTest(config)} disabled={testingId === config.id}>{testingId === config.id ? 'Testing' : 'Test'}</button><label className="tiny-switch" title={config.enabled ? 'Disable key' : 'Enable key'}><input type="checkbox" checked={config.enabled} onChange={() => toggleEnabled(config)} /><span /></label><button className="subtle-icon-button" title="Remove configuration" onClick={() => removeConfig(config)}><Icon name="trash" size={13} /></button></div>
        </div>)}
      </div>
      <div className="key-add-form">
        <div className="modal-section-title"><span>ADD CONFIGURATION</span><span>ACTIVE CONFIG · {activeApiId ? 'SELECTED' : 'NONE'}</span></div>
        <div className="two-field-row"><label className="form-field"><span>Label</span><input className="text-input" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} /></label><label className="form-field"><span>Model</span><input className="text-input" maxLength={100} value={model} onChange={(event) => setModel(event.target.value)} /></label></div>
        <label className="form-field"><span>Gemini API key</span><input className="text-input api-key-entry" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste an API key" /></label>
        <button className="button-primary full-width" onClick={addConfig} disabled={!key.trim()}><Icon name="plus" size={14} /> Add key</button>
      </div>
      <details className="import-keys-details"><summary>Import multiple configurations <Icon name="chevron" size={13} /></summary><p>Paste a JSON array of objects with <code>label</code>, <code>key</code>, and optional <code>model</code> fields. The file is processed locally.</p><textarea className="manual-prompt-input import-keys-input" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'[{"label":"Studio key","key":"…","model":"gemini-2.5-flash"}]'} /><button className="button-secondary full-width" disabled={!importText.trim()} onClick={importConfigs}>Import configurations</button></details>
      {notice && <div className="modal-notice">{notice}</div>}
      <div className="modal-footer"><span>One selected configuration is used per request. No automatic quota-circumvention rotation.</span><button className="button-secondary" onClick={onClose}>Done</button></div>
    </section>
  </div>;
}
