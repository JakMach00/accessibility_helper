import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReportFormat, ScanResultDTO } from '@shared/types';
import type { IReportExporter } from '@core/domain/ports';

export class JsonReportExporter implements IReportExporter {
  readonly format: ReportFormat = 'json';

  async export(scan: ScanResultDTO, outputPath: string): Promise<string> {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(scan, null, 2), 'utf-8');
    return outputPath;
  }
}
