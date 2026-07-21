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
  ScanSummaryDTO,
  JiraConfigView,
  JiraConfigInput,
  JiraIssuePayload,
  JiraCreateResult,
  AppSettings
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
  screenshotOpen: 'screenshot:open',
  shellOpenScreenshots: 'shell:openScreenshots',
  ignoreList: 'ignore:list',
  ignoreAdd: 'ignore:add',
  ignoreRemove: 'ignore:remove',
  jiraGetConfig: 'jira:getConfig',
  jiraSaveConfig: 'jira:saveConfig',
  jiraCreateIssue: 'jira:createIssue',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsPickFolder: 'settings:pickFolder',
  menuOpenSettings: 'menu:open-settings'
} as const;

// Contract of the API exposed by the preload as window.api.
// The renderer programs against this interface only.
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
  openScreenshot(path: string): Promise<void>; // opens the file in the system image viewer
  openScreenshotsFolder(): Promise<void>;
  listIgnored(): Promise<string[]>;
  addIgnored(key: string): Promise<void>;
  removeIgnored(key: string): Promise<void>;
  getJiraConfig(): Promise<JiraConfigView>;
  saveJiraConfig(config: JiraConfigInput): Promise<void>;
  createJiraIssue(payload: JiraIssuePayload): Promise<JiraCreateResult>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  pickFolder(): Promise<string | null>;
  onOpenSettings(callback: () => void): void;
}
