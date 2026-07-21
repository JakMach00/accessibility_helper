import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AuditProgressEvent,
  AvailableModuleDTO,
  ConnectOptions,
  ConnectResultDTO,
  DomInspectionDTO,
  ExportOptions,
  ExportResultDTO,
  RunAuditOptions,
  JiraConfigView,
  JiraConfigInput,
  JiraIssuePayload,
  JiraCreateResult,
  AppSettings,
  ScanDiffDTO,
  ScanResultDTO,
  ScanSummaryDTO
} from '@shared/types';
import { IPC, type RendererApi } from '@shared/ipc';

const api: RendererApi = {
  connect: (options: ConnectOptions): Promise<ConnectResultDTO> => ipcRenderer.invoke(IPC.browserConnect, options),
  listTargets: (): Promise<ConnectResultDTO> => ipcRenderer.invoke(IPC.browserListTargets),
  closeBrowser: (): Promise<void> => ipcRenderer.invoke(IPC.browserClose),
  listModules: (): Promise<AvailableModuleDTO[]> => ipcRenderer.invoke(IPC.modulesList),
  runAudit: (options: RunAuditOptions): Promise<ScanResultDTO> => ipcRenderer.invoke(IPC.auditRun, options),
  onProgress: (listener: (event: AuditProgressEvent) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: AuditProgressEvent): void => listener(payload);
    ipcRenderer.on(IPC.auditProgress, handler);
    return () => ipcRenderer.removeListener(IPC.auditProgress, handler);
  },
  historyList: (): Promise<ScanSummaryDTO[]> => ipcRenderer.invoke(IPC.historyList),
  historyGet: (id: string): Promise<ScanResultDTO | null> => ipcRenderer.invoke(IPC.historyGet, id),
  historyDelete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.historyDelete, id),
  historyCompare: (baseId: string, targetId: string): Promise<ScanDiffDTO> =>
    ipcRenderer.invoke(IPC.historyCompare, baseId, targetId),
  exportReport: (options: ExportOptions): Promise<ExportResultDTO | null> =>
    ipcRenderer.invoke(IPC.reportExport, options),
  inspectDom: (targetId: string, cssSelector: string): Promise<DomInspectionDTO> =>
    ipcRenderer.invoke(IPC.domInspect, targetId, cssSelector),
  readScreenshot: (path: string): Promise<string> => ipcRenderer.invoke(IPC.screenshotRead, path),
  openScreenshot: (path: string): Promise<void> => ipcRenderer.invoke(IPC.screenshotOpen, path),
  openScreenshotsFolder: (): Promise<void> => ipcRenderer.invoke(IPC.shellOpenScreenshots),
  listIgnored: (): Promise<string[]> => ipcRenderer.invoke(IPC.ignoreList),
  addIgnored: (key: string): Promise<void> => ipcRenderer.invoke(IPC.ignoreAdd, key),
  removeIgnored: (key: string): Promise<void> => ipcRenderer.invoke(IPC.ignoreRemove, key),
  getJiraConfig: (): Promise<JiraConfigView> => ipcRenderer.invoke(IPC.jiraGetConfig),
  saveJiraConfig: (config: JiraConfigInput): Promise<void> => ipcRenderer.invoke(IPC.jiraSaveConfig, config),
  createJiraIssue: (payload: JiraIssuePayload): Promise<JiraCreateResult> =>
    ipcRenderer.invoke(IPC.jiraCreateIssue, payload),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (settings: AppSettings): Promise<void> => ipcRenderer.invoke(IPC.settingsSave, settings),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.settingsPickFolder),
  onOpenSettings: (callback: () => void): void => {
    ipcRenderer.on(IPC.menuOpenSettings, () => callback());
  }
};

contextBridge.exposeInMainWorld('api', api);
