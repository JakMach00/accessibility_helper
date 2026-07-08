import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { AuditContext, IBrowserPage, ILogger, IScreenshotService } from '@core/domain/ports';
import { PlaywrightBrowserPage } from '@infra/browser/PlaywrightBrowserSession';
import { WcagScanModule } from '@infra/modules/WcagScanModule';
import { KeyboardNavigationModule } from '@infra/modules/KeyboardNavigationModule';
import { ZoomReflowModule } from '@infra/modules/ZoomReflowModule';
import { ContrastModule } from '@infra/modules/ContrastModule';
import { AriaModule } from '@infra/modules/AriaModule';
import { NvdaModule } from '@infra/modules/NvdaModule';

// The tests run the modules on real, headless Chromium against HTML fixtures
// z celowo zasianymi problemami. Wymagaja zainstalowanego Chromium dla Playwright
// (npx playwright install chromium). Uruchamiane osobno: npm run test:e2e.

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

const fakeShots: IScreenshotService = {
  async capture() {
    return { path: '', box: null };
  }
};

function ctx(page: IBrowserPage): AuditContext {
  return { scanId: 'e2e', page, screenshots: fakeShots, logger: silentLogger, signal: new AbortController().signal };
}

const fixtureUrl = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).href;

function criteriaOf(issues: Array<{ wcagReferences: Array<{ criterion: string }> }>): string[] {
  return issues.flatMap((i) => i.wcagReferences.map((r) => r.criterion));
}

describe('E2E: audit modules on real Chromium', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60000);

  afterAll(async () => {
    await browser?.close();
  });

  async function withPage(fixture: string, fn: (page: IBrowserPage) => Promise<void>): Promise<void> {
    const raw: Page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
    try {
      await raw.goto(fixtureUrl(fixture), { waitUntil: 'domcontentloaded' });
      await fn(new PlaywrightBrowserPage(raw, silentLogger));
    } finally {
      await raw.close();
    }
  }

  it('WCAG Scan (axe) wykrywa naruszenia na stronie', async () => {
    await withPage('a11y-issues.html', async (page) => {
      const result = await new WcagScanModule().run(ctx(page));
      expect(result.issues.length).toBeGreaterThanOrEqual(2); // m.in. brak alt i pusty przycisk
      expect(result.status).toBe('fail');
    });
  }, 60000);

  it('Keyboard detects a clickable non-focusable element and a positive tabindex', async () => {
    await withPage('a11y-issues.html', async (page) => {
      const result = await new KeyboardNavigationModule().run(ctx(page));
      const crits = criteriaOf(result.issues);
      expect(crits).toContain('2.1.1');
      expect(crits).toContain('2.4.3');
    });
  }, 60000);

  it('ARIA wykrywa nieprawidlowa role i zepsuta referencje', async () => {
    await withPage('a11y-issues.html', async (page) => {
      const result = await new AriaModule().run(ctx(page));
      const crits = criteriaOf(result.issues);
      expect(crits).toContain('4.1.2');
      expect(crits).toContain('1.3.1');
    });
  }, 60000);

  it('Zoom detects zoom blocking', async () => {
    await withPage('a11y-issues.html', async (page) => {
      const result = await new ZoomReflowModule().run(ctx(page));
      const crits = criteriaOf(result.issues);
      expect(crits).toContain('1.4.4');
    });
  }, 60000);

  it('Contrast detects a contrast drop in the hover state', async () => {
    await withPage('a11y-issues.html', async (page) => {
      const result = await new ContrastModule().run(ctx(page));
      const crits = criteriaOf(result.issues);
      expect(crits).toContain('1.4.3');
    });
  }, 60000);

  it('NVDA provides the reading-order preview and detects a heading skip', async () => {
    await withPage('a11y-issues.html', async (page) => {
      const result = await new NvdaModule().run(ctx(page));
      const titles = result.issues.map((i) => i.title);
      expect(titles.some((t) => t.includes('Reading-order preview'))).toBe(true);
      expect(titles.some((t) => t.includes('Heading level skip'))).toBe(true);
    });
  }, 60000);

  it('axe dziala mimo restrykcyjnego CSP (wstrzykniecie przez CDP omija CSP)', async () => {
    await withPage('csp-locked.html', async (page) => {
      const result = await new WcagScanModule().run(ctx(page));
      // If axe were injected via <script>, CSP would block it and the result would be empty/error.
      expect(result.issues.length).toBeGreaterThan(0);
    });
  }, 60000);
});
