import type { WcagReferenceDTO } from '@shared/types';
import { createIssue, type Issue } from '@core/domain/Issue';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import { referenceByCriterion } from '@core/domain/WcagReference';
import type { AuditContext, IAuditModule } from '@core/domain/ports';
import {
  measureOverflow,
  readViewportMeta,
  type OverflowReport,
  type ViewportMetaInfo
} from '@infra/browser/reflowScripts';

const MODULE_ID = 'zoom-reflow';
// Kanoniczne cele reflow WCAG: 400% na 1280px = 320 CSS px szerokosci, 200% = 640 CSS px.
const WIDTH_200 = 640;
const HEIGHT_200 = 512;
const WIDTH_400 = 320;
const HEIGHT_400 = 256;
const OVERFLOW_TOLERANCE = 4; // px
const REFLOW_DELAY_MS = 350;

export class ZoomReflowModule implements IAuditModule {
  readonly id = MODULE_ID;
  readonly name = 'Zoom / Reflow';

  async run(context: AuditContext): Promise<ModuleResult> {
    const start = Date.now();
    const { page, screenshots, logger, scanId } = context;

    const issues: Issue[] = [];
    let passedChecks = 0;
    let issueNumber = 0;

    const baseline = page.viewport();

    const shot = async (label: string): Promise<string | null> => {
      issueNumber += 1;
      try {
        const result = await screenshots.capture(page, { scanId, label, index: issueNumber, box: null });
        return result.path;
      } catch (error) {
        logger.warn(`Zoom: screenshot error ${label}`, error);
        return null;
      }
    };

    // 1) Meta viewport blocking zoom (1.4.4) - independent of zoom, reliable.
    const meta = await page.evaluate<ViewportMetaInfo>(readViewportMeta);
    const blocksZoom = meta.userScalableNo || (meta.maximumScale !== null && meta.maximumScale < 2);

    logger.info('Zoom: 100% screenshot (reference)');
    const shot100 = await shot('zoom-100pct');

    // 2) Reflow przy 200% (640 px).
    logger.info('Zoom: measuring reflow at 200%');
    await page.setViewport(WIDTH_200, HEIGHT_200);
    await sleep(REFLOW_DELAY_MS);
    const report200 = await page.evaluate<OverflowReport>(measureOverflow);
    const shot200 = await shot('zoom-200pct');

    // 3) Reflow przy 400% (320 px) - kanoniczny cel 1.4.10.
    logger.info('Zoom: measuring reflow at 400%');
    await page.setViewport(WIDTH_400, HEIGHT_400);
    await sleep(REFLOW_DELAY_MS);
    const report400 = await page.evaluate<OverflowReport>(measureOverflow);
    const shot400 = await shot('zoom-400pct');

    // Restore the original view size.
    await page.setViewport(baseline.width, baseline.height);
    await sleep(200);

    // --- Build findings ---

    if (blocksZoom) {
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'serious',
          status: 'fail',
          title: 'Page blocks zooming',
          description: `The meta viewport restricts zooming (${meta.content}). Low-vision users cannot enlarge text to 200%.`,
          wcagReferences: refsFor('1.4.4', '1.4.10'),
          recommendation: 'Remove user-scalable=no and maximum-scale below 2 from the meta viewport.',
          screenshotPath: shot100,
          extra: { viewportContent: meta.content, maximumScale: meta.maximumScale }
        })
      );
    } else {
      passedChecks += 1;
    }

    // Reflow 400% (target 320 px): horizontal scrolling means no reflow.
    if (report400.overflowX > OVERFLOW_TOLERANCE) {
      const culprits = report400.elements.slice(0, 10).map((e) => e.cssSelector);
      const worst = report400.elements[0] ?? null;
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'serious',
          status: 'needs-review',
          title: 'No reflow at 400% (horizontal scrolling at 320 px)',
          description: `At 320 px width the page requires horizontal scrolling (overflow ${report400.overflowX} px). Content should reflow without two-dimensional scrolling. Note: data tables, maps and graphics may be exceptions.`,
          html: worst?.html ?? '',
          cssSelector: worst?.cssSelector ?? '',
          wcagReferences: refsFor('1.4.10'),
          recommendation:
            'Use responsive layouts (max-width: 100%, avoid fixed px widths), media queries and wrapping. Verify manually which elements require scrolling.',
          screenshotPath: shot400,
          boundingBox: worst?.box ?? null,
          extra: {
            overflowX: report400.overflowX,
            scrollWidth: report400.scrollWidth,
            clientWidth: report400.clientWidth,
            overflowingSelectors: culprits,
            baselineScreenshot: shot100
          }
        })
      );
      // Widok odniesienia 100% do porownania przed/po.
      if (shot100) {
        issues.push(
          createIssue({
            moduleId: MODULE_ID,
            severity: 'minor',
            status: 'needs-review',
            title: 'Reference view at 100% (reflow comparison)',
            description: 'Screenshot of the page at 100% zoom for comparison with the 400% view.',
            wcagReferences: refsFor('1.4.10'),
            recommendation: 'Compare with the 400% view to judge whether horizontal scrolling is justified.',
            screenshotPath: shot100
          })
        );
      }
    } else {
      passedChecks += 1;
    }

    // Reflow 200% (640 px): dodatkowy, mocniejszy sygnal problemu.
    if (report200.overflowX > OVERFLOW_TOLERANCE) {
      const worst = report200.elements[0] ?? null;
      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity: 'moderate',
          status: 'needs-review',
          title: 'Horizontal scrolling already at 200%',
          description: `At 640 px width (200%) horizontal scrolling appears (overflow ${report200.overflowX} px). This is an early sign of reflow and text-scaling problems.`,
          html: worst?.html ?? '',
          cssSelector: worst?.cssSelector ?? '',
          wcagReferences: refsFor('1.4.10', '1.4.4'),
          recommendation: 'Check fixed widths and elements overflowing their container when zoomed.',
          screenshotPath: shot200,
          boundingBox: worst?.box ?? null,
          extra: { overflowX: report200.overflowX }
        })
      );
    } else {
      passedChecks += 1;
    }

    logger.info(`Zoom: ${issues.length} findings (overflow 200%=${report200.overflowX}px, 400%=${report400.overflowX}px)`);

    return buildModuleResult({
      moduleId: MODULE_ID,
      moduleName: this.name,
      issues,
      durationMs: Date.now() - start,
      passedChecks,
      metadata: {
        baselineWidth: baseline.width,
        baselineHeight: baseline.height,
        blocksZoom,
        overflowX200: report200.overflowX,
        overflowX400: report400.overflowX,
        overflowElements400: report400.elements.length
      }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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
