import type { BoundingBoxDTO } from '@shared/types';

// Function executed in the page context. Self-contained: ARIA tables and helpers
// are defined inline, because the function body is serialized to page.evaluate.

export type AriaFindingKind = 'invalid-role' | 'abstract-role' | 'missing-name' | 'missing-state' | 'broken-ref';

export interface AriaFinding {
  kind: AriaFindingKind;
  role: string | null;
  detail: string;
  cssSelector: string;
  html: string;
  box: BoundingBoxDTO | null;
}

export interface AriaReport {
  findings: AriaFinding[];
  elementsWithRole: number;
}

export function collectAriaFindings(): AriaReport {
  const VALID_ROLES = new Set<string>([
    'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell',
    'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'deletion',
    'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid', 'gridcell',
    'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee',
    'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'none',
    'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row',
    'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status',
    'strong', 'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
    'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'
  ]);
  const ABSTRACT_ROLES = new Set<string>([
    'command', 'composite', 'input', 'landmark', 'range', 'roletype', 'section', 'sectionhead', 'select',
    'structure', 'widget', 'window'
  ]);
  const NAME_REQUIRED = new Set<string>([
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'textbox', 'combobox', 'searchbox', 'slider', 'spinbutton', 'option', 'treeitem'
  ]);
  const REQUIRED_STATES: Record<string, string[]> = {
    checkbox: ['aria-checked'],
    switch: ['aria-checked'],
    radio: ['aria-checked'],
    combobox: ['aria-expanded'],
    slider: ['aria-valuenow'],
    spinbutton: ['aria-valuenow'],
    scrollbar: ['aria-controls', 'aria-valuenow']
  };
  const IDREF_ATTRS = [
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
    'aria-activedescendant',
    'aria-details',
    'aria-flowto',
    'aria-errormessage'
  ];

  const buildSelector = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let seg = node.tagName.toLowerCase();
      let i = 1;
      let sib: Element | null = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) i += 1;
        sib = sib.previousElementSibling;
      }
      seg += `:nth-of-type(${i})`;
      parts.unshift(seg);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  };

  const boxOf = (el: Element): BoundingBoxDTO | null => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const sx = window.scrollX || 0;
    const sy = window.scrollY || 0;
    return { x: r.left + sx, y: r.top + sy, width: r.width, height: r.height };
  };

  const accessibleName = (el: Element): string => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim();
      if (text) return text;
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const findings: AriaFinding[] = [];
  const add = (kind: AriaFindingKind, el: Element, role: string | null, detail: string): void => {
    if (findings.length >= 120) return;
    findings.push({ kind, role, detail, cssSelector: buildSelector(el), html: el.outerHTML.slice(0, 200), box: boxOf(el) });
  };

  // Elements with a role attribute.
  const roled = Array.from(document.querySelectorAll('[role]'));
  for (const el of roled) {
    const roleAttr = (el.getAttribute('role') || '').trim().toLowerCase();
    if (!roleAttr) continue;
    const tokens = roleAttr.split(/\s+/);
    const primary = tokens[0] ?? '';

    // Walidacja kazdego tokenu roli.
    let validPrimaryFound = false;
    for (const token of tokens) {
      if (VALID_ROLES.has(token)) {
        validPrimaryFound = true;
        break;
      }
    }
    if (!validPrimaryFound) {
      const abstractToken = tokens.find((t) => ABSTRACT_ROLES.has(t));
      if (abstractToken) {
        add('abstract-role', el, primary, `Abstract role "${abstractToken}" cannot be used directly`);
      } else {
        add('invalid-role', el, primary, `Unknown ARIA role "${primary}"`);
      }
      continue;
    }

    // Accessible name for roles that require one.
    if (NAME_REQUIRED.has(primary)) {
      if (!accessibleName(el)) {
        add('missing-name', el, primary, `Role "${primary}" requires an accessible name (aria-label, aria-labelledby or text)`);
      }
    }

    // Required states/properties for the role.
    const required = REQUIRED_STATES[primary];
    if (required) {
      for (const attr of required) {
        if (!el.hasAttribute(attr)) {
          add('missing-state', el, primary, `Role "${primary}" requires the attribute ${attr}`);
        }
      }
    }
  }

  // idref references pointing to non-existent elements.
  for (const attr of IDREF_ATTRS) {
    const withAttr = Array.from(document.querySelectorAll(`[${attr}]`));
    for (const el of withAttr) {
      const value = (el.getAttribute(attr) || '').trim();
      if (!value) continue;
      const ids = value.split(/\s+/);
      const missing = ids.filter((id) => id && !document.getElementById(id));
      if (missing.length > 0) {
        add('broken-ref', el, el.getAttribute('role'), `${attr} points to a non-existent id: ${missing.join(', ')}`);
      }
    }
  }

  return { findings, elementsWithRole: roled.length };
}
