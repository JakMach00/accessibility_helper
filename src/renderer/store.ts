import { create } from 'zustand';
import { humanizeError } from './errors';
import { applyTheme, getStoredTheme, storeTheme, type Theme } from './theme';
import type {
  AuditProgressEvent,
  AvailableModuleDTO,
  BrowserTargetDTO,
  ConnectMode,
  IssueDTO,
  ReportFormat,
  ScanResultDTO,
  ScanSummaryDTO,
  Severity,
  WcagLevel
} from '@shared/types';

export type TabId =
  | 'overview'
  | 'wcag-scan'
  | 'keyboard-nav'
  | 'contrast'
  | 'aria-audit'
  | 'nvda'
  | 'zoom-reflow'
  | 'dynamic-content'
  | 'screenshots'
  | 'export';

export interface Filters {
  search: string;
  severities: Set<Severity>;
  levels: Set<WcagLevel>;
  onlyFails: boolean;
  groupByCriterion: boolean;
  showIgnored: boolean;
}

interface AppState {
  theme: Theme;
  // connection
  browserName: string | null;
  targets: BrowserTargetDTO[];
  selectedTargetId: string | null;
  modules: AvailableModuleDTO[];

  // scan
  running: boolean;
  progress: AuditProgressEvent | null;
  currentScan: ScanResultDTO | null;
  error: string | null;

  // history
  history: ScanSummaryDTO[];
  compareBaseId: string | null;

  // UI
  activeTab: TabId;
  selectedIssueId: string | null;
  filters: Filters;
  ignoredKeys: Set<string>;

  // actions
  init: () => Promise<void>;
  connect: (mode: ConnectMode, startUrl?: string) => Promise<void>;
  refreshTargets: () => Promise<void>;
  selectTarget: (id: string) => void;
  runAudit: () => Promise<void>;
  loadHistory: () => Promise<void>;
  openScan: (id: string) => Promise<void>;
  exportReport: (format: ReportFormat) => Promise<string | null>;
  setTab: (tab: TabId) => void;
  selectIssue: (id: string | null) => void;
  setSearch: (value: string) => void;
  toggleSeverity: (sev: Severity) => void;
  toggleOnlyFails: () => void;
  setCompareBase: (id: string | null) => void;
  toggleLevel: (level: WcagLevel) => void;
  toggleGroupBy: () => void;
  toggleShowIgnored: () => void;
  ignoreIssue: (issue: IssueDTO) => Promise<void>;
  unignoreIssue: (issue: IssueDTO) => Promise<void>;
  toggleTheme: () => void;
}

const ALL_SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'minor'];

// Whether the URL is a blank/startup tab that is not worth auditing.
function isBlankUrl(url: string): boolean {
  return url === '' || /^(about:blank|about:newtab|edge:\/\/(newtab|new-tab-page)|chrome:\/\/newtab)/i.test(url);
}

// Selects the tab to audit: keeps the current selection if it is valid and not blank;
// otherwise it prefers the first non-blank page (e.g. the real page after navigation).
function pickTarget(targets: { id: string; url: string }[], preferId: string | null): string | null {
  const current = targets.find((t) => t.id === preferId);
  if (current && !isBlankUrl(current.url)) return current.id;
  const meaningful = targets.find((t) => !isBlankUrl(t.url));
  if (meaningful) return meaningful.id;
  return current?.id ?? targets[0]?.id ?? null;
}

export const useStore = create<AppState>((set, get) => ({
  theme: getStoredTheme(),
  browserName: null,
  targets: [],
  selectedTargetId: null,
  modules: [],
  running: false,
  progress: null,
  currentScan: null,
  error: null,
  history: [],
  compareBaseId: null,
  activeTab: 'overview',
  selectedIssueId: null,
  filters: {
    search: '',
    severities: new Set(ALL_SEVERITIES),
    levels: new Set<WcagLevel>(['A', 'AA', 'AAA']),
    onlyFails: false,
    groupByCriterion: false,
    showIgnored: false
  },
  ignoredKeys: new Set<string>(),

  init: async () => {
    window.api.onProgress((event) => set({ progress: event }));
    const modules = await window.api.listModules();
    const ignored = await window.api.listIgnored();
    set({ modules, ignoredKeys: new Set(ignored) });
    await get().loadHistory();
  },

  connect: async (mode, startUrl) => {
    set({ error: null });
    try {
      // Do not pass an empty address or the "https://" placeholder as startUrl.
      const clean = startUrl && startUrl.trim() && startUrl.trim() !== 'https://' ? startUrl.trim() : undefined;
      const result = await window.api.connect(clean ? { mode, startUrl: clean } : { mode });
      set({
        browserName: result.browser.name,
        targets: result.targets,
        selectedTargetId: pickTarget(result.targets, null)
      });
    } catch (e) {
      set({ error: humanizeError(e) });
    }
  },

  refreshTargets: async () => {
    try {
      const result = await window.api.listTargets();
      const selected = pickTarget(result.targets, get().selectedTargetId);
      set({ targets: result.targets, browserName: result.browser.name, selectedTargetId: selected });
    } catch (e) {
      set({ error: humanizeError(e) });
    }
  },

  selectTarget: (id) => set({ selectedTargetId: id }),

  runAudit: async () => {
    set({ running: true, error: null, progress: null });
    try {
      // Refresh the tab list right before the scan; pickTarget selects the correct page,
      // if the previously selected tab is gone (e.g. the startup about:blank after navigation).
      await get().refreshTargets();
      const targetId = get().selectedTargetId;
      if (get().targets.length === 0) {
        set({
          error: 'No open tab was found. Open a page in the browser and try again.',
          running: false
        });
        return;
      }
      const scan = await window.api.runAudit(targetId ? { targetId } : {});
      set({ currentScan: scan, activeTab: 'overview', selectedIssueId: null });
      await get().loadHistory();
    } catch (e) {
      set({ error: humanizeError(e) });
    } finally {
      set({ running: false });
    }
  },

  loadHistory: async () => {
    const history = await window.api.historyList();
    set({ history });
  },

  openScan: async (id) => {
    const scan = await window.api.historyGet(id);
    if (scan) set({ currentScan: scan, activeTab: 'overview', selectedIssueId: null });
  },

  exportReport: async (format) => {
    const scan = get().currentScan;
    if (!scan) return null;
    try {
      const result = await window.api.exportReport({ scanId: scan.id, format });
      return result ? result.filePath : null;
    } catch (e) {
      set({ error: humanizeError(e) });
      return null;
    }
  },

  setTab: (tab) => set({ activeTab: tab, selectedIssueId: null }),
  selectIssue: (id) => set({ selectedIssueId: id }),
  setSearch: (value) => set((s) => ({ filters: { ...s.filters, search: value } })),
  toggleSeverity: (sev) =>
    set((s) => {
      const next = new Set(s.filters.severities);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return { filters: { ...s.filters, severities: next } };
    }),
  toggleOnlyFails: () => set((s) => ({ filters: { ...s.filters, onlyFails: !s.filters.onlyFails } })),
  setCompareBase: (id) => set({ compareBaseId: id }),

  toggleLevel: (level) =>
    set((s) => {
      const next = new Set(s.filters.levels);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return { filters: { ...s.filters, levels: next } };
    }),
  toggleGroupBy: () => set((s) => ({ filters: { ...s.filters, groupByCriterion: !s.filters.groupByCriterion } })),
  toggleShowIgnored: () => set((s) => ({ filters: { ...s.filters, showIgnored: !s.filters.showIgnored } })),

  ignoreIssue: async (issue) => {
    // Ignoring works at the issue type level: every occurrence of the same
    // problem (same module, title and WCAG mapping) is hidden, not just this element.
    const key = issueGroupKey(issue);
    await window.api.addIgnored(key);
    set((s) => ({ ignoredKeys: new Set(s.ignoredKeys).add(key) }));
  },
  unignoreIssue: async (issue) => {
    // Remove the group key and the legacy per-element key so entries created
    // by older versions of the app are cleaned up as well.
    const keys = [issueGroupKey(issue), issueIdentityKey(issue)];
    for (const key of keys) {
      await window.api.removeIgnored(key);
    }
    set((s) => {
      const next = new Set(s.ignoredKeys);
      for (const key of keys) next.delete(key);
      return { ignoredKeys: next };
    });
  },

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    storeTheme(next);
    set({ theme: next });
  }
}));


// Stable identity of an issue, matching the domain regression key.
export function issueIdentityKey(issue: IssueDTO): string {
  const wcag = issue.wcagReferences
    .map((r) => r.criterion)
    .sort()
    .join(',');
  return `${issue.moduleId}::${issue.title}::${wcag}::${issue.cssSelector}`;
}

// Identity of an issue type, without the element selector. Ignoring uses this
// key, so one click hides all occurrences of the same problem on the page.
export function issueGroupKey(issue: IssueDTO): string {
  const wcag = issue.wcagReferences
    .map((r) => r.criterion)
    .sort()
    .join(',');
  return `${issue.moduleId}::${issue.title}::${wcag}`;
}

// True when the issue is on the ignore list, either via its group key or via
// a legacy per-element key saved by an older version of the app.
export function isIssueIgnored(issue: IssueDTO, ignoredKeys: Set<string>): boolean {
  return ignoredKeys.has(issueGroupKey(issue)) || ignoredKeys.has(issueIdentityKey(issue));
}

// Selector: issues of the given module after filters are applied.
export function selectFilteredIssues(state: AppState, moduleId: string): IssueDTO[] {
  const scan = state.currentScan;
  if (!scan) return [];
  const module = scan.modules.find((m) => m.moduleId === moduleId);
  if (!module) return [];
  const { search, severities, levels, onlyFails, showIgnored } = state.filters;
  const term = search.trim().toLowerCase();
  const allLevels = levels.size === 0 || levels.size >= 3;
  return module.issues.filter((issue) => {
    if (!severities.has(issue.severity)) return false;
    if (onlyFails && issue.status !== 'fail') return false;
    if (!showIgnored && isIssueIgnored(issue, state.ignoredKeys)) return false;
    if (!allLevels) {
      const hasLevel = issue.wcagReferences.some((r) => levels.has(r.level));
      if (issue.wcagReferences.length > 0 && !hasLevel) return false;
    }
    if (term) {
      const hay = `${issue.title} ${issue.description} ${issue.cssSelector} ${issue.wcagReferences
        .map((r) => r.criterion)
        .join(' ')}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}
