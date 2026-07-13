import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReportFormat, ScanResultDTO } from '@shared/types';
import type { IReportExporter } from '@core/domain/ports';

function escape(value: string): string {
  let v = value.replace(/\r?\n/g, ' ').trim();
  // Neutralize formula injection: cells starting with =, +, -, @ could be
  // executed as a formula in Excel/Google Sheets, so we prefix them with an apostrophe.
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  if (v.includes('"') || v.includes(',') || v.includes(';')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

export class CsvReportExporter implements IReportExporter {
  readonly format: ReportFormat = 'csv';

  async export(scan: ScanResultDTO, outputPath: string): Promise<string> {
    const header = [
      'scanId',
      'url',
      'module',
      'severity',
      'status',
      'wcag',
      'level',
      'title',
      'selector',
      'xpath',
      'recommendation'
    ];
    const rows: string[] = [header.join(',')];

    for (const module of scan.modules) {
      for (const issue of module.issues) {
        const wcag = issue.wcagReferences.map((r) => r.criterion).join(' | ');
        const level = issue.wcagReferences.map((r) => r.level).join(' | ');
        rows.push(
          [
            escape(scan.id),
            escape(scan.url),
            escape(module.moduleName),
            escape(issue.severity),
            escape(issue.status),
            escape(wcag),
            escape(level),
            escape(issue.title),
            escape(issue.cssSelector),
            escape(issue.xpath),
            escape(issue.recommendation)
          ].join(',')
        );
      }
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rows.join('\n'), 'utf-8');
    return outputPath;
  }
}
