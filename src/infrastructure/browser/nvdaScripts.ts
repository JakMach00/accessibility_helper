import type { BoundingBoxDTO } from '@shared/types';

// Approximate accessibility tree built from the DOM (role + accessible name + order
// order). This approximates what a screen reader would announce; real NVDA uses
// the platform accessibility tree, so the result needs manual verification.

export interface AxLine {
  role: string;
  name: string;
  level: number | null; // poziom naglowka, jesli dotyczy
  interactive: boolean;
  focusable: boolean;
  cssSelector: string;
  box: BoundingBoxDTO | null;
  html: string;
}

export interface AxTree {
  nodes: AxLine[];
  headingCount: number;
  landmarkCount: number;
  interactiveWithoutName: number;
}

export function buildAccessibilityTree(): AxTree {
  const INTERACTIVE_ROLES = new Set<string>([
    'link', 'button', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'textbox', 'combobox', 'searchbox',
    'slider', 'spinbutton', 'option', 'menuitemcheckbox', 'menuitemradio'
  ]);
  const LANDMARK_ROLES = new Set<string>([
    'banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'
  ]);

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

  const isHidden = (el: HTMLElement): boolean => {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return true;
    return false;
  };

  const implicitRole = (el: HTMLElement): { role: string; level: number | null } => {
    const explicit = (el.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0];
    if (explicit) {
      const lvlAttr = el.getAttribute('aria-level');
      const lvl = lvlAttr ? Number.parseInt(lvlAttr, 10) : null;
      return { role: explicit, level: explicit === 'heading' && lvl ? lvl : null };
    }
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return { role: 'heading', level: Number.parseInt(tag.slice(1), 10) };
    if (tag === 'a' && el.hasAttribute('href')) return { role: 'link', level: null };
    if (tag === 'button') return { role: 'button', level: null };
    if (tag === 'nav') return { role: 'navigation', level: null };
    if (tag === 'main') return { role: 'main', level: null };
    if (tag === 'header') return { role: 'banner', level: null };
    if (tag === 'footer') return { role: 'contentinfo', level: null };
    if (tag === 'aside') return { role: 'complementary', level: null };
    if (tag === 'form') return { role: 'form', level: null };
    if (tag === 'img') return { role: 'img', level: null };
    if (tag === 'select') return { role: 'combobox', level: null };
    if (tag === 'textarea') return { role: 'textbox', level: null };
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset') return { role: 'button', level: null };
      if (type === 'checkbox') return { role: 'checkbox', level: null };
      if (type === 'radio') return { role: 'radio', level: null };
      if (type === 'range') return { role: 'slider', level: null };
      if (type === 'search') return { role: 'searchbox', level: null };
      return { role: 'textbox', level: null };
    }
    return { role: 'generic', level: null };
  };

  const labelForInput = (el: HTMLElement): string => {
    const id = el.getAttribute('id');
    if (id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (forLabel && forLabel.textContent) return forLabel.textContent.replace(/\s+/g, ' ').trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && wrapping.textContent) return wrapping.textContent.replace(/\s+/g, ' ').trim();
    return '';
  };

  const accessibleName = (el: HTMLElement, role: string): string => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) return text;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      return alt === null ? '' : alt.trim();
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const fromLabel = labelForInput(el);
      if (fromLabel) return fromLabel;
      const ph = el.getAttribute('placeholder');
      if (ph && ph.trim()) return ph.trim();
      const val = (el as HTMLInputElement).value;
      if (typeof val === 'string' && val.trim() && role === 'button') return val.trim();
      return '';
    }
    const title = el.getAttribute('title');
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 120);
    if (title && title.trim()) return title.trim();
    return '';
  };

  const SELECTOR =
    'h1, h2, h3, h4, h5, h6, a[href], button, input, select, textarea, img, nav, main, header, footer, aside, form, [role]';
  const elements = Array.from(document.querySelectorAll(SELECTOR)) as HTMLElement[];

  const nodes: AxLine[] = [];
  let headingCount = 0;
  let landmarkCount = 0;
  let interactiveWithoutName = 0;

  for (const el of elements) {
    if (nodes.length >= 300) break;
    if (isHidden(el)) continue;
    const { role, level } = implicitRole(el);
    if (role === 'generic' || role === 'presentation' || role === 'none') continue;
    const name = accessibleName(el, role);
    const interactive = INTERACTIVE_ROLES.has(role);
    const tabRaw = el.getAttribute('tabindex');
    const focusable =
      interactive ||
      (tabRaw !== null && Number.parseInt(tabRaw, 10) >= 0) ||
      ['a', 'button', 'input', 'select', 'textarea'].indexOf(el.tagName.toLowerCase()) !== -1;

    if (role === 'heading') headingCount += 1;
    if (LANDMARK_ROLES.has(role)) landmarkCount += 1;
    if (interactive && !name) interactiveWithoutName += 1;

    nodes.push({
      role,
      name,
      level,
      interactive,
      focusable,
      cssSelector: buildSelector(el),
      box: boxOf(el),
      html: el.outerHTML.slice(0, 160)
    });
  }

  return { nodes, headingCount, landmarkCount, interactiveWithoutName };
}
