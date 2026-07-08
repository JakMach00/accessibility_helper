import type { ModuleResultDTO, ModuleStatus } from '@shared/types';
import type { Issue } from './Issue';
import { addToCounts, emptyCounts } from './Severity';

export type ModuleResult = ModuleResultDTO;

export interface BuildModuleResultInput {
  moduleId: string;
  moduleName: string;
  issues: Issue[];
  durationMs: number;
  passedChecks?: number;
  metadata?: Record<string, unknown>;
  forcedStatus?: ModuleStatus; // e.g. "error" when a module crashes
}

function deriveStatus(issues: Issue[], passedChecks: number): ModuleStatus {
  const hasFail = issues.some((i) => i.status === 'fail');
  const hasReview = issues.some((i) => i.status === 'needs-review');
  const hasWarn = issues.some((i) => i.status === 'warning');
  if (hasFail) return 'fail';
  if (hasReview) return 'needs-review';
  if (hasWarn) return 'warning';
  if (passedChecks > 0) return 'pass';
  return 'not-applicable';
}

export function buildModuleResult(input: BuildModuleResultInput): ModuleResult {
  const counts = emptyCounts();
  let needsReviewChecks = 0;
  for (const issue of input.issues) {
    addToCounts(counts, issue.severity);
    if (issue.status === 'needs-review') needsReviewChecks += 1;
  }
  const passedChecks = input.passedChecks ?? 0;
  return {
    moduleId: input.moduleId,
    moduleName: input.moduleName,
    status: input.forcedStatus ?? deriveStatus(input.issues, passedChecks),
    counts,
    passedChecks,
    needsReviewChecks,
    issues: input.issues,
    durationMs: input.durationMs,
    metadata: input.metadata ?? {}
  };
}
