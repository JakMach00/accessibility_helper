import { useEffect } from 'react';
import { useStore, type TabId } from './store';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { IssuesView } from './components/IssuesView';
import { ExportPanel, Placeholder, ScreenshotsPanel } from './components/Panels';

const MODULE_TAB_NAMES: Partial<Record<TabId, string>> = {
  'keyboard-nav': 'Keyboard Navigation',
  contrast: 'Contrast Checker',
  'aria-audit': 'ARIA Audit',
  nvda: 'NVDA Simulation',
  'zoom-reflow': 'Zoom / Reflow'
};

export function App() {
  const { init, activeTab, running, progress, error, modules } = useStore();

  useEffect(() => {
    void init();
  }, [init]);

  const isImplemented = (moduleId: string) => modules.find((m) => m.id === moduleId)?.implemented ?? false;

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return <Overview />;
      case 'wcag-scan':
        return <IssuesView moduleId="wcag-scan" />;
      case 'screenshots':
        return <ScreenshotsPanel />;
      case 'export':
        return <ExportPanel />;
      default: {
        if (isImplemented(activeTab)) return <IssuesView moduleId={activeTab} />;
        return <Placeholder name={MODULE_TAB_NAMES[activeTab] ?? activeTab} />;
      }
    }
  };

  const pct = progress ? Math.round((progress.current / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="app">
      <Topbar />
      {(running || progress) && (
        <>
          <div className="progress-bar">
            <div className="fill" style={{ width: `${running ? pct : 100}%` }} />
          </div>
          {progress && <div className="progress-label">{progress.message}</div>}
        </>
      )}
      <div className="body">
        <Sidebar />
        <main className="content">
          {error && <div className="error-banner">{error}</div>}
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
