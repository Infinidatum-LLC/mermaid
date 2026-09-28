/**
 * <infd-diagram> — one Mermaid diagram, themed and animated in the order it reads.
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
 *   caption    One sentence shown above the diagram.
 *   alt        The diagram in words, for screen readers. The SVG itself is hidden from them.
 *   src        URL of a .mmd file to draw, instead of the element's text.
 *   animate    "auto" (default) builds the diagram when it scrolls into view; "none" draws it still.
 *   speed      Animation speed multiplier, 0.25 to 4. Default 1.
 *   controls   "none" hides Back / Next step / Replay.
 *   fit        "auto" (default) draws a flowchart both ways and keeps the direction that
 *              fits the column; "authored" keeps the direction as written.
 *   theme      "light" (default), "dark" or "auto" (follows the reader). --infd-* still win.
 *   flow       "dots" sends dots along the arrows once the diagram is complete.
 *   highlight  "hover" (default) lights a box and its neighbors under the pointer; "none" turns it off.
 *   focus      Node ids, comma-separated, to keep lit while everything else dims.
 *   tools      Any of "zoom fullscreen export", or "all". Default none.
 *
 * Flowcharts, state and class diagrams build by distance from the start;
 * sequence diagrams build message by message. Other types draw still.
 * `%% step A, B | caption` comments script the steps (see lib/steps.js).
 *
 * Events: infd-drawn { svg, steps }, infd-step { step, total, caption },
 * infd-node-click { id }, infd-error.
 * Methods: play(), next(), prev(), goTo(n), toSvg(), toPng(), download("svg" | "png").
 *
 * Box classes :::person :::ai :::check :::risk :::done take their colors from CSS
 * custom properties on the element or any ancestor (any CSS color works):
 *   --infd-card --infd-panel --infd-ink --infd-ink-soft --infd-rule
 *   --infd-accent --infd-ai --infd-ai-bg --infd-good --infd-good-bg --infd-risk --infd-risk-bg
 *   --infd-font
 *
 * Reduced motion draws the diagram complete and still, with no moving dots. It
 * is also drawn complete first, so a printed page, or one never scrolled this
 * far, shows the whole diagram.
 */
import { mermaid, renderDiagram, renderSvgString, size } from './lib/render.js';
import { buildSteps, parseScript } from './lib/steps.js';
import { MOTION_STYLE, drawEdge, emphasize, fadeIn, startFlow } from './lib/motion.js';
import { Viewport } from './lib/viewport.js';
import { download, toPng, toSvg } from './lib/export.js';
import { DIAGRAM_CLASSES, PRESETS, readTheme, themeFrom } from './lib/theme.js';

export {
  mermaid,
  renderDiagram,
  renderSvgString,
  buildSteps,
  parseScript,
  readTheme,
  themeFrom,
  toSvg,
  toPng,
  DIAGRAM_CLASSES,
  PRESETS,
};

/** Kept for pages written against the first release. */
export const rankGraph = (svg) => buildSteps(svg).steps;

// The frame follows the same colors as the drawing: --infd-* when set, else the preset.
const chrome = (preset) =>
  ['card', 'ink', 'rule', 'accent', 'risk']
    .map((k) => `--c-${k}: var(--infd-${k}, ${PRESETS[preset][k]});`)
    .join(' ');

const STYLE = `
:host { display: block; ${chrome('light')} }
:host([theme='dark']) { ${chrome('dark')} }
@media (prefers-color-scheme: dark) { :host([theme='auto']) { ${chrome('dark')} } }
figure { margin: 0; border: 1px solid var(--c-rule); background: var(--c-card); border-radius: 2px; padding: 12px; color: var(--c-ink); font-family: var(--infd-font, inherit); }
figure:fullscreen { display: flex; flex-direction: column; border: 0; border-radius: 0; }
figure:fullscreen .draw { flex: 1; max-height: none; }
figcaption { margin-bottom: 8px; font-size: 12px; font-weight: 500; }
figcaption:empty { display: none; }
.draw { min-height: 140px; overflow: auto; }
.draw.zoomable { max-height: 80vh; }
.draw.zoomed { cursor: grab; }
.draw.panning { cursor: grabbing; user-select: none; }
.draw svg { display: block; margin: 0 auto; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.say { margin: 8px 0 0; font-size: 13px; min-height: 1.4em; }
.say:empty { display: none; }
.bar { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
[hidden] { display: none !important; }
.tools { margin-left: auto; display: flex; gap: 4px; }
button { font: inherit; color: inherit; background: none; cursor: pointer; border: 1px solid var(--c-rule); border-radius: 2px; padding: 4px 8px; }
button:hover { border-color: var(--c-accent); }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, figure:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 2px; }
.step { font-family: ui-monospace, monospace; opacity: .75; }
.error { font-size: 12px; color: var(--c-risk); white-space: pre-wrap; }
${MOTION_STYLE}`;

const TOOLS = ['zoom', 'fullscreen', 'export'];

export class InfdDiagram extends HTMLElement {
  static get observedAttributes() {
    return ['caption', 'alt', 'controls', 'tools', 'focus', 'flow', 'highlight', 'src', 'theme'];
  }

  #code;
  #fetched;
  #steps = [];
  #graph = null;
  #svg = null;
  #shown = 0;
  #timers = [];
  #stopFlow = () => undefined;
  #seen;
  #root;
  #resize;
  #width = 0;
  #drawing = false;
  #view;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLE}</style>
      <figure part="figure">
        <figcaption part="caption"></figcaption>
        <p class="sr"></p>
        <div class="draw" part="drawing"></div>
        <p class="say" part="step-caption" aria-live="polite"></p>
        <div class="bar" part="controls">
          <span class="steps">
            <button type="button" class="prev" part="button" aria-label="Previous step">Back</button>
            <button type="button" class="next" part="button">Next step</button>
            <button type="button" class="replay" part="button">Replay</button>
            <span class="step" aria-live="polite"></span>
          </span>
          <span class="tools" part="tools">
            <button type="button" data-tool="zoom" data-act="out" part="button" aria-label="Zoom out">−</button>
            <button type="button" data-tool="zoom" data-act="reset" part="button" aria-label="Reset zoom" class="pct">100%</button>
            <button type="button" data-tool="zoom" data-act="in" part="button" aria-label="Zoom in">+</button>
            <button type="button" data-tool="fullscreen" data-act="full" part="button">Fullscreen</button>
            <button type="button" data-tool="export" data-act="svg" part="button">SVG</button>
            <button type="button" data-tool="export" data-act="png" part="button">PNG</button>
          </span>
        </div>
      </figure>`;
    const $ = (s) => this.#root.querySelector(s);
    $('.next').addEventListener('click', () => this.next());
    $('.prev').addEventListener('click', () => this.prev());
    $('.replay').addEventListener('click', () => this.play());
    $('.tools').addEventListener('click', (e) =>
      this.#tool(e.target.closest('button')?.dataset.act)
    );
    $('figure').addEventListener('keydown', (e) => {
      if (e.target !== e.currentTarget || this.#steps.length < 2) return;
      if (e.key === 'ArrowRight') this.next();
      else if (e.key === 'ArrowLeft') this.prev();
      else return;
      e.preventDefault();
    });
    $('figure').addEventListener('fullscreenchange', () => this.#refit());
    this.#view = new Viewport(
      $('.draw'),
      (z) => ($('.pct').textContent = `${Math.round(z * 100)}%`)
    );
    this.#hover($('.draw'));
  }

  get code() {
    return this.#code ?? this.#fetched ?? this.textContent.trim();
  }

  set code(value) {
    this.#code = String(value);
    if (this.isConnected) this.#draw();
  }

  /** The steps of the current drawing, as `{ nodes, edges, labels, caption }`. */
  get steps() {
    return this.#steps;
  }

  get step() {
    return this.#shown;
  }

  connectedCallback() {
    this.#sync();
    // A new column width (a window resize, a phone turned) can change which
    // direction fits, so the diagram is fitted again, drawn still.
    let wait;
    this.#resize = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (!this.#width || Math.abs(w - this.#width) < 24 || this.#drawing) return;
      if (document.fullscreenElement) return;
      clearTimeout(wait);
      wait = setTimeout(() => this.#draw({ still: true }), 150);
    });
    this.#resize.observe(this);
    // Parsers deliver an element's text after it connects; wait for it.
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', () => this.#load(), { once: true });
    else queueMicrotask(() => this.#load());
  }

  disconnectedCallback() {
    this.#resize?.disconnect();
    this.#seen?.disconnect();
    this.#clear();
    this.#stopFlow();
  }

  attributeChangedCallback(name, old, value) {
    this.#sync();
    if (!this.isConnected || old === value) return;
    if (name === 'src') {
      this.#fetched = undefined;
      this.#load();
    } else if (!this.#svg) return;
    else if (name === 'theme') this.#draw({ still: true });
    else if (name === 'focus') this.#emphasize();
    else if (name === 'flow') this.#reveal(this.#shown, false);
  }

  // The reader's setting stops all motion; animate="none" stops only the build.
  get #still() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  get #reduced() {
    return this.getAttribute('animate') === 'none' || this.#still;
  }

  get #speed() {
    const s = Number(this.getAttribute('speed'));
    return Number.isFinite(s) && s > 0 ? Math.min(4, Math.max(0.25, s)) : 1;
  }

  get #tools() {
    const raw = (this.getAttribute('tools') ?? '').toLowerCase();
    return raw === 'all' ? TOOLS : TOOLS.filter((t) => raw.split(/[\s,]+/).includes(t));
  }

  get #theme() {
    return readTheme(this, this.getAttribute('theme') ?? 'light');
  }

  get #highlight() {
    return this.getAttribute('highlight') !== 'none';
  }

  #sync() {
    const $ = (s) => this.#root.querySelector(s);
    $('figcaption').textContent = this.getAttribute('caption') ?? '';
    $('.sr').textContent = this.getAttribute('alt') ?? '';
    const tools = this.#tools;
    this.#root.querySelectorAll('[data-tool]').forEach((b) => {
      b.hidden = !tools.includes(b.dataset.tool);
    });
    $('.tools').hidden = tools.length === 0;
    $('.draw').classList.toggle('zoomable', tools.includes('zoom'));
    this.#controls();
  }

  #controls() {
    const $ = (s) => this.#root.querySelector(s);
    const total = this.#steps.length;
    const stepping = this.getAttribute('controls') !== 'none' && total >= 2;
    $('.steps').hidden = !stepping;
    $('.bar').hidden = !stepping && $('.tools').hidden;
    $('figure').tabIndex = stepping ? 0 : -1;
    const done = this.#shown >= total;
    $('.next').textContent = done ? 'Step from the start' : 'Next step';
    $('.prev').disabled = this.#shown <= 1;
    $('.step').textContent = `Step ${this.#shown} of ${total}`;
  }

  async #load() {
    const src = this.getAttribute('src');
    if (src && this.#code === undefined && this.#fetched === undefined) {
      try {
        const res = await fetch(new URL(src, document.baseURI));
        if (!res.ok) throw new Error(`${src} answered ${res.status}`);
        this.#fetched = (await res.text()).trim();
      } catch (e) {
        return this.#fail(e);
      }
    }
    this.#draw();
  }

  async #draw({ still = false } = {}) {
    const host = this.#root.querySelector('.draw');
    const code = this.code;
    if (!code) return;
    this.#seen?.disconnect();
    this.#clear();
    this.#stopFlow();
    this.#drawing = true;
    try {
      this.#width = Math.round(this.getBoundingClientRect().width);
      const svg = await renderDiagram(host, code, {
        fit: this.getAttribute('fit') || 'auto',
        theme: this.#theme,
      });
      this.#svg = svg;
      ({ steps: this.#steps, graph: this.#graph } = buildSteps(svg, code));
      this.#view.attach(svg);
      host.classList.toggle('interactive', !!this.#graph && this.#highlight);
      this.#reveal(this.#steps.length, false);
      this.dispatchEvent(
        new CustomEvent('infd-drawn', { detail: { svg, steps: this.#steps.length } })
      );
      if (still || this.#reduced || this.#steps.length < 2) return;
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
      this.#fail(e);
    } finally {
      this.#drawing = false;
    }
  }

  #fail(e) {
    const host = this.#root.querySelector('.draw');
    host.innerHTML = '';
    this.#svg = null;
    this.#steps = [];
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Diagram could not be drawn: ${e?.message ?? e}`;
    host.appendChild(p);
    this.#controls();
    this.dispatchEvent(new CustomEvent('infd-error', { detail: e }));
  }

  #clear() {
    this.#timers.forEach((t) => clearTimeout(t));
    this.#timers = [];
  }

  #reveal(upto, animate) {
    const speed = this.#speed;
    const total = this.#steps.length;
    this.#steps.forEach((step, i) => {
      const on = i < upto;
      const fresh = animate && !this.#reduced && i === upto - 1;
      step.edges.forEach((p) => drawEdge(p, on, fresh, speed));
      step.nodes.forEach((n) => fadeIn(n, on, fresh, 180, speed));
      step.labels.forEach((l) => fadeIn(l, on, fresh, 260, speed));
    });
    this.#shown = upto;
    this.#stopFlow();
    if (this.#svg && upto >= total && this.getAttribute('flow') === 'dots' && !this.#still) {
      const lines = this.#graph
        ? this.#graph.edges.map((e) => e.path)
        : this.#steps.flatMap((s) => s.edges);
      this.#stopFlow = startFlow(lines, speed);
    }
    this.#emphasize();
    this.#controls();
    // A scripted step keeps showing the last caption until the next one replaces it.
    const said = this.#steps.slice(0, upto).findLast((s) => s.caption)?.caption ?? '';
    this.#root.querySelector('.say').textContent = said;
    if (total)
      this.dispatchEvent(
        new CustomEvent('infd-step', {
          detail: { step: upto, total, caption: this.#steps[upto - 1]?.caption ?? '' },
        })
      );
  }

  #emphasize(names) {
    if (!this.#svg) return;
    const focus = (this.getAttribute('focus') ?? '').split(/[\s,]+/).filter(Boolean);
    emphasize(this.#svg, this.#graph, names ?? focus, { neighbors: !!names });
  }

  #hover(box) {
    const nameOf = (target) => {
      const g = target?.closest?.('g.node');
      if (!g || !this.#graph) return undefined;
      for (const [n, el] of this.#graph.nodes) if (el === g) return n;
      return undefined;
    };
    box.addEventListener('pointerover', (e) => {
      if (!this.#highlight || e.pointerType === 'touch') return;
      const n = nameOf(e.target);
      if (n) this.#emphasize([n]);
    });
    box.addEventListener('pointerout', (e) => {
      if (!this.#highlight || nameOf(e.relatedTarget)) return;
      this.#emphasize();
    });
    box.addEventListener('click', (e) => {
      const n = nameOf(e.target);
      if (n)
        this.dispatchEvent(
          new CustomEvent('infd-node-click', { detail: { id: n }, bubbles: true, composed: true })
        );
    });
  }

  async #tool(act) {
    const figure = this.#root.querySelector('figure');
    if (act === 'in') this.#view.zoomBy(1.25);
    else if (act === 'out') this.#view.zoomBy(0.8);
    else if (act === 'reset') this.#view.reset();
    else if (act === 'full') {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await figure.requestFullscreen?.();
    } else if (act === 'svg' || act === 'png') await this.download(act);
  }

  #refit() {
    if (!this.#svg) return;
    const box = this.#root.querySelector('.draw');
    const full = !!document.fullscreenElement;
    this.#root.querySelector('[data-act="full"]').textContent = full
      ? 'Exit fullscreen'
      : 'Fullscreen';
    if (full)
      requestAnimationFrame(() => this.#view.fitTo(box.clientWidth - 8, box.clientHeight - 8));
    else {
      size(this.#svg, box.clientWidth);
      this.#view.attach(this.#svg);
    }
  }

  /** Builds the diagram from the start, one step at a time. */
  play() {
    this.#clear();
    const total = this.#steps.length;
    if (this.#reduced) return this.#reveal(total, false);
    this.#reveal(0, false);
    const speed = this.#speed;
    for (let i = 1; i <= total; i++)
      this.#timers.push(setTimeout(() => this.#reveal(i, true), (250 + (i - 1) * 650) / speed));
  }

  /** Shows the next step, or starts over from the first. */
  next() {
    this.#clear();
    this.#reveal(this.#shown >= this.#steps.length ? 1 : this.#shown + 1, true);
  }

  /** Steps back one. */
  prev() {
    this.#clear();
    this.#reveal(Math.max(1, this.#shown - 1), false);
  }

  /** Shows steps 1 to `n`, still. `goTo(steps.length)` shows everything. */
  goTo(n) {
    this.#clear();
    this.#reveal(Math.max(0, Math.min(this.#steps.length, Math.round(n))), false);
  }

  /** The diagram as standalone SVG markup, labels drawn as SVG text. */
  toSvg() {
    return toSvg(this.code, { theme: this.#theme });
  }

  /** The diagram as a PNG Blob at twice its natural size. */
  toPng(scale = 2) {
    return toPng(this.code, { theme: this.#theme, scale });
  }

  /** Saves the diagram as an .svg or .png file named after its caption. */
  async download(format = 'svg') {
    const name =
      (this.getAttribute('caption') || 'diagram')
        .replace(/[^\w-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)
        .toLowerCase() || 'diagram';
    if (format === 'png') download(await this.toPng(), `${name}.png`);
    else download(await this.toSvg(), `${name}.svg`, 'image/svg+xml');
  }
}

if (!customElements.get('infd-diagram')) customElements.define('infd-diagram', InfdDiagram);
