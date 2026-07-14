import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { IssuesView } from './components/IssuesView';
import { ExportPanel, ScreenshotsPanel } from './components/Panels';
import { SettingsModal } from './components/SettingsModal';

export function App() {
  const { init, activeTab, running, progress, error } = useStore();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    window.api.onOpenSettings(() => setShowSettings(true));
  }, []);

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
      default:
        return <IssuesView moduleId={activeTab} />;
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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
