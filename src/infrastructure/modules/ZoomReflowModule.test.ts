import { describe, expect, it } from 'vitest';
import type { BoundingBoxDTO, ViewportDTO } from '@shared/types';
import type { AuditContext, IBrowserPage, ILogger, IScreenshotService } from '@core/domain/ports';
import {
  measureOverflow,
  readViewportMeta,
  type OverflowReport,
  type ViewportMetaInfo
} from '@infra/browser/reflowScripts';
import { ZoomReflowModule } from './ZoomReflowModule';

const EMPTY_REPORT: OverflowReport = {
  scrollWidth: 320,
  clientWidth: 320,
  scrollHeight: 600,
  clientHeight: 256,
  overflowX: 0,
  elements: []
};

class FakePage implements IBrowserPage {
  constructor(
    private readonly meta: ViewportMetaInfo,
    private readonly overflowQueue: OverflowReport[]
  ) {}

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
  async evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, _arg?: A): Promise<R> {
    const f = fn as unknown;
    if (f === readViewportMeta) return this.meta as unknown as R;
    if (f === measureOverflow) {
      const next = this.overflowQueue.shift() ?? EMPTY_REPORT;
      return next as unknown as R;
    }
    return undefined as unknown as R;
  }
  async addScriptTag(): Promise<void> {}
  async pressKey(): Promise<void> {}
  async screenshotViewport(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async screenshotClip(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async forcePseudoStates(): Promise<void> {}
}

class FakeShots implements IScreenshotService {
  async capture(): Promise<{ path: string; box: BoundingBoxDTO | null }> {
    return { path: '/tmp/shot.png', box: null };
  }
}

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

function makeContext(page: IBrowserPage): AuditContext {
  return {
    scanId: 'test-scan',
    page,
    screenshots: new FakeShots(),
    logger: silentLogger,
    signal: new AbortController().signal
  };
}

const BOX: BoundingBoxDTO = { x: 0, y: 0, width: 500, height: 20 };

describe('ZoomReflowModule', () => {
  it('detects zoom blocking and missing reflow', async () => {
    const meta: ViewportMetaInfo = {
      hasMeta: true,
      content: 'width=device-width, user-scalable=no',
      userScalableNo: true,
      maximumScale: null
    };
    const report200: OverflowReport = {
      scrollWidth: 700,
      clientWidth: 640,
      scrollHeight: 900,
      clientHeight: 512,
      overflowX: 60,
      elements: [
        { tag: 'div', cssSelector: 'div:nth-of-type(1)', html: '<div>', right: 700, width: 700, box: BOX }
      ]
    };
    const report400: OverflowReport = {
      scrollWidth: 620,
      clientWidth: 320,
      scrollHeight: 1200,
      clientHeight: 256,
      overflowX: 300,
      elements: [
        { tag: 'table', cssSelector: 'table:nth-of-type(1)', html: '<table>', right: 620, width: 620, box: BOX }
      ]
    };

    // Measurement order: 200% first, then 400%.
    const page = new FakePage(meta, [report200, report400]);
    const result = await new ZoomReflowModule().run(makeContext(page));

    const hasCriterion = (crit: string, status?: string) =>
      result.issues.some(
        (i) => i.wcagReferences.some((r) => r.criterion === crit) && (status ? i.status === status : true)
      );

    expect(hasCriterion('1.4.4', 'fail')).toBe(true); // zoom blocking
    expect(hasCriterion('1.4.10', 'needs-review')).toBe(true); // missing reflow
    expect(result.status).toBe('fail');
    expect(result.metadata['overflowX400']).toBe(300);
  });

  it('reports no issues for a page with correct reflow', async () => {
    const meta: ViewportMetaInfo = {
      hasMeta: true,
      content: 'width=device-width, initial-scale=1',
      userScalableNo: false,
      maximumScale: null
    };
    const page = new FakePage(meta, [EMPTY_REPORT, EMPTY_REPORT]);
    const result = await new ZoomReflowModule().run(makeContext(page));

    expect(result.issues).toHaveLength(0);
    expect(result.status).toBe('pass');
  });
});
