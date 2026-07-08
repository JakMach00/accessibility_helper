import { describe, expect, it } from 'vitest';
import type { ScanResultDTO, ScanSummaryDTO } from '@shared/types';
import type { IScanRepository } from '@core/domain/ports';
import { createIssue } from '@core/domain/Issue';
import { buildModuleResult } from '@core/domain/ModuleResult';
import { assembleScanResult } from '@core/domain/ScanResult';
import { CompareScansUseCase } from './HistoryUseCases';

function makeScan(id: string, selectors: string[]): ScanResultDTO {
  const issues = selectors.map((sel) =>
    createIssue({
      moduleId: 'wcag-scan',
      severity: 'serious',
      title: 'Elements must have sufficient color contrast',
      description: 'x',
      cssSelector: sel,
      wcagReferences: [{ criterion: '1.4.3', level: 'AA', title: 'Contrast (Minimum)', url: 'u' }]
    })
  );
  const module = buildModuleResult({
    moduleId: 'wcag-scan',
    moduleName: 'WCAG Scan',
    issues,
    durationMs: 100
  });
  return assembleScanResult({
    id,
    url: 'https://example.com',
    title: 'Example',
    startedAt: new Date(0),
    finishedAt: new Date(1000),
    browser: { name: 'Chrome', version: '1' },
    viewport: { width: 1280, height: 1024 },
    modules: [module],
    appVersion: 'test'
  });
}

class FakeRepo implements IScanRepository {
  constructor(private readonly scans: Record<string, ScanResultDTO>) {}
  async save(): Promise<void> {}
  async list(): Promise<ScanSummaryDTO[]> {
    return [];
  }
  async getById(id: string): Promise<ScanResultDTO | null> {
    return this.scans[id] ?? null;
  }
  async delete(): Promise<void> {}
}

describe('CompareScansUseCase', () => {
  it('detects regressions and fixes by issue identity', async () => {
    const base = makeScan('base', ['.a', '.b']); // .a i .b
    const target = makeScan('target', ['.b', '.c']); // .b utrzymany, .c nowy, .a naprawiony
    const repo = new FakeRepo({ base, target });

    const diff = await new CompareScansUseCase(repo).execute('base', 'target');

    expect(diff.regressionCount).toBe(1); // .c
    expect(diff.fixedCount).toBe(1); // .a
    expect(diff.persistentIssues).toHaveLength(1); // .b
    expect(diff.newIssues[0]?.cssSelector).toBe('.c');
    expect(diff.resolvedIssues[0]?.cssSelector).toBe('.a');
  });

  it('throws when the base scan is missing', async () => {
    const repo = new FakeRepo({});
    await expect(new CompareScansUseCase(repo).execute('nope', 'nope2')).rejects.toThrow();
  });
});
