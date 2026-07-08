import type { BoundingBoxDTO } from '@shared/types';

// Functions executed in the page context (page.evaluate). Each one is self-contained.

export interface ViewportMetaInfo {
  hasMeta: boolean;
  content: string;
  userScalableNo: boolean;
  maximumScale: number | null;
}

export interface OverflowElement {
  tag: string;
  cssSelector: string;
  html: string;
  right: number; // prawa krawedz elementu w px (wzgledem viewportu)
  width: number;
  box: BoundingBoxDTO | null;
}

export interface OverflowReport {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  overflowX: number; // scrollWidth - clientWidth (horizontal page scrolling)
  elements: OverflowElement[];
}

// Reads the meta viewport and detects zoom blocking (user-scalable=no / maximum-scale < 2).
export function readViewportMeta(): ViewportMetaInfo {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    return { hasMeta: false, content: '', userScalableNo: false, maximumScale: null };
  }
  const content = (meta.getAttribute('content') || '').toLowerCase();
  const userScalableNo = /user-scalable\s*=\s*(no|0)/.test(content);
  let maximumScale: number | null = null;
  const match = content.match(/maximum-scale\s*=\s*([0-9.]+)/);
  if (match && match[1]) {
    const parsed = Number.parseFloat(match[1]);
    maximumScale = Number.isNaN(parsed) ? null : parsed;
  }
  return { hasMeta: true, content, userScalableNo, maximumScale };
}

// Pomiar poziomego przepelnienia i elementow wystajacych poza szerokosc viewportu.
export function measureOverflow(): OverflowReport {
  const TOL = 2;

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
    return true;
  };

  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;

  const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
  const overflowing: OverflowElement[] = [];
  for (const el of all) {
    if (overflowing.length >= 60) break;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.right <= clientWidth + TOL) continue;
    if (!isVisible(el)) continue;
    // Jesli rodzic tez wystaje, raportujemy najwyzszego przodka (mniej szumu).
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      const pr = parent.getBoundingClientRect();
      if (pr.right > clientWidth + TOL) continue;
    }
    overflowing.push({
      tag: el.tagName.toLowerCase(),
      cssSelector: buildSelector(el),
      html: el.outerHTML.slice(0, 200),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      box: boxOf(el)
    });
  }
  overflowing.sort((a, b) => b.right - a.right);

  return {
    scrollWidth: doc.scrollWidth,
    clientWidth,
    scrollHeight: doc.scrollHeight,
    clientHeight: doc.clientHeight,
    overflowX: doc.scrollWidth - clientWidth,
    elements: overflowing.slice(0, 40)
  };
}
