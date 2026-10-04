/**
 * INFD FLOW — the lightweight flowchart: parser, layout and SVG in a few
 * kilobytes, with no Mermaid download. Served as /v/<version>/flow.js.
 *
 *   <script type="module" src="https://<host>/v/<version>/flow.js"></script>
 *   <infd-flow caption="A person checks every draft." alt="Staff ask, the AI drafts, ...">
 *     flowchart LR
 *       A[Staff ask]:::person --> B[AI drafts]:::ai --> C[Review]:::check --> D[Send]:::done
 *   </infd-flow>
 *
 * Or import the functions and write the figure into server HTML yourself:
 *
 *   import { flowFigure, FLOW_CSS, playAll } from 'https://<host>/v/<version>/flow.js';
 *
 * The source is a strict subset of Mermaid's flowchart (src/flow/parse.js), so
 * the same text also draws in <infd-diagram> and any Mermaid viewer. For other
 * diagram types, or syntax outside the subset, use <infd-diagram>.
 *
 * Attributes: caption, alt, theme ("light" | "dark" | "auto"), variant
 * ("card" | "compact"), animate ("auto" | "none"), src (a .mmd file).
 * Colors: the same --infd-* custom properties as <infd-diagram>.
 * Events: "infd-flow-error" with { detail: { error, line } } when the source
 * is outside the subset; the element then shows the error in place.
 */
import { checkFlow } from './flow/parse.js';
import { FLOW_CSS, esc, flowFigure } from './flow/svg.js';
import { playFlow } from './flow/player.js';

export { FLOW_CLASSES, FlowError, checkFlow, parseFlow } from './flow/parse.js';
export {
  candidateLayouts,
  layoutBreaks,
  layoutFlow,
  textWidth,
  wrap,
  MIN_SCALE,
} from './flow/layout.js';
export { FLOW_CSS, LEGEND, flowFigure, flowId, flowSvg } from './flow/svg.js';
export { playAll, playFlow } from './flow/player.js';

const ERROR_CSS =
  '.dg-error{font:12px/1.4 ui-monospace,monospace;color:var(--dg-risk);border:1px dashed var(--dg-risk);border-radius:4px;padding:8px;white-space:pre-wrap}';

const Base = globalThis.HTMLElement ?? class {};

export class InfdFlow extends Base {
  static observedAttributes = ['caption', 'alt', 'theme', 'variant', 'animate', 'src'];

  #code = null;
  #fromSrc = false;
  #detach = () => {};
  #queued = false;

  /** The diagram source. Defaults to the element's text. */
  get code() {
    return this.#code ?? this.textContent ?? '';
  }

  set code(value) {
    this.#code = String(value ?? '');
    this.#fromSrc = false;
    this.#schedule();
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.#schedule();
  }

  disconnectedCallback() {
    this.#detach();
  }

  attributeChangedCallback(name) {
    if (name === 'src' && this.#fromSrc) this.#code = null;
    if (this.isConnected) this.#schedule();
  }

  #schedule() {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      this.#draw();
    });
  }

  async #draw() {
    const root = this.shadowRoot;
    if (!root) return;
    const src = this.getAttribute('src');
    if (src && this.#code === null) {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        this.#code = await res.text();
        this.#fromSrc = true;
      } catch (e) {
        return this.#fail({ ok: false, error: `Could not load ${src}: ${e?.message ?? e}` });
      }
    }
    const checked = checkFlow(this.code);
    if (!checked.ok) return this.#fail(checked);
    this.#detach();
    const theme = this.getAttribute('theme');
    root.innerHTML = `<style>:host{display:block}${FLOW_CSS}</style>${flowFigure(checked.flow, {
      caption: this.getAttribute('caption') ?? undefined,
      alt: this.getAttribute('alt') ?? undefined,
      variant: this.getAttribute('variant') === 'compact' ? 'compact' : 'card',
      theme: theme === 'dark' || theme === 'auto' ? theme : 'light',
      animate: this.getAttribute('animate') === 'none' ? 'none' : 'auto',
    })}`;
    const fig = root.querySelector('figure');
    this.#detach = fig ? playFlow(fig) : () => {};
    this.dispatchEvent(new CustomEvent('infd-flow-render', { detail: { flow: checked.flow } }));
  }

  #fail(result) {
    this.#detach();
    this.#detach = () => {};
    this.shadowRoot.innerHTML = `<style>:host{display:block}${FLOW_CSS}${ERROR_CSS}</style><div class="dg"><p class="dg-error" role="alert">${esc(result.error)}</p></div>`;
    this.dispatchEvent(
      new CustomEvent('infd-flow-error', { detail: { error: result.error, line: result.line } })
    );
  }
}

if (globalThis.customElements && !customElements.get('infd-flow')) {
  customElements.define('infd-flow', InfdFlow);
}
