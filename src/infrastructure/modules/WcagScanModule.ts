import axe from 'axe-core';
import type { BoundingBoxDTO, IssueStatus, Severity } from '@shared/types';
import { createIssue, type Issue } from '@core/domain/Issue';
import { buildModuleResult, type ModuleResult } from '@core/domain/ModuleResult';
import { normalizeImpact } from '@core/domain/Severity';
import { referencesFromTags } from '@core/domain/WcagReference';
import type { AuditContext, IAuditModule } from '@core/domain/ports';

const axeSource = (axe as unknown as { source: string }).source;

// Minimal axe result types used by the module (avoids depending on axe's full types here).
interface AxeNode {
  target: string[];
  html: string;
  failureSummary?: string;
}
interface AxeRule {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}
interface AxeResults {
  violations: AxeRule[];
  incomplete: AxeRule[];
  passes: AxeRule[];
}

interface NodeGeom {
  found: boolean;
  xpath: string;
  box: BoundingBoxDTO | null;
}

const MODULE_ID = 'wcag-scan';
const MAX_SCREENSHOTS = 30;

export class WcagScanModule implements IAuditModule {
  readonly id = MODULE_ID;
  readonly name = 'WCAG Scan (axe-core)';

  async run(context: AuditContext): Promise<ModuleResult> {
    const start = Date.now();
    const { page, screenshots, logger, scanId } = context;

    logger.info('WCAG: wstrzykiwanie axe-core');
    await page.addScriptTag(axeSource);

    logger.info('WCAG: uruchamianie axe.run');
    const results = await page.evaluate<AxeResults>(() => {
      const w = window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<AxeResults> } };
      return w.axe.run(document, {
        resultTypes: ['violations', 'incomplete'],
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
        }
      });
    });

    // Zbierz wszystkie selektory do jednego zapytania o geometrie (jeden round-trip).
    const violationEntries = results.violations.flatMap((rule) =>
      rule.nodes.map((node) => ({ rule, node, status: 'fail' as IssueStatus }))
    );
    const incompleteEntries = results.incomplete.flatMap((rule) =>
      rule.nodes.map((node) => ({ rule, node, status: 'needs-review' as IssueStatus }))
    );
    const entries = [...violationEntries, ...incompleteEntries];
    const selectors = entries.map((e) => e.node.target[0] ?? '');

    const geom = await page.evaluate<NodeGeom[], string[]>((sels) => {
      const buildXPath = (node: Element): string => {
        if (node.id) return `//*[@id="${node.id}"]`;
        const segments: string[] = [];
        let current: Element | null = node;
        while (current && current.nodeType === 1) {
          let index = 1;
          let sibling = current.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === current.tagName) index += 1;
            sibling = sibling.previousElementSibling;
          }
          segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
          current = current.parentElement;
        }
        return '/' + segments.join('/');
      };
      return sels.map((sel) => {
        if (!sel) return { found: false, xpath: '', box: null };
        const el = document.querySelector(sel);
        if (!el) return { found: false, xpath: '', box: null };
        const rect = el.getBoundingClientRect();
        const sx = window.scrollX || 0;
        const sy = window.scrollY || 0;
        const box =
          rect.width > 0 && rect.height > 0
            ? { x: rect.left + sx, y: rect.top + sy, width: rect.width, height: rect.height }
            : null;
        return { found: true, xpath: buildXPath(el), box };
      });
    }, selectors);

    const issues: Issue[] = [];
    let screenshotBudget = MAX_SCREENSHOTS;

    // Sort so screenshots are taken for the most severe issues first.
    const indexed = entries.map((entry, i) => ({ entry, geom: geom[i] ?? { found: false, xpath: '', box: null } }));
    indexed.sort((a, b) => severityRank(a.entry.rule.impact) - severityRank(b.entry.rule.impact));

    let issueNumber = 0;
    for (const { entry, geom: g } of indexed) {
      issueNumber += 1;
      const severity: Severity = entry.status === 'needs-review' ? weaken(entry.rule.impact) : normalizeImpact(entry.rule.impact);

      let screenshotPath: string | null = null;
      if (g.box && screenshotBudget > 0) {
        try {
          const shot = await screenshots.capture(page, {
            scanId,
            label: entry.rule.id,
            index: issueNumber,
            box: g.box,
            cssSelector: entry.node.target[0] ?? ''
          });
          screenshotPath = shot.path || null;
          if (screenshotPath) screenshotBudget -= 1;
        } catch (error) {
          logger.warn(`WCAG: screenshot error for ${entry.rule.id}`, error);
        }
      }

      issues.push(
        createIssue({
          moduleId: MODULE_ID,
          severity,
          status: entry.status,
          title: entry.rule.help,
          description: entry.rule.description,
          html: entry.node.html,
          cssSelector: entry.node.target[0] ?? '',
          xpath: g.xpath,
          wcagReferences: referencesFromTags(entry.rule.tags),
          helpUrl: entry.rule.helpUrl,
          recommendation: entry.node.failureSummary ?? entry.rule.help,
          screenshotPath,
          boundingBox: g.box,
          extra: { ruleId: entry.rule.id, tags: entry.rule.tags }
        })
      );
    }

    return buildModuleResult({
      moduleId: MODULE_ID,
      moduleName: this.name,
      issues,
      durationMs: Date.now() - start,
      passedChecks: results.passes.length,
      metadata: {
        violationRules: results.violations.length,
        incompleteRules: results.incomplete.length,
        passRules: results.passes.length
      }
    });
  }
}

function severityRank(impact: string | null): number {
  switch (impact) {
    case 'critical':
      return 0;
    case 'serious':
      return 1;
    case 'moderate':
      return 2;
    default:
      return 3;
  }
}

// "incomplete" items (for manual verification) are weighted more leniently.
function weaken(impact: string | null): Severity {
  const normalized = normalizeImpact(impact);
  if (normalized === 'critical') return 'serious';
  if (normalized === 'serious') return 'moderate';
  return 'minor';
}
