import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ILogger, IProgressReporter } from '@core/domain/ports';
import type { CliOptions } from './core';
import { evaluateExitCode, formatJsonSummary, formatSummary, parseCliArgs } from './core';
import { buildCliContainer } from './container';

const APP_VERSION = '0.1.0';

// Logger CLI pisze wylacznie na stderr, aby stdout pozostal czysty (dla --json-summary).
function stderrLogger(quiet: boolean): ILogger {
  const write = (level: string, message: string): void => {
    process.stderr.write(`${level} ${message}\n`);
  };
  return {
    debug: (m) => {
      if (!quiet) write('[debug]', m);
    },
    info: (m) => {
      if (!quiet) write('[info]', m);
    },
    warn: (m) => write('[warn]', m),
    error: (m) => write('[error]', m)
  };
}

async function runAudit(options: CliOptions): Promise<number> {
  const logger = stderrLogger(options.quiet);
  const dataDir = mkdtempSync(join(tmpdir(), 'wcag-audit-'));
  const container = buildCliContainer({ dataDir, appVersion: APP_VERSION, logger });

  const progress: IProgressReporter = {
    report: (event) => {
      if (!options.quiet) process.stderr.write(`[${event.current}/${event.total}] ${event.message}\n`);
    }
  };

  try {
    await container.session.connect({
      mode: options.browserMode,
      ...(options.endpointUrl !== undefined ? { endpointUrl: options.endpointUrl } : {}),
      startUrl: options.url
    });

    const scan = await container.createRunAudit(progress).execute({
      url: options.url,
      ...(options.moduleIds !== undefined ? { moduleIds: options.moduleIds } : {}),
      viewport: options.viewport
    });

    if (options.reportFormat) {
      const outputPath = options.outputPath ?? `wcag-report.${options.reportFormat}`;
      const written = await container.exporters[options.reportFormat].export(scan, outputPath);
      process.stderr.write(`Report saved: ${written}\n`);
    }

    process.stdout.write((options.jsonSummary ? formatJsonSummary(scan) : formatSummary(scan)) + '\n');

    const { code, reasons } = evaluateExitCode(scan, options.thresholds);
    if (reasons.length > 0) {
      process.stderr.write(`Thresholds exceeded: ${reasons.join('; ')}\n`);
    }
    return code;
  } finally {
    await container.session.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(parsed.message + '\n');
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`Error: ${parsed.message}\n\nUse --help to see the available options.\n`);
    return 2;
  }
  try {
    return await runAudit(parsed.options);
  } catch (error) {
    process.stderr.write(`Execution error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

// Run as a program (skipped when imported in tests): the standard ESM
// main-module test by comparing the module URL with the launch argument.
const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
