import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ReportFormat } from '@shared/types';
import { RunAuditUseCase } from '@core/application/RunAuditUseCase';
import type { ILogger, IProgressReporter, IReportExporter } from '@core/domain/ports';
import { PlaywrightBrowserSession } from '@infra/browser/PlaywrightBrowserSession';
import { createDefaultRegistry } from '@infra/registry/defaultModules';
import { PlaywrightScreenshotService } from '@infra/screenshot/PlaywrightScreenshotService';
import { FileScanRepository } from '@infra/persistence/FileScanRepository';
import { JsonReportExporter } from '@infra/export/JsonReportExporter';
import { CsvReportExporter } from '@infra/export/CsvReportExporter';
import { HtmlReportExporter } from '@infra/export/HtmlReportExporter';

export interface CliContainer {
  session: PlaywrightBrowserSession;
  createRunAudit: (progress: IProgressReporter) => RunAuditUseCase;
  exporters: Record<ReportFormat, IReportExporter>;
}

export interface CliContainerOptions {
  dataDir: string;
  appVersion: string;
  logger: ILogger;
}

// Wires the same use cases as the main process, but without any Electron dependency.
export function buildCliContainer(options: CliContainerOptions): CliContainer {
  const screenshots = new PlaywrightScreenshotService(join(options.dataDir, 'screenshots'), options.logger);
  const repository = new FileScanRepository(join(options.dataDir, 'history'), options.logger);
  const session = new PlaywrightBrowserSession(options.logger);
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
      logger: options.logger,
      now: () => new Date(),
      newId: () => randomUUID(),
      appVersion: options.appVersion
    });

  return { session, createRunAudit, exporters };
}
