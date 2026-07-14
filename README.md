# WCAG 2.2 Auditor

A desktop application for auditing web pages against WCAG 2.2. It drives a real browser (Edge, Chrome, or a bundled Chromium), runs a set of pluggable audit modules against the page, and presents findings with severity, WCAG references, DOM location, remediation guidance, and annotated screenshots. Reports can be exported to HTML, JSON, and CSV, and the same engine is available as a command-line tool for CI/CD.

The application is built with Electron, React, and TypeScript (strict mode) following a Clean Architecture layering, and ships with unit and end-to-end tests.

## Features

- Seven audit modules covering complementary areas of WCAG 2.2:
  - WCAG Scan (axe-core): the core automated rule set, split into critical / serious / moderate / minor.
  - Keyboard Navigation: focus order, positive tabindex, elements unreachable by keyboard, missing visible focus, missing skip link, and a focus-trap probe that actually tabs through the page.
  - Zoom / Reflow: horizontal overflow at 200% and 400% (320 px), plus detection of a meta viewport that blocks zooming.
  - Contrast Checker: text contrast in the interactive :focus and :hover states, which axe-core does not check.
  - ARIA Audit: invalid and abstract roles, broken idref references, missing accessible names, and missing required states.
  - NVDA Simulation: an approximate reading-order preview, unnamed controls, and heading-level skips.
  - Dynamic Content: hovers over menus, tooltips and popovers to find content that appears on hover but cannot be reached by keyboard, or that lacks popup semantics (WCAG 1.4.13, 2.1.1).
- Audit any tab in an already-open browser, without navigating away, so multi-step flows (login, multi-page forms) can be reached manually and then scanned in place.
- Human-readable, actionable error messages throughout.
- Scan history with regression comparison between two scans.
- Report export to HTML, JSON, and CSV, saved to a location of your choice.
- Dark and light themes.
- A command-line interface with quality thresholds mapped to exit codes for pipeline gating.

## Requirements and permissions

To run a finished build:

- Windows 10 or 11 (64-bit).
- Chrome or Edge (Edge ships with every Windows install). The bundled Chromium mode needs nothing extra.
- No administrator rights. The portable build and the unpacked folder run entirely in the user profile.

To build from source (done once, by one person):

- Node.js 20 LTS or newer, and npm.

| Action | Administrator required |
| --- | --- |
| Running the portable build or the unpacked folder | No |
| Writing results (history, screenshots) | No (user profile) |
| The NSIS installer | No (per-user install) |
| Installing Node.js from the official MSI installer | Yes (once, for building only) |
| Installing Node.js from the ZIP distribution | No |

If policy prevents running the Node MSI installer, download Node.js as a ZIP archive, extract it, and add the folder to PATH. That requires no administrator rights.

## Getting a ready build

### Build on GitHub (no local tooling)

The repository includes a GitHub Actions workflow (`.github/workflows/build-windows.yml`) that builds the Windows app on GitHub-hosted Windows runners and publishes the whole ready-to-run app folder as a single `.zip`, so nothing is downloaded as a bare `.exe`:

1. Push the project to GitHub (a private repository is fine).
2. Open the Actions tab, select "Build Windows", and click "Run workflow" (or push a `v*` tag such as `v2.2.1`).
3. After a few minutes, download `WCAG-Auditor-<version>.zip` from Releases (for tag builds) or from the run's Artifacts (`wcag-auditor-windows-zip`).

Extract the `.zip` and run `WCAG Auditor.exe` inside the extracted folder. No installation and no local build are needed; the app stores its data in your user profile (`%APPDATA%`).

### Build locally

On a machine with Node.js:

```bash
npm install                 # dependencies; also downloads Chromium for Playwright
npm run dist:portable       # produces release\WCAG-Auditor-2.2.1-portable.exe
```

If a corporate proxy blocks the Chromium download, run `npm install --ignore-scripts` (the Edge and Chrome modes then work without a bundled Chromium).

For a live development preview with hot reload (no packaging): `npm run dev`.

## Running the application

The build produces three artifacts in `release\`:

- `npm run dist:portable` - a single `WCAG-Auditor-2.2.1-portable.exe`. Recommended for distribution: no installation, no administrator rights, and its data is stored next to the executable.
- `npm run dist:dir` - an unpacked `win-unpacked\` folder containing `WCAG Auditor.exe`. Run the executable in place; data is stored in the user profile (`%APPDATA%`).
- `npm run dist` - builds both of the above plus an NSIS installer (`WCAG Auditor Setup 2.2.1.exe`) with Start menu and desktop shortcuts and a per-user install.

For the portable build, scan history and screenshots are written to a `wcag-auditor-data` folder next to the executable, so removing the file leaves nothing behind.

On first launch of an unsigned executable, Windows SmartScreen may show a warning: click "More info", then "Run anyway". This is a warning, not a block. Environments with strict application allowlisting (AppLocker or WDAC) may still block unsigned executables regardless of whether they are installed; in that case the executable needs to be code-signed.

The default icon is the Electron icon. To use a custom one, add `build\icon.ico` (256x256) and uncomment the `icon:` line in `electron-builder.yml`.

## Using the auditor

The application controls a browser and audits the current page of a selected tab, with no reload and no need to type an address. This makes it possible to audit a page that is only reachable through a multi-step flow.

Connection modes:

- Open Edge / Open Chrome for auditing: the application launches a controlled browser. Leave the start address empty, go through your flow manually in that browser, then choose the tab and run the scan. This mode needs no extra setup.
- Attach to an open browser: connects to a browser you started yourself with a remote debugging port. Start it from the command line, for example:

  ```
  msedge --remote-debugging-port=9222 --user-data-dir="%TEMP%\wcag-edge"
  ```

  (for Chrome, replace `msedge` with `chrome`). If the browser was already running, close all of its windows first, because they block the port.
- Bundled Chromium: uses the Chromium that Playwright downloads.

Typical workflow: connect, complete your flow in the open browser, click Refresh, select the correct tab, then Run scan. The scan runs against whatever the selected tab currently shows.

## Reports and screenshots

After a scan, use the HTML, JSON, or CSV buttons to save a report. A save dialog lets you choose the location, and the saved file is then highlighted in the file explorer. The Screenshots folder button opens the directory that holds the annotated screenshots.

## Command-line interface (CI/CD)

A headless audit for pipelines. It builds to a standalone ESM file:

```bash
npm run build:cli
node dist-cli\wcag-audit.mjs --help
```

Examples:

```bash
node dist-cli\wcag-audit.mjs https://example.com

node dist-cli\wcag-audit.mjs https://example.com \
  --modules wcag-scan,contrast --format html --output report.html \
  --max-serious 0 --fail-on fail

node dist-cli\wcag-audit.mjs https://example.com \
  --browser attach --endpoint http://127.0.0.1:9222 --json-summary
```

Exit codes: `0` when no threshold is exceeded, `1` when a threshold is exceeded (for example `--max-critical` or `--fail-on`), and `2` on an execution or argument error. The summary goes to stdout and progress goes to stderr, so `--json-summary` produces clean JSON for further processing.

## Testing

```bash
npm test            # unit tests (Vitest), fast, no browser
npm run test:e2e    # integration / end-to-end tests on real Chromium
```

The end-to-end tests run each module on a real browser against fixtures with seeded issues (`src\e2e\fixtures`) and assert that the issues are detected. One test confirms that axe-core works despite a restrictive Content-Security-Policy. They require Chromium for Playwright:

```bash
npx playwright install chromium
```

On a headless Linux CI runner, run them under Xvfb. On Windows and macOS no extra setup is needed.

## Automation coverage

Automated tooling cannot fully replace manual accessibility review. Approximate coverage per area:

| Area | Approximate coverage |
| --- | --- |
| WCAG Scan (axe-core rules) | ~95% of what axe covers |
| ARIA Audit | ~90% |
| Contrast in interactive states | additive to axe (default state) |
| Keyboard navigation | ~75% |
| Zoom / Reflow | ~70% |
| NVDA reading-order simulation | ~60%, always needs manual verification |
| Dynamic content revealed on hover | detects reveal and keyboard reachability; the 1.4.13 dismissable / hoverable / persistent conditions need manual verification |

Findings marked "needs review" are heuristics that require human confirmation.

Some things cannot be checked automatically at all, and the application shows a reminder about them after every scan. In particular, no tool can judge whether an image's alt text is *meaningful*: it can only confirm that the attribute exists. Whether alt text, link text and button labels actually describe their target always needs a human.

## Architecture

Clean Architecture with dependencies pointing inward:

- Domain: pure TypeScript entities and ports (interfaces), with no framework dependencies.
- Application: use cases (run audit, export report, history, compare scans).
- Infrastructure: adapters that implement the ports (Playwright browser session, screenshot service, file repository, report exporters, audit modules).
- Presentation: the React renderer and, separately, the CLI, both driving the same use cases.

The plugin seam is the `IAuditModule` port. The audit orchestrator iterates over a module registry, isolates per-module errors so one failing module does not break the whole scan, and aggregates the results.

## Project structure

```
src/
  main/            Electron main process: entry, composition (DI), IPC handlers
  preload/         Secure contextBridge
  renderer/        React application (dashboard, components, store, styles, theme)
  cli/             Headless CLI audit (core logic, Node composition, entry point)
  shared/          Data contracts and IPC channel definitions shared across processes
  core/
    domain/        Entities and ports
    application/   Use cases
  infrastructure/
    browser/       Playwright session, CDP, in-page scripts, error mapping
    modules/       Audit modules (WCAG Scan, Keyboard, Zoom/Reflow, Contrast, ARIA, NVDA)
    screenshot/    Screenshot service
    persistence/   Scan repository
    export/        HTML / JSON / CSV exporters
    registry/      Module registry and default module set
  e2e/             End-to-end tests and HTML fixtures
```

## Security notes

- The renderer runs with context isolation; all privileged operations go through a typed IPC bridge.
- Report content is HTML-escaped on export, and CSV cells are guarded against spreadsheet formula injection.
- Scan identifiers crossing the IPC boundary are validated to prevent path traversal.
- In attach mode the application connects to a browser you control and never closes it.
