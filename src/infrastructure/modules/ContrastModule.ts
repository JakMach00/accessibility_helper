import type { WcagReferenceDTO } from '@shared/types';
import { createIssue, type Issue } from '@core/domain/Issue';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import { referenceByCriterion } from '@core/domain/WcagReference';
import type { AuditContext, IAuditModule } from '@core/domain/ports';
import {
  cleanupContrastMarkers,
  measureContrastAt,
  prepareContrastCandidates,
  type ContrastCandidate,
  type ContrastMeasurement
} from '@infra/browser/contrastScripts';

const MODULE_ID = 'contrast';
const MAX_SCREENSHOTS = 15;
const STATE_CAP = 30; // ile elementow badac w stanach interaktywnych
const DEGRADE_EPSILON = 0.05; // how much a state must worsen contrast to be reported
const STATES: Array<'focus' | 'hover'> = ['focus', 'hover'];

interface StateFailure {
  state: 'focus' | 'hover';
  measurement: ContrastMeasurement;
  ratio: number;
  required: number;
  screenshotPath: string | null;
}

export class ContrastModule implements IAuditModule {
  readonly id = MODULE_ID;
  readonly name = 'Contrast Checker';

  async run(context: AuditContext): Promise<ModuleResult> {
    const start = Date.now();
    const { page, screenshots, logger, scanId } = context;

    const issues: Issue[] = [];
    let passedChecks = 0;
    let screenshotBudget = MAX_SCREENSHOTS;
    let issueNumber = 0;

    logger.info('Contrast: collecting candidates (interactive elements with text)');
    const candidates = await page.evaluate<ContrastCandidate[]>(prepareContrastCandidates);

    const toCheck = candidates.slice(0, STATE_CAP);
    for (const candidate of toCheck) {
      const selector = `[data-wcag-ct="${candidate.index}"]`;

      // Measurement in the default state (reference).
      const base = await page.evaluate<ContrastMeasurement | null, { selector: string }>(measureContrastAt, {
        selector
      });
      if (!base || base.ratio === null || base.hasBgImage) {
        // Image background or no measurement: axe flags this for review, so we skip it.
        continue;
      }
      const required = base.isLargeText ? 3 : 4.5;

      // Pomiar w wymuszonych stanach; raportujemy tylko realne pogorszenie.
      let worst: StateFailure | null = null;
      for (const state of STATES) {
        await page.forcePseudoStates(selector, [state]);
        const m = await page.evaluate<ContrastMeasurement | null, { selector: string }>(measureContrastAt, {
          selector
        });
        const stateRatio = m !== null && m.ratio !== null && !m.hasBgImage ? m.ratio : null;
        const degraded = stateRatio !== null && stateRatio < required && stateRatio < base.ratio - DEGRADE_EPSILON;

        let screenshotPath: string | null = null;
        if (degraded && screenshotBudget > 0 && candidate.box) {
          // Screenshot in the forced state as evidence.
          issueNumber += 1;
          try {
            const result = await screenshots.capture(page, {
              scanId,
              label: `contrast-${state}-${candidate.tag}`,
              index: issueNumber,
              box: candidate.box,
              cssSelector: candidate.cssSelector
            });
            screenshotPath = result.path;
            screenshotBudget -= 1;
          } catch (error) {
            logger.warn(`Contrast: screenshot error ${state}`, error);
          }
        }
        await page.forcePseudoStates(selector, []); // wyczysc stan

        if (degraded && m !== null && stateRatio !== null) {
          if (!worst || stateRatio < worst.ratio) {
            worst = { state, measurement: m, ratio: stateRatio, required, screenshotPath };
          }
        }
      }

      if (worst) {
        const stateName = worst.state === 'focus' ? ':focus' : ':hover';
        issues.push(
          createIssue({
            moduleId: MODULE_ID,
            severity: 'moderate',
            status: 'needs-review',
            title: `Text contrast too low in the ${stateName}`,
            description: `In the ${stateName} state text contrast drops to ${worst.ratio} : 1 (required ${required} : 1). In the default state it is ${base.ratio} : 1. axe-core does not check interactive states, which is why this module detects it.`,
            html: candidate.html,
            cssSelector: candidate.cssSelector,
            wcagReferences: refsFor('1.4.3'),
            recommendation: `Adjust the ${stateName} colors so the contrast is at least ${required} : 1. Text: ${worst.measurement.fg} on background ${worst.measurement.bg}.`,
            screenshotPath: worst.screenshotPath,
            boundingBox: candidate.box,
            extra: {
              state: worst.state,
              defaultRatio: base.ratio,
              stateRatio: worst.ratio,
              required,
              isLargeText: base.isLargeText,
              fontSizePx: base.fontSizePx
            }
          })
        );
      } else {
        passedChecks += 1;
      }
    }

    await page.evaluate(cleanupContrastMarkers);

    logger.info(`Contrast: ${issues.length} findings across ${toCheck.length} checked elements`);

    return buildModuleResult({
      moduleId: MODULE_ID,
      moduleName: this.name,
      issues,
      durationMs: Date.now() - start,
      passedChecks,
      metadata: {
        candidates: candidates.length,
        checkedInStates: toCheck.length,
        note: 'Default-state contrast is covered by the WCAG Scan module (axe-core); this module checks :focus and :hover. Non-text contrast (1.4.11) requires manual review.'
      }
    });
  }
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
