/**
 * <infd-diagram> — one Mermaid flowchart, themed and animated in flow order.
 *
 * Served next to the Mermaid build it imports, so a page needs one script tag:
 *
 *   <script type="module" src="https://<host>/v/<version>/diagram.js"></script>
 *   <infd-diagram caption="Where a person checks.">
 *     flowchart LR
 *       A[Ask]:::person --> B[Draft]:::ai --> C[Review]:::check --> D[Send]:::done
 *   </infd-diagram>
 *
 * Attributes
 *   caption   One sentence shown above the diagram.
 *   alt       The flow in words, for screen readers. The SVG itself is hidden from them.
 *   animate   "auto" (default) builds the flow when it scrolls into view; "none" draws it still.
 *   controls  "none" hides Next step / Replay.
 *   fit       "auto" (default) draws a flowchart both ways and keeps the direction that
 *             fits the column; "authored" keeps the direction as written.
 *
 * Source comes from the element's text, or the `code` property.
 *
 * Box classes :::person :::ai :::check :::risk :::done take their colors from CSS
 * custom properties on the element or any ancestor (any CSS color works):
 *   --infd-card --infd-panel --infd-ink --infd-ink-soft --infd-rule
 *   --infd-accent --infd-ai --infd-ai-bg --infd-good --infd-good-bg --infd-risk --infd-risk-bg
 *   --infd-font
 *
 * Reduced motion draws the diagram complete and still. It is also drawn complete
 * first, so a printed page, or one never scrolled this far, shows the whole flow.
 */
import mermaid from './mermaid.esm.min.mjs';

export { mermaid };

export const DIAGRAM_CLASSES = ['person', 'ai', 'check', 'risk', 'done'];

const MAX_HEIGHT = 640;
const MIN_SCALE = 0.8;

const DEFAULTS = {
  card: '#ffffff',
  panel: '#e7f1ed',
  ink: '#0c1b2e',
  'ink-soft': '#2d4058',
  rule: '#6a887e',
  accent: '#00664f',
  ai: '#2c65aa',
  'ai-bg': '#e4eefa',
  good: '#2d7a20',
  'good-bg': '#e5f6de',
  risk: '#be123c',
  'risk-bg': '#ffe4e8',
};

/* ---------- drawing ---------- */

// Mermaid keeps one set of settings and one scratch element, so draws take turns.
let queue = Promise.resolve();
function inTurn(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

let counter = 0;

/**
 * Draws `code` into `host` and returns the SVG element. Used by <infd-diagram>,
 * and exported for pages that want the drawing without the element.
 */
export function renderDiagram(host, code, { fit = 'auto', theme = readTheme(host) } = {}) {
  return inTurn(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: theme.font,
      themeVariables: {
        fontFamily: theme.font,
        fontSize: '14px',
        primaryColor: theme.card,
        primaryBorderColor: theme.rule,
        primaryTextColor: theme.ink,
        lineColor: theme['ink-soft'],
        textColor: theme.ink,
        edgeLabelBackground: theme.card,
        tertiaryColor: theme.panel,
      },
      flowchart: {
        htmlLabels: true,
        curve: 'basis',
        useMaxWidth: true,
        padding: 8,
        nodeSpacing: 28,
        rankSpacing: 36,
        wrappingWidth: 130,
      },
    });
    const id = `infd-diagram-${++counter}`;
    const flow = /^\s*flowchart\s+(LR|TD|TB|RL|BT)\b/.exec(code);
    const source = (c) => (flow ? `${c}\n${classDefs(theme)}` : c);
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
    if (fit === 'auto' && flow && (flow[1] === 'LR' || flow[1] === 'TD' || flow[1] === 'TB')) {
      const turned = code.replace(
        /^(\s*flowchart\s+)(LR|TD|TB)/,
        (_, a, d) => a + (d === 'LR' ? 'TD' : 'LR')
      );
      const second = await draw(turned);
      chosen = second && second.fit > first.fit * 1.1 ? second : await draw(code);
    }
    const svg = chosen.svg;
    svg.setAttribute('aria-hidden', 'true');
    // Never smaller than MIN_SCALE: past that the words blur, and a sideways
    // scroll reads better than a squint.
    svg.style.maxWidth = 'none';
    svg.style.width = `${Math.round(svg.viewBox.baseVal.width * Math.max(MIN_SCALE, fitScale(svg, host.clientWidth)))}px`;
    svg.style.height = 'auto';
    return svg;
  });
}

function fitScale(svg, width) {
  const { width: w, height: h } = svg.viewBox.baseVal;
  if (!w || !h || !width) return 1;
  return Math.min(1, width / w, MAX_HEIGHT / h);
}

/* ---------- ranking the flow ---------- */

/**
 * Groups boxes by distance from the start. Mermaid names each box
 * `<svg id>-flowchart-<node>-<n>` and each arrow `L_<from>_<to>_<n>`, which is
 * all the graph this needs. A loop back keeps the rank its box was first
 * reached at. Non-flowchart diagrams come back with no ranks and draw still.
 */
export function rankGraph(svg) {
  const nodes = new Map();
  svg.querySelectorAll('g.node').forEach((g) => {
    const m = /-flowchart-(.+)-\d+$/.exec(g.id);
    if (m) nodes.set(m[1], g);
  });
  const edges = [];
  svg.querySelectorAll('path.flowchart-link').forEach((path) => {
    const key = path.dataset.id || '';
    const ends = splitEdge(key, nodes);
    if (!ends) return;
    const labels = [...svg.querySelectorAll(`.edgeLabel .label[data-id="${CSS.escape(key)}"]`)].map(
      (l) => l.closest('.edgeLabel') || l
    );
    edges.push({ ...ends, path, labels });
  });
  if (nodes.size === 0) return [];

  const rank = new Map();
  const incoming = new Set(edges.map((e) => e.to));
  let frontier = [...nodes.keys()].filter((n) => !incoming.has(n));
  if (frontier.length === 0) frontier = [...nodes.keys()].slice(0, 1);
  frontier.forEach((n) => rank.set(n, 0));
  for (let r = 0; frontier.length; r++) {
    const next = [];
    for (const e of edges) {
      if (frontier.includes(e.from) && !rank.has(e.to)) {
        rank.set(e.to, r + 1);
        next.push(e.to);
      }
    }
    frontier = next;
  }
  const last = Math.max(0, ...rank.values());
  nodes.forEach((_, n) => rank.has(n) || rank.set(n, last));

  const out = Array.from({ length: last + 1 }, () => ({ nodes: [], edges: [], labels: [] }));
  nodes.forEach((g, n) => out[rank.get(n)].nodes.push(g));
  // An arrow draws with the later of its two ends, so a loop back appears once both boxes are there.
  for (const e of edges) {
    const r = Math.max(rank.get(e.from) ?? 0, rank.get(e.to) ?? 0);
    out[r].edges.push(e.path);
    out[r].labels.push(...e.labels);
  }
  return out;
}

function splitEdge(key, nodes) {
  const body = key.replace(/^L[_-]/, '').replace(/[_-]\d+$/, '');
  for (let i = body.indexOf('_'); i > 0; i = body.indexOf('_', i + 1)) {
    const from = body.slice(0, i);
    const to = body.slice(i + 1);
    if (nodes.has(from) && nodes.has(to)) return { from, to };
  }
  return undefined;
}

/* ---------- motion ---------- */

// Opacity only: Mermaid places boxes with a transform attribute, which a CSS transform would replace.
function fadeIn(el, on, fresh, delay) {
  el.getAnimations().forEach((a) => a.cancel());
  el.style.opacity = on ? '1' : '0';
  if (on && fresh)
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 380,
      delay,
      easing: 'cubic-bezier(.2,.7,.3,1)',
      fill: 'backwards',
    });
}

function drawEdge(path, on, fresh) {
  path.getAnimations().forEach((a) => a.cancel());
  path.style.opacity = on ? '1' : '0';
  if (!on || !fresh) return;
  const len = path.getTotalLength();
  // A dotted arrow keeps its own dashes; only a solid one draws along its length.
  const solid =
    !path.classList.contains('edge-pattern-dotted') &&
    !path.classList.contains('edge-pattern-dashed');
  if (solid) {
    path.animate(
      [
        { strokeDasharray: `${len}`, strokeDashoffset: `${len}` },
        { strokeDasharray: `${len}`, strokeDashoffset: '0' },
      ],
      {
        duration: 420,
        easing: 'ease-out',
        fill: 'backwards',
      }
    );
  } else {
    path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, fill: 'backwards' });
  }
}

/* ---------- theme ---------- */

/** Reads --infd-* from the element, resolving any CSS color to hex for Mermaid. */
export function readTheme(el) {
  const css = getComputedStyle(el);
  const probe = document.createElement('span');
  probe.style.display = 'none';
  (el.shadowRoot ?? el).appendChild(probe);
  const resolve = (name) => {
    const raw = css.getPropertyValue(`--infd-${name}`).trim();
    if (!raw) return DEFAULTS[name];
    probe.style.color = '';
    probe.style.color = raw;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
    return m
      ? `#${m
          .slice(1, 4)
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('')}`
      : DEFAULTS[name];
  };
  const theme = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, resolve(k)]));
  probe.remove();
  theme.font =
    css.getPropertyValue('--infd-font').trim() || css.fontFamily || 'system-ui, sans-serif';
  return theme;
}

function classDefs(t) {
  return [
    `classDef person fill:${t.panel},stroke:${t['ink-soft']},color:${t.ink}`,
    `classDef ai fill:${t['ai-bg']},stroke:${t.ai},color:${t.ink}`,
    `classDef check fill:${t.card},stroke:${t.accent},stroke-width:2px,color:${t.ink}`,
    `classDef risk fill:${t['risk-bg']},stroke:${t.risk},color:${t.ink}`,
    `classDef done fill:${t['good-bg']},stroke:${t.good},color:${t.ink}`,
  ].join('\n');
}

/* ---------- the element ---------- */

const STYLE = `
:host { display: block; }
figure { margin: 0; border: 1px solid var(--infd-rule, #8aa098); background: var(--infd-card, #fff); border-radius: 2px; padding: 12px; color: var(--infd-ink, #0c1b2e); font-family: var(--infd-font, inherit); }
figcaption { margin-bottom: 8px; font-size: 12px; font-weight: 500; }
figcaption:empty { display: none; }
.draw { min-height: 140px; overflow-x: auto; }
.draw svg { display: block; margin: 0 auto; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.controls { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
.controls[hidden] { display: none; }
button { font: inherit; color: inherit; background: none; cursor: pointer; border: 1px solid var(--infd-rule, #8aa098); border-radius: 2px; padding: 4px 8px; }
button:hover { border-color: var(--infd-accent, #00664f); }
button:focus-visible { outline: 2px solid var(--infd-accent, #00664f); outline-offset: 2px; }
.step { font-family: ui-monospace, monospace; opacity: .75; }
.error { font-size: 12px; color: var(--infd-risk, #be123c); white-space: pre-wrap; }
`;

export class InfdDiagram extends HTMLElement {
  static get observedAttributes() {
    return ['caption', 'alt', 'controls'];
  }

  #code;
  #ranks = [];
  #shown = 0;
  #timers = [];
  #seen;
  #root;
  #resize;
  #width = 0;
  #drawing = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLE}</style>
      <figure part="figure">
        <figcaption part="caption"></figcaption>
        <p class="sr"></p>
        <div class="draw" part="drawing"></div>
        <div class="controls" part="controls" hidden>
          <button type="button" class="next" part="button">Next step</button>
          <button type="button" class="replay" part="button">Replay</button>
          <span class="step" aria-live="polite"></span>
        </div>
      </figure>`;
    this.#root.querySelector('.next').addEventListener('click', () => this.next());
    this.#root.querySelector('.replay').addEventListener('click', () => this.play());
  }

  get code() {
    return this.#code ?? this.textContent.trim();
  }

  set code(value) {
    this.#code = String(value);
    if (this.isConnected) this.#draw();
  }

  connectedCallback() {
    this.#sync();
    // A new column width (a window resize, a phone turned) can change which
    // direction fits, so the diagram is fitted again, drawn still.
    let wait;
    this.#resize = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (!this.#width || Math.abs(w - this.#width) < 24 || this.#drawing) return;
      clearTimeout(wait);
      wait = setTimeout(() => this.#draw({ still: true }), 150);
    });
    this.#resize.observe(this);
    // Parsers deliver an element's text after it connects; wait for it.
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', () => this.#draw(), { once: true });
    else queueMicrotask(() => this.#draw());
  }

  disconnectedCallback() {
    this.#resize?.disconnect();
    this.#seen?.disconnect();
    this.#clear();
  }

  attributeChangedCallback() {
    this.#sync();
  }

  get #reduced() {
    return (
      this.getAttribute('animate') === 'none' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  #sync() {
    this.#root.querySelector('figcaption').textContent = this.getAttribute('caption') ?? '';
    this.#root.querySelector('.sr').textContent = this.getAttribute('alt') ?? '';
    this.#controls();
  }

  #controls() {
    const box = this.#root.querySelector('.controls');
    const total = this.#ranks.length;
    box.hidden = this.getAttribute('controls') === 'none' || total < 2;
    const done = this.#shown >= total;
    this.#root.querySelector('.next').textContent = done ? 'Step from the start' : 'Next step';
    this.#root.querySelector('.step').textContent = `Step ${this.#shown} of ${total}`;
  }

  async #draw({ still = false } = {}) {
    const host = this.#root.querySelector('.draw');
    const code = this.code;
    if (!code) return;
    this.#seen?.disconnect();
    this.#clear();
    this.#drawing = true;
    try {
      this.#width = Math.round(this.getBoundingClientRect().width);
      const svg = await renderDiagram(host, code, {
        fit: this.getAttribute('fit') || 'auto',
        theme: readTheme(this),
      });
      this.#ranks = rankGraph(svg);
      this.#reveal(this.#ranks.length, false);
      this.dispatchEvent(
        new CustomEvent('infd-drawn', { detail: { svg, steps: this.#ranks.length } })
      );
      if (still || this.#reduced || this.#ranks.length < 2) return;
      const box = this.getBoundingClientRect();
      if (document.visibilityState === 'visible' && box.top < innerHeight && box.bottom > 0)
        return this.play();
      this.#seen = new IntersectionObserver(
        ([entry]) => {
          // A tall diagram may never show a third of itself at once; 200px in view is enough.
          if (entry.intersectionRatio < 0.35 && entry.intersectionRect.height < 200) return;
          this.#seen.disconnect();
          this.play();
        },
        { threshold: [0, 0.1, 0.2, 0.35] }
      );
      this.#seen.observe(this);
    } catch (e) {
      host.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = `Diagram could not be drawn: ${e?.message ?? e}`;
      host.appendChild(p);
      this.dispatchEvent(new CustomEvent('infd-error', { detail: e }));
    } finally {
      this.#drawing = false;
    }
  }

  #clear() {
    this.#timers.forEach((t) => clearTimeout(t));
    this.#timers = [];
  }

  #reveal(upto, animate) {
    this.#ranks.forEach((rank, i) => {
      const on = i < upto;
      const fresh = animate && !this.#reduced && i === upto - 1;
      rank.edges.forEach((p) => drawEdge(p, on, fresh));
      rank.nodes.forEach((n) => fadeIn(n, on, fresh, 180));
      rank.labels.forEach((l) => fadeIn(l, on, fresh, 260));
    });
    this.#shown = upto;
    this.#controls();
  }

  /** Builds the flow from the start, one rank at a time. */
  play() {
    this.#clear();
    const total = this.#ranks.length;
    if (this.#reduced) return this.#reveal(total, false);
    this.#reveal(0, false);
    for (let i = 1; i <= total; i++)
      this.#timers.push(setTimeout(() => this.#reveal(i, true), 250 + (i - 1) * 650));
  }

  /** Shows the next rank, or starts over from the first. */
  next() {
    this.#clear();
    this.#reveal(this.#shown >= this.#ranks.length ? 1 : this.#shown + 1, true);
  }
}

if (!customElements.get('infd-diagram')) customElements.define('infd-diagram', InfdDiagram);
