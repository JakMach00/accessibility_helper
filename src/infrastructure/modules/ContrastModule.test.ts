import { describe, expect, it } from 'vitest';
import type { BoundingBoxDTO, ViewportDTO } from '@shared/types';
import type { AuditContext, IBrowserPage, ILogger, IScreenshotService } from '@core/domain/ports';
import {
  cleanupContrastMarkers,
  measureContrastAt,
  prepareContrastCandidates,
  type ContrastCandidate,
  type ContrastMeasurement
} from '@infra/browser/contrastScripts';
import { ContrastModule } from './ContrastModule';

const BOX: BoundingBoxDTO = { x: 0, y: 0, width: 100, height: 20 };

function measurement(ratio: number, isLargeText = false): ContrastMeasurement {
  return {
    ratio,
    fg: 'rgb(0, 0, 0)',
    bg: 'rgb(255, 255, 255)',
    hasBgImage: false,
    isLargeText,
    fontSizePx: 16,
    fontWeight: 400
  };
}

class FakePage implements IBrowserPage {
  private forced: string | null = null;
  constructor(
    private readonly candidates: ContrastCandidate[],
    private readonly measurements: Record<string, ContrastMeasurement | null>
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
  async evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    const f = fn as unknown;
    if (f === prepareContrastCandidates) return this.candidates as unknown as R;
    if (f === measureContrastAt) {
      const a = arg as unknown as { selector?: string } | undefined;
      const selector = a?.selector ?? '';
      const key = `${selector}::${this.forced ?? 'default'}`;
      return (this.measurements[key] ?? null) as unknown as R;
    }
    if (f === cleanupContrastMarkers) return 0 as unknown as R;
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
  async forcePseudoStates(_cssSelector: string, states: Array<'hover' | 'focus' | 'active'>): Promise<void> {
    this.forced = states[0] ?? null;
  }
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

const CANDIDATE: ContrastCandidate = {
  index: 0,
  tag: 'a',
  role: null,
  cssSelector: 'a:nth-of-type(1)',
  html: '<a href="/">Link</a>',
  text: 'Link',
  box: BOX
};

describe('ContrastModule', () => {
  it('reports a contrast drop in the :hover state', async () => {
    const measurements: Record<string, ContrastMeasurement | null> = {
      '[data-wcag-ct="0"]::default': measurement(7),
      '[data-wcag-ct="0"]::focus': measurement(6.5), // wciaz OK
      '[data-wcag-ct="0"]::hover': measurement(2.0) // spadek ponizej 4.5
    };
    const page = new FakePage([CANDIDATE], measurements);
    const result = await new ContrastModule().run(makeContext(page));

    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0];
    expect(issue?.wcagReferences.some((r) => r.criterion === '1.4.3')).toBe(true);
    expect(issue?.status).toBe('needs-review');
    expect(issue?.extra['state']).toBe('hover');
    expect(result.status).toBe('needs-review');
  });

  it('does not report when contrast does not degrade in states', async () => {
    const measurements: Record<string, ContrastMeasurement | null> = {
      '[data-wcag-ct="0"]::default': measurement(7),
      '[data-wcag-ct="0"]::focus': measurement(7),
      '[data-wcag-ct="0"]::hover': measurement(7)
    };
    const page = new FakePage([CANDIDATE], measurements);
    const result = await new ContrastModule().run(makeContext(page));

    expect(result.issues).toHaveLength(0);
    expect(result.status).toBe('pass');
  });
});
