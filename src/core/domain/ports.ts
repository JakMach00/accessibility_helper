import type {
  AuditProgressEvent,
  BoundingBoxDTO,
  BrowserInfoDTO,
  BrowserTargetDTO,
  ConnectOptions,
  ReportFormat,
  ScanResultDTO,
  ScanSummaryDTO,
  ViewportDTO
} from '@shared/types';
import type { Issue } from './Issue';
import type { ModuleResult } from './ModuleResult';
import type { ScanResult } from './ScanResult';

// ---------------------------------------------------------------------------
// Logowanie
// ---------------------------------------------------------------------------
export interface ILogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

// ---------------------------------------------------------------------------
// A browser page. The minimal surface the audit modules need.
// Adapter (Playwright) tlumaczy to na konkretny silnik. Dzieki temu domena
// nie wie nic o Playwright ani CDP.
// ---------------------------------------------------------------------------
export interface IBrowserPage {
  url(): string;
  title(): Promise<string>;
  viewport(): ViewportDTO;
  setViewport(width: number, height: number): Promise<void>;
  // Runs a function in the page context. Argument and result must be serializable.
  evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  addScriptTag(content: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  screenshotViewport(): Promise<Uint8Array>;
  screenshotClip(box: BoundingBoxDTO): Promise<Uint8Array>;
  // Force CSS states (:hover, :focus, :active) for the contrast module.
  forcePseudoStates(cssSelector: string, states: Array<'hover' | 'focus' | 'active'>): Promise<void>;
  // Czyszczenie emulacji viewportu po skanie (istotne dla trybu attach na realnej karcie).
  // Opcjonalne: atrapy w testach moga go nie implementowac.
  resetEmulation?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Browser session: connecting, tab selection, obtaining the page to audit.
// ---------------------------------------------------------------------------
export interface IBrowserSession {
  connect(options: ConnectOptions): Promise<{ browser: BrowserInfoDTO; targets: BrowserTargetDTO[] }>;
  listTargets(): Promise<{ browser: BrowserInfoDTO; targets: BrowserTargetDTO[] }>;
  getPage(targetId?: string): Promise<IBrowserPage>;
  navigate(page: IBrowserPage, url: string): Promise<void>;
  browserInfo(): BrowserInfoDTO;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Audit context passed to each module.
// ---------------------------------------------------------------------------
export interface AuditContext {
  scanId: string;
  page: IBrowserPage;
  screenshots: IScreenshotService;
  logger: ILogger;
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Audit module. The heart of the plugin architecture.
// Kazdy modul (WCAG, Keyboard, Zoom, Contrast, ARIA, NVDA) implementuje ten port.
// ---------------------------------------------------------------------------
export interface IAuditModule {
  readonly id: string;
  readonly name: string;
  run(context: AuditContext): Promise<ModuleResult>;
}

// Module registry. Allows enabling/disabling modules and adding plugins.
export interface IModuleRegistry {
  all(): IAuditModule[];
  resolve(ids?: string[]): IAuditModule[];
}

// ---------------------------------------------------------------------------
// Zrzuty ekranu z adnotacja (czerwony prostokat + numer bledu, punkt 7).
// ---------------------------------------------------------------------------
export interface CaptureOptions {
  scanId: string;
  label: string; // uzywane w nazwie pliku
  index: number; // numer bledu na zrzucie
  box: BoundingBoxDTO | null; // null = pelny viewport bez adnotacji
}

export interface IScreenshotService {
  capture(page: IBrowserPage, options: CaptureOptions): Promise<{ path: string; box: BoundingBoxDTO | null }>;
}

// ---------------------------------------------------------------------------
// Scan repository (Repository Pattern, history and regressions).
// ---------------------------------------------------------------------------
export interface IScanRepository {
  save(scan: ScanResult): Promise<void>;
  list(): Promise<ScanSummaryDTO[]>;
  getById(id: string): Promise<ScanResult | null>;
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Eksport raportow (punkt 10). Jeden port, wiele formatow.
// ---------------------------------------------------------------------------
export interface IReportExporter {
  readonly format: ReportFormat;
  export(scan: ScanResultDTO, outputPath: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Progress reporting to the UI (progress bar, non-blocking).
// ---------------------------------------------------------------------------
export interface IProgressReporter {
  report(event: AuditProgressEvent): void;
}

// Re-eksport dla wygody warstwy application.
export type { Issue, ModuleResult, ScanResult };
