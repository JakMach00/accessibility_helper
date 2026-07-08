import { describe, expect, it } from 'vitest';
import type { BoundingBoxDTO, ViewportDTO } from '@shared/types';
import type { AuditContext, IBrowserPage, ILogger, IScreenshotService } from '@core/domain/ports';
import { collectAriaFindings, type AriaReport } from '@infra/browser/ariaScripts';
import { AriaModule } from './AriaModule';

const BOX: BoundingBoxDTO = { x: 0, y: 0, width: 40, height: 20 };

class FakePage implements IBrowserPage {
  constructor(private readonly report: AriaReport) {}

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
    if (f === collectAriaFindings) return this.report as unknown as R;
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
    return { path: '/tmp/shot.png', box: BOX };
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

describe('AriaModule', () => {
  it('maps ARIA findings to WCAG issues', async () => {
    const report: AriaReport = {
      elementsWithRole: 5,
      findings: [
        {
          kind: 'invalid-role',
          role: 'buton',
          detail: 'Unknown ARIA role "buton"',
          cssSelector: 'div:nth-of-type(1)',
          html: '<div role="buton">',
          box: BOX
        },
        {
          kind: 'broken-ref',
          role: null,
          detail: 'aria-labelledby points to a non-existent id: heading',
          cssSelector: 'section:nth-of-type(1)',
          html: '<section aria-labelledby="heading">',
          box: BOX
        },
        {
          kind: 'missing-name',
          role: 'button',
          detail: 'Role "button" requires an accessible name',
          cssSelector: 'span:nth-of-type(1)',
          html: '<span role="button">',
          box: null
        }
      ]
    };
    const result = await new AriaModule().run(makeContext(new FakePage(report)));

    const hasCriterion = (crit: string, status?: string) =>
      result.issues.some(
        (i) => i.wcagReferences.some((r) => r.criterion === crit) && (status ? i.status === status : true)
      );

    expect(result.issues).toHaveLength(3);
    expect(hasCriterion('4.1.2', 'fail')).toBe(true); // nieprawidlowa rola
    expect(hasCriterion('1.3.1', 'fail')).toBe(true); // zepsuta referencja
    expect(hasCriterion('4.1.2', 'needs-review')).toBe(true); // missing name
    expect(result.status).toBe('fail');
  });

  it('returns pass for a page without ARIA issues', async () => {
    const report: AriaReport = { elementsWithRole: 3, findings: [] };
    const result = await new AriaModule().run(makeContext(new FakePage(report)));

    expect(result.issues).toHaveLength(0);
    expect(result.status).toBe('pass');
  });
});
