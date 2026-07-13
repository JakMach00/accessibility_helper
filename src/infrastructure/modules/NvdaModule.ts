import type { WcagReferenceDTO } from '@shared/types';
import { createIssue, type Issue } from '@core/domain/Issue';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import { referenceByCriterion } from '@core/domain/WcagReference';
import type { AuditContext, IAuditModule } from '@core/domain/ports';
import { buildAccessibilityTree, type AxLine, type AxTree } from '@infra/browser/nvdaScripts';

const MODULE_ID = 'nvda';
const MAX_SCREENSHOTS = 10;
const NONAME_CAP = 25;
const HEADING_CAP = 15;
const PREVIEW_LINES = 30;

export class NvdaModule implements IAuditModule {
  readonly id = MODULE_ID;
  readonly name = 'NVDA Simulation';

  async run(context: AuditContext): Promise<ModuleResult> {
    const start = Date.now();
    const { page, screenshots, logger, scanId } = context;

    logger.info('NVDA: building the approximate accessibility tree');
    const tree = await page.evaluate<AxTree>(buildAccessibilityTree);

    const issues: Issue[] = [];
    let passedChecks = 0;
    let screenshotBudget = MAX_SCREENSHOTS;
    let issueNumber = 0;

    // 1) Reading-order preview - the unique output of this module.
    const preview = tree.nodes.slice(0, PREVIEW_LINES).map(announce).join('\n');
    if (tree.nodes.length > 0) {
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'minor',
          status: 'needs-review',
          title: 'Reading-order preview (screen reader simulation)',
          description: `Approximate screen reader announcement order (first ${Math.min(PREVIEW_LINES, tree.nodes.length)} z ${tree.nodes.length}):\n${preview}\n\nThis is a DOM-based approximation. Verify manually in NVDA, because the real reading depends on the platform accessibility tree.`,
          wcagReferences: refsFor('1.3.1'),
          recommendation: 'Go through the page in NVDA (arrows, H for headings, Tab for controls) and compare with the preview.',
          extra: {
            totalNodes: tree.nodes.length,
            headingCount: tree.headingCount,
            landmarkCount: tree.landmarkCount
          }
        })
      );
    }

    // 2) Interactive elements without an accessible name (the reader announces only the role).
    let noNameReported = 0;
    for (const node of tree.nodes) {
      if (!node.interactive || node.name) continue;
      if (noNameReported >= NONAME_CAP) break;
      noNameReported += 1;
      issueNumber += 1;

      let screenshotPath: string | null = null;
      if (node.box && screenshotBudget > 0) {
        try {
          const shot = await screenshots.capture(page, {
            scanId,
            label: `nvda-noname-${node.role}`,
            index: issueNumber,
            box: node.box,
            cssSelector: node.cssSelector
          });
          screenshotPath = shot.path;
          screenshotBudget -= 1;
        } catch (error) {
          logger.warn('NVDA: screenshot error', error);
        }
      }

      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'moderate',
          status: 'needs-review',
          title: `Control "${node.role}" without an accessible name`,
          description: `The screen reader will announce only the role ("${node.role}") without a label, which is unusable for the user. Verify in NVDA.`,
          html: node.html,
          cssSelector: node.cssSelector,
          wcagReferences: refsFor('4.1.2'),
          recommendation: 'Add an accessible name: aria-label, aria-labelledby, an associated <label> or visible text.',
          screenshotPath,
          boundingBox: node.box,
          extra: { role: node.role }
        })
      );
    }
    if (tree.interactiveWithoutName === 0) passedChecks += 1;

    // 3) Heading level skips (they hinder heading navigation in the reader).
    const headings = tree.nodes.filter((n) => n.role === 'heading');
    let prevLevel = 0;
    let headingIssues = 0;
    for (const h of headings) {
      const level = h.level ?? 1;
      if (prevLevel !== 0 && level - prevLevel > 1 && headingIssues < HEADING_CAP) {
        headingIssues += 1;
        issues.push(
          createIssue({
            moduleId: MODULE_ID,
            severity: 'moderate',
            status: 'needs-review',
            title: `Heading level skip (h${prevLevel} -> h${level})`,
            description: `A level ${prevLevel} heading is followed by level ${level}, skipping intermediate levels. Heading navigation in the screen reader becomes confusing.`,
            html: h.html,
            cssSelector: h.cssSelector,
            wcagReferences: refsFor('1.3.1'),
            recommendation: 'Keep heading levels in order without skips (e.g. use h3 after h2, not h4).',
            boundingBox: h.box,
            extra: { from: prevLevel, to: level }
          })
        );
      }
      prevLevel = level;
    }
    if (headingIssues === 0) passedChecks += 1;

    logger.info(`NVDA: ${issues.length} findings, ${tree.nodes.length} nodes in the tree`);

    return buildModuleResult({
      moduleId: MODULE_ID,
      moduleName: this.name,
      issues,
      durationMs: Date.now() - start,
      passedChecks,
      metadata: {
        totalNodes: tree.nodes.length,
        headingCount: tree.headingCount,
        landmarkCount: tree.landmarkCount,
        interactiveWithoutName: tree.interactiveWithoutName,
        note: 'Approximate DOM-based simulation. Real NVDA uses the platform accessibility tree, so treat the results as hints for manual verification (~60% coverage).'
      }
    });
  }
}

// Builds a textual announcement of the node, like a screen reader.
function announce(node: AxLine): string {
  const roleLabel = node.role === 'heading' && node.level ? `heading ${node.level}` : node.role;
  const nameLabel = node.name ? `"${node.name}"` : '(no name)';
  return `${roleLabel}: ${nameLabel}`;
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
