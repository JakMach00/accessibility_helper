import { useState } from 'react';
import type { ScanDiffDTO } from '@shared/types';
import { useStore } from '../store';
import { humanizeError } from '../errors';

export function Overview() {
  const { currentScan, history, openScan, compareBaseId, setCompareBase } = useStore();
  const [diff, setDiff] = useState<ScanDiffDTO | null>(null);
  const [compareError, setCompareError] = useState('');

  const runCompare = async (targetId: string) => {
    if (!compareBaseId) return;
    setCompareError('');
    try {
      const result = await window.api.historyCompare(compareBaseId, targetId);
      setDiff(result);
    } catch (e) {
      setCompareError(humanizeError(e));
    }
  };

  if (!currentScan) {
    return (
      <div>
        <div className="empty">
          No scan result yet. Connect a browser and run a scan, or open an item from history below.
        </div>
        <HistoryList />
      </div>
    );
  }

  const c = currentScan.counts;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Scan result</h2>
        <span className={`status-pill ${currentScan.overallStatus}`}>
          {currentScan.overallStatus === 'pass'
            ? 'PASS'
            : currentScan.overallStatus === 'fail'
              ? 'FAIL'
              : 'NEEDS REVIEW'}
        </span>
      </div>

      <div className="review-note">
        <strong>Automated checks are not enough.</strong> Verify these manually on every page:
        <ul>
          <li>Whether image alt text is meaningful and accurate, not just present.</li>
          <li>Whether link and button text makes sense out of context.</li>
          <li>Reading and focus order in custom or complex widgets.</li>
          <li>Content shown only on hover, focus, or click (menus, tooltips, popovers).</li>
        </ul>
      </div>

      <div className="cards">
        <Stat n={c.total} label="Total" />
        <Stat n={c.critical} label="Critical" color="var(--crit)" />
        <Stat n={c.serious} label="Serious" color="var(--serious)" />
        <Stat n={c.moderate} label="Moderate" color="var(--moderate)" />
        <Stat n={c.minor} label="Minor" color="var(--minor)" />
      </div>

      <div className="meta-grid">
        <span className="k">URL</span>
        <span>{currentScan.url}</span>
        <span className="k">Title</span>
        <span>{currentScan.title || '-'}</span>
        <span className="k">Browser</span>
        <span>
          {currentScan.browser.name} {currentScan.browser.version}
        </span>
        <span className="k">Viewport</span>
        <span>
          {currentScan.viewport.width}x{currentScan.viewport.height}
        </span>
        <span className="k">Scan time</span>
        <span>{(currentScan.durationMs / 1000).toFixed(1)} s</span>
        <span className="k">Date</span>
        <span>{new Date(currentScan.finishedAt).toLocaleString('en-GB')}</span>
      </div>

      <div className="section-title">Modules</div>
      <table className="modules">
        <thead>
          <tr>
            <th>Module</th>
            <th>Status</th>
            <th>Critical</th>
            <th>Serious</th>
            <th>Moderate</th>
            <th>Minor</th>
            <th>Passed</th>
            <th>Czas</th>
          </tr>
        </thead>
        <tbody>
          {currentScan.modules.map((m) => (
            <tr key={m.moduleId}>
              <td>{m.moduleName}</td>
              <td>{m.status}</td>
              <td>{m.counts.critical}</td>
              <td>{m.counts.serious}</td>
              <td>{m.counts.moderate}</td>
              <td>{m.counts.minor}</td>
              <td>{m.passedChecks}</td>
              <td>{(m.durationMs / 1000).toFixed(1)} s</td>
            </tr>
          ))}
        </tbody>
      </table>

      <HistoryList />

      {history.length >= 2 && (
        <>
          <div className="section-title">Comparison and regressions</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Baza:</span>
            <select value={compareBaseId ?? ''} onChange={(e) => setCompareBase(e.target.value || null)}>
              <option value="">select a base scan</option>
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {new Date(h.finishedAt).toLocaleString('en-GB')} - {h.url}
                </option>
              ))}
            </select>
            <button disabled={!compareBaseId} onClick={() => runCompare(currentScan.id)}>
              Compare with current
            </button>
          </div>
          {compareError && <div className="detail-error">{compareError}</div>}
          {diff && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <span style={{ color: 'var(--fail)' }}>New (regressions): {diff.regressionCount}</span>
              {'   '}
              <span style={{ color: 'var(--pass)' }}>Fixed: {diff.fixedCount}</span>
              {'   '}
              <span style={{ color: 'var(--text-dim)' }}>Persisting: {diff.persistentIssues.length}</span>
            </div>
          )}
        </>
      )}
    </div>
  );

  function HistoryList() {
    if (history.length === 0) return null;
    return (
      <>
        <div className="section-title">Scan history</div>
        <table className="modules">
          <thead>
            <tr>
              <th>Data</th>
              <th>URL</th>
              <th>Status</th>
              <th>Issues</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.finishedAt).toLocaleString('en-GB')}</td>
                <td style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.url}</td>
                <td>{h.overallStatus}</td>
                <td>{h.counts.total}</td>
                <td>
                  <button onClick={() => openScan(h.id)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
}

function Stat({ n, label, color }: { n: number; label: string; color?: string }) {
  return (
    <div className="stat">
      <div className="n" style={color ? { color } : undefined}>
        {n}
      </div>
      <div className="l">{label}</div>
    </div>
  );
}
