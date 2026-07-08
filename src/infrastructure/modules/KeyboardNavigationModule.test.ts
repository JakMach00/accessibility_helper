import { describe, expect, it } from 'vitest';
import type { BoundingBoxDTO, ViewportDTO } from '@shared/types';
import type { AuditContext, IBrowserPage, ILogger, IScreenshotService } from '@core/domain/ports';
import {
  activeElementSignature,
  cleanupKeyboardMarkers,
  collectKeyboardData,
  resetFocusToTop,
  type ActiveSignature,
  type KeyboardData
} from '@infra/browser/keyboardScripts';
import { KeyboardNavigationModule } from './KeyboardNavigationModule';

const BOX: BoundingBoxDTO = { x: 0, y: 0, width: 10, height: 10 };

// Fake page: recognizes functions by reference and returns prepared data.
class FakePage implements IBrowserPage {
  private tabStep = 0;
  constructor(
    private readonly data: KeyboardData,
    private readonly tabSequence: Array<number | null>
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
    if (f === collectKeyboardData) return this.data as unknown as R;
    if (f === activeElementSignature) {
      const idx = this.tabSequence[this.tabStep] ?? null;
      this.tabStep += 1;
      const sig: ActiveSignature = { kbdIndex: idx, tag: 'x', isBody: idx === null };
      return sig as unknown as R;
    }
    if (f === resetFocusToTop) {
      this.tabStep = 0;
      return true as unknown as R;
    }
    if (f === cleanupKeyboardMarkers) return 0 as unknown as R;
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

describe('KeyboardNavigationModule', () => {
  it('detects the main keyboard accessibility issues', async () => {
    const data: KeyboardData = {
      focusables: [
        {
          index: 0,
          tag: 'a',
          role: null,
          tabindex: null,
          name: 'Home',
          visible: true,
          box: BOX,
          cssSelector: 'a:nth-of-type(1)',
          html: '<a href="/">Home</a>'
        },
        {
          index: 1,
          tag: 'div',
          role: 'button',
          tabindex: 5, // dodatni tabindex
          name: 'Menu',
          visible: true,
          box: BOX,
          cssSelector: 'div:nth-of-type(1)',
          html: '<div tabindex="5" role="button">Menu</div>'
        },
        {
          index: 2,
          tag: 'input',
          role: null,
          tabindex: null,
          name: '',
          visible: false, // focusable but not visible
          box: BOX,
          cssSelector: 'input:nth-of-type(1)',
          html: '<input>'
        }
      ],
      clickables: [
        {
          tag: 'div',
          role: 'button',
          reason: 'Element with a click handler is not reachable by keyboard (no tabindex)',
          box: BOX,
          cssSelector: 'div:nth-of-type(2)',
          html: '<div onclick="x()">Klik</div>'
        }
      ],
      nav: { hasMain: true, landmarkCount: 4, headingCount: 3, hasSkipLink: false, skipLinkText: '' },
      focusStyles: [
        { index: 0, changed: true, focusableConfirmed: true }, // has a visible focus indicator
        { index: 1, changed: false, focusableConfirmed: true } // no visible focus indicator
      ]
    };

    // The Tab sequence sticks on element 1 (focus trap).
    const page = new FakePage(data, [0, 1, 1, 1, 1, 1, 1]);
    const result = await new KeyboardNavigationModule().run(makeContext(page));

    const hasCriterion = (crit: string, status?: string) =>
      result.issues.some(
        (i) => i.wcagReferences.some((r) => r.criterion === crit) && (status ? i.status === status : true)
      );

    expect(hasCriterion('2.1.1', 'fail')).toBe(true); // clickable non-focusable
    expect(hasCriterion('2.4.3', 'fail')).toBe(true); // dodatni tabindex
    expect(hasCriterion('2.4.7', 'needs-review')).toBe(true); // no visible focus indicator
    expect(hasCriterion('2.4.1', 'needs-review')).toBe(true); // missing skip link
    expect(hasCriterion('2.1.2', 'needs-review')).toBe(true); // focus trap
    expect(result.status).toBe('fail'); // sa twarde bledy
    expect(result.metadata['focusableCount']).toBe(3);
  });

  it('does not report a trap for a correct Tab sequence', async () => {
    const data: KeyboardData = {
      focusables: [
        {
          index: 0,
          tag: 'a',
          role: null,
          tabindex: null,
          name: 'A',
          visible: true,
          box: BOX,
          cssSelector: 'a:nth-of-type(1)',
          html: '<a>'
        },
        {
          index: 1,
          tag: 'button',
          role: null,
          tabindex: null,
          name: 'B',
          visible: true,
          box: BOX,
          cssSelector: 'button:nth-of-type(1)',
          html: '<button>'
        }
      ],
      clickables: [],
      nav: { hasMain: false, landmarkCount: 0, headingCount: 1, hasSkipLink: false, skipLinkText: '' },
      focusStyles: [
        { index: 0, changed: true, focusableConfirmed: true },
        { index: 1, changed: true, focusableConfirmed: true }
      ]
    };

    // Focus goes 0 -> 1 -> out (null), without sticking.
    const page = new FakePage(data, [0, 1, null, 0, 1, null]);
    const result = await new KeyboardNavigationModule().run(makeContext(page));

    const trap = result.issues.some((i) => i.wcagReferences.some((r) => r.criterion === '2.1.2'));
    expect(trap).toBe(false);
    // No hard errors and nothing to review -> pass status.
    expect(result.status).toBe('pass');
  });
});
