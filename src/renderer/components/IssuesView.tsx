import { useEffect, useMemo, useState } from 'react';
import type { DomInspectionDTO, IssueDTO, Severity } from '@shared/types';
import { SEVERITY_ORDER } from '@shared/types';
import { useStore } from '../store';
import { humanizeError } from '../errors';

const SEV_COLORS: Record<Severity, string> = {
  critical: '#ff453a',
  serious: '#ff9f0a',
  moderate: '#ffd60a',
  minor: '#64d2ff'
};

const ALL: Severity[] = ['critical', 'serious', 'moderate', 'minor'];

export function IssuesView({ moduleId }: { moduleId: string }) {
  const {
    currentScan,
    filters,
    selectedIssueId,
    selectIssue,
    setSearch,
    toggleSeverity,
    toggleOnlyFails
  } = useStore();

  const module = currentScan?.modules.find((m) => m.moduleId === moduleId);

  const issues = useMemo<IssueDTO[]>(() => {
    if (!module) return [];
    const term = filters.search.trim().toLowerCase();
    return module.issues
      .filter((i) => filters.severities.has(i.severity))
      .filter((i) => (filters.onlyFails ? i.status === 'fail' : true))
      .filter((i) => {
        if (!term) return true;
        const hay = `${i.title} ${i.description} ${i.cssSelector} ${i.wcagReferences
          .map((r) => r.criterion)
          .join(' ')}`.toLowerCase();
        return hay.includes(term);
      })
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [module, filters]);

  if (!currentScan) {
    return <div className="empty">Run a scan to see the results.</div>;
  }
  if (!module) {
    return <div className="empty">This module was not run in this scan.</div>;
  }

  const selected = issues.find((i) => i.id === selectedIssueId) ?? null;

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
        <span className={`sev-toggle ${filters.onlyFails ? 'on' : ''}`} onClick={() => toggleOnlyFails()}>
          tylko FAIL
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          {issues.length} / {module.issues.length}
        </span>
      </div>

      <div>
        {issues.length === 0 && <div className="empty">No issues match the current filters.</div>}
        {issues.map((issue) => (
          <div
            key={issue.id}
            className={`issue-row ${selectedIssueId === issue.id ? 'selected' : ''}`}
            onClick={() => selectIssue(issue.id)}
          >
            <div>
              <span className={`chip ${issue.severity}`}>{issue.severity}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="title">{issue.title}</div>
              <div className="sub">{issue.cssSelector || issue.xpath}</div>
            </div>
            <div className="wcag">
              {issue.wcagReferences.map((r) => `WCAG ${r.criterion}`).join(', ') || '-'}
            </div>
          </div>
        ))}
      </div>

      {selected && <IssueDetail issue={selected} />}
    </div>
  );
}

function IssueDetail({ issue }: { issue: IssueDTO }) {
  const selectedTargetId = useStore((s) => s.selectedTargetId);
  const [shot, setShot] = useState<string>('');
  const [inspection, setInspection] = useState<DomInspectionDTO | null>(null);
  const [inspecting, setInspecting] = useState(false);

  useEffect(() => {
    setShot('');
    setInspection(null);
    if (issue.screenshotPath) {
      void window.api.readScreenshot(issue.screenshotPath).then(setShot);
    }
  }, [issue.id, issue.screenshotPath]);

  const inspect = async () => {
    if (!selectedTargetId || !issue.cssSelector) return;
    setInspecting(true);
    try {
      const result = await window.api.inspectDom(selectedTargetId, issue.cssSelector);
      setInspection(result);
    } catch (e) {
      alert(humanizeError(e));
    } finally {
      setInspecting(false);
    }
  };

  return (
    <div className="detail">
      <h3>{issue.title}</h3>
      <div className="kv">
        <span className={`chip ${issue.severity}`}>{issue.severity}</span>{' '}
        <span className="chip ghost">{issue.status}</span>
      </div>
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
      {issue.helpUrl && (
        <div className="kv">
          <span className="k">Dokumentacja:</span>{' '}
          <a href={issue.helpUrl} target="_blank" rel="noreferrer">
            {issue.helpUrl}
          </a>
        </div>
      )}

      <div className="kv">
        <span className="k">Fragment HTML:</span>
      </div>
      <pre>{issue.html || '-'}</pre>

      <div className="kv">
        <span className="k">Recommendation:</span>
      </div>
      <pre>{issue.recommendation || '-'}</pre>

      <button onClick={inspect} disabled={inspecting || !issue.cssSelector}>
        {inspecting ? 'Pobieranie…' : 'DOM inspection (computed styles + ARIA)'}
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

      {shot && <img className="shot" src={shot} alt="Issue screenshot" />}
    </div>
  );
}
