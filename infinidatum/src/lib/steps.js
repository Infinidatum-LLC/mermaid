/**
 * Splits a drawn diagram into the steps it builds in.
 *
 * A step is `{ nodes, edges, labels, caption }`: boxes that fade in, lines
 * that draw along their length, and labels that fade in after them.
 *
 * - Graph diagrams (flowchart, state, class, and anything else Mermaid draws
 *   with `g.nodes` and `g.edgePaths`) build by distance from the start.
 * - Sequence diagrams build message by message, after the participants.
 * - Other types come back with no steps and draw still.
 *
 * Authors can script the steps instead, with comments Mermaid ignores:
 *
 *   %% step A, B | Staff ask and the AI drafts
 *   %% step C    | A person reviews
 *
 * In a graph the targets are node ids; in a sequence diagram they are
 * message and note numbers, counted from 1 (`1-3, 5`). The caption after `|`
 * is optional. Anything no step names appears in a last step.
 */

const STEP_LINE = /^\s*%%\s*step\b:?[ \t]*([^|\n]*?)[ \t]*(?:\|[ \t]*([^\n]*?))?[ \t]*$/gim;

/** The scripted steps in `code`, or `null` when it has none. */
export function parseScript(code) {
  const steps = [];
  for (const m of String(code).matchAll(STEP_LINE)) {
    steps.push({
      targets: m[1].split(/[\s,]+/).filter(Boolean),
      caption: (m[2] ?? '').trim(),
    });
  }
  return steps.length ? steps : null;
}

/** Returns `{ steps, graph }` for a rendered SVG. `graph` drives hover and flow effects. */
export function buildSteps(svg, code = '') {
  const script = parseScript(code);
  if (svg.querySelector('.messageLine0, .messageLine1, .actor-line')) return sequence(svg, script);
  const graph = readGraph(svg);
  if (!graph) return { steps: [], graph: null };
  return { steps: script ? scriptedGraph(graph, script) : rankedGraph(graph), graph };
}

/* ---------- graphs ---------- */

/**
 * Reads boxes, arrows and groups. Mermaid names each box
 * `<svg id>-<kind>-<name>-<n>`. Arrow ends are found by geometry, because not
 * every diagram type names them (state transitions are just `edge0`).
 */
export function readGraph(svg) {
  const prefix = `${svg.id}-`;
  const nodes = new Map();
  svg.querySelectorAll('g.node').forEach((g) => {
    let name = g.id.startsWith(prefix) ? g.id.slice(prefix.length) : g.id;
    name = name.replace(/-\d+$/, '').replace(/^[^-]+-/, '');
    if (name && !nodes.has(name)) nodes.set(name, g);
  });
  if (nodes.size === 0) return null;

  const boxes = [...nodes].map(([name, g]) => ({ name, rect: g.getBoundingClientRect() }));
  const nearest = (pt) => {
    let best;
    let bestD = Infinity;
    for (const b of boxes) {
      const d = distance(pt, b.rect);
      if (d < bestD) [best, bestD] = [b.name, d];
    }
    return best;
  };

  const edges = [];
  new Set(svg.querySelectorAll('g.edgePaths > path, path.flowchart-link')).forEach((path) => {
    const key = path.dataset.id || '';
    const ends =
      splitEdge(key, nodes) ??
      (() => {
        const len = path.getTotalLength?.() ?? 0;
        if (!len) return undefined;
        const from = nearest(screenPoint(path, path.getPointAtLength(0)));
        const to = nearest(screenPoint(path, path.getPointAtLength(len)));
        return from && to ? { from, to } : undefined;
      })();
    if (!ends) return;
    const labels = key
      ? [...svg.querySelectorAll(`.edgeLabel .label[data-id="${CSS.escape(key)}"]`)].map(
          (l) => l.closest('.edgeLabel') || l
        )
      : [];
    edges.push({ ...ends, path, labels });
  });

  const clusters = [...svg.querySelectorAll('g.cluster')].map((g) => {
    const r = g.getBoundingClientRect();
    const members = boxes.filter((b) => inside(center(b.rect), r)).map((b) => b.name);
    return { g, members };
  });

  return { nodes, edges, clusters };
}

function splitEdge(key, nodes) {
  const body = key.replace(/^(?:L|id)[_-]/, '').replace(/[_-]\d+$/, '');
  for (let i = body.indexOf('_'); i > 0; i = body.indexOf('_', i + 1)) {
    const from = body.slice(0, i);
    const to = body.slice(i + 1);
    if (nodes.has(from) && nodes.has(to)) return { from, to };
  }
  return undefined;
}

/** Ranks boxes by distance from the start. A loop back keeps the rank its box was first reached at. */
function rankedGraph({ nodes, edges, clusters }) {
  const rank = new Map();
  const incoming = new Set(edges.filter((e) => e.from !== e.to).map((e) => e.to));
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
  return assemble(nodes, edges, clusters, rank, last + 1);
}

function scriptedGraph({ nodes, edges, clusters }, script) {
  const step = new Map();
  script.forEach((s, i) =>
    s.targets.forEach((t) => nodes.has(t) && !step.has(t) && step.set(t, i))
  );
  let total = script.length;
  if ([...nodes.keys()].some((n) => !step.has(n))) {
    nodes.forEach((_, n) => step.has(n) || step.set(n, total));
    total += 1;
  }
  const steps = assemble(nodes, edges, clusters, step, total);
  script.forEach((s, i) => (steps[i].caption = s.caption));
  return steps;
}

// An arrow draws with the later of its two ends, so a loop back appears once
// both boxes are there. A group appears with its first box.
function assemble(nodes, edges, clusters, at, total) {
  const out = Array.from({ length: total }, () => ({
    nodes: [],
    edges: [],
    labels: [],
    caption: '',
  }));
  nodes.forEach((g, n) => out[at.get(n)].nodes.push(g));
  for (const e of edges) {
    const r = Math.max(at.get(e.from) ?? 0, at.get(e.to) ?? 0);
    out[r].edges.push(e.path);
    out[r].labels.push(...e.labels);
  }
  for (const c of clusters) {
    const r = c.members.length ? Math.min(...c.members.map((m) => at.get(m) ?? 0)) : 0;
    out[r].nodes.unshift(c.g);
  }
  return out;
}

/* ---------- sequence diagrams ---------- */

/**
 * Participants first, then each message and note in the order written.
 * Messages carry `data-id="i<n>"` (statement order); each message's text is
 * the element just before its line. Loops, activations and numbers join the
 * first step at or below their top edge.
 */
function sequence(svg, script) {
  const actors = [
    ...new Set(
      [...svg.querySelectorAll('.actor-line, rect.actor, [class*="actor-man"]')].map(
        (el) => el.closest('g') ?? el
      )
    ),
  ];
  const items = [];
  svg.querySelectorAll('[class^="messageLine"], [class*=" messageLine"]').forEach((line) => {
    const prev = line.previousElementSibling;
    const text = prev?.classList.contains('messageText') ? prev : null;
    items.push({ order: order(line), edges: [line], labels: text ? [text] : [], nodes: [] });
  });
  svg.querySelectorAll('rect.note').forEach((rect) => {
    const g = rect.closest('g') ?? rect;
    items.push({ order: order(g), edges: [], labels: [], nodes: [g] });
  });
  if (!items.length) return { steps: [], graph: null };
  items.sort((a, b) => a.order - b.order);

  let steps;
  if (script) {
    const at = new Map();
    script.forEach((s, i) =>
      s.targets.forEach((t) => {
        const [a, b = a] = t.split('-').map(Number);
        for (let n = a; n <= b && Number.isFinite(n); n++) at.has(n) || at.set(n, i);
      })
    );
    let total = script.length;
    if (items.some((_, i) => !at.has(i + 1))) total += 1;
    steps = Array.from({ length: total }, (_, i) => ({
      nodes: [],
      edges: [],
      labels: [],
      caption: script[i]?.caption ?? '',
    }));
    items.forEach((it, i) => merge(steps[at.get(i + 1) ?? total - 1], it));
  } else {
    steps = items.map((it) => merge({ nodes: [], edges: [], labels: [], caption: '' }, it));
  }

  // Everything else joins the first step it sits beside.
  const tops = steps.map((s) => top([...s.edges, ...s.nodes]));
  const seen = new Set(actors);
  svg.querySelectorAll('[class^="activation"], .loopLine, .sequenceNumber').forEach((el) => {
    const g = el.classList.contains('loopLine') ? el.parentElement : el;
    if (seen.has(g)) return;
    seen.add(g);
    const y = g.getBoundingClientRect().top;
    let i = tops.findIndex((t) => t >= y - 4);
    if (i < 0) i = steps.length - 1;
    steps[i].nodes.push(g);
  });
  steps[0].nodes.unshift(...actors);
  return { steps, graph: null };
}

function order(el) {
  const m = /^i(\d+)$/.exec(el.dataset?.id ?? el.closest('[data-id]')?.dataset.id ?? '');
  return m ? Number(m[1]) : el.getBoundingClientRect().top;
}

function merge(step, it) {
  step.nodes.push(...it.nodes);
  step.edges.push(...it.edges);
  step.labels.push(...it.labels);
  return step;
}

function top(els) {
  const ys = els.map((e) => e.getBoundingClientRect().top);
  return ys.length ? Math.min(...ys) : Infinity;
}

/* ---------- geometry ---------- */

function screenPoint(el, p) {
  const m = el.getScreenCTM();
  return m ? new DOMPoint(p.x, p.y).matrixTransform(m) : p;
}

function distance(p, r) {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
}

function center(r) {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

function inside(p, r) {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}
