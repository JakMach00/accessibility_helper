import type { TabId } from '../store';
import { useStore } from '../store';

interface NavDef {
  id: TabId;
  label: string;
  moduleId?: string;
}

const AUDIT_TABS: NavDef[] = [
  { id: 'wcag-scan', label: 'WCAG Issues', moduleId: 'wcag-scan' },
  { id: 'keyboard-nav', label: 'Keyboard', moduleId: 'keyboard-nav' },
  { id: 'contrast', label: 'Contrast', moduleId: 'contrast' },
  { id: 'aria-audit', label: 'ARIA', moduleId: 'aria-audit' },
  { id: 'nvda', label: 'NVDA', moduleId: 'nvda' },
  { id: 'zoom-reflow', label: 'Zoom', moduleId: 'zoom-reflow' }
];

export function Sidebar() {
  const { activeTab, setTab, currentScan, modules } = useStore();

  const isImplemented = (moduleId?: string) =>
    !moduleId || (modules.find((m) => m.id === moduleId)?.implemented ?? false);

  const countFor = (moduleId?: string): number | null => {
    if (!currentScan || !moduleId) return null;
    const module = currentScan.modules.find((m) => m.moduleId === moduleId);
    return module ? module.counts.total : null;
  };

  const NavItem = ({ id, label, moduleId }: NavDef) => {
    const implemented = isImplemented(moduleId);
    const count = countFor(moduleId);
    return (
      <button
        className={`nav-item ${activeTab === id ? 'active' : ''} ${implemented ? '' : 'soon'}`}
        onClick={() => setTab(id)}
      >
        <span>{label}</span>
        {count !== null ? (
          <span className="badge">{count}</span>
        ) : !implemented ? (
          <span className="badge" style={{ fontSize: 9 }}>
            wkrotce
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <nav className="sidebar">
      <button
        className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
        onClick={() => setTab('overview')}
      >
        <span>Overview</span>
      </button>

      <div className="group-label">Audit modules</div>
      {AUDIT_TABS.map((t) => (
        <NavItem key={t.id} {...t} />
      ))}

      <div className="group-label">Results</div>
      <button
        className={`nav-item ${activeTab === 'screenshots' ? 'active' : ''}`}
        onClick={() => setTab('screenshots')}
      >
        <span>Screenshots</span>
      </button>
      <button
        className={`nav-item ${activeTab === 'export' ? 'active' : ''}`}
        onClick={() => setTab('export')}
      >
        <span>Export</span>
      </button>
    </nav>
  );
}
