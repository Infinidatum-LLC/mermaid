/**
 * The Infinidatum Mermaid client: every way a project can use this service,
 * from one import. Works in browsers; parse, renderSvg, renderPng, imageUrl
 * and embedUrl also work in Node 18+ and other runtimes with fetch.
 *
 *   import * as infd from 'https://<host>/v/<version>/client.js';
 *
 *   await infd.render(el, code, { caption, theme: 'auto', flow: 'dots' }); // <infd-diagram>
 *   infd.embed(el, code, { caption });        // an auto-sized <iframe>, isolated from the page
 *   infd.embedUrl(code, options);             // the iframe URL, for a CMS or LMS
 *   await infd.parse(code);                   // { ok, diagramType } or { ok: false, error, line }
 *   await infd.parse({ a: code1, b: code2 }); // batch
 *   await infd.renderSvg(code, { theme });    // SVG markup, drawn on the server
 *   await infd.renderPng(code, { scale: 2 }); // PNG Blob
 *   infd.imageUrl(code, { format: 'png' });   // a GET URL for <img src>, cached by the CDN
 *
 * Options for render, embed and embedUrl mirror <infd-diagram>'s attributes:
 * caption, alt, theme, flow, tools, speed, animate, controls, focus,
 * highlight, fit. embed and embedUrl also take bg (page background), colors (card, panel, ink,
 * ink-soft, rule, accent, ai, ai-bg, good, good-bg, risk, risk-bg) and font,
 * because an iframe cannot inherit the page's --infd-* variables.
 */

const here = new URL('.', import.meta.url);
let origin = here.origin;

/** The Mermaid version this client belongs to, from its URL. */
export const version = /\/v\/([^/]+)\//.exec(here.pathname)?.[1] ?? 'latest';

/** Points the API calls at another deployment (for self-hosting or local testing). */
export function configure({ origin: o } = {}) {
  if (o) origin = new URL(o).origin;
}

const ELEMENT_OPTIONS = [
  'caption',
  'alt',
  'theme',
  'flow',
  'tools',
  'speed',
  'animate',
  'controls',
  'focus',
  'highlight',
  'fit',
  'src',
];
const COLORS = [
  'card',
  'panel',
  'ink',
  'ink-soft',
  'rule',
  'accent',
  'ai',
  'ai-bg',
  'good',
  'good-bg',
  'risk',
  'risk-bg',
  'font',
];

/* ---------- in the page ---------- */

/**
 * Draws `code` as an <infd-diagram> inside `target` (an element or selector)
 * and resolves with the element once it has drawn.
 */
export async function render(target, code, options = {}) {
  await import(new URL('diagram.js', here).href);
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error(`No element for ${target}`);
  const el = document.createElement('infd-diagram');
  for (const k of ELEMENT_OPTIONS) if (options[k] != null) el.setAttribute(k, String(options[k]));
  const drawn = new Promise((resolve, reject) => {
    el.addEventListener('infd-drawn', () => resolve(el), { once: true });
    el.addEventListener('infd-error', (e) => reject(e.detail), { once: true });
  });
  if (code) el.code = code;
  host.replaceChildren(el);
  return drawn;
}

/* ---------- in an iframe ---------- */

/**
 * The URL of a page that shows one diagram. The source travels in the URL
 * fragment, which browsers never send to the server.
 */
export function embedUrl(code, options = {}) {
  const params = new URLSearchParams();
  if (code) params.set('code', code);
  for (const k of [...ELEMENT_OPTIONS, ...COLORS, 'bg', 'id'])
    if (options[k] != null) params.set(k, String(options[k]));
  return `${new URL('embed.html', here).href}#${params}`;
}

let embeds = 0;

/**
 * Puts an iframe showing `code` inside `target`. It resizes to the diagram's
 * height and forwards infd-step and infd-node-click as events on the iframe.
 */
export function embed(target, code, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error(`No element for ${target}`);
  const id = `infd-embed-${++embeds}`;
  const frame = document.createElement('iframe');
  frame.src = embedUrl(code, { ...options, id });
  frame.title = options.caption || options.alt || 'Diagram';
  frame.loading = 'lazy';
  frame.style.cssText = 'display:block;width:100%;border:0;height:240px';
  const listen = (e) => {
    if (e.origin !== here.origin || e.source !== frame.contentWindow || e.data?.id !== id) return;
    if (e.data.type === 'infd-embed-size') frame.style.height = `${Math.ceil(e.data.height)}px`;
    else if (e.data.type)
      frame.dispatchEvent(new CustomEvent(e.data.type, { detail: e.data.detail }));
  };
  addEventListener('message', listen);
  host.replaceChildren(frame);
  frame.destroy = () => {
    removeEventListener('message', listen);
    frame.remove();
  };
  return frame;
}

/* ---------- on the server ---------- */

async function post(path, body) {
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 500) throw new Error(`${path} answered ${res.status}`);
  return res;
}

/** Checks syntax. `code` is one source string, or an object of named sources. */
export async function parse(code) {
  const body = typeof code === 'string' ? { code } : { diagrams: code };
  return (await post('/api/parse', body)).json();
}

async function image(code, options, format) {
  const res = await post('/api/render', { ...options, code, format });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? `Render failed (${res.status})`), err);
  }
  return res;
}

/** SVG markup for `code`, drawn on the server. Options: theme, labels, colors. */
export async function renderSvg(code, options = {}) {
  return (await image(code, options, 'svg')).text();
}

/** A PNG Blob for `code`, drawn on the server. Options: theme, scale (1 to 4), colors. */
export async function renderPng(code, options = {}) {
  return (await image(code, options, 'png')).blob();
}

/**
 * A GET URL that returns `code` as an image, for <img src>, email and
 * Markdown. Identical requests are served from the CDN cache.
 */
export function imageUrl(code, { format = 'svg', ...options } = {}) {
  const params = new URLSearchParams({ code, format });
  for (const k of ['theme', 'scale', 'labels', ...COLORS])
    if (options[k] != null) params.set(k, String(options[k]));
  return `${origin}/api/render?${params}`;
}
