import { useState } from 'react';
import type { ConnectMode, ReportFormat } from '@shared/types';
import { useStore } from '../store';

const MODE_LABELS: Record<ConnectMode, string> = {
  'launch-edge': 'Open Edge for auditing',
  'launch-chrome': 'Open Chrome for auditing',
  attach: 'Attach to an open browser',
  'launch-bundled': 'Bundled Chromium'
};

// Order in the list: simplest first for the "go through your flow manually" scenario.
const MODE_ORDER: ConnectMode[] = ['launch-edge', 'launch-chrome', 'attach', 'launch-bundled'];

// Command that starts the browser with a debugging port (attach mode).
const ATTACH_CMD = 'msedge --remote-debugging-port=9222 --user-data-dir="%TEMP%\\wcag-edge"';

const Logo = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" rx="10" fill="#1f6feb" />
    <path d="M24 11l11 6.5v13L24 37l-11-6.5v-13L24 11z" stroke="#fff" strokeWidth="2.4" fill="none" />
    <circle cx="24" cy="24" r="4.5" fill="#fff" />
  </svg>
);

export function Topbar() {
  const {
    browserName,
    targets,
    selectedTargetId,
    running,
    currentScan,
    theme,
    connect,
    refreshTargets,
    selectTarget,
    runAudit,
    exportReport,
    toggleTheme
  } = useStore();

  const [mode, setMode] = useState<ConnectMode>('launch-edge');
  const [startUrl, setStartUrl] = useState('');

  const connected = browserName !== null;
  const isLaunch = mode.startsWith('launch');

  const onExport = async (format: ReportFormat) => {
    // After saving, the file is highlighted in Explorer, so an alert is unnecessary.
    await exportReport(format);
  };

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(ATTACH_CMD);
    } catch {
      // the clipboard may be unavailable - the command can be selected and copied manually
    }
  };

  const renderHint = () => {
    if (connected) {
      return (
        <span>
          Go through your flow in the open browser (for example to the last page), then click
          <b> Refresh</b>, select the correct tab and <b> Run scan</b>. The audit runs on the current page,
          with no reload and no need to type an address.
        </span>
      );
    }
    if (mode === 'attach') {
      return (
        <span>
          Start the browser with a debugging port (from the command line), go through your flow, then click
          <b> Connect</b>:
          <code className="cmd">{ATTACH_CMD}</code>
          <button className="link-btn" onClick={copyCmd}>
            Copy
          </button>
          <span style={{ color: 'var(--text-faint)' }}>For Chrome replace msedge with chrome.</span>
        </span>
      );
    }
    return (
      <span>
        The application will open a controlled browser. Leave the address empty, go through your flow manually in that
        browser, then choose a tab and run the scan. The start address is optional.
      </span>
    );
  };

  return (
    <>
      <div className="topbar">
        <span className="brand">
          <Logo /> WCAG Auditor
        </span>

        {!connected ? (
          <>
            <select value={mode} onChange={(e) => setMode(e.target.value as ConnectMode)}>
              {MODE_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
            {isLaunch && (
              <input
                style={{ width: 260 }}
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="Start address (optional)"
              />
            )}
            <button className="primary" onClick={() => connect(mode, startUrl)}>
              Connect
            </button>
          </>
        ) : (
          <>
            <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{browserName}</span>
            <select
              value={selectedTargetId ?? ''}
              onChange={(e) => selectTarget(e.target.value)}
              title="Choose the tab whose current page should be audited"
            >
              {targets.length === 0 && <option value="">no tabs</option>}
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title ? `${t.title} - ${t.url}` : t.url}
                </option>
              ))}
            </select>
            <button onClick={() => refreshTargets()} title="Refresh the list of open tabs">
              Refresh
            </button>
            <button
              className="primary"
              onClick={() => runAudit()}
              disabled={running || !selectedTargetId}
              title="Audits the current page of the selected tab, without reloading"
            >
              {running ? 'Scanning…' : 'Run scan'}
            </button>
          </>
        )}

        <span className="spacer" />

        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle color theme"
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>


        {currentScan && (
          <>
            <button onClick={() => onExport('html')} title="Save the HTML report to a location you choose">
              HTML
            </button>
            <button onClick={() => onExport('json')} title="Save the JSON report to a location you choose">
              JSON
            </button>
            <button onClick={() => onExport('csv')} title="Save the CSV report to a location you choose">
              CSV
            </button>
            <button onClick={() => void window.api.openScreenshotsFolder()} title="Open the screenshots folder">
              Screenshots folder
            </button>
          </>
        )}
      </div>
      <div className="topbar-hint">{renderHint()}</div>
    </>
  );
}
