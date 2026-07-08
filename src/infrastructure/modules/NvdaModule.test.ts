import { describe, expect, it } from 'vitest';
import type { BoundingBoxDTO, ViewportDTO } from '@shared/types';
import type { AuditContext, IBrowserPage, ILogger, IScreenshotService } from '@core/domain/ports';
import { buildAccessibilityTree, type AxLine, type AxTree } from '@infra/browser/nvdaScripts';
import { NvdaModule } from './NvdaModule';

const BOX: BoundingBoxDTO = { x: 0, y: 0, width: 40, height: 20 };

function node(partial: Partial<AxLine> & { role: string }): AxLine {
  return {
    role: partial.role,
    name: partial.name ?? '',
    level: partial.level ?? null,
    interactive: partial.interactive ?? false,
    focusable: partial.focusable ?? false,
    cssSelector: partial.cssSelector ?? 'x',
    box: partial.box ?? null,
    html: partial.html ?? '<x>'
  };
}

class FakePage implements IBrowserPage {
  constructor(private readonly tree: AxTree) {}

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
    if (f === buildAccessibilityTree) return this.tree as unknown as R;
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

describe('NvdaModule', () => {
  it('detects an unnamed control and a heading skip and provides a preview', async () => {
    const tree: AxTree = {
      headingCount: 2,
      landmarkCount: 0,
      interactiveWithoutName: 1,
      nodes: [
        node({ role: 'heading', level: 1, name: 'Start', cssSelector: 'h1:nth-of-type(1)', box: BOX }),
        node({ role: 'heading', level: 3, name: 'Sekcja', cssSelector: 'h3:nth-of-type(1)', box: BOX }),
        node({ role: 'button', name: '', interactive: true, focusable: true, cssSelector: 'button:nth-of-type(1)', box: BOX }),
        node({ role: 'link', name: 'Kontakt', interactive: true, focusable: true, cssSelector: 'a:nth-of-type(1)', box: BOX })
      ]
    };
    const result = await new NvdaModule().run(makeContext(new FakePage(tree)));

    const titles = result.issues.map((i) => i.title);
    expect(titles.some((t) => t.includes('Reading-order preview'))).toBe(true);
    expect(titles.some((t) => t.includes('without an accessible name'))).toBe(true);
    expect(titles.some((t) => t.includes('Heading level skip'))).toBe(true);
    expect(result.issues.some((i) => i.wcagReferences.some((r) => r.criterion === '4.1.2'))).toBe(true);
    expect(result.status).toBe('needs-review');
  });

  it('for a correct structure returns only the reading-order preview', async () => {
    const tree: AxTree = {
      headingCount: 2,
      landmarkCount: 1,
      interactiveWithoutName: 0,
      nodes: [
        node({ role: 'heading', level: 1, name: 'Start' }),
        node({ role: 'heading', level: 2, name: 'Sekcja' }),
        node({ role: 'link', name: 'Kontakt', interactive: true, focusable: true }),
        node({ role: 'button', name: 'Wyslij', interactive: true, focusable: true })
      ]
    };
    const result = await new NvdaModule().run(makeContext(new FakePage(tree)));

    // Preview only (NVDA always needs manual verification), no structural errors.
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.title).toContain('Reading-order preview');
    expect(result.status).toBe('needs-review');
  });
});
