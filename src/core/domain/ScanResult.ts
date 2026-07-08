import type {
  BrowserInfoDTO,
  OverallStatus,
  ScanResultDTO,
  ScanSummaryDTO,
  SeverityCounts,
  ViewportDTO
} from '@shared/types';
import type { ModuleResult } from './ModuleResult';
import { emptyCounts, mergeCounts } from './Severity';

export type ScanResult = ScanResultDTO;

export interface AssembleScanInput {
  id: string;
  url: string;
  title: string;
  startedAt: Date;
  finishedAt: Date;
  browser: BrowserInfoDTO;
  viewport: ViewportDTO;
  modules: ModuleResult[];
  appVersion: string;
}

function aggregateCounts(modules: ModuleResult[]): SeverityCounts {
  return modules.reduce((acc, m) => mergeCounts(acc, m.counts), emptyCounts());
}

function overallStatus(modules: ModuleResult[], counts: SeverityCounts): OverallStatus {
  if (counts.total > 0 && modules.some((m) => m.status === 'fail')) return 'fail';
  if (modules.some((m) => m.status === 'needs-review' || m.status === 'warning')) return 'needs-review';
  return 'pass';
}

export function assembleScanResult(input: AssembleScanInput): ScanResult {
  const counts = aggregateCounts(input.modules);
  return {
    id: input.id,
    url: input.url,
    title: input.title,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
    browser: input.browser,
    viewport: input.viewport,
    overallStatus: overallStatus(input.modules, counts),
    counts,
    modules: input.modules,
    appVersion: input.appVersion
  };
}

export function toSummary(scan: ScanResult): ScanSummaryDTO {
  return {
    id: scan.id,
    url: scan.url,
    title: scan.title,
    finishedAt: scan.finishedAt,
    overallStatus: scan.overallStatus,
    counts: scan.counts
  };
}
