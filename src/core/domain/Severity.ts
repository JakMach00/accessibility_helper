import type { Severity, SeverityCounts } from '@shared/types';
import { SEVERITY_ORDER } from '@shared/types';

// Mapowanie poziomu wagi z axe-core (impact) na nasza dziedzine.
export function normalizeImpact(impact: string | null | undefined): Severity {
  switch (impact) {
    case 'critical':
      return 'critical';
    case 'serious':
      return 'serious';
    case 'moderate':
      return 'moderate';
    default:
      return 'minor';
  }
}

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

export function emptyCounts(): SeverityCounts {
  return { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0 };
}

export function addToCounts(counts: SeverityCounts, severity: Severity): SeverityCounts {
  counts[severity] += 1;
  counts.total += 1;
  return counts;
}

export function mergeCounts(a: SeverityCounts, b: SeverityCounts): SeverityCounts {
  return {
    critical: a.critical + b.critical,
    serious: a.serious + b.serious,
    moderate: a.moderate + b.moderate,
    minor: a.minor + b.minor,
    total: a.total + b.total
  };
}
