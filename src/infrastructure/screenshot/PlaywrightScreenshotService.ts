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
        const box = options.box;
        // Scroll the element into view and read the ACTUAL scroll (may be clamped near the page end).
        const targetY = Math.max(0, box.y - 100);
        const scroll = await page.evaluate((y: number) => {
          window.scrollTo(0, y);
          return { x: window.scrollX || 0, y: window.scrollY || 0 };
        }, targetY);
        // Nakladka jest position:fixed, wiec podajemy wspolrzedne wzgledem viewportu.
        const viewportBox = {
          x: box.x - scroll.x,
          y: box.y - scroll.y,
          width: box.width,
          height: box.height
        };
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
