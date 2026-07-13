import type { ConnectMode, OverallStatus, ReportFormat, ScanResultDTO, ViewportDTO } from '@shared/types';

// Pure CLI logic, fully testable without a browser or file system.

export interface CliThresholds {
  maxCritical: number;
  maxSerious: number;
  maxModerate: number;
  maxTotal: number;
  failOnStatuses: OverallStatus[];
}

export interface CliOptions {
  url: string;
  moduleIds: string[] | undefined; // undefined = wszystkie zarejestrowane
  browserMode: ConnectMode;
  endpointUrl: string | undefined;
  viewport: ViewportDTO;
  reportFormat: ReportFormat | undefined;
  outputPath: string | undefined;
  thresholds: CliThresholds;
  jsonSummary: boolean;
  quiet: boolean;
}

export type ParseResult =
  | { kind: 'run'; options: CliOptions }
  | { kind: 'help'; message: string }
  | { kind: 'error'; message: string };

const CONNECT_MODES: ReadonlySet<ConnectMode> = new Set<ConnectMode>([
  'attach',
  'launch-chrome',
  'launch-edge',
  'launch-bundled'
]);
const REPORT_FORMATS: ReadonlySet<ReportFormat> = new Set<ReportFormat>(['json', 'csv', 'html']);
const OVERALL_STATUSES: ReadonlySet<OverallStatus> = new Set<OverallStatus>(['pass', 'fail', 'needs-review']);

const DEFAULT_VIEWPORT: ViewportDTO = { width: 1280, height: 1024 };

export const HELP_TEXT = `WCAG 2.2 Auditor - CLI

Usage:
  wcag-audit <url> [options]

Options:
  --modules <list>       Comma-separated module ids (default: all)
  --browser <mode>        launch-bundled | launch-chrome | launch-edge | attach (default: launch-bundled)
  --endpoint <url>        CDP endpoint for attach mode (default http://127.0.0.1:9222)
  --viewport <WxH>   Viewport size, e.g. 1280x1024
  --format <fmt>          Save a report: json | csv | html
  --output <path>      Report file path (requires --format)
  --max-critical <n>      Error exit code when critical count > n (default: 0)
  --max-serious <n>       Error exit code when serious count > n
  --max-moderate <n>      Error exit code when moderate count > n
  --max-total <n>         Error exit code when total issues > n
  --fail-on <statuses>     Error exit code when the final status is one of: pass,fail,needs-review
  --json-summary          Print a JSON summary to stdout
  --quiet                 Do not print progress
  -h, --help              This help

Exit codes:
  0  no threshold exceeded
  1  a threshold was exceeded (see messages)
  2  execution error (e.g. no browser, invalid argument)

Examples:
  wcag-audit https://example.com
  wcag-audit https://example.com --modules wcag-scan,contrast --format html --output raport.html
  wcag-audit https://example.com --max-serious 0 --fail-on fail,needs-review`;

// Parses arguments (without "node script"). Returns ready options or help/error.
export function parseCliArgs(argv: string[]): ParseResult {
  if (argv.length === 0) return { kind: 'help', message: HELP_TEXT };

  const positional: string[] = [];
  let moduleIds: string[] | undefined;
  let browserMode: ConnectMode = 'launch-bundled';
  let endpointUrl: string | undefined;
  let viewport: ViewportDTO = DEFAULT_VIEWPORT;
  let reportFormat: ReportFormat | undefined;
  let outputPath: string | undefined;
  let maxCritical = 0;
  let maxSerious = Number.POSITIVE_INFINITY;
  let maxModerate = Number.POSITIVE_INFINITY;
  let maxTotal = Number.POSITIVE_INFINITY;
  let failOnStatuses: OverallStatus[] = [];
  let jsonSummary = false;
  let quiet = false;

  const needValue = (flag: string, value: string | undefined): value is string => {
    if (value === undefined) throw new CliArgError(`Option ${flag} requires a value`);
    return true;
  };
  const parseCount = (flag: string, value: string | undefined): number => {
    needValue(flag, value);
    const n = Number.parseInt(value as string, 10);
    if (Number.isNaN(n) || n < 0) throw new CliArgError(`Option ${flag} requires an integer >= 0`);
    return n;
  };

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i] ?? '';
      switch (arg) {
        case '-h':
        case '--help':
          return { kind: 'help', message: HELP_TEXT };
        case '--modules': {
          const value = argv[++i];
          needValue(arg, value);
          moduleIds = (value as string)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (moduleIds.length === 0) throw new CliArgError('Option --modules cannot be empty');
          break;
        }
        case '--browser': {
          const value = argv[++i];
          needValue(arg, value);
          if (!CONNECT_MODES.has(value as ConnectMode)) {
            throw new CliArgError(`Unknown browser mode: ${value as string}`);
          }
          browserMode = value as ConnectMode;
          break;
        }
        case '--endpoint': {
          const value = argv[++i];
          needValue(arg, value);
          endpointUrl = value as string;
          break;
        }
        case '--viewport': {
          const value = argv[++i];
          needValue(arg, value);
          viewport = parseViewport(value as string);
          break;
        }
        case '--format': {
          const value = argv[++i];
          needValue(arg, value);
          if (!REPORT_FORMATS.has(value as ReportFormat)) {
            throw new CliArgError(`Unknown report format: ${value as string}`);
          }
          reportFormat = value as ReportFormat;
          break;
        }
        case '--output': {
          const value = argv[++i];
          needValue(arg, value);
          outputPath = value as string;
          break;
        }
        case '--max-critical':
          maxCritical = parseCount(arg, argv[++i]);
          break;
        case '--max-serious':
          maxSerious = parseCount(arg, argv[++i]);
          break;
        case '--max-moderate':
          maxModerate = parseCount(arg, argv[++i]);
          break;
        case '--max-total':
          maxTotal = parseCount(arg, argv[++i]);
          break;
        case '--fail-on': {
          const value = argv[++i];
          needValue(arg, value);
          failOnStatuses = parseStatuses(value as string);
          break;
        }
        case '--json-summary':
          jsonSummary = true;
          break;
        case '--quiet':
          quiet = true;
          break;
        default:
          if (arg.startsWith('-')) throw new CliArgError(`Unknown option: ${arg}`);
          positional.push(arg);
      }
    }

    const url = positional[0];
    if (url === undefined) throw new CliArgError('No URL to audit');
    if (positional.length > 1) throw new CliArgError(`Unexpected argument: ${positional[1] ?? ''}`);
    if (!/^https?:\/\//i.test(url)) throw new CliArgError('The URL must start with http:// or https://');
    if (outputPath !== undefined && reportFormat === undefined) {
      throw new CliArgError('Option --output requires --format');
    }
  } catch (error) {
    if (error instanceof CliArgError) return { kind: 'error', message: error.message };
    throw error;
  }

  return {
    kind: 'run',
    options: {
      url: positional[0] as string,
      moduleIds,
      browserMode,
      endpointUrl,
      viewport,
      reportFormat,
      outputPath,
      thresholds: { maxCritical, maxSerious, maxModerate, maxTotal, failOnStatuses },
      jsonSummary,
      quiet
    }
  };
}

// Threshold evaluation for CI: exit code 1 if any threshold is exceeded.
export function evaluateExitCode(scan: ScanResultDTO, thresholds: CliThresholds): { code: number; reasons: string[] } {
  const reasons: string[] = [];
  const c = scan.counts;
  if (c.critical > thresholds.maxCritical) {
    reasons.push(`critical ${c.critical} > ${thresholds.maxCritical}`);
  }
  if (c.serious > thresholds.maxSerious) {
    reasons.push(`serious ${c.serious} > ${thresholds.maxSerious}`);
  }
  if (c.moderate > thresholds.maxModerate) {
    reasons.push(`moderate ${c.moderate} > ${thresholds.maxModerate}`);
  }
  if (c.total > thresholds.maxTotal) {
    reasons.push(`total ${c.total} > ${thresholds.maxTotal}`);
  }
  if (thresholds.failOnStatuses.includes(scan.overallStatus)) {
    reasons.push(`final status: ${scan.overallStatus}`);
  }
  return { code: reasons.length > 0 ? 1 : 0, reasons };
}

// Human-readable summary.
export function formatSummary(scan: ScanResultDTO): string {
  const lines: string[] = [];
  lines.push(`URL:     ${scan.url}`);
  lines.push(`Title:   ${scan.title}`);
  lines.push(`Status:  ${scan.overallStatus.toUpperCase()}`);
  lines.push(`Time:    ${(scan.durationMs / 1000).toFixed(1)} s`);
  lines.push(
    `Issues: critical ${scan.counts.critical}, serious ${scan.counts.serious}, ` +
      `moderate ${scan.counts.moderate}, minor ${scan.counts.minor} (total ${scan.counts.total})`
  );
  lines.push('');
  lines.push('Modules:');
  for (const m of scan.modules) {
    lines.push(
      `  ${padRight(m.moduleName, 22)} ${padRight(m.status, 13)} ` +
        `issues: ${m.counts.total}, ok: ${m.passedChecks}`
    );
  }
  return lines.join('\n');
}

// Podsumowanie maszynowe (stabilny, zwiezly JSON).
export function formatJsonSummary(scan: ScanResultDTO): string {
  return JSON.stringify(
    {
      id: scan.id,
      url: scan.url,
      overallStatus: scan.overallStatus,
      durationMs: scan.durationMs,
      counts: scan.counts,
      modules: scan.modules.map((m) => ({ id: m.moduleId, status: m.status, counts: m.counts }))
    },
    null,
    2
  );
}

class CliArgError extends Error {}

function parseViewport(value: string): ViewportDTO {
  const match = value.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match || !match[1] || !match[2]) {
    throw new CliArgError('Option --viewport requires the format WxH, e.g. 1280x1024');
  }
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (width <= 0 || height <= 0) throw new CliArgError('Viewport dimensions must be positive');
  return { width, height };
}

function parseStatuses(value: string): OverallStatus[] {
  const tokens = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const out: OverallStatus[] = [];
  for (const token of tokens) {
    if (!OVERALL_STATUSES.has(token as OverallStatus)) {
      throw new CliArgError(`Unknown status in --fail-on: ${token}`);
    }
    out.push(token as OverallStatus);
  }
  if (out.length === 0) throw new CliArgError('Option --fail-on cannot be empty');
  return out;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}
