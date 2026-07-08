import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import type { AvailableModuleDTO, ReportFormat } from '@shared/types';
import { RunAuditUseCase } from '@core/application/RunAuditUseCase';
import {
  CompareScansUseCase,
  DeleteScanUseCase,
  GetHistoryUseCase,
  GetScanUseCase
} from '@core/application/HistoryUseCases';
import { ExportReportUseCase } from '@core/application/ExportReportUseCase';
import type { IProgressReporter, IReportExporter } from '@core/domain/ports';
import { PlaywrightBrowserSession } from '@infra/browser/PlaywrightBrowserSession';
import { createDefaultRegistry } from '@infra/registry/defaultModules';
import { PlaywrightScreenshotService } from '@infra/screenshot/PlaywrightScreenshotService';
import { FileScanRepository } from '@infra/persistence/FileScanRepository';
import type { ModuleRegistry } from '@infra/registry/ModuleRegistry';
import { ConsoleLogger } from '@infra/logging/ConsoleLogger';
import { JsonReportExporter } from '@infra/export/JsonReportExporter';
import { CsvReportExporter } from '@infra/export/CsvReportExporter';
import { HtmlReportExporter } from '@infra/export/HtmlReportExporter';

// Planned modules (not yet implemented) shown in the UI as "coming soon".
// All planned modules are implemented and registered above.
const PLANNED_MODULES: AvailableModuleDTO[] = [];

export interface Container {
  session: PlaywrightBrowserSession;
  registry: ModuleRegistry;
  createRunAudit: (progress: IProgressReporter) => RunAuditUseCase;
  getHistory: GetHistoryUseCase;
  getScan: GetScanUseCase;
  deleteScan: DeleteScanUseCase;
  compareScans: CompareScansUseCase;
  exportReport: ExportReportUseCase;
  listModules: () => AvailableModuleDTO[];
  screenshotsDir: string;
}

export function buildContainer(): Container {
  const userData = app.getPath('userData');
  const historyDir = join(userData, 'history');
  const screenshotsDir = join(userData, 'screenshots');
  const reportsDir = join(userData, 'reports');

  const logger = new ConsoleLogger('main');
  const session = new PlaywrightBrowserSession(logger);
  const screenshots = new PlaywrightScreenshotService(screenshotsDir, logger);
  const repository = new FileScanRepository(historyDir, logger);

  const registry = createDefaultRegistry();

  const exporters: Record<ReportFormat, IReportExporter> = {
    json: new JsonReportExporter(),
    csv: new CsvReportExporter(),
    html: new HtmlReportExporter()
  };

  const createRunAudit = (progress: IProgressReporter): RunAuditUseCase =>
    new RunAuditUseCase({
      session,
      registry,
      repository,
      screenshots,
      progress,
      logger,
      now: () => new Date(),
      newId: () => randomUUID(),
      appVersion: app.getVersion()
    });

  const listModules = (): AvailableModuleDTO[] => [
    ...registry.all().map((m) => ({ id: m.id, name: m.name, implemented: true })),
    ...PLANNED_MODULES
  ];

  return {
    session,
    registry,
    createRunAudit,
    getHistory: new GetHistoryUseCase(repository),
    getScan: new GetScanUseCase(repository),
    deleteScan: new DeleteScanUseCase(repository),
    compareScans: new CompareScansUseCase(repository),
    exportReport: new ExportReportUseCase({
      repository,
      exporters,
      defaultPathFor: (scanId, format) => join(reportsDir, `${scanId}.${format}`)
    }),
    listModules,
    screenshotsDir
  };
}
