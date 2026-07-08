import type { WcagLevel, WcagReferenceDTO } from '@shared/types';

interface CriterionMeta {
  criterion: string;
  level: WcagLevel;
  title: string;
}

// Podzbior najczesciej trafianych kryteriow WCAG 2.2. Klucz to tag axe (np. "wcag143").
// The catalog is intentionally extensible; further modules can add entries.
const CATALOG: Record<string, CriterionMeta> = {
  wcag111: { criterion: '1.1.1', level: 'A', title: 'Non-text Content' },
  wcag121: { criterion: '1.2.1', level: 'A', title: 'Audio-only and Video-only (Prerecorded)' },
  wcag131: { criterion: '1.3.1', level: 'A', title: 'Info and Relationships' },
  wcag132: { criterion: '1.3.2', level: 'A', title: 'Meaningful Sequence' },
  wcag135: { criterion: '1.3.5', level: 'AA', title: 'Identify Input Purpose' },
  wcag141: { criterion: '1.4.1', level: 'A', title: 'Use of Color' },
  wcag143: { criterion: '1.4.3', level: 'AA', title: 'Contrast (Minimum)' },
  wcag144: { criterion: '1.4.4', level: 'AA', title: 'Resize Text' },
  wcag1410: { criterion: '1.4.10', level: 'AA', title: 'Reflow' },
  wcag1411: { criterion: '1.4.11', level: 'AA', title: 'Non-text Contrast' },
  wcag1412: { criterion: '1.4.12', level: 'AA', title: 'Text Spacing' },
  wcag1413: { criterion: '1.4.13', level: 'AA', title: 'Content on Hover or Focus' },
  wcag211: { criterion: '2.1.1', level: 'A', title: 'Keyboard' },
  wcag212: { criterion: '2.1.2', level: 'A', title: 'No Keyboard Trap' },
  wcag241: { criterion: '2.4.1', level: 'A', title: 'Bypass Blocks' },
  wcag242: { criterion: '2.4.2', level: 'A', title: 'Page Titled' },
  wcag243: { criterion: '2.4.3', level: 'A', title: 'Focus Order' },
  wcag244: { criterion: '2.4.4', level: 'A', title: 'Link Purpose (In Context)' },
  wcag246: { criterion: '2.4.6', level: 'AA', title: 'Headings and Labels' },
  wcag247: { criterion: '2.4.7', level: 'AA', title: 'Focus Visible' },
  wcag2411: { criterion: '2.4.11', level: 'AA', title: 'Focus Not Obscured (Minimum)' },
  wcag256: { criterion: '2.5.6', level: 'AAA', title: 'Concurrent Input Mechanisms' },
  wcag258: { criterion: '2.5.8', level: 'AA', title: 'Target Size (Minimum)' },
  wcag311: { criterion: '3.1.1', level: 'A', title: 'Language of Page' },
  wcag325: { criterion: '3.2.5', level: 'AAA', title: 'Change on Request' },
  wcag332: { criterion: '3.3.2', level: 'A', title: 'Labels or Instructions' },
  wcag411: { criterion: '4.1.1', level: 'A', title: 'Parsing (obsolete)' },
  wcag412: { criterion: '4.1.2', level: 'A', title: 'Name, Role, Value' },
  wcag413: { criterion: '4.1.3', level: 'AA', title: 'Status Messages' }
};

function urlFor(criterion: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html#${criterion}`;
}

export function referenceFromTag(tag: string): WcagReferenceDTO | null {
  const meta = CATALOG[tag];
  if (!meta) return null;
  return { criterion: meta.criterion, level: meta.level, title: meta.title, url: urlFor(meta.criterion, meta.title) };
}

// Buduje liste referencji WCAG z listy tagow axe, deduplikujac po kryterium.
export function referencesFromTags(tags: string[]): WcagReferenceDTO[] {
  const seen = new Set<string>();
  const out: WcagReferenceDTO[] = [];
  for (const tag of tags) {
    const ref = referenceFromTag(tag);
    if (ref && !seen.has(ref.criterion)) {
      seen.add(ref.criterion);
      out.push(ref);
    }
  }
  return out;
}

// Direct lookup by criterion number (used by non-axe modules).
export function referenceByCriterion(criterion: string): WcagReferenceDTO | null {
  const key = 'wcag' + criterion.replace(/\./g, '');
  return referenceFromTag(key);
}
