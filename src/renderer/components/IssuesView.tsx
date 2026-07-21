import { useEffect, useMemo, useState } from 'react';
import type { DomInspectionDTO, IssueDTO, ScanResultDTO, Severity, WcagLevel } from '@shared/types';
import { SEVERITY_ORDER } from '@shared/types';
import { isIssueIgnored, issueGroupKey, useStore } from '../store';
import { humanizeError } from '../errors';
import { JiraSettingsModal } from './JiraSettingsModal';

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
      .filter((i) => (filters.showIgnored ? true : !isIssueIgnored(i, ignoredKeys)))
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
              {isIssueIgnored(issue, ignoredKeys) && <span className="ignored-tag">ignored</span>}
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

// Formats a machine key from issue.extra (e.g. "contrastRatio") for humans.
function humanizeExtraKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function formatExtraValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Builds the full defect text. Used for the created Jira issue and for the
// copy-to-clipboard variant (Jira wiki markup).
function buildJiraDefect(issue: IssueDTO, scan: ScanResultDTO | null, sameTypeCount: number): string {
  const criteria =
    issue.wcagReferences.map((r) => `${r.criterion} ${r.title} (Level ${r.level})`).join(', ') || 'n/a';
  const module = scan?.modules.find((m) => m.moduleId === issue.moduleId);
  const pageUrl = scan?.url ?? '';
  const screenshotName = issue.screenshotPath ? issue.screenshotPath.split(/[\\/]/).pop() : '';
  const scannedAt = scan ? scan.finishedAt.replace('T', ' ').slice(0, 16) : '';
  const extraEntries = Object.entries(issue.extra ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  );

  const lines: string[] = [];
  lines.push(`h3. [Accessibility] ${issue.title}`);
  lines.push('');
  lines.push(`*Severity:* ${issue.severity} (status: ${issue.status})`);
  lines.push(`*Module:* ${module?.moduleName ?? issue.moduleId}`);
  lines.push(`*WCAG 2.2:* ${criteria}`);
  lines.push(`*Occurrences on this page:* ${sameTypeCount}`);
  lines.push('');
  lines.push('h3. Environment');
  if (pageUrl) lines.push(`- Page: ${pageUrl}`);
  if (scan?.title) lines.push(`- Page title: ${scan.title}`);
  if (scan) {
    lines.push(`- Browser: ${scan.browser.name} ${scan.browser.version}`.trimEnd());
    lines.push(`- Viewport: ${scan.viewport.width} x ${scan.viewport.height}`);
    lines.push(`- Tool: WCAG Auditor v${scan.appVersion}, scanned ${scannedAt}`);
  }
  lines.push('');
  lines.push('h3. Affected element');
  lines.push(`*Selector:* {{${issue.cssSelector || 'n/a'}}}`);
  if (issue.xpath) lines.push(`*XPath:* {{${issue.xpath}}}`);
  if (issue.html) {
    lines.push('*HTML snippet:*');
    lines.push('{code:html}');
    lines.push(issue.html);
    lines.push('{code}');
  }
  if (extraEntries.length > 0) {
    lines.push('');
    lines.push('h3. Technical details');
    for (const [key, value] of extraEntries) {
      lines.push(`- ${humanizeExtraKey(key)}: ${formatExtraValue(value)}`);
    }
  }
  lines.push('');
  lines.push('h3. Steps to reproduce');
  if (scan) {
    lines.push(
      `# Open ${scan.browser.name} and size the window to about ${scan.viewport.width} x ${scan.viewport.height}.`
    );
  } else {
    lines.push('# Open the browser.');
  }
  lines.push(`# Go to ${pageUrl || 'the affected page'}.`);
  lines.push('# Open DevTools (F12), press Ctrl+F in the Elements panel and search for the selector above.');
  lines.push(`# Inspect the found element. Problem: ${issue.description || issue.title}`);
  lines.push('');
  lines.push('h3. Expected result');
  lines.push(
    issue.wcagReferences.length > 0
      ? `The element meets WCAG 2.2 success ${issue.wcagReferences.length > 1 ? 'criteria' : 'criterion'} ${criteria}.`
      : 'The element is accessible to keyboard and assistive technology users.'
  );
  lines.push('');
  lines.push('h3. Actual result');
  lines.push(issue.description || issue.title);
  lines.push('');
  lines.push('h3. Suggested fix');
  lines.push(issue.recommendation || 'See the reference links below.');
  if (screenshotName) {
    lines.push('');
    lines.push('h3. Screenshot');
    lines.push(
      `- ${screenshotName} (saved by WCAG Auditor; open it via the Screenshots folder button and attach it to this ticket)`
    );
  }
  const references = [
    ...(issue.helpUrl ? [issue.helpUrl] : []),
    ...issue.wcagReferences.map((r) => `WCAG ${r.criterion} ${r.title}: ${r.url}`)
  ];
  if (references.length > 0) {
    lines.push('');
    lines.push('h3. References');
    for (const ref of references) lines.push(`- ${ref}`);
  }
  return lines.join('\n');
}

function IssueDetail({ issue }: { issue: IssueDTO }) {
  const selectedTargetId = useStore((s) => s.selectedTargetId);
  const currentScan = useStore((s) => s.currentScan);
  const ignoreIssue = useStore((s) => s.ignoreIssue);
  const unignoreIssue = useStore((s) => s.unignoreIssue);
  const isIgnored = useStore((s) => isIssueIgnored(issue, s.ignoredKeys));
  const [shot, setShot] = useState<string>('');
  const [inspection, setInspection] = useState<DomInspectionDTO | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [jiraResult, setJiraResult] = useState<{ key: string; url: string } | null>(null);
  const [actionError, setActionError] = useState('');

  // How many issues of the same type this scan contains. Ignoring hides all of them.
  const sameTypeCount = useMemo(() => {
    const module = currentScan?.modules.find((m) => m.moduleId === issue.moduleId);
    if (!module) return 1;
    const key = issueGroupKey(issue);
    return module.issues.filter((i) => issueGroupKey(i) === key).length;
  }, [currentScan, issue]);

  const jiraText = buildJiraDefect(issue, currentScan, sameTypeCount);
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
      const criteriaShort = issue.wcagReferences.map((r) => r.criterion).join(', ');
      const summary = criteriaShort ? `[A11y] ${issue.title} (WCAG ${criteriaShort})` : `[A11y] ${issue.title}`;
      const result = await window.api.createJiraIssue({ summary, description: jiraText });
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

      {shot && (
        <img
          className="shot"
          src={shot}
          alt="Issue screenshot"
          title="Double-click to open in the image viewer"
          style={{ maxHeight: 320, cursor: 'zoom-in' }}
          onDoubleClick={() => {
            if (issue.screenshotPath) void window.api.openScreenshot(issue.screenshotPath);
          }}
        />
      )}

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
          <button
            onClick={() => void ignoreIssue(issue)}
            title="Hides every occurrence of this issue type, in this scan and in future scans"
          >
            {sameTypeCount > 1 ? `Ignore this issue type (${sameTypeCount} occurrences)` : 'Ignore this issue'}
          </button>
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

      {jiraOpen && <JiraSettingsModal onClose={() => setJiraOpen(false)} />}
    </div>
  );
}
