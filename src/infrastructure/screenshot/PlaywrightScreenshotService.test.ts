import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoundingBoxDTO, ViewportDTO } from '@shared/types';
import type { IBrowserPage, ILogger } from '@core/domain/ports';
import { drawOverlay, measureForShot, removeOverlay, type ShotMeasureResult } from '@infra/browser/domScripts';
import { PlaywrightScreenshotService } from './PlaywrightScreenshotService';

const STORED_BOX: BoundingBoxDTO = { x: 100, y: 900, width: 50, height: 20 };
const LIVE_BOX: BoundingBoxDTO = { x: 30, y: 40, width: 50, height: 20 };

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

class FakePage implements IBrowserPage {
  overlayBoxes: BoundingBoxDTO[] = [];
  scrolledTo: number[] = [];
  screenshots = 0;

  constructor(private readonly measure: ShotMeasureResult) {}

  url(): string {
    return 'https://example.com';
  }
  async title(): Promise<string> {
    return 'Example';
  }
  viewport(): ViewportDTO {
    return { width: 1280, height: 1024 };
  }
  async setViewport(): Promise<void> {}
  async evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    const f = fn as unknown;
    if (f === measureForShot) return this.measure as unknown as R;
    if (f === drawOverlay) {
      const input = arg as unknown as { box: BoundingBoxDTO };
      this.overlayBoxes.push(input.box);
      return 'overlay-1' as unknown as R;
    }
    if (f === removeOverlay) return undefined as unknown as R;
    // The fallback path calls an inline function with the scroll target.
    if (typeof arg === 'number') {
      this.scrolledTo.push(arg);
      return { x: 0, y: arg } as unknown as R;
    }
    return undefined as unknown as R;
  }
  async addScriptTag(): Promise<void> {}
  async pressKey(): Promise<void> {}
  async screenshotViewport(): Promise<Uint8Array> {
    this.screenshots += 1;
    return new Uint8Array([1, 2, 3]);
  }
  async screenshotClip(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async forcePseudoStates(): Promise<void> {}
}

describe('PlaywrightScreenshotService', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wcag-shot-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('annotates the element at its live viewport position', async () => {
    const page = new FakePage({ state: 'ok', box: LIVE_BOX });
    const service = new PlaywrightScreenshotService(dir, silentLogger);

    const result = await service.capture(page, {
      scanId: 'scan1',
      label: 'test',
      index: 1,
      box: STORED_BOX,
      cssSelector: '.target'
    });

    expect(page.overlayBoxes).toEqual([LIVE_BOX]);
    expect(result.path).not.toBe('');
    expect(await readdir(join(dir, 'scan1'))).toHaveLength(1);
  });

  it('skips the screenshot when the element is hidden, instead of marking a stale box', async () => {
    const page = new FakePage({ state: 'hidden' });
    const service = new PlaywrightScreenshotService(dir, silentLogger);

    const result = await service.capture(page, {
      scanId: 'scan2',
      label: 'carousel',
      index: 31,
      box: STORED_BOX,
      cssSelector: '.rotated-slide'
    });

    expect(result.path).toBe('');
    expect(result.box).toBeNull();
    expect(page.overlayBoxes).toEqual([]); // no rectangle over an empty area
    expect(page.screenshots).toBe(0);
  });

  it('skips the screenshot when the element no longer exists', async () => {
    const page = new FakePage({ state: 'missing' });
    const service = new PlaywrightScreenshotService(dir, silentLogger);

    const result = await service.capture(page, {
      scanId: 'scan3',
      label: 'gone',
      index: 2,
      box: STORED_BOX,
      cssSelector: '.gone'
    });

    expect(result.path).toBe('');
    expect(page.overlayBoxes).toEqual([]);
  });

  it('falls back to the stored box adjusted by scroll when no selector is available', async () => {
    const page = new FakePage({ state: 'missing' });
    const service = new PlaywrightScreenshotService(dir, silentLogger);

    await service.capture(page, {
      scanId: 'scan4',
      label: 'no-selector',
      index: 3,
      box: STORED_BOX
    });

    expect(page.scrolledTo).toEqual([800]); // box.y - 100
    expect(page.overlayBoxes).toEqual([{ x: 100, y: 100, width: 50, height: 20 }]);
  });

  it('takes a plain viewport screenshot when no annotation is requested', async () => {
    const page = new FakePage({ state: 'missing' });
    const service = new PlaywrightScreenshotService(dir, silentLogger);

    const result = await service.capture(page, { scanId: 'scan5', label: 'reference', index: 1, box: null });

    expect(result.path).not.toBe('');
    expect(page.overlayBoxes).toEqual([]);
    expect(page.screenshots).toBe(1);
  });
});
