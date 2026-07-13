import type { ScanDiffDTO, ScanResultDTO, ScanSummaryDTO } from '@shared/types';
import { issueIdentity, type Issue } from '@core/domain/Issue';
import type { IScanRepository } from '@core/domain/ports';

export class GetHistoryUseCase {
  constructor(private readonly repository: IScanRepository) {}
  execute(): Promise<ScanSummaryDTO[]> {
    return this.repository.list();
  }
}

export class GetScanUseCase {
  constructor(private readonly repository: IScanRepository) {}
  execute(id: string): Promise<ScanResultDTO | null> {
    return this.repository.getById(id);
  }
}

export class DeleteScanUseCase {
  constructor(private readonly repository: IScanRepository) {}
  execute(id: string): Promise<void> {
    return this.repository.delete(id);
  }
}

function flattenIssues(scan: ScanResultDTO): Issue[] {
  return scan.modules.flatMap((m) => m.issues);
}

// Comparison of two scans. base = earlier version, target = later one.
// Regression = an issue present in target that was not in base.
export class CompareScansUseCase {
  constructor(private readonly repository: IScanRepository) {}

  async execute(baseId: string, targetId: string): Promise<ScanDiffDTO> {
    const [base, target] = await Promise.all([
      this.repository.getById(baseId),
      this.repository.getById(targetId)
    ]);
    if (!base) throw new Error(`Base scan not found: ${baseId}`);
    if (!target) throw new Error(`Compared scan not found: ${targetId}`);

    const baseMap = new Map(flattenIssues(base).map((i) => [issueIdentity(i), i]));
    const targetMap = new Map(flattenIssues(target).map((i) => [issueIdentity(i), i]));

    const newIssues: Issue[] = [];
    const persistentIssues: Issue[] = [];
    for (const [key, issue] of targetMap) {
      if (baseMap.has(key)) persistentIssues.push(issue);
      else newIssues.push(issue);
    }
    const resolvedIssues: Issue[] = [];
    for (const [key, issue] of baseMap) {
      if (!targetMap.has(key)) resolvedIssues.push(issue);
    }

    return {
      baseId,
      targetId,
      newIssues,
      resolvedIssues,
      persistentIssues,
      regressionCount: newIssues.length,
      fixedCount: resolvedIssues.length
    };
  }
}
