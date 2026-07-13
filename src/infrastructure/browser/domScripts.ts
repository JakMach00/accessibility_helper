import type { BoundingBoxDTO } from '@shared/types';

// Result of fetching DOM node information based on a CSS selector.
export interface NodeInfo {
  found: boolean;
  html: string;
  xpath: string;
  box: BoundingBoxDTO | null;
}

// NOTE: this function is executed in the page context (page.evaluate),
// so it cannot use anything outside the browser.
export function computeNodeInfo(selector: string): NodeInfo {
  const el = document.querySelector(selector);
  if (!el) {
    return { found: false, html: '', xpath: '', box: null };
  }

  const buildXPath = (node: Element): string => {
    if (node.id) {
      return `//*[@id="${node.id}"]`;
    }
    const segments: string[] = [];
    let current: Element | null = node;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      const tag = current.tagName.toLowerCase();
      segments.unshift(`${tag}[${index}]`);
      current = current.parentElement;
    }
    return '/' + segments.join('/');
  };

  const rect = el.getBoundingClientRect();
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || 0;
  const box: BoundingBoxDTO =
    rect.width > 0 && rect.height > 0
      ? { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height }
      : { x: 0, y: 0, width: 0, height: 0 };

  const outer = el.outerHTML;
  const html = outer.length > 2000 ? outer.slice(0, 2000) + '...' : outer;

  return {
    found: true,
    html,
    xpath: buildXPath(el),
    box: box.width > 0 && box.height > 0 ? box : null
  };
}

// Reads computed styles, ARIA attributes and basic data for the DOM inspector.
export interface InspectResult {
  found: boolean;
  html: string;
  xpath: string;
  computedStyles: Record<string, string>;
  ariaAttributes: Record<string, string>;
}

export function inspectNode(selector: string): InspectResult {
  const el = document.querySelector(selector);
  if (!el) {
    return { found: false, html: '', xpath: '', computedStyles: {}, ariaAttributes: {} };
  }

  const buildXPath = (node: Element): string => {
    if (node.id) return `//*[@id="${node.id}"]`;
    const segments: string[] = [];
    let current: Element | null = node;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
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

  const interesting = [
    'color',
    'background-color',
    'font-size',
    'font-weight',
    'display',
    'visibility',
    'opacity',
    'outline',
    'outline-color',
    'outline-width',
    'box-shadow',
    'position',
    'width',
    'height'
  ];
  const cs = window.getComputedStyle(el);
  const computedStyles: Record<string, string> = {};
  for (const prop of interesting) {
    computedStyles[prop] = cs.getPropertyValue(prop);
  }

  const ariaAttributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'role' || attr.name.startsWith('aria-')) {
      ariaAttributes[attr.name] = attr.value;
    }
  }

  const outer = el.outerHTML;
  return {
    found: true,
    html: outer.length > 4000 ? outer.slice(0, 4000) + '...' : outer,
    xpath: buildXPath(el),
    computedStyles,
    ariaAttributes
  };
}

// Rysuje w stronie tymczasowy overlay (czerwony prostokat + numer) wokol elementu.
// Returns the overlay id so it can be removed after the screenshot.
export function drawOverlay(payload: { box: BoundingBoxDTO; label: string }): string {
  const id = 'wcag-auditor-overlay-' + Math.random().toString(36).slice(2);
  const wrapper = document.createElement('div');
  wrapper.id = id;
  wrapper.style.cssText = [
    'position:fixed',
    `left:${payload.box.x}px`,
    `top:${payload.box.y}px`,
    `width:${payload.box.width}px`,
    `height:${payload.box.height}px`,
    'border:3px solid #ff3b30',
    'box-sizing:border-box',
    'z-index:2147483647',
    'pointer-events:none'
  ].join(';');

  const badge = document.createElement('div');
  badge.textContent = payload.label;
  badge.style.cssText = [
    'position:absolute',
    'top:-22px',
    'left:-3px',
    'background:#ff3b30',
    'color:#fff',
    'font:bold 12px/18px system-ui,sans-serif',
    'padding:0 6px',
    'border-radius:3px',
    'white-space:nowrap'
  ].join(';');

  wrapper.appendChild(badge);
  document.body.appendChild(wrapper);
  return id;
}

export function removeOverlay(id: string): void {
  const el = document.getElementById(id);
  if (el) el.remove();
}
