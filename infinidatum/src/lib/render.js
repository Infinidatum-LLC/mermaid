/**
 * Draws Mermaid source into an element with the Infinidatum theme.
 */
// Resolved beside the bundled file: scripts/assemble.mjs keeps this import external.
import mermaid from './mermaid.esm.min.mjs';
import { classDefs, mermaidConfig, readTheme } from './theme.js';

export const MAX_HEIGHT = 640;
export const MIN_SCALE = 0.8;

// Mermaid keeps one set of settings and one scratch element, so draws take turns.
let queue = Promise.resolve();
function inTurn(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

let counter = 0;

const FLOW = /^\s*(?:flowchart|graph)\s+(LR|TD|TB|RL|BT)\b/m;
const CLASSES = /^\s*(?:flowchart|graph|stateDiagram-v2|stateDiagram|classDiagram)\b/m;

/**
 * Draws `code` into `host` and returns the SVG element. Used by <infd-diagram>,
 * the server renderer, and pages that want the drawing without the element.
 *
 *   fit     "auto" draws a flowchart both ways and keeps the direction that
 *           fits `host`; "authored" keeps the direction as written.
 *   theme   From readTheme() or themeFrom().
 *   labels  "html" (default) or "svg" for images and email.
 */
export function renderDiagram(
  host,
  code,
  { fit = 'auto', theme = readTheme(host), labels = 'html' } = {}
) {
  return inTurn(async () => {
    mermaid.initialize(mermaidConfig(theme, { labels }));
    const id = `infd-diagram-${++counter}`;
    const body = stripHeader(code);
    const flow = FLOW.exec(body);
    const source = (c) => (CLASSES.test(body) ? `${c}\n${classDefs(theme)}` : c);
    const draw = async (c) => {
      const { svg } = await mermaid.render(id, source(c));
      host.innerHTML = svg;
      const el = host.querySelector('svg');
      return el && { svg: el, fit: fitScale(el, host.clientWidth) };
    };
    const first = await draw(code);
    if (!first) throw new Error('Mermaid drew nothing');
    let chosen = first;
    // The flow reads either way, so draw it both ways and keep the one that
    // fits its column at the larger size. Ties go to the authored direction.
    if (fit === 'auto' && flow && ['LR', 'TD', 'TB'].includes(flow[1]) && host.clientWidth) {
      const turned = code.replace(
        /^(\s*(?:flowchart|graph)\s+)(LR|TD|TB)/m,
        (_, a, d) => a + (d === 'LR' ? 'TD' : 'LR')
      );
      const second = await draw(turned);
      chosen = second && second.fit > first.fit * 1.1 ? second : await draw(code);
    }
    const svg = chosen.svg;
    svg.setAttribute('aria-hidden', 'true');
    size(svg, host.clientWidth);
    return svg;
  });
}

/** Just the SVG markup, drawn in a hidden scratch element at its natural size. */
export async function renderSvgString(code, options = {}) {
  const scratch = document.createElement('div');
  scratch.style.cssText = 'position:absolute;left:-10000px;top:0;width:1200px;visibility:hidden';
  document.body.appendChild(scratch);
  try {
    const svg = await renderDiagram(scratch, code, { fit: 'authored', ...options });
    return standalone(svg);
  } finally {
    scratch.remove();
  }
}

/** A drawn SVG as standalone markup: explicit size, no page styles, visible to assistive tech. */
export function standalone(svg) {
  const copy = svg.cloneNode(true);
  copy.removeAttribute('aria-hidden');
  copy.removeAttribute('style');
  copy.querySelectorAll('[style*="opacity"]').forEach((el) => (el.style.opacity = ''));
  const { width, height } = svg.viewBox.baseVal;
  copy.setAttribute('width', String(Math.ceil(width)));
  copy.setAttribute('height', String(Math.ceil(height)));
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(copy);
}

// Never smaller than MIN_SCALE: past that the words blur, and a sideways
// scroll reads better than a squint.
export function size(svg, width) {
  svg.style.maxWidth = 'none';
  svg.style.width = `${Math.round(svg.viewBox.baseVal.width * Math.max(MIN_SCALE, fitScale(svg, width)))}px`;
  svg.style.height = 'auto';
}

function fitScale(svg, width) {
  const { width: w, height: h } = svg.viewBox.baseVal;
  if (!w || !h || !width) return 1;
  return Math.min(1, width / w, MAX_HEIGHT / h);
}

// Front matter and %%{init}%% directives come before the diagram keyword.
function stripHeader(code) {
  return code.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '').replace(/^\s*%%\{[\s\S]*?\}%%\s*/gm, '');
}

export { mermaid };
