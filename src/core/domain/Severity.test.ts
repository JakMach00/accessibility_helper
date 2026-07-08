import { describe, expect, it } from 'vitest';
import { addToCounts, emptyCounts, mergeCounts, normalizeImpact } from './Severity';
import { referencesFromTags } from './WcagReference';

describe('Severity', () => {
  it('mapuje impact axe na dziedzine', () => {
    expect(normalizeImpact('critical')).toBe('critical');
    expect(normalizeImpact('serious')).toBe('serious');
    expect(normalizeImpact('moderate')).toBe('moderate');
    expect(normalizeImpact(null)).toBe('minor');
    expect(normalizeImpact('cokolwiek')).toBe('minor');
  });

  it('zlicza wagi', () => {
    const counts = emptyCounts();
    addToCounts(counts, 'critical');
    addToCounts(counts, 'critical');
    addToCounts(counts, 'minor');
    expect(counts.critical).toBe(2);
    expect(counts.minor).toBe(1);
    expect(counts.total).toBe(3);
  });

  it('laczy liczniki', () => {
    const a = { critical: 1, serious: 2, moderate: 0, minor: 1, total: 4 };
    const b = { critical: 0, serious: 1, moderate: 3, minor: 0, total: 4 };
    const merged = mergeCounts(a, b);
    expect(merged.serious).toBe(3);
    expect(merged.moderate).toBe(3);
    expect(merged.total).toBe(8);
  });
});

describe('WcagReference', () => {
  it('mapuje tagi axe na kryteria WCAG i deduplikuje', () => {
    const refs = referencesFromTags(['wcag2aa', 'wcag143', 'wcag143', 'best-practice']);
    const criteria = refs.map((r) => r.criterion);
    expect(criteria).toContain('1.4.3');
    expect(criteria.filter((c) => c === '1.4.3')).toHaveLength(1);
  });

  it('buduje poprawny link Understanding', () => {
    const refs = referencesFromTags(['wcag412']);
    expect(refs[0]?.url).toContain('WCAG22/Understanding');
    expect(refs[0]?.level).toBe('A');
  });
});
