import type {
  BoundingBoxDTO,
  IssueDTO,
  IssueStatus,
  Severity,
  WcagReferenceDTO
} from '@shared/types';

// The Issue domain entity is structurally compatible with IssueDTO (the transfer type),
// but we build it via a factory that enforces invariants and defaults.
export type Issue = IssueDTO;

let counter = 0;

export function createIssueId(moduleId: string): string {
  counter += 1;
  return `${moduleId}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export interface CreateIssueInput {
  moduleId: string;
  severity: Severity;
  title: string;
  description: string;
  html?: string;
  cssSelector?: string;
  xpath?: string;
  wcagReferences?: WcagReferenceDTO[];
  helpUrl?: string;
  recommendation?: string;
  screenshotPath?: string | null;
  boundingBox?: BoundingBoxDTO | null;
  occurrences?: number;
  status?: IssueStatus;
  extra?: Record<string, unknown>;
}

export function createIssue(input: CreateIssueInput): Issue {
  return {
    id: createIssueId(input.moduleId),
    moduleId: input.moduleId,
    severity: input.severity,
    status: input.status ?? 'fail',
    title: input.title,
    description: input.description,
    html: input.html ?? '',
    cssSelector: input.cssSelector ?? '',
    xpath: input.xpath ?? '',
    wcagReferences: input.wcagReferences ?? [],
    helpUrl: input.helpUrl ?? '',
    recommendation: input.recommendation ?? '',
    screenshotPath: input.screenshotPath ?? null,
    boundingBox: input.boundingBox ?? null,
    occurrences: input.occurrences ?? 1,
    extra: input.extra ?? {}
  };
}

// Issue identity key for comparisons between scans (regressions).
// Selector + WCAG criterion + module give a stable identity independent of id.
export function issueIdentity(issue: Issue): string {
  const wcag = issue.wcagReferences.map((r) => r.criterion).sort().join(',');
  return `${issue.moduleId}::${issue.title}::${wcag}::${issue.cssSelector}`;
}
