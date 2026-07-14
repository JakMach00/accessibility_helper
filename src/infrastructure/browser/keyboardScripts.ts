import type { BoundingBoxDTO } from '@shared/types';

// Functions in this file are serialized and executed in the page context (page.evaluate).
// Each function is therefore self-contained: it refers neither to imports nor to
// module variables, and defines all helpers inside itself.

export interface FocusableDescriptor {
  index: number; // value of the data-wcag-kbd attribute set on the element
  tag: string;
  role: string | null;
  tabindex: number | null;
  name: string;
  visible: boolean;
  box: BoundingBoxDTO | null;
  cssSelector: string;
  html: string;
}

export interface ClickableDescriptor {
  tag: string;
  role: string | null;
  reason: string;
  box: BoundingBoxDTO | null;
  cssSelector: string;
  html: string;
}

export interface NavInfo {
  hasMain: boolean;
  landmarkCount: number;
  headingCount: number;
  hasSkipLink: boolean;
  skipLinkText: string;
}

export interface FocusStyleResult {
  index: number;
  changed: boolean; // whether the computed style changed after focusing
  focusableConfirmed: boolean; // whether the element actually took focus
}

export interface KeyboardData {
  focusables: FocusableDescriptor[];
  clickables: ClickableDescriptor[];
  nav: NavInfo;
  focusStyles: FocusStyleResult[];
}

export interface ActiveSignature {
  kbdIndex: number | null; // data-wcag-kbd aktywnego elementu, jesli oznaczony
  tag: string;
  isBody: boolean;
}

// How many of the first elements to check for a visible focus indicator (time limit).
const FOCUS_SAMPLE_LIMIT = 80;

// One large query: tags elements, collects the inventory, clickable non-focusable ones,
// landmarks and the visible-focus analysis result.
export function collectKeyboardData(): KeyboardData {
  const FOCUS_SAMPLE = 80;

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

  const isVisible = (el: HTMLElement): boolean => {
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
    if (Number.parseFloat(st.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  };

  const nameOf = (el: HTMLElement): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, 80);
    if (el.tagName === 'INPUT' || el.tagName === 'BUTTON') {
      const val = (el as HTMLInputElement).value;
      if (typeof val === 'string' && val.trim()) return val.trim().slice(0, 80);
    }
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim().slice(0, 80);
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim().slice(0, 80);
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim().slice(0, 80);
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  };

  const snap = (el: HTMLElement): string => {
    const s = window.getComputedStyle(el);
    return [
      s.outlineStyle,
      s.outlineWidth,
      s.outlineColor,
      s.boxShadow,
      s.borderTopWidth,
      s.borderTopColor,
      s.borderBottomWidth,
      s.backgroundColor,
      s.color
    ].join('|');
  };

  // --- Inventory of elements in Tab order ---
  const FOCUSABLE_SELECTOR =
    'a[href], area[href], button, input, select, textarea, [tabindex], [contenteditable=""], [contenteditable="true"], audio[controls], video[controls], iframe, summary';
  const raw = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
  const focusables: FocusableDescriptor[] = [];
  let idx = 0;
  for (const el of raw) {
    const tabRaw = el.getAttribute('tabindex');
    let tabindex: number | null = null;
    if (tabRaw !== null) {
      const parsed = Number.parseInt(tabRaw, 10);
      tabindex = Number.isNaN(parsed) ? null : parsed;
    }
    const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
    const inTabOrder = tabindex === null ? true : tabindex >= 0;
    if (!inTabOrder || disabled) continue;

    el.setAttribute('data-wcag-kbd', String(idx));
    focusables.push({
      index: idx,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      tabindex,
      name: nameOf(el),
      visible: isVisible(el),
      box: boxOf(el),
      cssSelector: buildSelector(el),
      html: el.outerHTML.slice(0, 300)
    });
    idx += 1;
  }

  // --- Clickable but not keyboard-focusable ---
  const INTERACTIVE_ROLES = [
    'button',
    'link',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'checkbox',
    'switch',
    'radio',
    'option',
    'slider',
    'spinbutton'
  ];
  const NATIVE = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'];
  const clickables: ClickableDescriptor[] = [];
  const everything = Array.from(document.querySelectorAll('*')) as HTMLElement[];
  for (const el of everything) {
    if (clickables.length >= 100) break;
    const role = el.getAttribute('role');
    const hasOnclick = el.hasAttribute('onclick') || typeof el.onclick === 'function';
    const roleInteractive = role !== null && INTERACTIVE_ROLES.indexOf(role) !== -1;
    if (!hasOnclick && !roleInteractive) continue;
    if (NATIVE.indexOf(el.tagName) !== -1) continue;
    const tabRaw = el.getAttribute('tabindex');
    const tab = tabRaw === null ? null : Number.parseInt(tabRaw, 10);
    const keyboardReachable = tab !== null && !Number.isNaN(tab) && tab >= 0;
    if (keyboardReachable) continue;
    if (!isVisible(el)) continue;
    const reason =
      roleInteractive && !hasOnclick
        ? `Element with role "${role ?? ''}" is not reachable by keyboard (no tabindex)`
        : 'Element with a click handler is not reachable by keyboard (no tabindex)';
    clickables.push({
      tag: el.tagName.toLowerCase(),
      role,
      reason,
      box: boxOf(el),
      cssSelector: buildSelector(el),
      html: el.outerHTML.slice(0, 300)
    });
  }

  // --- Punkty orientacyjne i skip-link ---
  const landmarkSelector =
    'header, nav, main, aside, footer, form, [role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], [role="search"], [role="form"]';
  const landmarkCount = document.querySelectorAll(landmarkSelector).length;
  const headingCount = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').length;
  const hasMain = document.querySelector('main, [role="main"]') !== null;

  let hasSkipLink = false;
  let skipLinkText = '';
  const anchors = Array.from(document.querySelectorAll('a[href^="#"]')).slice(0, 6) as HTMLAnchorElement[];
  const skipPattern = /\bskip\b|\bjump to\b/i;
  for (const a of anchors) {
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    const idAndClass = `${a.id} ${a.className}`.toLowerCase();
    if (skipPattern.test(text) || idAndClass.indexOf('skip') !== -1) {
      hasSkipLink = true;
      skipLinkText = text.slice(0, 80);
      break;
    }
  }

  const nav: NavInfo = { hasMain, landmarkCount, headingCount, hasSkipLink, skipLinkText };

  // --- Visible-focus analysis for the first N elements ---
  const focusStyles: FocusStyleResult[] = [];
  const limit = Math.min(focusables.length, FOCUS_SAMPLE, FOCUS_SAMPLE_LIMIT);
  for (let i = 0; i < limit; i += 1) {
    const desc = focusables[i];
    if (!desc) continue;
    const el = document.querySelector(`[data-wcag-kbd="${desc.index}"]`) as HTMLElement | null;
    if (!el) {
      focusStyles.push({ index: desc.index, changed: false, focusableConfirmed: false });
      continue;
    }
    const before = snap(el);
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* some elements may throw on focus, ignore */
    }
    const focusableConfirmed = document.activeElement === el;
    const after = snap(el);
    focusStyles.push({ index: desc.index, changed: before !== after, focusableConfirmed });
    try {
      el.blur();
    } catch {
      /* noop */
    }
  }

  // Leave a clean focus state before the Tab probe.
  const active = document.activeElement as HTMLElement | null;
  if (active && typeof active.blur === 'function') active.blur();
  window.scrollTo(0, 0);

  return { focusables, clickables, nav, focusStyles };
}

// Reads the active element and its data-wcag-kbd marker (to map the Tab sequence).
export function activeElementSignature(): ActiveSignature {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) {
    return { kbdIndex: null, tag: el ? el.tagName.toLowerCase() : 'none', isBody: true };
  }
  const attr = el.getAttribute('data-wcag-kbd');
  const kbdIndex = attr === null ? null : Number.parseInt(attr, 10);
  return {
    kbdIndex: kbdIndex !== null && !Number.isNaN(kbdIndex) ? kbdIndex : null,
    tag: el.tagName.toLowerCase(),
    isBody: false
  };
}

// Reset focus and scroll to the top before starting the Tab probe.
export function resetFocusToTop(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (active && typeof active.blur === 'function') active.blur();
  window.scrollTo(0, 0);
  return true;
}

// Remove temporary attributes and clear focus after the module finishes.
export function cleanupKeyboardMarkers(): number {
  const marked = Array.from(document.querySelectorAll('[data-wcag-kbd]'));
  for (const el of marked) el.removeAttribute('data-wcag-kbd');
  const active = document.activeElement as HTMLElement | null;
  if (active && typeof active.blur === 'function') active.blur();
  return marked.length;
}
