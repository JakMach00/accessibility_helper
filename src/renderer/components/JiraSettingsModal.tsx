import { useEffect, useState } from 'react';
import type { JiraConfigView } from '@shared/types';
import { humanizeError } from '../errors';

// Jira connection settings. Opened from the toolbar and from the issue detail view.
export function JiraSettingsModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<JiraConfigView | null>(null);
  const [token, setToken] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  useEffect(() => {
    void window.api.getJiraConfig().then((c) => {
      setCfg(c);
      setLabelsText(c.labels.join(', '));
    });
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setSettingsError('');
    try {
      await window.api.saveJiraConfig({
        baseUrl: cfg.baseUrl.trim(),
        email: cfg.email.trim(),
        apiToken: token, // empty = keep existing
        projectKey: cfg.projectKey.trim(),
        issueType: cfg.issueType.trim(),
        component: cfg.component.trim(),
        labels: labelsText.split(',').map((l) => l.trim()).filter(Boolean)
      });
      onClose();
    } catch (e) {
      setSettingsError(humanizeError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) return null;
  const field = (label: string, value: string, on: (v: string) => void, placeholder = '') => (
    <label className="jira-field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Jira settings</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          Uses the Jira Cloud REST API. Create an API token at id.atlassian.com. The token is stored encrypted on this
          machine.
        </p>
        {field('Base URL', cfg.baseUrl, (v) => setCfg({ ...cfg, baseUrl: v }), 'https://your-domain.atlassian.net')}
        {field('Email', cfg.email, (v) => setCfg({ ...cfg, email: v }), 'you@company.com')}
        <label className="jira-field">
          <span>API token {cfg.hasToken ? '(saved, leave empty to keep)' : ''}</span>
          <input type="password" value={token} placeholder="paste API token" onChange={(e) => setToken(e.target.value)} />
        </label>
        {field('Project key', cfg.projectKey, (v) => setCfg({ ...cfg, projectKey: v }), 'ACC')}
        {field('Issue type', cfg.issueType, (v) => setCfg({ ...cfg, issueType: v }), 'Bug')}
        {field('Component (optional)', cfg.component, (v) => setCfg({ ...cfg, component: v }))}
        {field('Labels (comma-separated)', labelsText, setLabelsText)}
        {settingsError && <div className="detail-error">{settingsError}</div>}
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
