import type { ExportOptions, ExportResultDTO, ReportFormat } from '@shared/types';
import type { IReportExporter, IScanRepository } from '@core/domain/ports';

export interface ExportReportDeps {
  repository: IScanRepository;
  exporters: Record<ReportFormat, IReportExporter>;
  // Default output path when the user does not choose one.
  defaultPathFor: (scanId: string, format: ReportFormat) => string;
}

export class ExportReportUseCase {
  constructor(private readonly deps: ExportReportDeps) {}

  async execute(options: ExportOptions): Promise<ExportResultDTO> {
    const scan = await this.deps.repository.getById(options.scanId);
    if (!scan)
      throw new Error('No scan to export. Run a scan or open an item from history and try again.');

    const exporter = this.deps.exporters[options.format];
    if (!exporter) throw new Error(`No exporter for format: ${options.format}`);

    const outputPath = options.outputPath ?? this.deps.defaultPathFor(options.scanId, options.format);
    const filePath = await exporter.export(scan, outputPath);
    return { filePath, format: options.format };
  }
}
