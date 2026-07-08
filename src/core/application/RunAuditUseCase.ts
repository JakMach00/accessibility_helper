import type { RunAuditOptions, ScanResultDTO, ViewportDTO } from '@shared/types';
import { assembleScanResult } from '@core/domain/ScanResult';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import type {
  IBrowserSession,
  ILogger,
  IModuleRegistry,
  IProgressReporter,
  IScanRepository,
  IScreenshotService
} from '@core/domain/ports';

const DEFAULT_VIEWPORT: ViewportDTO = { width: 1280, height: 1024 };

export interface RunAuditDeps {
  session: IBrowserSession;
  registry: IModuleRegistry;
  repository: IScanRepository;
  screenshots: IScreenshotService;
  progress: IProgressReporter;
  logger: ILogger;
  now: () => Date;
  newId: () => string;
  appVersion: string;
}

// Orkiestrator audytu. Nie wie NIC o konkretnych modulach, tylko iteruje
// over whatever the registry provides. A single module's errors do not break the whole scan.
export class RunAuditUseCase {
  constructor(private readonly deps: RunAuditDeps) {}

  async execute(options: RunAuditOptions): Promise<ScanResultDTO> {
    const { session, registry, repository, screenshots, progress, logger, now, newId, appVersion } = this.deps;
    const scanId = newId();
    const startedAt = now();
    const controller = new AbortController();

    const modules = registry.resolve(options.moduleIds);
    const total = modules.length;

    progress.report({ scanId, phase: 'preparing', current: 0, total, message: 'Preparing the page' });

    const page = await session.getPage(options.targetId);
    if (options.url) {
      await session.navigate(page, options.url);
    }
    const viewport = options.viewport ?? DEFAULT_VIEWPORT;
    await page.setViewport(viewport.width, viewport.height);

    const url = page.url();
    const title = await page.title();

    const results: ModuleResult[] = [];
    let index = 0;
    for (const module of modules) {
      index += 1;
      progress.report({
        scanId,
        phase: 'running-module',
        moduleId: module.id,
        moduleName: module.name,
        current: index,
        total,
        message: `Module: ${module.name}`
      });

      const moduleStart = now();
      try {
        const result = await module.run({
          scanId,
          page,
          screenshots,
          logger,
          signal: controller.signal
        });
        results.push(result);
      } catch (error) {
        logger.error(`Module ${module.id} failed`, error);
        results.push(
          buildModuleResult({
            moduleId: module.id,
            moduleName: module.name,
            issues: [],
            durationMs: now().getTime() - moduleStart.getTime(),
            forcedStatus: 'error',
            metadata: { error: error instanceof Error ? error.message : String(error) }
          })
        );
      }

      progress.report({
        scanId,
        phase: 'module-done',
        moduleId: module.id,
        moduleName: module.name,
        current: index,
        total,
        message: `Zakonczono: ${module.name}`
      });
    }

    progress.report({ scanId, phase: 'aggregating', current: total, total, message: 'Aggregating results' });

    // Restore the natural view size (important for attach mode on a real tab).
    await page.resetEmulation?.();

    const scan = assembleScanResult({
      id: scanId,
      url,
      title,
      startedAt,
      finishedAt: now(),
      browser: session.browserInfo(),
      viewport,
      modules: results,
      appVersion
    });

    progress.report({ scanId, phase: 'saving', current: total, total, message: 'Zapis do historii' });
    await repository.save(scan);

    progress.report({ scanId, phase: 'done', current: total, total, message: 'Gotowe' });
    return scan;
  }
}
