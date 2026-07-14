import { useEffect, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { humanizeError } from '../errors';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.api.getSettings().then(setSettings);
  }, []);

  const pick = async () => {
    const dir = await window.api.pickFolder();
    if (dir) setSettings((s) => (s ? { ...s, exportDir: dir } : s));
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      await window.api.saveSettings(settings);
      onClose();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <label className="jira-field">
          <span>Default folder for exported reports (HTML / JSON / CSV)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={settings.exportDir}
              placeholder="Not set - you will be asked each time"
              onChange={(e) => setSettings({ ...settings, exportDir: e.target.value })}
            />
            <button onClick={pick}>Browse…</button>
          </div>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.askEachTime}
            onChange={(e) => setSettings({ ...settings, askEachTime: e.target.checked })}
          />
          <span>Ask for the location each time (uncheck to always save to the folder above)</span>
        </label>
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Screenshots are stored in the application data folder. Use the Screenshots folder button in the toolbar to
          open them.
        </p>
        {error && <div className="detail-error">{error}</div>}
        <div className="action-row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
