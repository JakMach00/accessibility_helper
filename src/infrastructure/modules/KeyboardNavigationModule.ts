import type { BoundingBoxDTO, WcagReferenceDTO } from '@shared/types';
import { createIssue, type Issue } from '@core/domain/Issue';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import { referenceByCriterion } from '@core/domain/WcagReference';
import type { AuditContext, IAuditModule, IBrowserPage } from '@core/domain/ports';
import {
  activeElementSignature,
  cleanupKeyboardMarkers,
  collectKeyboardData,
  resetFocusToTop,
  type ActiveSignature,
  type FocusableDescriptor,
  type KeyboardData
} from '@infra/browser/keyboardScripts';

const MODULE_ID = 'keyboard-nav';
const MAX_SCREENSHOTS = 18;
const CAP_PER_CATEGORY = 40;
const MAX_TABS = 90;
const TRAP_RUN = 4; // the same element this many times in a row in the Tab order = suspected trap

export class KeyboardNavigationModule implements IAuditModule {
  readonly id = MODULE_ID;
  readonly name = 'Keyboard Navigation';

  async run(context: AuditContext): Promise<ModuleResult> {
    const start = Date.now();
    const { page, screenshots, logger, scanId } = context;

    logger.info('Keyboard: collecting inventory of focusable elements');
    const data = await page.evaluate<KeyboardData>(collectKeyboardData);

    const issues: Issue[] = [];
    let passedChecks = 0;
    let screenshotBudget = MAX_SCREENSHOTS;
    let issueNumber = 0;

    const capture = async (label: string, box: BoundingBoxDTO | null, cssSelector: string): Promise<string | null> => {
      if (!box || screenshotBudget <= 0) return null;
      try {
        const shot = await screenshots.capture(page, { scanId, label, index: issueNumber, box, cssSelector });
        if (!shot.path) return null;
        screenshotBudget -= 1;
        return shot.path;
      } catch (error) {
        logger.warn(`Keyboard: screenshot error for ${label}`, error);
        return null;
      }
    };

    // 1) Clickable but not keyboard-focusable (2.1.1) - hard error.
    const clickables = data.clickables.slice(0, CAP_PER_CATEGORY);
    for (const c of clickables) {
      issueNumber += 1;
      const screenshotPath = await capture(`clickable-${c.tag}`, c.box, c.cssSelector);
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'serious',
          status: 'fail',
          title: 'Interactive element not reachable by keyboard',
          description: c.reason,
          html: c.html,
          cssSelector: c.cssSelector,
          wcagReferences: refsFor('2.1.1'),
          recommendation:
            'Use a native <button> or <a>, or add tabindex="0", an appropriate role and Enter/Space key handling.',
          screenshotPath,
          boundingBox: c.box,
          extra: { role: c.role }
        })
      );
    }
    if (data.clickables.length === 0) passedChecks += 1;

    // 2) Positive tabindex value (2.4.3) - breaks the natural focus order.
    const positiveTab = data.focusables.filter((f) => f.tabindex !== null && f.tabindex > 0).slice(0, CAP_PER_CATEGORY);
    for (const f of positiveTab) {
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'moderate',
          status: 'fail',
          title: `Positive tabindex value (${f.tabindex ?? ''})`,
          description:
            'A positive tabindex forces an artificial focus order that easily diverges from the visual and logical order.',
          html: f.html,
          cssSelector: f.cssSelector,
          wcagReferences: refsFor('2.4.3'),
          recommendation: 'Replace it with tabindex="0" and control the order through the DOM structure.',
          boundingBox: f.box,
          extra: { tabindex: f.tabindex }
        })
      );
    }
    if (!data.focusables.some((f) => f.tabindex !== null && f.tabindex > 0)) passedChecks += 1;

    // 3) Missing visible focus indicator (2.4.7) - needs review (programmatic focus does not trigger :focus-visible).
    const focusableById = new Map<number, FocusableDescriptor>(data.focusables.map((f) => [f.index, f]));
    let noFocusIndicator = 0;
    for (const fs of data.focusStyles) {
      if (fs.focusableConfirmed && fs.changed) {
        passedChecks += 1;
        continue;
      }
      if (!fs.focusableConfirmed) continue; // element did not take focus programmatically, skip here
      if (noFocusIndicator >= 30) continue;
      const desc = focusableById.get(fs.index);
      if (!desc) continue;
      noFocusIndicator += 1;
      issueNumber += 1;
      const screenshotPath = await capture(`focus-${desc.tag}`, desc.box, desc.cssSelector);
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'moderate',
          status: 'needs-review',
          title: 'No clear style change on focus',
          description:
            'No change of border, shadow or outline was detected on focus. The focus indicator may be invisible to keyboard users.',
          html: desc.html,
          cssSelector: desc.cssSelector,
          wcagReferences: refsFor('2.4.7'),
          recommendation:
            'Provide a visible :focus or :focus-visible style (outline or other contrast). Verify manually by navigating with the keyboard.',
          screenshotPath,
          boundingBox: desc.box,
          extra: { name: desc.name }
        })
      );
    }

    // 4) Focusable but invisible elements (2.4.3 / 2.1.1) - focus can leave the visible area.
    const invisible = data.focusables.filter((f) => !f.visible).slice(0, 30);
    for (const f of invisible) {
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'moderate',
          status: 'needs-review',
          title: 'Element in the Tab order is not visible',
          description:
            'The element is reachable by keyboard but is invisible in its default state. Sighted users may lose track of focus. Note: off-screen skip links that appear on focus are a valid pattern.',
          html: f.html,
          cssSelector: f.cssSelector,
          wcagReferences: refsFor('2.4.3', '2.1.1'),
          recommendation:
            'Make sure focus lands only on visible controls, or reveal the element on focus (skip-link pattern).',
          boundingBox: f.box,
          extra: { name: f.name }
        })
      );
    }
    if (!data.focusables.some((f) => !f.visible)) passedChecks += 1;

    // 5) Missing skip link on a structured page (2.4.1).
    const needsSkip = data.nav.hasMain || data.nav.landmarkCount >= 3;
    if (needsSkip && !data.nav.hasSkipLink) {
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'moderate',
          status: 'needs-review',
          title: 'Missing skip link',
          description:
            'The page has landmarks but no "skip to content" link was found. Keyboard users have to tab through the entire navigation.',
          wcagReferences: refsFor('2.4.1'),
          recommendation: 'Add a link to the main content as the first focusable element (e.g. href="#main").',
          extra: { landmarkCount: data.nav.landmarkCount, hasMain: data.nav.hasMain }
        })
      );
    } else if (data.nav.hasSkipLink || !needsSkip) {
      passedChecks += 1;
    }

    // 6) Focus-trap probe (2.1.2): actual Tab traversal and sequence analysis.
    const trap = await this.probeKeyboardTrap(page, data.focusables.length, logger);
    if (trap.trapIndex !== null) {
      const desc = focusableById.get(trap.trapIndex);
      issueNumber += 1;
      const screenshotPath = desc ? await capture(`trap-${desc.tag}`, desc.box, desc.cssSelector) : null;
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'serious',
          status: 'needs-review',
          title: 'Suspected keyboard focus trap',
          description: `While tabbing, focus repeatedly stopped on the same element and did not move on (${trap.runLength} repeats). This may indicate a focus trap.`,
          html: desc?.html ?? '',
          cssSelector: desc?.cssSelector ?? '',
          wcagReferences: refsFor('2.1.2'),
          recommendation:
            'Make sure focus can be moved out with Tab / Shift+Tab and that modals close with Escape. Verify manually.',
          screenshotPath,
          boundingBox: desc?.box ?? null,
          extra: { reachedDistinct: trap.reachedDistinct, focusableCount: data.focusables.length }
        })
      );
    } else {
      passedChecks += 1;
    }

    // Sprzatanie znacznikow w stronie.
    await page.evaluate(cleanupKeyboardMarkers);

    logger.info(`Keyboard: ${issues.length} findings, ${data.focusables.length} focusable elements`);

    return buildModuleResult({
      moduleId: MODULE_ID,
      moduleName: this.name,
      issues,
      durationMs: Date.now() - start,
      passedChecks,
      metadata: {
        focusableCount: data.focusables.length,
        clickableNonFocusable: data.clickables.length,
        positiveTabindex: data.focusables.filter((f) => f.tabindex !== null && f.tabindex > 0).length,
        landmarkCount: data.nav.landmarkCount,
        headingCount: data.nav.headingCount,
        hasMain: data.nav.hasMain,
        hasSkipLink: data.nav.hasSkipLink
      }
    });
  }

  // Tabs through the page and detects focus getting stuck on one element.
  private async probeKeyboardTrap(
    page: IBrowserPage,
    focusableCount: number,
    logger: AuditContext['logger']
  ): Promise<{ trapIndex: number | null; runLength: number; reachedDistinct: number }> {
    if (focusableCount < 2) return { trapIndex: null, runLength: 0, reachedDistinct: 0 };

    await page.evaluate(resetFocusToTop);
    const maxTabs = Math.min(focusableCount + 4, MAX_TABS);
    const seen = new Set<number>();
    let runValue: number | null = null;
    let runLen = 0;

    for (let i = 0; i < maxTabs; i += 1) {
      try {
        await page.pressKey('Tab');
      } catch (error) {
        logger.warn('Keyboard: error while simulating Tab', error);
        break;
      }
      const sig = await page.evaluate<ActiveSignature>(activeElementSignature);
      const v = sig.kbdIndex;
      if (v !== null) seen.add(v);
      if (v !== null && v === runValue) {
        runLen += 1;
      } else {
        runValue = v;
        runLen = 1;
      }
      if (runLen >= TRAP_RUN && v !== null && seen.size < focusableCount) {
        return { trapIndex: v, runLength: runLen, reachedDistinct: seen.size };
      }
    }
    return { trapIndex: null, runLength: 0, reachedDistinct: seen.size };
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
