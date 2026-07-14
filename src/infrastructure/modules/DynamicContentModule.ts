import type { WcagReferenceDTO } from '@shared/types';
import { createIssue, type Issue } from '@core/domain/Issue';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import { referenceByCriterion } from '@core/domain/WcagReference';
import type { AuditContext, IAuditModule } from '@core/domain/ports';
import {
  clearHoverState,
  collectDynamicCandidates,
  measureReveal,
  snapshotVisible,
  type DynamicScanReport,
  type RevealResult,
  type RevealSnapshot
} from '@infra/browser/dynamicScripts';

const MODULE_ID = 'dynamic-content';
const MAX_SCREENSHOTS = 8;

export class DynamicContentModule implements IAuditModule {
  readonly id = MODULE_ID;
  readonly name = 'Dynamic Content';

  async run(context: AuditContext): Promise<ModuleResult> {
    const start = Date.now();
    const { page, screenshots, logger, scanId } = context;

    logger.info('Dynamic: collecting elements that may reveal content on hover');
    const report = await page.evaluate<DynamicScanReport>(collectDynamicCandidates);

    const issues: Issue[] = [];
    let screenshotBudget = MAX_SCREENSHOTS;
    let issueNumber = 0;
    let hoverChecked = 0;
    let revealedCount = 0;

    // Hovering needs a real pointer; without it the module reports nothing useful.
    if (!page.hover) {
      logger.warn('Dynamic: hover is not supported by this page adapter, skipping the probe');
      return buildModuleResult({
        moduleId: MODULE_ID,
        moduleName: this.name,
        issues,
        durationMs: Date.now() - start,
        passedChecks: 0,
        metadata: { note: 'Hover probing is unavailable in this environment.' }
      });
    }

    for (const candidate of report.candidates) {
      if (!candidate.cssSelector) continue;

      const before = await page.evaluate<RevealSnapshot>(snapshotVisible);

      try {
        await page.hover(candidate.cssSelector);
      } catch {
        // Element may be covered, off-screen or gone; nothing to probe here.
        continue;
      }
      hoverChecked += 1;

      const reveal = await page.evaluate<RevealResult, { before: RevealSnapshot; triggerSelector: string }>(
        measureReveal,
        { before, triggerSelector: candidate.cssSelector }
      );

      if (!reveal.revealed) {
        await page.evaluate(clearHoverState);
        continue;
      }
      revealedCount += 1;

      // The core problem: content appears on hover but the trigger cannot be reached
      // by keyboard, so keyboard and screen reader users never see it (2.1.1).
      const keyboardUnreachable = !candidate.focusable;

      // Content that appears on hover without any popup semantics is not announced
      // to screen readers and is a 1.4.13 risk (dismissable / hoverable / persistent).
      const missingPopupSemantics = !candidate.hasPopupAttr;

      if (!keyboardUnreachable && !missingPopupSemantics) {
        // Reachable and declared: still worth a manual look, but not an issue.
        await page.evaluate(clearHoverState);
        continue;
      }

      issueNumber += 1;
      let screenshotPath: string | null = null;
      if (reveal.revealedBox && screenshotBudget > 0) {
        try {
          const shot = await screenshots.capture(page, {
            scanId,
            label: `dynamic-${candidate.tag}`,
            index: issueNumber,
            box: reveal.revealedBox,
            cssSelector: reveal.revealedSelector
          });
          screenshotPath = shot.path;
          screenshotBudget -= 1;
        } catch (error) {
          logger.warn('Dynamic: screenshot error', error);
        }
      }

      const label = candidate.text || candidate.tag;
      if (keyboardUnreachable) {
        issues.push(
          createIssue({
            moduleId: MODULE_ID,
            severity: 'serious',
            status: 'fail',
            title: 'Content revealed on hover is not reachable by keyboard',
            description: `Hovering over "${label}" reveals additional content ("${reveal.revealedText}"), but the trigger cannot be focused with the keyboard. Keyboard and screen reader users cannot open it.`,
            html: candidate.html,
            cssSelector: candidate.cssSelector,
            wcagReferences: refsFor('2.1.1', '1.4.13'),
            recommendation:
              'Make the trigger focusable (a native <button>/<a>, or tabindex="0" with an appropriate role) and reveal the same content on focus, not only on hover.',
            screenshotPath,
            boundingBox: reveal.revealedBox,
            extra: { revealedSelector: reveal.revealedSelector, trigger: candidate.cssSelector }
          })
        );
      } else {
        issues.push(
          createIssue({
            moduleId: MODULE_ID,
            severity: 'moderate',
            status: 'needs-review',
            title: 'Hover content without popup semantics',
            description: `Hovering over "${label}" reveals content ("${reveal.revealedText}"), but the trigger declares no aria-haspopup, aria-expanded or aria-controls. Screen reader users get no indication that extra content exists. Check manually that the content is dismissable with Escape, stays visible while the pointer moves onto it, and remains until dismissed.`,
            html: candidate.html,
            cssSelector: candidate.cssSelector,
            wcagReferences: refsFor('1.4.13', '4.1.2'),
            recommendation:
              'Add aria-expanded (kept in sync) and aria-haspopup or aria-controls on the trigger, and verify the WCAG 1.4.13 conditions: dismissable, hoverable, persistent.',
            screenshotPath,
            boundingBox: reveal.revealedBox,
            extra: {
              revealedSelector: reveal.revealedSelector,
              expandedBefore: candidate.expandedBefore,
              expandedAfter: reveal.expandedAfter,
              inTriggerSubtree: reveal.inTriggerSubtree
            }
          })
        );
      }

      await page.evaluate(clearHoverState);
    }

    logger.info(`Dynamic: ${issues.length} findings, ${revealedCount} hover reveals across ${hoverChecked} probes`);

    return buildModuleResult({
      moduleId: MODULE_ID,
      moduleName: this.name,
      issues,
      durationMs: Date.now() - start,
      passedChecks: Math.max(0, hoverChecked - issues.length),
      metadata: {
        candidates: report.candidates.length,
        hoverChecked,
        revealedCount,
        note: 'Probes elements that reveal content on hover (menus, tooltips, popovers). WCAG 1.4.13 also requires the content to be dismissable, hoverable and persistent, which needs manual verification.'
      }
    });
  }
}

// Builds a list of WCAG references from criterion numbers, skipping unknown ones.
function refsFor(...criteria: string[]): WcagReferenceDTO[] {
  const out: WcagReferenceDTO[] = [];
  for (const c of criteria) {
    const ref = referenceByCriterion(c);
    if (ref) out.push(ref);
  }
  return out;
}
