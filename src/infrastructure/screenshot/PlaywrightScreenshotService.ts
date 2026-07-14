import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoundingBoxDTO } from '@shared/types';
import type { CaptureOptions, IBrowserPage, IScreenshotService, ILogger } from '@core/domain/ports';
import {
  drawOverlay,
  measureForShot,
  removeOverlay,
  type ShotMeasureInput,
  type ShotMeasureResult
} from '@infra/browser/domScripts';

export class PlaywrightScreenshotService implements IScreenshotService {
  constructor(
    private readonly baseDir: string,
    private readonly logger: ILogger
  ) {}

  private sanitize(label: string): string {
    return label.replace(/[^a-z0-9-_]/gi, '_').slice(0, 60);
  }

  async capture(
    page: IBrowserPage,
    options: CaptureOptions
  ): Promise<{ path: string; box: BoundingBoxDTO | null }> {
    const dir = join(this.baseDir, options.scanId);
    await mkdir(dir, { recursive: true });
    const fileName = `${String(options.index).padStart(3, '0')}-${this.sanitize(options.label)}.png`;
    const filePath = join(dir, fileName);

    let overlayId: string | null = null;
    try {
      if (options.box) {
        let viewportBox: BoundingBoxDTO | null = null;

        if (options.cssSelector) {
          // Re-measure the element live. This handles nested scroll containers,
          // sticky positioning and carousels that moved since the scan.
          const measured = await page.evaluate<ShotMeasureResult, ShotMeasureInput>(measureForShot, {
            selector: options.cssSelector,
            scroll: options.skipScroll !== true
          });

          if (measured.state === 'ok') {
            viewportBox = measured.box;
          } else {
            // The element is gone or not visible right now (collapsed menu, rotated
            // carousel slide, off-screen). Drawing the stored rectangle would mark an
            // empty area, so we skip the screenshot instead of producing a misleading one.
            this.logger.warn(`Screenshot skipped (${options.label}): element ${measured.state}`);
            return { path: '', box: null };
          }
        } else {
          // No selector available: fall back to the stored page-absolute box,
          // adjusted by the scroll position actually reached.
          const box = options.box;
          const targetY = Math.max(0, box.y - 100);
          const scroll = await page.evaluate((y: number) => {
            window.scrollTo(0, y);
            return { x: window.scrollX || 0, y: window.scrollY || 0 };
          }, targetY);
          viewportBox = { x: box.x - scroll.x, y: box.y - scroll.y, width: box.width, height: box.height };
        }

        overlayId = await page.evaluate(drawOverlay, { box: viewportBox, label: `#${options.index}` });
      }
      const buffer = await page.screenshotViewport();
      await writeFile(filePath, buffer);
    } catch (error) {
      this.logger.warn(`Could not take screenshot (${options.label})`, error);
    } finally {
      if (overlayId) {
        await page.evaluate(removeOverlay, overlayId).catch(() => undefined);
      }
    }

    return { path: filePath, box: options.box };
  }
}
