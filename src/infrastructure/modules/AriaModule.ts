import type { Severity, WcagReferenceDTO } from '@shared/types';
import type { IssueStatus } from '@shared/types';
import { createIssue, type Issue } from '@core/domain/Issue';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import { referenceByCriterion } from '@core/domain/WcagReference';
import type { AuditContext, IAuditModule } from '@core/domain/ports';
import { collectAriaFindings, type AriaFinding, type AriaFindingKind, type AriaReport } from '@infra/browser/ariaScripts';

const MODULE_ID = 'aria-audit';
const MAX_SCREENSHOTS = 10;

interface FindingRule {
  severity: Severity;
  status: IssueStatus;
  criteria: string[];
  title: string;
  recommendation: string;
}

const RULES: Record<AriaFindingKind, FindingRule> = {
  'invalid-role': {
    severity: 'serious',
    status: 'fail',
    criteria: ['4.1.2'],
    title: 'Invalid ARIA role',
    recommendation: 'Use a valid ARIA 1.2 role or remove the role attribute if native semantics are sufficient.'
  },
  'abstract-role': {
    severity: 'serious',
    status: 'fail',
    criteria: ['4.1.2'],
    title: 'Abstract ARIA role used',
    recommendation: 'Abstract roles are for inheritance only. Use a concrete descendant role.'
  },
  'broken-ref': {
    severity: 'serious',
    status: 'fail',
    criteria: ['1.3.1', '4.1.2'],
    title: 'Broken ARIA reference (idref)',
    recommendation: 'Fix the attribute value so it points to an existing id in the document.'
  },
  'missing-name': {
    severity: 'moderate',
    status: 'needs-review',
    criteria: ['4.1.2'],
    title: 'Missing accessible name for ARIA role',
    recommendation: 'Add aria-label, aria-labelledby or visible text describing the control.'
  },
  'missing-state': {
    severity: 'moderate',
    status: 'needs-review',
    criteria: ['4.1.2'],
    title: 'Missing required ARIA state/property',
    recommendation: 'Add the required state attribute (e.g. aria-checked, aria-expanded, aria-valuenow).'
  }
};

export class AriaModule implements IAuditModule {
  readonly id = MODULE_ID;
  readonly name = 'ARIA Audit';

  async run(context: AuditContext): Promise<ModuleResult> {
    const start = Date.now();
    const { page, screenshots, logger, scanId } = context;

    logger.info('ARIA: collecting issues with roles, references and names');
    const report = await page.evaluate<AriaReport>(collectAriaFindings);

    const issues: Issue[] = [];
    let screenshotBudget = MAX_SCREENSHOTS;
    let issueNumber = 0;

    // Hard errors first (they take priority for screenshots).
    const ordered = [...report.findings].sort((a, b) => rank(a.kind) - rank(b.kind));

    for (const finding of ordered) {
      const rule = RULES[finding.kind];
      issueNumber += 1;

      let screenshotPath: string | null = null;
      if (rule.status === 'fail' && finding.box && screenshotBudget > 0) {
        try {
          const shot = await screenshots.capture(page, {
            scanId,
            label: `aria-${finding.kind}`,
            index: issueNumber,
            box: finding.box,
            cssSelector: finding.cssSelector
          });
          screenshotPath = shot.path;
          screenshotBudget -= 1;
        } catch (error) {
          logger.warn(`ARIA: screenshot error ${finding.kind}`, error);
        }
      }

      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: rule.severity,
          status: rule.status,
          title: rule.title,
          description: finding.detail,
          html: finding.html,
          cssSelector: finding.cssSelector,
          wcagReferences: refsFor(...rule.criteria),
          recommendation: rule.recommendation,
          screenshotPath,
          boundingBox: finding.box,
          extra: { kind: finding.kind, role: finding.role }
        })
      );
    }

    logger.info(`ARIA: ${issues.length} findings across ${report.elementsWithRole} elements with a role`);

    return buildModuleResult({
      moduleId: MODULE_ID,
      moduleName: this.name,
      issues,
      durationMs: Date.now() - start,
      passedChecks: Math.max(0, report.elementsWithRole - countHardErrors(report.findings)),
      metadata: {
        elementsWithRole: report.elementsWithRole,
        findings: report.findings.length,
        note: 'Some ARIA checks overlap with the WCAG Scan module (axe-core); here we focus on roles, idref references and required names/states.'
      }
    });
  }
}

// Sort order: hard errors first (priority for screenshots).
function rank(kind: AriaFindingKind): number {
  const order: Record<AriaFindingKind, number> = {
    'invalid-role': 0,
    'abstract-role': 1,
    'broken-ref': 2,
    'missing-name': 3,
    'missing-state': 4
  };
  return order[kind];
}

// Liczy findingi bedace twardymi bledami (do korekty passedChecks).
function countHardErrors(findings: AriaFinding[]): number {
  let n = 0;
  for (const f of findings) {
    if (RULES[f.kind].status === 'fail') n += 1;
  }
  return n;
}

// Buduje liste referencji WCAG z numerow kryteriow, pomijajac nieznane.
function refsFor(...criteria: string[]): WcagReferenceDTO[] {
  const out: WcagReferenceDTO[] = [];
  for (const c of criteria) {
    const ref = referenceByCriterion(c);
    if (ref) out.push(ref);
  }
  return out;
}
