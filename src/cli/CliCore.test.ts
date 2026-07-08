import { describe, expect, it } from 'vitest';
import type { ScanResultDTO, SeverityCounts } from '@shared/types';
import { evaluateExitCode, formatJsonSummary, formatSummary, parseCliArgs, type CliThresholds } from './core';

function counts(partial: Partial<SeverityCounts>): SeverityCounts {
  const critical = partial.critical ?? 0;
  const serious = partial.serious ?? 0;
  const moderate = partial.moderate ?? 0;
  const minor = partial.minor ?? 0;
  return { critical, serious, moderate, minor, total: partial.total ?? critical + serious + moderate + minor };
}

function scan(overrides: Partial<ScanResultDTO>): ScanResultDTO {
  return {
    id: 'scan-1',
    url: 'https://example.com',
    title: 'Example',
    startedAt: '2026-07-01T10:00:00.000Z',
    finishedAt: '2026-07-01T10:00:05.000Z',
    durationMs: 5000,
    browser: { name: 'Chromium', version: '125' },
    viewport: { width: 1280, height: 1024 },
    overallStatus: overrides.overallStatus ?? 'pass',
    counts: overrides.counts ?? counts({}),
    modules: overrides.modules ?? [],
    appVersion: '0.1.0'
  };
}

const NO_LIMITS: CliThresholds = {
  maxCritical: Number.POSITIVE_INFINITY,
  maxSerious: Number.POSITIVE_INFINITY,
  maxModerate: Number.POSITIVE_INFINITY,
  maxTotal: Number.POSITIVE_INFINITY,
  failOnStatuses: []
};

describe('parseCliArgs', () => {
  it('no arguments => help', () => {
    expect(parseCliArgs([]).kind).toBe('help');
  });

  it('--help => help', () => {
    expect(parseCliArgs(['--help']).kind).toBe('help');
    expect(parseCliArgs(['-h']).kind).toBe('help');
  });

  it('URL only => run with default values', () => {
    const result = parseCliArgs(['https://example.com']);
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.options.url).toBe('https://example.com');
    expect(result.options.browserMode).toBe('launch-bundled');
    expect(result.options.moduleIds).toBeUndefined();
    expect(result.options.thresholds.maxCritical).toBe(0);
    expect(result.options.viewport).toEqual({ width: 1280, height: 1024 });
  });

  it('parses modules, format, output, viewport, browser, endpoint', () => {
    const result = parseCliArgs([
      'https://example.com',
      '--modules',
      'wcag-scan, contrast',
      '--format',
      'html',
      '--output',
      'raport.html',
      '--viewport',
      '800x600',
      '--browser',
      'attach',
      '--endpoint',
      'http://127.0.0.1:9222'
    ]);
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.options.moduleIds).toEqual(['wcag-scan', 'contrast']);
    expect(result.options.reportFormat).toBe('html');
    expect(result.options.outputPath).toBe('raport.html');
    expect(result.options.viewport).toEqual({ width: 800, height: 600 });
    expect(result.options.browserMode).toBe('attach');
    expect(result.options.endpointUrl).toBe('http://127.0.0.1:9222');
  });

  it('parsuje progi i fail-on', () => {
    const result = parseCliArgs(['https://example.com', '--max-serious', '3', '--fail-on', 'fail,needs-review']);
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.options.thresholds.maxSerious).toBe(3);
    expect(result.options.thresholds.failOnStatuses).toEqual(['fail', 'needs-review']);
  });

  it('rejects a missing URL, wrong protocol, unknown option and wrong format', () => {
    expect(parseCliArgs(['--quiet']).kind).toBe('error');
    expect(parseCliArgs(['ftp://example.com']).kind).toBe('error');
    expect(parseCliArgs(['https://example.com', '--nope']).kind).toBe('error');
    expect(parseCliArgs(['https://example.com', '--format', 'pdf']).kind).toBe('error');
    expect(parseCliArgs(['https://example.com', '--viewport', 'zle']).kind).toBe('error');
    expect(parseCliArgs(['https://example.com', '--output', 'r.html']).kind).toBe('error'); // missing --format
    expect(parseCliArgs(['https://example.com', '--max-critical', '-1']).kind).toBe('error');
    expect(parseCliArgs(['https://example.com', '--modules']).kind).toBe('error'); // missing value
  });
});

describe('evaluateExitCode', () => {
  it('no thresholds exceeded => code 0', () => {
    const result = evaluateExitCode(scan({ counts: counts({ serious: 2, moderate: 5 }) }), NO_LIMITS);
    expect(result.code).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it('critical over threshold => code 1', () => {
    const result = evaluateExitCode(scan({ counts: counts({ critical: 1 }) }), { ...NO_LIMITS, maxCritical: 0 });
    expect(result.code).toBe(1);
    expect(result.reasons.join()).toContain('critical');
  });

  it('final status in fail-on list => code 1', () => {
    const result = evaluateExitCode(scan({ overallStatus: 'fail' }), { ...NO_LIMITS, failOnStatuses: ['fail'] });
    expect(result.code).toBe(1);
    expect(result.reasons.join()).toContain('fail');
  });

  it('combines multiple reasons', () => {
    const result = evaluateExitCode(scan({ counts: counts({ serious: 4, total: 4 }), overallStatus: 'fail' }), {
      maxCritical: 0,
      maxSerious: 1,
      maxModerate: Number.POSITIVE_INFINITY,
      maxTotal: 2,
      failOnStatuses: ['fail']
    });
    expect(result.code).toBe(1);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('formatowanie', () => {
  it('formatSummary contains URL and status', () => {
    const text = formatSummary(scan({ overallStatus: 'needs-review', counts: counts({ serious: 1 }) }));
    expect(text).toContain('https://example.com');
    expect(text).toContain('NEEDS-REVIEW');
  });

  it('formatJsonSummary returns valid JSON', () => {
    const json = formatJsonSummary(scan({ counts: counts({ minor: 2 }) }));
    const parsed = JSON.parse(json) as { url: string; counts: SeverityCounts };
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.counts.minor).toBe(2);
  });
});
