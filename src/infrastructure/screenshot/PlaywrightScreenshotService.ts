import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoundingBoxDTO } from '@shared/types';
import type { CaptureOptions, IBrowserPage, IScreenshotService, ILogger } from '@core/domain/ports';
import { drawOverlay, removeOverlay } from '@infra/browser/domScripts';

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

        // Preferred path: re-measure the element live. scrollIntoView handles nested
        // scroll containers, sticky and fixed positioning; getBoundingClientRect then
        // returns the true viewport rectangle, so the overlay lands exactly on it.
        if (options.cssSelector) {
          viewportBox = await page.evaluate((selector: string) => {
            const el = selector ? (document.querySelector(selector) as HTMLElement | null) : null;
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return null;
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          }, options.cssSelector);
        }

        // Fallback: use the stored page-absolute box adjusted by the actual scroll.
        if (!viewportBox) {
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
