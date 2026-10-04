/**
 * Lays out a parsed flow (./parse.js) as boxes and arrow paths, and picks which
 * layout each column width gets. Pure functions, no DOM: ./svg.js turns the
 * result into SVG on the server or in the browser.
 */

/** @typedef {import('./parse.js').Flow} Flow */
/** @typedef {import('./parse.js').FlowDirection} FlowDirection */
/** @typedef {import('./parse.js').FlowEdge} FlowEdge */
/** @typedef {import('./parse.js').FlowNode} FlowNode */
/** @typedef {{ x: number, y: number, w: number, h: number, lines: string[] }} LabelBox */
/** @typedef {FlowNode & { x: number, y: number, w: number, h: number, lines: string[], rank: number }} PlacedNode */
/** @typedef {FlowEdge & { d: string, rank: number, labelBox?: LabelBox }} PlacedEdge */
/**
 * @typedef {object} FlowLayout
 * @property {FlowDirection} direction
 * @property {number} width
 * @property {number} height
 * @property {number} ranks
 * @property {PlacedNode[]} nodes
 * @property {PlacedEdge[]} edges
 */

/* ---------------------------------------------------------- measuring text */

export const FONT_SIZE = 13;
export const LABEL_FONT_SIZE = 12;
export const LINE = 17;
export const LABEL_LINE = 15;
const MAX_TEXT = 150;
const MAX_EDGE_TEXT = 116;
/** Wrap widths for a phone column: more lines, narrower boxes. */
const NARROW_TEXT = 92;
const NARROW_EDGE_TEXT = 76;

/**
 * Text width in pixels, estimated from Inter's advance widths. The server has
 * no font to measure with, so this errs wide: a box a little roomy beats a
 * word that runs past its border.
 */
export function textWidth(s, size = FONT_SIZE) {
  let em = 0;
  for (const ch of s) {
    if (ch === ' ') em += 0.28;
    else if ("iljI.,:;'!|".includes(ch)) em += 0.27;
    else if ('frt()[]-/'.includes(ch)) em += 0.38;
    else if ('mwMW'.includes(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.68;
    else if (/\d/.test(ch)) em += 0.58;
    else em += 0.55;
  }
  return Math.ceil(em * size * 1.06);
}

/** Greedy word wrap to a pixel width. A single long word gets its own line. */
export function wrap(s, max, size = FONT_SIZE) {
  const out = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/* ---------------------------------------------------------------- layout */

const PAD_X = 12;
const PAD_Y = 8;
export const DECISION_INSET = 12;
const NODE_GAP = 16;
const RANK_GAP = 44;
const MARGIN = 8;
const BACK_LANE = 18;
/** An arrow label's clearance from the arrowhead, and from the box it leaves. */
const LABEL_TIP = 10;
const LABEL_PAD = 6;

/**
 * Lays the flow out in ranks, one rank per step from the start: a layered
 * drawing, as Mermaid's own does, cut down to what four to ten boxes need.
 * Long arrows pass through placeholder slots so they never cross a box, and
 * an arrow back to an earlier box runs in a lane outside the drawing.
 * `narrow` wraps the words tighter, for a phone column.
 *
 * @param {Flow} flow
 * @param {FlowDirection} [direction]
 * @param {boolean} [narrow]
 * @returns {FlowLayout}
 */
export function layoutFlow(flow, direction = flow.direction, narrow = false) {
  const lr = direction === 'LR';
  const ids = flow.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));

  // 1. Which arrows go back: a depth-first walk in authored order.
  const out = new Map(ids.map((id) => [id, []]));
  for (const e of flow.edges) out.get(e.from).push(e);
  const back = new Set();
  const state = new Map();
  const visit = (id) => {
    state.set(id, 1);
    for (const e of out.get(id)) {
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
  };
  const incoming = new Set(flow.edges.map((e) => e.to));
  for (const id of ids) if (!incoming.has(id) && !state.has(id)) visit(id);
  for (const id of ids) if (!state.has(id)) visit(id);
  const forward = flow.edges.filter((e) => !back.has(e) && e.from !== e.to);

  // 2. Rank: the longest path from a start, so every forward arrow moves on.
  const rank = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of forward) {
      const r = rank.get(e.from) + 1;
      if (r > rank.get(e.to)) {
        rank.set(e.to, r);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const ranks = Math.max(0, ...rank.values()) + 1;

  // 3. Slots: real boxes, plus a placeholder in each rank a long arrow crosses.
  const slots = [];
  const slotOf = new Map();
  for (const n of flow.nodes) {
    const lines = wrap(n.label, narrow ? NARROW_TEXT : MAX_TEXT);
    const inset = n.shape === 'decision' ? DECISION_INSET * 2 : 0;
    const w = Math.max(64, ...lines.map((l) => textWidth(l))) + PAD_X * 2 + inset;
    const h = lines.length * LINE + PAD_Y * 2;
    const s = { key: n.id, node: n, rank: rank.get(n.id), order: index.get(n.id), w, h, lines };
    slots.push(s);
    slotOf.set(n.id, s);
  }
  const paths = new Map();
  forward.forEach((e, ei) => {
    const chain = [slotOf.get(e.from)];
    for (let r = rank.get(e.from) + 1; r < rank.get(e.to); r++) {
      const s = {
        key: `~${ei}-${r}`,
        rank: r,
        order: index.get(e.from) + 0.5,
        w: lr ? 0 : 8,
        h: lr ? 8 : 0,
        lines: [],
      };
      slots.push(s);
      chain.push(s);
    }
    chain.push(slotOf.get(e.to));
    paths.set(e, chain);
  });

  // 4. Order within a rank: authored order, then two barycenter sweeps.
  const byRank = Array.from({ length: ranks }, () => []);
  for (const s of slots) byRank[s.rank].push(s);
  const neighbors = new Map(slots.map((s) => [s, { up: [], down: [] }]));
  for (const chain of paths.values()) {
    for (let i = 0; i + 1 < chain.length; i++) {
      neighbors.get(chain[i]).down.push(chain[i + 1]);
      neighbors.get(chain[i + 1]).up.push(chain[i]);
    }
  }
  const sortRank = (row) => row.sort((a, b) => a.order - b.order).forEach((s, i) => (s.order = i));
  byRank.forEach(sortRank);
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let r = 1; r < ranks; r++) {
      for (const s of byRank[r]) {
        const up = neighbors.get(s).up;
        if (up.length) s.order = up.reduce((a, u) => a + u.order, 0) / up.length + s.order * 0.001;
      }
      sortRank(byRank[r]);
    }
    for (let r = ranks - 2; r >= 0; r--) {
      for (const s of byRank[r]) {
        const down = neighbors.get(s).down;
        if (down.length)
          s.order = down.reduce((a, d) => a + d.order, 0) / down.length + s.order * 0.001;
      }
      sortRank(byRank[r]);
    }
  }

  // 5. Arrow labels, wrapped. Each sits on a straight run beside one box:
  // the box it points to, or the box it leaves when several labeled arrows
  // meet in one box. That box's slot is made broad enough to hold it, so
  // labels in a fan never touch, and the gap is deep enough for the run.
  const labelOf = new Map();
  for (const e of flow.edges) {
    if (!e.label) continue;
    const lines = wrap(e.label, narrow ? NARROW_EDGE_TEXT : MAX_EDGE_TEXT, LABEL_FONT_SIZE);
    labelOf.set(e, {
      lines,
      w: Math.max(...lines.map((l) => textWidth(l, LABEL_FONT_SIZE))) + 10,
      h: lines.length * LABEL_LINE + 4,
    });
  }
  const labeledInto = new Map();
  for (const e of paths.keys())
    if (labelOf.has(e)) labeledInto.set(e.to, (labeledInto.get(e.to) ?? 0) + 1);
  const atSource = (e) => labeledInto.get(e.to) > 1;
  const run = (l) => (lr ? l.w : l.h) + LABEL_TIP + LABEL_PAD;
  const gap = Array.from({ length: Math.max(0, ranks - 1) }, () => RANK_GAP);
  const reserve = new Map();
  for (const [e, chain] of paths) {
    const label = labelOf.get(e);
    if (!label) continue;
    const g = atSource(e) ? chain[0].rank : rank.get(e.to) - 1;
    gap[g] = Math.max(gap[g], run(label) + 28);
    const key = atSource(e) ? e.from : e.to;
    reserve.set(key, Math.max(reserve.get(key) ?? 0, lr ? label.h : label.w));
  }

  // 6. Coordinates. Along the flow, each rank is as deep as its deepest box;
  // across it, the rank is centered on the widest one.
  const depth = (s) => (lr ? s.w : s.h);
  const breadth = (s) => Math.max(lr ? s.h : s.w, (s.node && reserve.get(s.key)) || 0);
  const rankDepth = byRank.map((row) => Math.max(0, ...row.map(depth)));
  const rankBreadth = byRank.map(
    (row) => row.reduce((a, s) => a + breadth(s), 0) + NODE_GAP * Math.max(0, row.length - 1)
  );
  const across = Math.max(...rankBreadth);
  const start = [];
  let along = MARGIN;
  for (let r = 0; r < ranks; r++) {
    start.push(along);
    along += rankDepth[r] + (gap[r] ?? 0);
  }
  const center = new Map();
  byRank.forEach((row, r) => {
    let pos = MARGIN + (across - rankBreadth[r]) / 2;
    for (const s of row) {
      const b = breadth(s);
      const mid = pos + b / 2;
      const a = start[r] + rankDepth[r] / 2;
      center.set(s, lr ? { x: a, y: mid } : { x: mid, y: a });
      pos += b + NODE_GAP;
    }
  });

  const nodes = flow.nodes.map((n) => {
    const s = slotOf.get(n.id);
    const c = center.get(s);
    return {
      ...n,
      x: c.x - s.w / 2,
      y: c.y - s.h / 2,
      w: s.w,
      h: s.h,
      lines: s.lines,
      rank: s.rank,
    };
  });
  const end = start[ranks - 1] + rankDepth[ranks - 1] + MARGIN;
  let width = lr ? end : across + MARGIN * 2;
  let height = lr ? across + MARGIN * 2 : end;

  // 7. Arrows. Forward: leave the box's far side, cross each gap on a curve,
  // run straight through each rank. Back: out and round in an outside lane.
  const exitPt = (s) => {
    const c = center.get(s);
    return lr ? { x: c.x + s.w / 2, y: c.y } : { x: c.x, y: c.y + s.h / 2 };
  };
  const entryPt = (s) => {
    const c = center.get(s);
    return lr ? { x: c.x - s.w / 2, y: c.y } : { x: c.x, y: c.y - s.h / 2 };
  };
  const rankEnd = (r) => start[r] + rankDepth[r];
  // Moves a point along the flow.
  const ahead = (q, by) => (lr ? { x: q.x + by, y: q.y } : { x: q.x, y: q.y + by });
  const edges = [];
  /** How far the outermost loop-back lane, and its label, reach past the drawing. */
  let outside = 0;
  for (const e of flow.edges) {
    const label = labelOf.get(e);
    const chain = paths.get(e);
    if (chain) {
      const parts = [];
      let p = exitPt(chain[0]);
      parts.push(`M${f(p.x)},${f(p.y)}`);
      let labelAt;
      for (let i = 1; i < chain.length; i++) {
        const prevRank = chain[i - 1].rank;
        let from = lr ? { x: rankEnd(prevRank), y: p.y } : { x: p.x, y: rankEnd(prevRank) };
        if (lr ? from.x > p.x : from.y > p.y) parts.push(`L${f(from.x)},${f(from.y)}`);
        const target = chain[i];
        let to;
        if (target.node) to = entryPt(target);
        else
          to = lr
            ? { x: start[target.rank], y: center.get(target).y }
            : { x: center.get(target).x, y: start[target.rank] };
        let stop = to;
        if (label && i === 1 && atSource(e)) {
          labelAt = ahead(from, LABEL_PAD + (lr ? label.w : label.h) / 2);
          from = ahead(from, run(label));
          parts.push(`L${f(from.x)},${f(from.y)}`);
        } else if (label && i === chain.length - 1 && !atSource(e)) {
          labelAt = ahead(to, -LABEL_TIP - (lr ? label.w : label.h) / 2);
          stop = ahead(to, -run(label));
        }
        const m = lr ? (from.x + stop.x) / 2 : (from.y + stop.y) / 2;
        const c1 = lr ? { x: m, y: from.y } : { x: from.x, y: m };
        const c2 = lr ? { x: m, y: stop.y } : { x: stop.x, y: m };
        parts.push(`C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(stop.x)},${f(stop.y)}`);
        if (stop !== to) parts.push(`L${f(to.x)},${f(to.y)}`);
        if (target.node) p = to;
        else p = lr ? { x: rankEnd(target.rank), y: to.y } : { x: to.x, y: rankEnd(target.rank) };
        if (!target.node) parts.push(`L${f(p.x)},${f(p.y)}`);
      }
      edges.push({
        ...e,
        d: parts.join(' '),
        rank: rank.get(e.to),
        labelBox: label && labelAt && box(label, labelAt),
      });
    } else {
      // A loop back, or a box's arrow to itself. Its label sits on the lane,
      // so the lane stands far enough out to keep the label off the boxes.
      const half = label ? (lr ? label.h : label.w) / 2 : 0;
      const lane = outside + BACK_LANE + half;
      outside = lane + half;
      const a = slotOf.get(e.from);
      const b = slotOf.get(e.to);
      const ca = center.get(a);
      const cb = center.get(b);
      let d;
      let labelAt;
      if (lr) {
        const y = MARGIN + across + lane;
        const p0 = { x: ca.x, y: ca.y + a.h / 2 };
        const p1 = { x: cb.x, y: cb.y + b.h / 2 };
        d = `M${f(p0.x)},${f(p0.y)} C${f(p0.x)},${f(y)} ${f(p0.x)},${f(y)} ${f((p0.x + p1.x) / 2)},${f(y)} S${f(p1.x)},${f(y)} ${f(p1.x)},${f(p1.y)}`;
        labelAt = { x: (p0.x + p1.x) / 2, y };
        height = Math.max(height, y + (label ? label.h / 2 : 0) + MARGIN);
      } else {
        const x = MARGIN + across + lane;
        const p0 = { x: ca.x + a.w / 2, y: ca.y };
        const p1 = { x: cb.x + b.w / 2, y: cb.y };
        d = `M${f(p0.x)},${f(p0.y)} C${f(x)},${f(p0.y)} ${f(x)},${f(p0.y)} ${f(x)},${f((p0.y + p1.y) / 2)} S${f(x)},${f(p1.y)} ${f(p1.x)},${f(p1.y)}`;
        labelAt = { x, y: (p0.y + p1.y) / 2 };
        width = Math.max(width, x + (label ? label.w / 2 : 0) + MARGIN);
      }
      edges.push({
        ...e,
        d,
        rank: Math.max(a.rank, b.rank),
        labelBox: label && box(label, labelAt),
      });
    }
  }
  // An arrow's label may reach past the drawing's edge: grow to hold it.
  for (const e of edges) {
    if (!e.labelBox) continue;
    width = Math.max(width, e.labelBox.x + e.labelBox.w + MARGIN);
    height = Math.max(height, e.labelBox.y + e.labelBox.h + MARGIN);
  }

  return {
    direction,
    width: Math.ceil(width),
    height: Math.ceil(height),
    ranks,
    nodes,
    edges,
  };
}

function box(label, at) {
  return {
    x: at.x - label.w / 2,
    y: at.y - label.h / 2,
    w: label.w,
    h: label.h,
    lines: label.lines,
  };
}

function f(n) {
  return String(Math.round(n * 10) / 10);
}

/* ------------------------------------------------------------- fitting */

/** Past this the words blur: a sideways scroll reads better than a squint. */
export const MIN_SCALE = 0.8;
const MAX_HEIGHT = 640;

function fit(l, width) {
  return Math.min(1, width / l.width, MAX_HEIGHT / l.height);
}

/**
 * Which drawing each column width gets, so CSS can switch without a script.
 * `layouts` are candidates for the same flow, the authored one first: each
 * width gets the one that fits at the largest size, and the authored one keeps
 * any tie within 10%. Returns the width ranges, scanning the widths a column
 * can have, each naming its layout by index.
 *
 * @param {FlowLayout[]} layouts
 * @returns {{ from: number, to: number, pick: number }[]}
 */
export function layoutBreaks(layouts) {
  const out = [];
  for (let w = 240; w <= 1000; w += 8) {
    let pick = 0;
    let best = fit(layouts[0], w) * 1.1;
    layouts.forEach((l, i) => {
      if (i > 0 && fit(l, w) > best) [pick, best] = [i, fit(l, w)];
    });
    const last = out[out.length - 1];
    if (last && last.pick === pick) last.to = w + 7;
    else out.push({ from: w, to: w + 7, pick });
  }
  out[0].from = 0;
  out[out.length - 1].to = Infinity;
  return out;
}

/**
 * The four candidates a responsive drawing chooses from: as authored, turned,
 * and both again wrapped tight for a phone. The authored one is first.
 * @param {Flow} flow
 */
export function candidateLayouts(flow) {
  const other = flow.direction === 'LR' ? 'TD' : 'LR';
  return [
    layoutFlow(flow),
    layoutFlow(flow, other),
    layoutFlow(flow, flow.direction, true),
    layoutFlow(flow, other, true),
  ];
}
