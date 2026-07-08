import { readFile } from 'node:fs/promises';
import { BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron';
import type {
  AuditProgressEvent,
  ConnectOptions,
  DomInspectionDTO,
  ExportOptions,
  ExportResultDTO,
  RunAuditOptions
} from '@shared/types';
import { IPC } from '@shared/ipc';
import type { IProgressReporter } from '@core/domain/ports';
import { inspectNode } from '@infra/browser/domScripts';
import type { Container } from './composition';

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
    // Pozwol uzytkownikowi wybrac miejsce zapisu.
    const win = BrowserWindow.fromWebContents(event.sender);
    const defaultName = `wcag-report-${new Date().toISOString().slice(0, 10)}.${options.format}`;
    const dialogOptions = {
      title: 'Save report',
      defaultPath: defaultName,
      filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }]
    };
    const picked = win
      ? await dialog.showSaveDialog(win, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (picked.canceled || !picked.filePath) return null;

    const result = await container.exportReport.execute({ ...options, outputPath: picked.filePath });
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
}
