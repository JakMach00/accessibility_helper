import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type WebContents } from 'electron';
import type {
  AuditProgressEvent,
  ConnectOptions,
  DomInspectionDTO,
  ExportOptions,
  ExportResultDTO,
  RunAuditOptions,
  JiraConfigInput,
  JiraIssuePayload,
  AppSettings
} from '@shared/types';
import { IPC } from '@shared/ipc';
import type { IProgressReporter } from '@core/domain/ports';
import { inspectNode } from '@infra/browser/domScripts';
import type { Container } from './composition';
import { createJiraIssue, getJiraConfig, saveJiraConfig } from './jira';
import { getSettings, saveSettings } from './settings';

// Progress reporter that sends events to the specific window that started the scan.
class WebContentsProgressReporter implements IProgressReporter {
  constructor(private readonly sender: WebContents) {}
  report(event: AuditProgressEvent): void {
    if (!this.sender.isDestroyed()) {
      this.sender.send(IPC.auditProgress, event);
    }
  }
}

export function registerIpcHandlers(container: Container): void {
  // The session and page are shared, so two parallel scans would clash
  // on CDP commands. We allow one scan at a time.
  let auditInProgress = false;

  ipcMain.handle(IPC.browserConnect, async (_e, options: ConnectOptions) => {
    return container.session.connect(options);
  });

  ipcMain.handle(IPC.browserListTargets, async () => {
    return container.session.listTargets();
  });

  ipcMain.handle(IPC.browserClose, async () => {
    await container.session.close();
  });

  ipcMain.handle(IPC.modulesList, async () => {
    return container.listModules();
  });

  ipcMain.handle(IPC.auditRun, async (event, options: RunAuditOptions) => {
    if (auditInProgress) {
      throw new Error('A scan is already running. Wait for it to finish.');
    }
    auditInProgress = true;
    try {
      const progress = new WebContentsProgressReporter(event.sender);
      const useCase = container.createRunAudit(progress);
      return await useCase.execute(options);
    } finally {
      auditInProgress = false;
    }
  });

  ipcMain.handle(IPC.historyList, async () => {
    return container.getHistory.execute();
  });

  ipcMain.handle(IPC.historyGet, async (_e, id: string) => {
    return container.getScan.execute(id);
  });

  ipcMain.handle(IPC.historyDelete, async (_e, id: string) => {
    await container.deleteScan.execute(id);
  });

  ipcMain.handle(IPC.historyCompare, async (_e, baseId: string, targetId: string) => {
    return container.compareScans.execute(baseId, targetId);
  });

  ipcMain.handle(IPC.reportExport, async (event, options: ExportOptions): Promise<ExportResultDTO | null> => {
    const settings = await getSettings();
    const defaultName = `wcag-report-${new Date().toISOString().slice(0, 10)}.${options.format}`;

    let outputPath: string;
    if (!settings.askEachTime && settings.exportDir) {
      // Save straight to the configured default folder.
      outputPath = join(settings.exportDir, defaultName);
    } else {
      // Ask where to save (default to the configured folder if one is set).
      const win = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions = {
        title: 'Save report',
        defaultPath: settings.exportDir ? join(settings.exportDir, defaultName) : defaultName,
        filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }]
      };
      const picked = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (picked.canceled || !picked.filePath) return null;
      outputPath = picked.filePath;
    }

    const result = await container.exportReport.execute({ ...options, outputPath });
    // Reveal the saved file in the file explorer.
    shell.showItemInFolder(result.filePath);
    return result;
  });

  ipcMain.handle(IPC.shellOpenScreenshots, async () => {
    await shell.openPath(container.screenshotsDir);
  });

  ipcMain.handle(IPC.domInspect, async (_e, targetId: string, cssSelector: string): Promise<DomInspectionDTO> => {
    const page = await container.session.getPage(targetId);
    const result = await page.evaluate(inspectNode, cssSelector);
    return {
      html: result.html,
      xpath: result.xpath,
      cssSelector,
      computedStyles: result.computedStyles,
      ariaAttributes: result.ariaAttributes,
      accessibleNode: null // the full accessibility tree is shown separately by the NVDA Simulation module
    };
  });

  ipcMain.handle(IPC.screenshotRead, async (_e, path: string): Promise<string> => {
    try {
      const buffer = await readFile(path);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  });

  ipcMain.handle(IPC.screenshotOpen, async (_e, path: string): Promise<void> => {
    // Only files inside our screenshots folder may be opened from the renderer.
    const requested = resolve(path);
    const root = resolve(container.screenshotsDir);
    if (requested !== root && !requested.startsWith(root + sep)) return;
    await shell.openPath(requested);
  });

  // --- Ignore list (accepted issues persisted across scans) ---
  const ignorePath = (): string => join(app.getPath('userData'), 'ignore-list.json');
  const readIgnore = async (): Promise<string[]> => {
    try {
      const arr = JSON.parse(await readFile(ignorePath(), 'utf-8')) as unknown;
      return Array.isArray(arr) ? (arr.filter((x) => typeof x === 'string') as string[]) : [];
    } catch {
      return [];
    }
  };
  const writeIgnore = async (keys: string[]): Promise<void> => {
    await writeFile(ignorePath(), JSON.stringify([...new Set(keys)], null, 2), 'utf-8');
  };

  ipcMain.handle(IPC.ignoreList, async (): Promise<string[]> => readIgnore());
  ipcMain.handle(IPC.ignoreAdd, async (_e, key: string): Promise<void> => {
    const keys = await readIgnore();
    if (!keys.includes(key)) await writeIgnore([...keys, key]);
  });
  ipcMain.handle(IPC.ignoreRemove, async (_e, key: string): Promise<void> => {
    const keys = await readIgnore();
    await writeIgnore(keys.filter((k) => k !== key));
  });

  // --- Jira ---
  ipcMain.handle(IPC.jiraGetConfig, async () => getJiraConfig());
  ipcMain.handle(IPC.jiraSaveConfig, async (_e, config: JiraConfigInput) => saveJiraConfig(config));
  ipcMain.handle(IPC.jiraCreateIssue, async (_e, payload: JiraIssuePayload) => createJiraIssue(payload));

  // --- Settings ---
  ipcMain.handle(IPC.settingsGet, async () => getSettings());
  ipcMain.handle(IPC.settingsSave, async (_e, settings: AppSettings) => saveSettings(settings));
  ipcMain.handle(IPC.settingsPickFolder, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: OpenDialogOptions = {
      title: 'Choose a default folder',
      properties: ['openDirectory', 'createDirectory']
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return picked.filePaths[0] ?? null;
  });
}
