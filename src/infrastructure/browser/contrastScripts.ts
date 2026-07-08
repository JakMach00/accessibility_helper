import type { BoundingBoxDTO } from '@shared/types';

// Functions executed in the page context. The contrast math lives solely in
// measureContrastAt, dzieki czemu pomiar stanu domyslnego i wymuszonych stanow
// (:hover / :focus / :active) korzysta z tej samej logiki.

export interface ContrastCandidate {
  index: number; // value of the data-wcag-ct attribute
  tag: string;
  role: string | null;
  cssSelector: string;
  html: string;
  text: string;
  box: BoundingBoxDTO | null;
}

export interface ContrastMeasurement {
  ratio: number | null; // null = nie da sie policzyc pewnie (np. obraz w tle)
  fg: string;
  bg: string;
  hasBgImage: boolean;
  isLargeText: boolean;
  fontSizePx: number;
  fontWeight: number;
}

// Tags interactive elements that have text and returns their description (without measuring contrast).
export function prepareContrastCandidates(): ContrastCandidate[] {
  const SELECTOR =
    'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"], input[type="reset"], summary, label';

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

  const raw = Array.from(document.querySelectorAll(SELECTOR)) as HTMLElement[];
  const out: ContrastCandidate[] = [];
  let idx = 0;
  for (const el of raw) {
    if (out.length >= 40) break;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!isVisible(el)) continue;
    el.setAttribute('data-wcag-ct', String(idx));
    out.push({
      index: idx,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      cssSelector: buildSelector(el),
      html: el.outerHTML.slice(0, 200),
      text: text.slice(0, 80),
      box: boxOf(el)
    });
    idx += 1;
  }
  return out;
}

// Measures the contrast of a single element in its CURRENT state (default or forced).
export function measureContrastAt(payload: { selector: string }): ContrastMeasurement | null {
  const el = document.querySelector(payload.selector) as HTMLElement | null;
  if (!el) return null;

  interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  const parseColor = (str: string): Rgba | null => {
    const s = str.trim();
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m || !m[1]) return null;
    const parts = m[1].split(',').map((p) => p.trim());
    const r = Number.parseFloat(parts[0] ?? '0');
    const g = Number.parseFloat(parts[1] ?? '0');
    const b = Number.parseFloat(parts[2] ?? '0');
    const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b, a: Number.isNaN(a) ? 1 : a };
  };

  const blend = (base: Rgba, top: Rgba): Rgba => {
    const a = top.a;
    return {
      r: base.r * (1 - a) + top.r * a,
      g: base.g * (1 - a) + top.g * a,
      b: base.b * (1 - a) + top.b * a,
      a: 1
    };
  };

  const relLum = (c: Rgba): number => {
    const chan = (v: number): number => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  };

  const contrast = (a: Rgba, b: Rgba): number => {
    const l1 = relLum(a);
    const l2 = relLum(b);
    const light = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
  };

  // Efektywne tlo: kompozycja warstw od korzenia do elementu na bialym tle.
  let hasBgImage = false;
  const layers: Rgba[] = [];
  let node: HTMLElement | null = el;
  let depth = 0;
  while (node && depth < 15) {
    const st = window.getComputedStyle(node);
    if (st.backgroundImage && st.backgroundImage !== 'none') hasBgImage = true;
    const bg = parseColor(st.backgroundColor);
    if (bg && bg.a > 0) layers.push(bg);
    node = node.parentElement;
    depth += 1;
  }
  let bgColor: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer) bgColor = blend(bgColor, layer);
  }

  const style = window.getComputedStyle(el);
  let fgColor = parseColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  if (fgColor.a < 1) fgColor = blend(bgColor, fgColor);

  const fontSizePx = Number.parseFloat(style.fontSize) || 16;
  const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
  const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);

  const ratio = Math.round(contrast(fgColor, bgColor) * 100) / 100;

  const fmt = (c: Rgba): string => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

  return {
    ratio,
    fg: fmt(fgColor),
    bg: fmt(bgColor),
    hasBgImage,
    isLargeText,
    fontSizePx,
    fontWeight
  };
}

// Removes temporary attributes after the module finishes.
export function cleanupContrastMarkers(): number {
  const marked = Array.from(document.querySelectorAll('[data-wcag-ct]'));
  for (const el of marked) el.removeAttribute('data-wcag-ct');
  return marked.length;
}
