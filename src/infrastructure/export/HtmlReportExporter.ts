import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReportFormat, ScanResultDTO, Severity } from '@shared/types';
import type { IReportExporter } from '@core/domain/ports';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PRIORITY: Record<Severity, string> = {
  critical: 'P1',
  serious: 'P2',
  moderate: 'P3',
  minor: 'P4'
};

const SEV_COLOR: Record<Severity, string> = {
  critical: '#ff453a',
  serious: '#ff9f0a',
  moderate: '#ffd60a',
  minor: '#64d2ff'
};

const LOGO_SVG = `<svg width="34" height="34" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="10" fill="#0a84ff"/><path d="M24 11l11 6.5v13L24 37l-11-6.5v-13L24 11z" stroke="#fff" stroke-width="2.4" fill="none"/><circle cx="24" cy="24" r="4.5" fill="#fff"/></svg>`;

export class HtmlReportExporter implements IReportExporter {
  readonly format: ReportFormat = 'html';

  private async imageTag(path: string | null): Promise<string> {
    if (!path) return '';
    try {
      const buffer = await readFile(path);
      const base64 = buffer.toString('base64');
      return `<img class="shot" src="data:image/png;base64,${base64}" alt="Issue screenshot" />`;
    } catch {
      return '';
    }
  }

  async export(scan: ScanResultDTO, outputPath: string): Promise<string> {
    const statusBadge =
      scan.overallStatus === 'pass'
        ? '<span class="status pass">PASS</span>'
        : scan.overallStatus === 'fail'
          ? '<span class="status fail">FAIL</span>'
          : '<span class="status review">DO WERYFIKACJI</span>';

    const moduleSections: string[] = [];
    for (const module of scan.modules) {
      const issueBlocks: string[] = [];
      for (const issue of module.issues) {
        const img = await this.imageTag(issue.screenshotPath);
        const refs =
          issue.wcagReferences
            .map(
              (r) =>
                `<a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer">WCAG ${escapeHtml(
                  r.criterion
                )} (${r.level})</a>`
            )
            .join(' ') || '<span class="muted">no mapping</span>';
        issueBlocks.push(`
          <div class="issue">
            <div class="issue-head">
              <span class="chip" style="background:${SEV_COLOR[issue.severity]}">${issue.severity.toUpperCase()}</span>
              <span class="chip prio">${PRIORITY[issue.severity]}</span>
              <span class="chip status-${issue.status}">${issue.status}</span>
              <h4>${escapeHtml(issue.title)}</h4>
            </div>
            <p class="desc">${escapeHtml(issue.description)}</p>
            <div class="meta"><strong>Selector:</strong> <code>${escapeHtml(issue.cssSelector)}</code></div>
            <div class="meta"><strong>XPath:</strong> <code>${escapeHtml(issue.xpath)}</code></div>
            <div class="meta"><strong>WCAG 2.2:</strong> ${refs}</div>
            <details><summary>Fragment HTML</summary><pre>${escapeHtml(issue.html)}</pre></details>
            <div class="rec"><strong>Recommendation:</strong><pre>${escapeHtml(issue.recommendation)}</pre></div>
            ${img}
          </div>`);
      }
      moduleSections.push(`
        <section class="module">
          <h3>${escapeHtml(module.moduleName)} <span class="muted">(${module.status})</span></h3>
          <div class="counts">
            <span>Critical: ${module.counts.critical}</span>
            <span>Serious: ${module.counts.serious}</span>
            <span>Moderate: ${module.counts.moderate}</span>
            <span>Minor: ${module.counts.minor}</span>
            <span>Passed checks: ${module.passedChecks}</span>
          </div>
          ${issueBlocks.join('\n') || '<p class="muted">No issues in this module.</p>'}
        </section>`);
    }

    const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Raport WCAG 2.2 - ${escapeHtml(scan.url)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0d1117; color:#e6edf3; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  header { display:flex; align-items:center; gap:12px; padding:20px 28px; border-bottom:1px solid #21262d; background:#161b22; position:sticky; top:0; }
  header h1 { font-size:18px; margin:0; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 28px 80px; }
  .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin:16px 0 28px; }
  .card { background:#161b22; border:1px solid #21262d; border-radius:10px; padding:14px 16px; }
  .card .n { font-size:24px; font-weight:700; }
  .card .l { color:#8b949e; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .status { padding:4px 10px; border-radius:6px; font-weight:700; font-size:12px; }
  .status.pass { background:#238636; }
  .status.fail { background:#da3633; }
  .status.review { background:#9e6a03; }
  .kv { color:#8b949e; margin:2px 0; }
  .kv strong { color:#e6edf3; }
  .module { margin:26px 0; }
  .module h3 { border-bottom:1px solid #21262d; padding-bottom:8px; }
  .counts { display:flex; gap:14px; flex-wrap:wrap; color:#8b949e; font-size:12px; margin:8px 0 16px; }
  .issue { background:#0f141a; border:1px solid #21262d; border-left:3px solid #30363d; border-radius:8px; padding:14px 16px; margin:12px 0; }
  .issue-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .issue-head h4 { margin:0; font-size:15px; }
  .chip { font-size:11px; font-weight:700; color:#0d1117; padding:2px 8px; border-radius:5px; }
  .chip.prio { background:#30363d; color:#e6edf3; }
  .chip.status-fail { background:#da3633; color:#fff; }
  .chip.status-needs-review { background:#9e6a03; color:#fff; }
  .chip.status-warning { background:#bb8009; color:#fff; }
  .desc { color:#c9d1d9; }
  .meta { font-size:12px; margin:3px 0; color:#8b949e; }
  .meta code { background:#161b22; padding:1px 6px; border-radius:4px; color:#79c0ff; }
  pre { background:#161b22; padding:10px; border-radius:6px; overflow:auto; font-size:12px; color:#c9d1d9; }
  details summary { cursor:pointer; color:#58a6ff; font-size:12px; margin:6px 0; }
  .rec { margin-top:6px; }
  .shot { max-width:100%; border:1px solid #30363d; border-radius:6px; margin-top:10px; }
  a { color:#58a6ff; }
  .muted { color:#6e7681; }
</style>
</head>
<body>
<header>${LOGO_SVG}<h1>WCAG 2.2 Auditor</h1>${statusBadge}</header>
<div class="wrap">
  <div class="kv"><strong>URL:</strong> ${escapeHtml(scan.url)}</div>
  <div class="kv"><strong>Page title:</strong> ${escapeHtml(scan.title)}</div>
  <div class="kv"><strong>Data:</strong> ${escapeHtml(new Date(scan.finishedAt).toLocaleString('pl-PL'))}</div>
  <div class="kv"><strong>Browser:</strong> ${escapeHtml(scan.browser.name)} ${escapeHtml(scan.browser.version)}</div>
  <div class="kv"><strong>Viewport:</strong> ${scan.viewport.width}x${scan.viewport.height}</div>
  <div class="kv"><strong>Scan time:</strong> ${(scan.durationMs / 1000).toFixed(1)} s</div>

  <div class="summary">
    <div class="card"><div class="n">${scan.counts.total}</div><div class="l">Wszystkie</div></div>
    <div class="card"><div class="n" style="color:${SEV_COLOR.critical}">${scan.counts.critical}</div><div class="l">Critical</div></div>
    <div class="card"><div class="n" style="color:${SEV_COLOR.serious}">${scan.counts.serious}</div><div class="l">Serious</div></div>
    <div class="card"><div class="n" style="color:${SEV_COLOR.moderate}">${scan.counts.moderate}</div><div class="l">Moderate</div></div>
    <div class="card"><div class="n" style="color:${SEV_COLOR.minor}">${scan.counts.minor}</div><div class="l">Minor</div></div>
  </div>

  ${moduleSections.join('\n')}
</div>
</body>
</html>`;

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, 'utf-8');
    return outputPath;
  }
}
