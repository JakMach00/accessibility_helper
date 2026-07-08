// Data contracts shared between the main and renderer processes.
// To jest jedyne miejsce "prawdy" o ksztalcie danych przesylanych przez IPC.

export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3
};

export type WcagLevel = 'A' | 'AA' | 'AAA';

export type ModuleStatus = 'pass' | 'fail' | 'warning' | 'needs-review' | 'not-applicable' | 'error';

export type IssueStatus = 'fail' | 'warning' | 'needs-review';

export interface WcagReferenceDTO {
  criterion: string; // np. "1.4.3"
  level: WcagLevel;
  title: string; // np. "Contrast (Minimum)"
  url: string;
}

export interface BoundingBoxDTO {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IssueDTO {
  id: string;
  moduleId: string;
  severity: Severity;
  status: IssueStatus;
  title: string;
  description: string;
  html: string; // fragment outerHTML elementu
  cssSelector: string;
  xpath: string;
  wcagReferences: WcagReferenceDTO[];
  helpUrl: string;
  recommendation: string;
  screenshotPath: string | null;
  boundingBox: BoundingBoxDTO | null;
  occurrences: number;
  // module-specific data (e.g. contrast ratio, NVDA reading)
  extra: Record<string, unknown>;
}

export interface SeverityCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  total: number;
}

export interface ModuleResultDTO {
  moduleId: string;
  moduleName: string;
  status: ModuleStatus;
  counts: SeverityCounts;
  passedChecks: number;
  needsReviewChecks: number;
  issues: IssueDTO[];
  durationMs: number;
  metadata: Record<string, unknown>;
}

export interface BrowserInfoDTO {
  name: string; // "Chromium" / "Chrome" / "Edge"
  version: string;
}

export interface ViewportDTO {
  width: number;
  height: number;
}

export type OverallStatus = 'pass' | 'fail' | 'needs-review';

export interface ScanResultDTO {
  id: string;
  url: string;
  title: string;
  startedAt: string; // ISO
  finishedAt: string; // ISO
  durationMs: number;
  browser: BrowserInfoDTO;
  viewport: ViewportDTO;
  overallStatus: OverallStatus;
  counts: SeverityCounts;
  modules: ModuleResultDTO[];
  appVersion: string;
}

export interface ScanSummaryDTO {
  id: string;
  url: string;
  title: string;
  finishedAt: string;
  overallStatus: OverallStatus;
  counts: SeverityCounts;
}

export interface BrowserTargetDTO {
  id: string;
  url: string;
  title: string;
}

export interface ConnectResultDTO {
  browser: BrowserInfoDTO;
  targets: BrowserTargetDTO[];
}

export type ConnectMode = 'attach' | 'launch-chrome' | 'launch-edge' | 'launch-bundled';

export interface ConnectOptions {
  mode: ConnectMode;
  endpointUrl?: string; // dla trybu attach, domyslnie http://127.0.0.1:9222
  startUrl?: string; // dla trybu launch
}

export interface RunAuditOptions {
  targetId?: string; // specific tab; empty = active
  url?: string; // optional navigation before the scan
  moduleIds?: string[]; // brak = wszystkie zarejestrowane
  viewport?: ViewportDTO;
}

export type AuditPhase =
  | 'connecting'
  | 'preparing'
  | 'running-module'
  | 'module-done'
  | 'aggregating'
  | 'saving'
  | 'done'
  | 'error';

export interface AuditProgressEvent {
  scanId: string;
  phase: AuditPhase;
  moduleId?: string;
  moduleName?: string;
  current: number;
  total: number;
  message: string;
}

export type ReportFormat = 'json' | 'csv' | 'html';

export interface ExportOptions {
  scanId: string;
  format: ReportFormat;
  outputPath?: string;
}

export interface ExportResultDTO {
  filePath: string;
  format: ReportFormat;
}

// Simple diff of two scans: detecting regressions and fixes.
export interface ScanDiffDTO {
  baseId: string;
  targetId: string;
  newIssues: IssueDTO[]; // pojawily sie w target
  resolvedIssues: IssueDTO[]; // byly w base, znikly
  persistentIssues: IssueDTO[]; // sa w obu
  regressionCount: number;
  fixedCount: number;
}

export interface DomInspectionDTO {
  html: string;
  xpath: string;
  cssSelector: string;
  computedStyles: Record<string, string>;
  ariaAttributes: Record<string, string>;
  accessibleNode: {
    role: string | null;
    name: string | null;
    description: string | null;
    states: string[];
  } | null;
}

export interface AvailableModuleDTO {
  id: string;
  name: string;
  implemented: boolean;
}
