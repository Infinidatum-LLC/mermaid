/**
 * Draws a laid-out flow (./layout.js) as SVG and HTML strings. No DOM and no
 * framework, so a server writes the picture into its HTML, an API answers with
 * it, and <infd-flow> uses the same strings in the browser.
 *
 * FITS ITS COLUMN WITHOUT A SCRIPT. flowFigure() lays the flow out four ways
 * (as authored, turned, and both wrapped tight for a phone) and writes each
 * one that is the best fit at some column width; a container query shows it
 * there (layout.js: layoutBreaks). A drawing that would shrink below 80%
 * scrolls sideways instead.
 *
 * COLORS come from the same --infd-* custom properties as <infd-diagram>, with
 * the light, dark or auto preset underneath. flowSvg(..., { theme }) bakes a
 * theme's colors in instead, for a standalone image.
 *
 * ACCESSIBILITY. The SVG is hidden from screen readers; `alt` says the whole
 * flow in words, and the legend names each color in text.
 */
import { PRESETS } from '../lib/theme.js';
import { parseFlow } from './parse.js';
import { candidateLayouts, layoutBreaks, LABEL_LINE, LINE, MIN_SCALE } from './layout.js';

/** @typedef {import('./parse.js').Flow} Flow */
/** @typedef {import('./parse.js').FlowClass} FlowClass */
/** @typedef {import('./layout.js').FlowLayout} FlowLayout */

export const LEGEND = {
  person: 'People',
  ai: 'AI',
  check: 'Human check',
  risk: 'Risk or stop',
  done: 'Good outcome',
};

const FONT = 'var(--infd-font, system-ui, -apple-system, "Segoe UI", sans-serif)';

/** The theme colors, as --dg-* variables over --infd-*, for one preset. */
function themeVars(preset) {
  return Object.keys(preset)
    .map((k) => `--dg-${k}:var(--infd-${k},${preset[k]});`)
    .join('');
}

/** Rules that color the drawing from --dg-* variables. */
const DRAWING_CSS = `
.dg-svg{font-family:${FONT}}
.dg-svg text{fill:var(--dg-ink);font-size:13px;text-anchor:middle;dominant-baseline:central}
.dg-node rect,.dg-node polygon{fill:var(--dg-card);stroke:var(--dg-rule);stroke-width:1.25}
.dg-person rect,.dg-person polygon{fill:var(--dg-panel);stroke:var(--dg-ink-soft)}
.dg-ai rect,.dg-ai polygon{fill:var(--dg-ai-bg);stroke:var(--dg-ai)}
.dg-check rect,.dg-check polygon{fill:var(--dg-card);stroke:var(--dg-accent);stroke-width:2}
.dg-risk rect,.dg-risk polygon{fill:var(--dg-risk-bg);stroke:var(--dg-risk)}
.dg-done rect,.dg-done polygon{fill:var(--dg-good-bg);stroke:var(--dg-good)}
.dg-line{fill:none;stroke:var(--dg-ink-soft);stroke-width:1.5}
.dg-dotted{stroke-dasharray:4 4}
.dg-arrowhead{fill:var(--dg-ink-soft)}
.dg-elabel rect{fill:var(--dg-card);stroke:var(--dg-rule)}
.dg-elabel text{font-size:12px;fill:var(--dg-ink-soft)}`;

/**
 * The stylesheet a page (or a shadow root) needs for flowFigure() output.
 * Write it once per page. The motion rules serve ./player.js.
 */
export const FLOW_CSS = `
.dg{${themeVars(PRESETS.light)}color:var(--dg-ink);font-family:${FONT};margin:0}
.dg[data-theme=dark]{${themeVars(PRESETS.dark)}}
@media (prefers-color-scheme:dark){.dg[data-theme=auto]{${themeVars(PRESETS.dark)}}}
.dg-card{border:1px solid var(--dg-rule);border-radius:4px;background:var(--dg-card);padding:12px}
.dg figcaption{margin:0 0 8px;font-size:12px;font-weight:500}
.dg-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.dg-frame{container-type:inline-size;overflow-x:auto}
:where(.dg-frame) .dg-svg{display:block;width:100%;height:auto;margin:0 auto}
${DRAWING_CSS}
.dg-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:8px 0 0;padding:0;list-style:none;font-size:11px;color:var(--dg-ink-soft)}
.dg-legend li{display:inline-flex;align-items:center;gap:6px}
.dg-swatch{display:inline-block;width:12px;height:10px;border-radius:2px;border:1.5px solid}
.dg-swatch.dg-person{background:var(--dg-panel);border-color:var(--dg-ink-soft)}
.dg-swatch.dg-ai{background:var(--dg-ai-bg);border-color:var(--dg-ai)}
.dg-swatch.dg-check{background:var(--dg-card);border-color:var(--dg-accent)}
.dg-swatch.dg-risk{background:var(--dg-risk-bg);border-color:var(--dg-risk)}
.dg-swatch.dg-done{background:var(--dg-good-bg);border-color:var(--dg-good)}
.dg-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;font-size:12px}
.dg-controls button{font:inherit;color:inherit;background:transparent;border:1px solid var(--dg-rule);border-radius:3px;padding:4px 8px;cursor:pointer}
.dg-controls button:hover{border-color:var(--dg-accent)}
.dg-controls span{font-family:ui-monospace,monospace;color:var(--dg-ink-soft)}
.dg-off{opacity:0}
.dg-in{animation:dg-fade 380ms cubic-bezier(.2,.7,.3,1) backwards}
.dg-in .dg-line:not(.dg-dotted){stroke-dasharray:1;animation:dg-draw 420ms ease-out backwards}
@keyframes dg-fade{from{opacity:0}}
@keyframes dg-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.dg-in,.dg-in .dg-line{animation:none}}
@media print{.dg-off{opacity:1}.dg-controls{display:none}}
`;

/** Escapes text for HTML and SVG content and attributes. */
export function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * One layout as an <svg> string. Every box, arrow and arrow label carries
 * `data-r`, its rank from the start, which ./player.js builds in order.
 *
 *   id         prefix for the arrowhead marker; unique on the page
 *   className  extra classes on the <svg>
 *   theme      a preset name or theme object: bakes its colors into the SVG,
 *              for a standalone file, email or an <img>
 *
 * @param {FlowLayout} layout
 * @param {{ id?: string, className?: string, theme?: string | Record<string, string> }} [options]
 */
export function flowSvg(layout, { id = 'dg', className = '', theme } = {}) {
  const { width, height } = layout;
  const t = typeof theme === 'string' ? (PRESETS[theme] ?? PRESETS.light) : theme;
  const style = t
    ? `<style>svg{${Object.keys(PRESETS.light)
        .map((k) => `--dg-${k}:${t[k] ?? PRESETS.light[k]};`)
        .join('')}background:${t.card ?? PRESETS.light.card}}${DRAWING_CSS}</style>`
    : '';
  const sizing = t
    ? ''
    : ` style="max-width:${width}px;min-width:${Math.round(width * MIN_SCALE)}px"`;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="dg-svg${className ? ` ${esc(className)}` : ''}"${sizing} aria-hidden="true" focusable="false">`,
    style,
    `<defs><marker id="${esc(id)}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" class="dg-arrowhead"/></marker></defs>`,
  ];
  for (const e of layout.edges) {
    const cls = e.dotted ? 'dg-line dg-dotted' : 'dg-line';
    const len = e.dotted ? '' : ' pathLength="1"';
    out.push(
      `<g class="dg-edge" data-r="${e.rank}"><path d="${e.d}" class="${cls}"${len} marker-end="url(#${esc(id)}-arrow)"/></g>`
    );
  }
  for (const e of layout.edges) {
    const b = e.labelBox;
    if (!b) continue;
    const spans = b.lines
      .map(
        (line, i) =>
          `<tspan x="${r1(b.x + b.w / 2)}" y="${r1(b.y + 2 + LABEL_LINE * i + LABEL_LINE / 2)}">${esc(line)}</tspan>`
      )
      .join('');
    out.push(
      `<g class="dg-elabel" data-r="${e.rank}"><rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="3"/><text>${spans}</text></g>`
    );
  }
  for (const n of layout.nodes) {
    const shape =
      n.shape === 'decision'
        ? `<polygon points="${[
            [n.x + 12, n.y],
            [n.x + n.w - 12, n.y],
            [n.x + n.w, n.y + n.h / 2],
            [n.x + n.w - 12, n.y + n.h],
            [n.x + 12, n.y + n.h],
            [n.x, n.y + n.h / 2],
          ]
            .map((p) => p.map(r1).join(','))
            .join(' ')}"/>`
        : `<rect x="${r1(n.x)}" y="${r1(n.y)}" width="${r1(n.w)}" height="${r1(n.h)}" rx="6"/>`;
    const spans = n.lines
      .map(
        (line, i) =>
          `<tspan x="${r1(n.x + n.w / 2)}" y="${r1(n.y + 8 + LINE * i + LINE / 2)}">${esc(line)}</tspan>`
      )
      .join('');
    out.push(
      `<g class="dg-node dg-${n.cls ?? 'plain'}" data-r="${n.rank}">${shape}<text>${spans}</text></g>`
    );
  }
  out.push('</svg>');
  return out.join('');
}

/** A short, stable name from the source: the same diagram gets the same one on server and client. */
export function flowId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `dg${(h >>> 0).toString(36)}`;
}

/**
 * A flow as a <figure> string that fits its column without a script.
 * Needs FLOW_CSS on the page. ./player.js adds step-by-step motion.
 *
 *   caption   one sentence above the drawing
 *   alt       the flow in words, for screen readers (required for real pages)
 *   legend    words for the classes, when they mean something else here
 *   variant   "card" (framed, default) or "compact"
 *   theme     "light" (default), "dark" or "auto"
 *   animate   "auto" (default) or "none"; read by ./player.js
 *
 * @param {string | Flow} source  Mermaid-subset source, or an already-built flow
 * @param {{ caption?: string, alt?: string, legend?: Partial<Record<FlowClass, string>>,
 *           variant?: 'card' | 'compact', theme?: 'light' | 'dark' | 'auto', animate?: 'auto' | 'none',
 *           id?: string }} [options]
 */
export function flowFigure(source, options = {}) {
  const { caption, alt, legend, variant = 'card', theme = 'light', animate = 'auto' } = options;
  const flow = typeof source === 'string' ? parseFlow(source) : source;
  const layouts = candidateLayouts(flow);
  const breaks = layoutBreaks(layouts);
  const shown = [...new Set(breaks.map((b) => b.pick))].sort();
  const id =
    options.id ?? flowId(`${typeof source === 'string' ? source : JSON.stringify(flow)}|${theme}`);
  const used = [...new Set(flow.nodes.map((n) => n.cls).filter(Boolean))];
  const words = { ...LEGEND, ...legend };

  // The first drawing is shown unless the column's width picks another.
  const css =
    shown.length > 1
      ? shown
          .slice(1)
          .map((i) => `.${id} .dg-v${i}{display:none}`)
          .join('') +
        breaks
          .filter((b) => b.pick !== shown[0])
          .map((b) => {
            const q = [
              b.from > 0 ? `(min-width:${b.from}px)` : '',
              Number.isFinite(b.to) ? `(max-width:${b.to}px)` : '',
            ]
              .filter(Boolean)
              .join(' and ');
            return `@container ${q}{.${id} .dg-v${shown[0]}{display:none}.${id} .dg-v${b.pick}{display:block}}`;
          })
          .join('')
      : '';

  const out = [
    `<figure class="dg ${id}${variant === 'card' ? ' dg-card' : ''}" data-theme="${esc(theme)}" data-ranks="${layouts[0].ranks}" data-animate="${animate === 'none' ? 'none' : 'auto'}">`,
  ];
  if (css) out.push(`<style>${css}</style>`);
  if (caption) out.push(`<figcaption>${esc(caption)}</figcaption>`);
  if (alt) out.push(`<p class="dg-sr">${esc(alt)}</p>`);
  out.push('<div class="dg-frame">');
  for (const i of shown) out.push(flowSvg(layouts[i], { id: `${id}v${i}`, className: `dg-v${i}` }));
  out.push('</div>');
  if (used.length > 1) {
    out.push('<ul class="dg-legend" aria-label="Colors in this diagram">');
    for (const c of used)
      out.push(
        `<li><span class="dg-swatch dg-${c}" aria-hidden="true"></span>${esc(words[c])}</li>`
      );
    out.push('</ul>');
  }
  out.push('</figure>');
  return out.join('');
}
