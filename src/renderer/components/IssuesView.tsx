import { useEffect, useMemo, useState } from 'react';
import type { DomInspectionDTO, IssueDTO, JiraConfigView, Severity, WcagLevel } from '@shared/types';
import { SEVERITY_ORDER } from '@shared/types';
import { issueIdentityKey, useStore } from '../store';
import { humanizeError } from '../errors';

const SEV_COLORS: Record<Severity, string> = {
  critical: '#ff453a',
  serious: '#ff9f0a',
  moderate: '#ffd60a',
  minor: '#64d2ff'
};

const ALL: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
const LEVELS: WcagLevel[] = ['A', 'AA', 'AAA'];

export function IssuesView({ moduleId }: { moduleId: string }) {
  const {
    currentScan,
    filters,
    selectedIssueId,
    ignoredKeys,
    selectIssue,
    setSearch,
    toggleSeverity,
    toggleLevel,
    toggleOnlyFails,
    toggleGroupBy,
    toggleShowIgnored
  } = useStore();

  const module = currentScan?.modules.find((m) => m.moduleId === moduleId);

  const issues = useMemo<IssueDTO[]>(() => {
    if (!module) return [];
    const term = filters.search.trim().toLowerCase();
    const allLevels = filters.levels.size === 0 || filters.levels.size >= 3;
    return module.issues
      .filter((i) => filters.severities.has(i.severity))
      .filter((i) => (filters.onlyFails ? i.status === 'fail' : true))
      .filter((i) => (filters.showIgnored ? true : !ignoredKeys.has(issueIdentityKey(i))))
      .filter((i) => {
        if (allLevels || i.wcagReferences.length === 0) return true;
        return i.wcagReferences.some((r) => filters.levels.has(r.level));
      })
      .filter((i) => {
        if (!term) return true;
        const hay = `${i.title} ${i.description} ${i.cssSelector} ${i.wcagReferences
          .map((r) => r.criterion)
          .join(' ')}`.toLowerCase();
        return hay.includes(term);
      })
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [module, filters, ignoredKeys]);

  const groups = useMemo(() => {
    if (!filters.groupByCriterion) return null;
    const map = new Map<string, IssueDTO[]>();
    for (const i of issues) {
      const key = i.wcagReferences[0]
        ? `WCAG ${i.wcagReferences[0].criterion} ${i.wcagReferences[0].title}`
        : 'No WCAG mapping';
      const list = map.get(key) ?? [];
      list.push(i);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [issues, filters.groupByCriterion]);

  if (!currentScan) {
    return <div className="empty">Run a scan to see the results.</div>;
  }
  if (!module) {
    return <div className="empty">This module was not run in this scan.</div>;
  }

  const renderIssue = (issue: IssueDTO) => {
    const expanded = selectedIssueId === issue.id;
    return (
      <div key={issue.id} className={`issue-block ${expanded ? 'expanded' : ''}`}>
        <div
          className={`issue-row ${expanded ? 'selected' : ''}`}
          onClick={() => selectIssue(expanded ? null : issue.id)}
        >
          <div>
            <span className={`chip ${issue.severity}`}>{issue.severity}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="title">
              {ignoredKeys.has(issueIdentityKey(issue)) && <span className="ignored-tag">ignored</span>}
              {issue.title}
            </div>
            <div className="sub">{issue.cssSelector || issue.xpath}</div>
          </div>
          <div className="wcag">{issue.wcagReferences.map((r) => `WCAG ${r.criterion}`).join(', ') || '-'}</div>
        </div>
        {expanded && <IssueDetail issue={issue} />}
      </div>
    );
  };

  return (
    <div className="issues-layout">
      <div className="filters">
        <input
          className="search"
          placeholder="Search by text, selector, WCAG criterion…"
          value={filters.search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {ALL.map((sev) => (
          <span
            key={sev}
            className={`sev-toggle ${filters.severities.has(sev) ? 'on' : ''}`}
            onClick={() => toggleSeverity(sev)}
          >
            <span className="sev-dot" style={{ background: SEV_COLORS[sev] }} />
            {sev}
          </span>
        ))}
        {LEVELS.map((lvl) => (
          <span
            key={lvl}
            className={`sev-toggle ${filters.levels.has(lvl) ? 'on' : ''}`}
            onClick={() => toggleLevel(lvl)}
            title={`WCAG level ${lvl}`}
          >
            {lvl}
          </span>
        ))}
        <span className={`sev-toggle ${filters.onlyFails ? 'on' : ''}`} onClick={() => toggleOnlyFails()}>
          only FAIL
        </span>
        <span className={`sev-toggle ${filters.groupByCriterion ? 'on' : ''}`} onClick={() => toggleGroupBy()}>
          group by WCAG
        </span>
        <span className={`sev-toggle ${filters.showIgnored ? 'on' : ''}`} onClick={() => toggleShowIgnored()}>
          show ignored
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          {issues.length} / {module.issues.length}
        </span>
      </div>

      <div className="issue-list">
        {issues.length === 0 && <div className="empty">No issues match the current filters.</div>}
        {groups
          ? groups.map(([label, list]) => (
              <div key={label}>
                <div className="group-header">
                  {label} <span className="group-count">{list.length}</span>
                </div>
                {list.map(renderIssue)}
              </div>
            ))
          : issues.map(renderIssue)}
      </div>
    </div>
  );
}

function buildJiraDefect(issue: IssueDTO, pageUrl: string): string {
  const criteria =
    issue.wcagReferences.map((r) => `${r.criterion} ${r.title} (Level ${r.level})`).join(', ') || 'n/a';
  const criteriaShort = issue.wcagReferences.map((r) => r.criterion).join(', ');
  const reference = issue.helpUrl || issue.wcagReferences[0]?.url || '';
  const lines: string[] = [];
  lines.push(`h3. [Accessibility] ${issue.title}`);
  lines.push('');
  lines.push(`*Severity:* ${issue.severity}`);
  lines.push(`*WCAG 2.2:* ${criteria}`);
  if (pageUrl) lines.push(`*Page:* ${pageUrl}`);
  lines.push(`*Element:* {{${issue.cssSelector || 'n/a'}}}`);
  lines.push('');
  lines.push('*Description:*');
  lines.push(issue.description || issue.title);
  lines.push('');
  lines.push('*Steps to reproduce:*');
  lines.push('# Open the page listed above.');
  lines.push('# Locate the element matching the selector.');
  lines.push('# Observe the described accessibility problem.');
  lines.push('');
  lines.push(`*Expected:* The element conforms to WCAG 2.2${criteriaShort ? ` (${criteriaShort})` : ''}.`);
  lines.push(`*Actual:* ${issue.description || issue.title}`);
  lines.push('');
  lines.push('*Suggested fix:*');
  lines.push(issue.recommendation || 'See reference.');
  if (reference) {
    lines.push('');
    lines.push(`*Reference:* ${reference}`);
  }
  return lines.join('\n');
}

function IssueDetail({ issue }: { issue: IssueDTO }) {
  const selectedTargetId = useStore((s) => s.selectedTargetId);
  const pageUrl = useStore((s) => s.currentScan?.url ?? '');
  const ignoreIssue = useStore((s) => s.ignoreIssue);
  const unignoreIssue = useStore((s) => s.unignoreIssue);
  const isIgnored = useStore((s) => s.ignoredKeys.has(issueIdentityKey(issue)));
  const [shot, setShot] = useState<string>('');
  const [inspection, setInspection] = useState<DomInspectionDTO | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [jiraResult, setJiraResult] = useState<{ key: string; url: string } | null>(null);
  const [actionError, setActionError] = useState('');

  const jiraText = buildJiraDefect(issue, pageUrl);
  const guidanceUrl = issue.helpUrl || issue.wcagReferences[0]?.url || '';

  useEffect(() => {
    setShot('');
    setInspection(null);
    setCopied(false);
    setJiraResult(null);
    setActionError('');
    if (issue.screenshotPath) {
      void window.api.readScreenshot(issue.screenshotPath).then(setShot);
    }
  }, [issue.id, issue.screenshotPath]);

  const createJira = async () => {
    setJiraBusy(true);
    setActionError('');
    try {
      const result = await window.api.createJiraIssue({ summary: `[A11y] ${issue.title}`, description: jiraText });
      setJiraResult(result);
    } catch (e) {
      setActionError(humanizeError(e));
    } finally {
      setJiraBusy(false);
    }
  };

  const inspect = async () => {
    if (!selectedTargetId || !issue.cssSelector) return;
    setInspecting(true);
    setActionError('');
    try {
      const result = await window.api.inspectDom(selectedTargetId, issue.cssSelector);
      setInspection(result);
    } catch (e) {
      setActionError(humanizeError(e));
    } finally {
      setInspecting(false);
    }
  };

  const copyJira = async () => {
    try {
      await navigator.clipboard.writeText(jiraText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; the text can still be selected and copied
    }
  };

  return (
    <div className="detail">
      <h3>{issue.title}</h3>
      <div className="kv">
        <span className={`chip ${issue.severity}`}>{issue.severity}</span>{' '}
        <span className="chip ghost">{issue.status}</span>
      </div>

      {shot && <img className="shot" src={shot} alt="Issue screenshot" style={{ maxHeight: 320 }} />}

      <p style={{ color: 'var(--text-dim)' }}>{issue.description}</p>

      <div className="kv">
        <span className="k">Selector:</span> <code>{issue.cssSelector || '-'}</code>
      </div>
      <div className="kv">
        <span className="k">XPath:</span> <code>{issue.xpath || '-'}</code>
      </div>
      <div className="kv">
        <span className="k">WCAG 2.2:</span>{' '}
        {issue.wcagReferences.length === 0
          ? '-'
          : issue.wcagReferences.map((r) => (
              <a key={r.criterion} href={r.url} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>
                {r.criterion} ({r.level})
              </a>
            ))}
      </div>
      {guidanceUrl && (
        <div className="kv">
          <span className="k">Learn more:</span>{' '}
          <a href={guidanceUrl} target="_blank" rel="noreferrer">
            What is wrong and how to fix it
          </a>
        </div>
      )}

      <div className="kv">
        <span className="k">HTML snippet:</span>
      </div>
      <pre>{issue.html || '-'}</pre>

      <div className="kv">
        <span className="k">Recommendation:</span>
      </div>
      <pre>{issue.recommendation || '-'}</pre>

      <details className="jira">
        <summary>Jira defect (ready to paste)</summary>
        <div style={{ marginTop: 8 }}>
          <button onClick={copyJira}>{copied ? 'Copied' : 'Copy to clipboard'}</button>
          <pre style={{ marginTop: 8 }}>{jiraText}</pre>
        </div>
      </details>

      <div className="action-row">
        <button className="primary" onClick={createJira} disabled={jiraBusy}>
          {jiraBusy ? 'Creating…' : 'Create Jira issue'}
        </button>
        <button onClick={() => setJiraOpen(true)}>Jira settings</button>
        {isIgnored ? (
          <button onClick={() => void unignoreIssue(issue)}>Remove from ignore list</button>
        ) : (
          <button onClick={() => void ignoreIssue(issue)}>Ignore this issue</button>
        )}
      </div>
      {jiraResult && (
        <div className="jira-result">
          Created{' '}
          <a href={jiraResult.url} target="_blank" rel="noreferrer">
            {jiraResult.key}
          </a>
        </div>
      )}
      {actionError && <div className="detail-error">{actionError}</div>}

      <button onClick={inspect} disabled={inspecting || !issue.cssSelector}>
        {inspecting ? 'Fetching…' : 'DOM inspection (computed styles + ARIA)'}
      </button>

      {inspection && (
        <div style={{ marginTop: 10 }}>
          <div className="kv">
            <span className="k">Computed styles:</span>
          </div>
          <pre>{JSON.stringify(inspection.computedStyles, null, 2)}</pre>
          <div className="kv">
            <span className="k">ARIA / role:</span>
          </div>
          <pre>
            {Object.keys(inspection.ariaAttributes).length === 0
              ? 'no ARIA attributes'
              : JSON.stringify(inspection.ariaAttributes, null, 2)}
          </pre>
        </div>
      )}

      {jiraOpen && <JiraSettings onClose={() => setJiraOpen(false)} />}
    </div>
  );
}

function JiraSettings({ onClose }: { onClose: () => void }) {
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
