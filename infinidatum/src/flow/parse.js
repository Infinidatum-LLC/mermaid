/**
 * INFD FLOW — a strict subset of Mermaid's flowchart, and its parser.
 * ./layout.js lays it out and ./svg.js draws it.
 *
 * Mermaid draws a hundred kinds of diagram. Most explainers need one: a small
 * flowchart of who asks, what the AI does, where a person checks, where it
 * stops. The full Mermaid build is about 800 KB in thirty-odd requests, drawn
 * in the browser after the page loads. This is a few kilobytes, runs on the
 * server or in the browser, and needs no DOM, so the picture can be in the
 * HTML before any script runs.
 *
 * THE SOURCE IS STILL MERMAID, so every diagram reads the same in any Mermaid
 * viewer and in <infd-diagram>:
 *
 *   flowchart LR                      or  flowchart TD
 *   A[Plain label]:::person           a box
 *   A["Label, with (punctuation)"]    a box, quoted
 *   D{A question?}                    a decision
 *   A --> B                           an arrow
 *   A -.-> B                          a dotted arrow: optional, or later
 *   D -->|Yes| B                      a labeled arrow
 *   A --> B --> C                     a chain
 *
 * Classes: person, ai, check, risk, done. Anything else is an error with its
 * line number, never a guess: a diagram that parses here draws.
 */

/** @typedef {'person' | 'ai' | 'check' | 'risk' | 'done'} FlowClass */
/** @typedef {'LR' | 'TD'} FlowDirection */
/** @typedef {{ id: string, label: string, shape: 'box' | 'decision', cls?: FlowClass }} FlowNode */
/** @typedef {{ from: string, to: string, label?: string, dotted?: boolean }} FlowEdge */
/** @typedef {{ direction: FlowDirection, nodes: FlowNode[], edges: FlowEdge[] }} Flow */

export const FLOW_CLASSES = ['person', 'ai', 'check', 'risk', 'done'];

export class FlowError extends Error {
  name = 'FlowError';
}

const ID = /^[A-Za-z]\w*/;
const CLASS_SET = new Set(FLOW_CLASSES);

/**
 * Parses the subset above. Throws FlowError naming the line on anything else.
 * @param {string} code
 * @returns {Flow}
 */
export function parseFlow(code) {
  const lines = String(code ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  // Blank lines before the header are allowed, as element text usually has one.
  const first = Math.max(
    0,
    lines.findIndex((l) => l.trim())
  );
  const head = /^\s*flowchart\s+(LR|TD)\s*$/.exec(lines[first] ?? '');
  if (!head) throw new FlowError(`line ${first + 1}: start with "flowchart LR" or "flowchart TD"`);
  /** @type {Map<string, FlowNode>} */
  const nodes = new Map();
  /** @type {FlowEdge[]} */
  const edges = [];

  lines.slice(first + 1).forEach((raw, i) => {
    const n = first + i + 2;
    const fail = (why) => {
      throw new FlowError(`line ${n}: ${why}: ${raw.trim()}`);
    };
    let rest = raw.trim();
    if (!rest) return;

    const node = () => {
      const id = ID.exec(rest)?.[0];
      if (!id) fail('expected a box id');
      rest = rest.slice(id.length);
      let label;
      let shape = 'box';
      const open = rest[0];
      if (open === '[' || open === '{') {
        const close = open === '[' ? ']' : '}';
        shape = open === '{' ? 'decision' : 'box';
        let body;
        if (rest[1] === '"') {
          const end = rest.indexOf(`"${close}`, 2);
          if (end < 0) fail('unclosed quoted label');
          body = rest.slice(2, end);
          rest = rest.slice(end + 2);
        } else {
          const end = rest.indexOf(close, 1);
          if (end < 0) fail(`missing ${close}`);
          body = rest.slice(1, end);
          if (/["[\]{}|]/.test(body))
            fail('quote a label that holds brackets, braces, pipes or quotes');
          rest = rest.slice(end + 1);
        }
        label = body.trim();
        if (!label) fail('empty label');
        if (/[<>"]/.test(label)) fail('labels are plain words: no HTML or quotes');
      } else if (open === '(' || open === '>' || open === '/') {
        fail('round and other shapes are not supported: use [box] or {decision}');
      }
      let cls;
      const c = /^:::(\w+)/.exec(rest);
      if (c) {
        if (!CLASS_SET.has(c[1])) fail(`unknown class ${c[1]}`);
        cls = c[1];
        rest = rest.slice(c[0].length);
      }
      const prev = nodes.get(id);
      if (!prev) {
        nodes.set(id, { id, label: label ?? id, shape, cls });
      } else {
        if (label !== undefined) {
          if (prev.label !== prev.id && prev.label !== label) fail(`box ${id} is labeled twice`);
          prev.label = label;
          prev.shape = shape;
        }
        if (cls) prev.cls = cls;
      }
      rest = rest.trimStart();
      return id;
    };

    let from = node();
    while (rest) {
      const arrow = /^(-->|-\.->)\s*/.exec(rest);
      if (!arrow) fail('expected --> or -.-> (no subgraphs, styles, links or comments)');
      rest = rest.slice(arrow[0].length);
      let label;
      if (rest[0] === '|') {
        const end = rest.indexOf('|', 1);
        if (end < 0) fail('unclosed arrow label');
        label = rest.slice(1, end).trim();
        if (!label || /[<>"[\]{}]/.test(label)) fail('arrow labels are plain words');
        rest = rest.slice(end + 1).trimStart();
      }
      const to = node();
      edges.push({ from, to, label, dotted: arrow[1] === '-.->' || undefined });
      from = to;
    }
  });

  if (nodes.size === 0) throw new FlowError('no boxes');
  return { direction: /** @type {FlowDirection} */ (head[1]), nodes: [...nodes.values()], edges };
}

/**
 * Whether `code` is in the subset, without throwing. A caller can draw with
 * this module when it is, and fall back to full Mermaid when it is not.
 * @param {string} code
 * @returns {{ ok: true, flow: Flow } | { ok: false, error: string, line?: number }}
 */
export function checkFlow(code) {
  try {
    return { ok: true, flow: parseFlow(code) };
  } catch (e) {
    if (!(e instanceof FlowError)) throw e;
    const line = /^line (\d+)/.exec(e.message);
    return { ok: false, error: e.message, ...(line ? { line: Number(line[1]) } : {}) };
  }
}
