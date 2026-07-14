import { useEffect, useState } from 'react';
import type { IssueDTO, ReportFormat } from '@shared/types';
import { useStore } from '../store';

function LazyShot({ issue }: { issue: IssueDTO }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (issue.screenshotPath) void window.api.readScreenshot(issue.screenshotPath).then(setSrc);
  }, [issue.screenshotPath]);
  if (!src) return null;
  return (
    <figure>
      <img src={src} alt={issue.title} />
      <figcaption>
        <span className={`chip ${issue.severity}`}>{issue.severity}</span> {issue.title}
      </figcaption>
    </figure>
  );
}

export function ScreenshotsPanel() {
  const currentScan = useStore((s) => s.currentScan);
  if (!currentScan) return <div className="empty">Run a scan to see screenshots.</div>;
  const withShots = currentScan.modules.flatMap((m) => m.issues).filter((i) => i.screenshotPath);
  if (withShots.length === 0) return <div className="empty">This scan produced no screenshots.</div>;
  return (
    <div className="gallery">
      {withShots.map((issue) => (
        <LazyShot key={issue.id} issue={issue} />
      ))}
    </div>
  );
}

export function ExportPanel() {
  const { currentScan, exportReport } = useStore();
  const [lastPath, setLastPath] = useState<string | null>(null);

  if (!currentScan) return <div className="empty">No scan to export.</div>;

  const run = async (format: ReportFormat) => {
    const path = await exportReport(format);
    if (path) setLastPath(path);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Report export</h2>
      <p style={{ color: 'var(--text-dim)' }}>
        The report includes the logo, date, URL, issue counts, PASS/FAIL status, screenshots, recommendations,
        priority and WCAG 2.2 references.
      </p>
      <div className="export-row">
        <button className="primary" onClick={() => run('html')}>
          Export HTML
        </button>
        <button onClick={() => run('json')}>Export JSON</button>
        <button onClick={() => run('csv')}>Export CSV</button>
      </div>
      {lastPath && <div className="export-note">Zapisano: {lastPath}</div>}
    </div>
  );
}

