import type { BoundingBoxDTO } from '@shared/types';

// Functions executed in the page context (page.evaluate). Each one is self-contained:
// helpers are defined inline, because the function body is serialized to the browser.

export interface DynamicCandidate {
  cssSelector: string;
  tag: string;
  text: string;
  html: string;
  box: BoundingBoxDTO | null;
  focusable: boolean; // reachable by keyboard (native or tabindex >= 0)
  hasPopupAttr: boolean; // declares aria-haspopup / aria-expanded / aria-controls
  expandedBefore: string | null; // aria-expanded value before hovering
}

export interface DynamicScanReport {
  candidates: DynamicCandidate[];
  totalConsidered: number;
}

export interface RevealSnapshot {
  visibleCount: number;
  signature: string;
}

export interface RevealResult {
  revealed: boolean;
  revealedText: string;
  revealedSelector: string;
  revealedBox: BoundingBoxDTO | null;
  expandedAfter: string | null;
  inTriggerSubtree: boolean; // revealed content sits inside the trigger (keyboard focus may still reach it)
}

// Finds elements that plausibly reveal content on hover: menu bars, nav items with
// nested lists, and anything declaring a popup relationship.
export function collectDynamicCandidates(): DynamicScanReport {
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

  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const isFocusable = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    const ti = el.getAttribute('tabindex');
    if (ti !== null) return Number(ti) >= 0;
    if (tag === 'a') return el.hasAttribute('href');
    return tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'summary';
  };

  // A hidden descendant suggests content that appears on hover.
  const hasHiddenDescendant = (el: Element): boolean => {
    const kids = el.querySelectorAll('ul, ol, div, nav, section, [role="menu"], [role="listbox"], [role="tooltip"]');
    for (const kid of Array.from(kids).slice(0, 8)) {
      const style = window.getComputedStyle(kid);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return true;
    }
    return false;
  };

  const seen = new Set<Element>();
  const candidates: DynamicCandidate[] = [];
  let totalConsidered = 0;

  const declared = Array.from(document.querySelectorAll('[aria-haspopup], [aria-expanded], [aria-controls]'));
  const navish = Array.from(document.querySelectorAll('nav a, nav button, [role="menubar"] *, li > a, li > button'));
  const pool = [...declared, ...navish];

  for (const el of pool) {
    if (candidates.length >= 25) break;
    if (seen.has(el)) continue;
    seen.add(el);
    if (!isVisible(el)) continue;
    totalConsidered += 1;

    const hasPopupAttr =
      el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls');
    const parentLi = el.closest('li');
    const parentHasHidden = parentLi ? hasHiddenDescendant(parentLi) : false;

    // Only keep elements that plausibly reveal something.
    if (!hasPopupAttr && !parentHasHidden && !hasHiddenDescendant(el)) continue;

    candidates.push({
      cssSelector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      html: el.outerHTML.slice(0, 200),
      box: boxOf(el),
      focusable: isFocusable(el),
      hasPopupAttr,
      expandedBefore: el.getAttribute('aria-expanded')
    });
  }

  return { candidates, totalConsidered };
}

// Snapshot of what is visible, used to detect content revealed by hovering.
export function snapshotVisible(): RevealSnapshot {
  const all = Array.from(document.querySelectorAll('a, button, [role="menuitem"], [role="option"], [role="tooltip"]'));
  let visibleCount = 0;
  const ids: string[] = [];
  for (const el of all) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    visibleCount += 1;
    if (ids.length < 200) ids.push(`${el.tagName}:${Math.round(r.left)},${Math.round(r.top)}`);
  }
  return { visibleCount, signature: ids.join('|') };
}

// After hovering, compares against the baseline snapshot to find revealed content.
export function measureReveal(arg: { before: RevealSnapshot; triggerSelector: string }): RevealResult {
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

  const after = (): { count: number; sig: string; items: Element[] } => {
    const all = Array.from(
      document.querySelectorAll('a, button, [role="menuitem"], [role="option"], [role="tooltip"]')
    );
    const items: Element[] = [];
    const ids: string[] = [];
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      items.push(el);
      if (ids.length < 200) ids.push(`${el.tagName}:${Math.round(r.left)},${Math.round(r.top)}`);
    }
    return { count: items.length, sig: ids.join('|'), items };
  };

  const snap = after();
  const trigger = arg.triggerSelector ? document.querySelector(arg.triggerSelector) : null;
  const grew = snap.count > arg.before.visibleCount;
  const changed = snap.sig !== arg.before.signature;

  if (!grew && !changed) {
    return {
      revealed: false,
      revealedText: '',
      revealedSelector: '',
      revealedBox: null,
      expandedAfter: trigger ? trigger.getAttribute('aria-expanded') : null,
      inTriggerSubtree: false
    };
  }

  // Find a newly visible container: the closest common wrapper of the new items.
  const beforeIds = new Set(arg.before.signature.split('|'));
  let newest: Element | null = null;
  for (const el of snap.items) {
    const r = el.getBoundingClientRect();
    const key = `${el.tagName}:${Math.round(r.left)},${Math.round(r.top)}`;
    if (!beforeIds.has(key)) {
      newest = el;
      break;
    }
  }

  const container = newest ? (newest.closest('ul, [role="menu"], [role="listbox"], [role="tooltip"], div') ?? newest) : null;
  const target = container ?? newest;

  return {
    revealed: Boolean(target) && grew,
    revealedText: target ? (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
    revealedSelector: target ? buildSelector(target) : '',
    revealedBox: target ? boxOf(target) : null,
    expandedAfter: trigger ? trigger.getAttribute('aria-expanded') : null,
    inTriggerSubtree: Boolean(trigger && target && trigger.contains(target))
  };
}

// Waits for a menu/tooltip transition to finish before measuring what appeared.
// Many menus fade or slide in, so measuring immediately after hovering sees nothing.
export function waitForReveal(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 350);
  });
}
