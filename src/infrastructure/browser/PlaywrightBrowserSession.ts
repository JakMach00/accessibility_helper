import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import type { BoundingBoxDTO, BrowserInfoDTO, BrowserTargetDTO, ConnectOptions, ViewportDTO } from '@shared/types';
import type { IBrowserPage, IBrowserSession, ILogger } from '@core/domain/ports';
import { findBrowserExecutable, friendlyBrowserName } from './browserDetection';
import {
  browserNotFoundMessage,
  bundledLaunchErrorMessage,
  connectionErrorMessage,
  launchTimeoutMessage,
  navigationErrorMessage
} from './browserErrors';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:9222';
const DEBUG_PORT = 9222;

// Single-page adapter. Hides Playwright and CDP behind the IBrowserPage port.
export class PlaywrightBrowserPage implements IBrowserPage {
  private cdp: CDPSession | null = null;

  constructor(
    private readonly page: Page,
    private readonly logger: ILogger
  ) {}

  private async cdpSession(): Promise<CDPSession> {
    if (!this.cdp) {
      this.cdp = await this.page.context().newCDPSession(this.page);
    }
    return this.cdp;
  }

  raw(): Page {
    return this.page;
  }

  url(): string {
    return this.page.url();
  }

  title(): Promise<string> {
    return this.page.title().catch(() => '');
  }

  viewport(): ViewportDTO {
    const size = this.page.viewportSize();
    return size ? { width: size.width, height: size.height } : { width: 1280, height: 1024 };
  }

  async setViewport(width: number, height: number): Promise<void> {
    // CDP is more reliable than setViewportSize for a browser attached over CDP.
    const session = await this.cdpSession();
    await session.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
  }

  evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    // Playwright expects PageFunction<Unboxed<A>, R>; our signature is simpler.
    // At the adapter boundary we cast through unknown; runtime behaviour is identical.
    const evaluate = this.page.evaluate.bind(this.page) as unknown as (
      pageFunction: (arg: A) => R | Promise<R>,
      arg?: A
    ) => Promise<R>;
    return evaluate(fn, arg);
  }

  async addScriptTag(content: string): Promise<void> {
    // We inject via CDP Runtime.evaluate instead of a <script> element, because it
    // bypasses the page Content-Security-Policy (common on banking/corporate sites).
    // An injected <script> would be blocked by CSP and axe-core would not run.
    try {
      const session = await this.cdpSession();
      await session.send('Runtime.evaluate', { expression: content, returnByValue: false });
    } catch (error) {
      this.logger.warn('Script injection over CDP failed, trying <script>', error);
      await this.page.addScriptTag({ content });
    }
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async screenshotViewport(): Promise<Uint8Array> {
    return this.page.screenshot({ type: 'png' });
  }

  async screenshotClip(box: BoundingBoxDTO): Promise<Uint8Array> {
    return this.page.screenshot({
      type: 'png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height }
    });
  }

  async forcePseudoStates(cssSelector: string, states: Array<'hover' | 'focus' | 'active'>): Promise<void> {
    try {
      const session = await this.cdpSession();
      await session.send('DOM.enable');
      await session.send('CSS.enable');
      const doc = (await session.send('DOM.getDocument', { depth: 1 })) as { root: { nodeId: number } };
      const found = (await session.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: cssSelector
      })) as { nodeId: number };
      if (found.nodeId) {
        await session.send('CSS.forcePseudoState', {
          nodeId: found.nodeId,
          forcedPseudoClasses: states
        });
      }
    } catch (error) {
      this.logger.warn(`forcePseudoStates failed for ${cssSelector}`, error);
    }
  }

  async resetEmulation(): Promise<void> {
    // Clears the forced viewport size so the user's real tab (attach mode)
    // returns to its natural size after the scan.
    try {
      const session = await this.cdpSession();
      await session.send('Emulation.clearDeviceMetricsOverride');
    } catch (error) {
      this.logger.warn('Could not clear the viewport emulation', error);
    }
  }

  async hover(cssSelector: string): Promise<void> {
    // Short timeout so a missing/covered element does not stall the scan; the
    // caller treats a failure as "nothing to reveal" and moves on.
    await this.page.hover(cssSelector, { timeout: 2000 });
  }
}

export class PlaywrightBrowserSession implements IBrowserSession {
  private browser: Browser | null = null;
  private child: ChildProcess | null = null;
  private tempUserDataDir: string | null = null;
  private info: BrowserInfoDTO = { name: 'Chromium', version: 'unknown' };
  private readonly targetMap = new Map<string, Page>();
  private readonly pageIds = new WeakMap<Page, string>();
  private idCounter = 0;

  constructor(private readonly logger: ILogger) {}

  browserInfo(): BrowserInfoDTO {
    return this.info;
  }

  async connect(options: ConnectOptions): Promise<{ browser: BrowserInfoDTO; targets: BrowserTargetDTO[] }> {
    await this.close();
    switch (options.mode) {
      case 'attach':
        await this.attach(options.endpointUrl ?? DEFAULT_ENDPOINT, 'Chrome');
        break;
      case 'launch-chrome':
        await this.launchInstalled('chrome', options.startUrl);
        break;
      case 'launch-edge':
        await this.launchInstalled('edge', options.startUrl);
        break;
      case 'launch-bundled':
        await this.launchBundled(options.startUrl);
        break;
      default:
        throw new Error(`Unknown connection mode: ${options.mode}`);
    }
    return this.listTargets();
  }

  private async attach(endpoint: string, displayName: string): Promise<void> {
    this.logger.info(`Connecting over CDP: ${endpoint}`);
    try {
      this.browser = await chromium.connectOverCDP(endpoint);
    } catch (error) {
      throw new Error(connectionErrorMessage(error, endpoint));
    }
    this.info = { name: displayName, version: await this.safeVersion() };
  }

  private async launchInstalled(kind: 'chrome' | 'edge', startUrl?: string): Promise<void> {
    const exe = findBrowserExecutable(kind);
    if (!exe) {
      throw new Error(browserNotFoundMessage(friendlyBrowserName(kind)));
    }
    const userDataDir = mkdtempSync(join(tmpdir(), `wcag-auditor-${kind}-`));
    this.tempUserDataDir = userDataDir;
    const args = [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      startUrl ?? 'about:blank'
    ];
    this.logger.info(`Launching ${friendlyBrowserName(kind)}: ${exe}`);
    this.child = spawn(exe, args, { detached: false, stdio: 'ignore' });
    this.child.on('exit', (code) => this.logger.info(`Browser process exited (code ${code ?? 'null'})`));

    try {
      await this.waitForEndpoint(`${DEFAULT_ENDPOINT}/json/version`, 15000);
      this.browser = await chromium.connectOverCDP(DEFAULT_ENDPOINT);
    } catch {
      throw new Error(launchTimeoutMessage(friendlyBrowserName(kind)));
    }
    this.info = { name: friendlyBrowserName(kind), version: await this.safeVersion() };
  }

  private async launchBundled(startUrl?: string): Promise<void> {
    this.logger.info('Launching wbudowanego Chromium (Playwright)');
    try {
      this.browser = await chromium.launch({ headless: false });
    } catch (error) {
      throw new Error(bundledLaunchErrorMessage(error));
    }
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 1024 } });
    const page = await context.newPage();
    if (startUrl) await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    this.info = { name: 'Chromium', version: await this.safeVersion() };
  }

  private async safeVersion(): Promise<string> {
    try {
      return this.browser ? this.browser.version() : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async waitForEndpoint(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    // Node 18+ ma globalne fetch.
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url);
        if (res.ok) return;
      } catch {
        // not up yet, keep retrying
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('The browser did not expose the debugging port in time.');
  }

  private ensureBrowser(): Browser {
    if (!this.browser) throw new Error('No browser connection. Choose a mode at the top and click Connect.');
    return this.browser;
  }

  private collectPages(): Page[] {
    const browser = this.ensureBrowser();
    const pages: Page[] = [];
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.isClosed()) pages.push(page);
      }
    }
    return pages;
  }

  private idFor(page: Page): string {
    let id = this.pageIds.get(page);
    if (!id) {
      this.idCounter += 1;
      id = `target-${this.idCounter}`;
      this.pageIds.set(page, id);
    }
    this.targetMap.set(id, page);
    return id;
  }

  async listTargets(): Promise<{ browser: BrowserInfoDTO; targets: BrowserTargetDTO[] }> {
    const pages = this.collectPages();
    const targets: BrowserTargetDTO[] = [];
    for (const page of pages) {
      const id = this.idFor(page);
      let title = '';
      try {
        title = await page.title();
      } catch {
        title = '';
      }
      targets.push({ id, url: page.url(), title: title || page.url() });
    }
    return { browser: this.info, targets };
  }

  async getPage(targetId?: string): Promise<IBrowserPage> {
    if (targetId) {
      const page = this.targetMap.get(targetId);
      if (!page || page.isClosed()) {
        throw new Error(
          'The selected browser tab is no longer available (it was closed or the flow moved to another tab or window). Click Refresh, choose the current tab and run the scan again.'
        );
      }
      await page.bringToFront().catch(() => undefined);
      return new PlaywrightBrowserPage(page, this.logger);
    }
    const pages = this.collectPages();
    let page = pages[0];
    if (!page) {
      const browser = this.ensureBrowser();
      const context = browser.contexts()[0] ?? (await browser.newContext());
      page = await context.newPage();
    }
    this.idFor(page);
    await page.bringToFront().catch(() => undefined);
    return new PlaywrightBrowserPage(page, this.logger);
  }

  async navigate(page: IBrowserPage, url: string): Promise<void> {
    const raw = (page as PlaywrightBrowserPage).raw();
    try {
      await raw.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (error) {
      throw new Error(navigationErrorMessage(error, url));
    }
  }

  async close(): Promise<void> {
    try {
      if (this.browser) {
        // connectOverCDP: we disconnect without closing the user's browser.
        await this.browser.close().catch(() => undefined);
      }
    } finally {
      this.browser = null;
      this.targetMap.clear();
      if (this.child && !this.child.killed) {
        this.child.kill();
      }
      this.child = null;
      // Best-effort: remove the temporary browser profile created on launch.
      if (this.tempUserDataDir) {
        const dir = this.tempUserDataDir;
        this.tempUserDataDir = null;
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}
