import type {
  AuditProgressEvent,
  AvailableModuleDTO,
  ConnectOptions,
  ConnectResultDTO,
  DomInspectionDTO,
  ExportOptions,
  ExportResultDTO,
  RunAuditOptions,
  ScanDiffDTO,
  ScanResultDTO,
  ScanSummaryDTO
} from './types';

// Nazwy kanalow IPC w jednym miejscu, zeby uniknac literalow-magii.
export const IPC = {
  browserConnect: 'browser:connect',
  browserListTargets: 'browser:listTargets',
  browserClose: 'browser:close',
  auditRun: 'audit:run',
  auditProgress: 'audit:progress', // main -> renderer (event)
  modulesList: 'modules:list',
  historyList: 'history:list',
  historyGet: 'history:get',
  historyDelete: 'history:delete',
  historyCompare: 'history:compare',
  reportExport: 'report:export',
  domInspect: 'dom:inspect',
  screenshotRead: 'screenshot:read',
  shellOpenScreenshots: 'shell:openScreenshots'
} as const;

// Kontrakt API wystawianego przez preload jako window.api.
// Renderer programuje wylacznie do tego interfejsu.
export interface RendererApi {
  connect(options: ConnectOptions): Promise<ConnectResultDTO>;
  listTargets(): Promise<ConnectResultDTO>;
  closeBrowser(): Promise<void>;
  listModules(): Promise<AvailableModuleDTO[]>;
  runAudit(options: RunAuditOptions): Promise<ScanResultDTO>;
  onProgress(listener: (event: AuditProgressEvent) => void): () => void;
  historyList(): Promise<ScanSummaryDTO[]>;
  historyGet(id: string): Promise<ScanResultDTO | null>;
  historyDelete(id: string): Promise<void>;
  historyCompare(baseId: string, targetId: string): Promise<ScanDiffDTO>;
  exportReport(options: ExportOptions): Promise<ExportResultDTO | null>;
  inspectDom(targetId: string, cssSelector: string): Promise<DomInspectionDTO>;
  readScreenshot(path: string): Promise<string>; // zwraca data URL lub pusty string
  openScreenshotsFolder(): Promise<void>;
}
