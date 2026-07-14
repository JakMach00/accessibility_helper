import { describe, expect, it } from 'vitest';
import type { BoundingBoxDTO, ViewportDTO } from '@shared/types';
import type { AuditContext, IBrowserPage, ILogger, IScreenshotService } from '@core/domain/ports';
import {
  collectDynamicCandidates,
  measureReveal,
  snapshotVisible,
  waitForReveal,
  type DynamicScanReport,
  type RevealResult,
  type RevealSnapshot
} from '@infra/browser/dynamicScripts';
import { DynamicContentModule } from './DynamicContentModule';

const BOX: BoundingBoxDTO = { x: 10, y: 20, width: 120, height: 40 };
const EMPTY_SNAPSHOT: RevealSnapshot = { visibleCount: 5, signature: 'A|B' };

class FakePage implements IBrowserPage {
  hovered: string[] = [];
  mouseMovedAway = 0;

  constructor(
    private readonly report: DynamicScanReport,
    private readonly reveals: Record<string, RevealResult>
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
    if (f === collectDynamicCandidates) return this.report as unknown as R;
    if (f === snapshotVisible) return EMPTY_SNAPSHOT as unknown as R;
    if (f === measureReveal) {
      const input = arg as unknown as { triggerSelector: string };
      const result = this.reveals[input.triggerSelector] ?? {
        revealed: false,
        revealedText: '',
        revealedSelector: '',
        revealedBox: null,
        expandedAfter: null,
        inTriggerSubtree: false
      };
      return result as unknown as R;
    }
    if (f === waitForReveal) return undefined as unknown as R;
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
  async hover(cssSelector: string): Promise<void> {
    this.hovered.push(cssSelector);
  }
  async moveMouseAway(): Promise<void> {
    this.mouseMovedAway += 1;
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

function ctx(page: IBrowserPage): AuditContext {
  return {
    scanId: 'test',
    page,
    screenshots: new FakeShots(),
    logger: silentLogger,
    signal: new AbortController().signal
  };
}

const revealed = (selector: string): RevealResult => ({
  revealed: true,
  revealedText: 'Submenu item one',
  revealedSelector: `${selector} ul`,
  revealedBox: BOX,
  expandedAfter: null,
  inTriggerSubtree: true
});

describe('DynamicContentModule', () => {
  it('reports hover content whose trigger is not keyboard focusable', async () => {
    const report: DynamicScanReport = {
      totalConsidered: 1,
      candidates: [
        {
          cssSelector: 'div.menu',
          tag: 'div',
          text: 'Products',
          html: '<div class="menu">Products</div>',
          box: BOX,
          focusable: false,
          hasPopupAttr: false,
          expandedBefore: null
        }
      ]
    };
    const page = new FakePage(report, { 'div.menu': revealed('div.menu') });
    const result = await new DynamicContentModule().run(ctx(page));

    expect(page.hovered).toContain('div.menu');
    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0]!;
    expect(issue.severity).toBe('serious');
    expect(issue.status).toBe('fail');
    expect(issue.wcagReferences.map((r) => r.criterion)).toContain('2.1.1');
  });

  it('flags focusable hover content that lacks popup semantics for review', async () => {
    const report: DynamicScanReport = {
      totalConsidered: 1,
      candidates: [
        {
          cssSelector: 'a.nav',
          tag: 'a',
          text: 'Banking',
          html: '<a class="nav" href="#">Banking</a>',
          box: BOX,
          focusable: true,
          hasPopupAttr: false,
          expandedBefore: null
        }
      ]
    };
    const page = new FakePage(report, { 'a.nav': revealed('a.nav') });
    const result = await new DynamicContentModule().run(ctx(page));

    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0]!;
    expect(issue.status).toBe('needs-review');
    expect(issue.wcagReferences.map((r) => r.criterion)).toContain('1.4.13');
  });

  it('reports nothing when a focusable trigger declares popup semantics', async () => {
    const report: DynamicScanReport = {
      totalConsidered: 1,
      candidates: [
        {
          cssSelector: 'button.ok',
          tag: 'button',
          text: 'Menu',
          html: '<button class="ok" aria-haspopup="true">Menu</button>',
          box: BOX,
          focusable: true,
          hasPopupAttr: true,
          expandedBefore: 'false'
        }
      ]
    };
    const page = new FakePage(report, { 'button.ok': revealed('button.ok') });
    const result = await new DynamicContentModule().run(ctx(page));

    expect(result.issues).toHaveLength(0);
    expect(result.status).toBe('pass');
  });

  it('reports nothing when hovering reveals no new content', async () => {
    const report: DynamicScanReport = {
      totalConsidered: 1,
      candidates: [
        {
          cssSelector: 'a.plain',
          tag: 'a',
          text: 'Home',
          html: '<a class="plain" href="#">Home</a>',
          box: BOX,
          focusable: true,
          hasPopupAttr: false,
          expandedBefore: null
        }
      ]
    };
    const page = new FakePage(report, {});
    const result = await new DynamicContentModule().run(ctx(page));

    expect(result.issues).toHaveLength(0);
  });
});

describe('DynamicContentModule pointer handling', () => {
  it('moves the pointer away before every probe so an open menu cannot block the next one', async () => {
    const candidate = (selector: string, text: string) => ({
      cssSelector: selector,
      tag: 'a',
      text,
      html: `<a href="#">${text}</a>`,
      box: BOX,
      focusable: false,
      hasPopupAttr: false,
      expandedBefore: null
    });
    const report: DynamicScanReport = {
      totalConsidered: 3,
      candidates: [candidate('a.one', 'One'), candidate('a.two', 'Two'), candidate('a.three', 'Three')]
    };
    const page = new FakePage(report, {
      'a.one': revealed('a.one'),
      'a.two': revealed('a.two'),
      'a.three': revealed('a.three')
    });

    const result = await new DynamicContentModule().run(ctx(page));

    // Every candidate is probed, not just the first one.
    expect(page.hovered).toEqual(['a.one', 'a.two', 'a.three']);
    expect(page.mouseMovedAway).toBe(3);
    expect(result.issues).toHaveLength(3);
  });
});
