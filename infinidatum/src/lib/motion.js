/**
 * Motion and emphasis for a drawn diagram: fades, lines drawing along their
 * length, dots moving along arrows, and dimming everything but a focus.
 *
 * Opacity only for boxes: Mermaid places them with a transform attribute,
 * which a CSS transform would replace.
 */

export function fadeIn(el, on, fresh, delay, speed = 1) {
  el.getAnimations().forEach((a) => a.cancel());
  el.style.opacity = on ? '1' : '0';
  if (on && fresh)
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 380 / speed,
      delay: delay / speed,
      easing: 'cubic-bezier(.2,.7,.3,1)',
      fill: 'backwards',
    });
}

export function drawEdge(path, on, fresh, speed = 1) {
  path.getAnimations().forEach((a) => a.cancel());
  path.style.opacity = on ? '1' : '0';
  if (!on || !fresh) return;
  const len = path.getTotalLength?.() ?? 0;
  // A dotted arrow keeps its own dashes; only a solid one draws along its length.
  const dashed =
    path.classList.contains('edge-pattern-dotted') ||
    path.classList.contains('edge-pattern-dashed') ||
    path.classList.contains('messageLine1') ||
    /\d/.test(getComputedStyle(path).strokeDasharray);
  if (len && !dashed) {
    path.animate(
      [
        { strokeDasharray: `${len}`, strokeDashoffset: `${len}` },
        { strokeDasharray: `${len}`, strokeDashoffset: '0' },
      ],
      { duration: 420 / speed, easing: 'ease-out', fill: 'backwards' }
    );
  } else {
    path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420 / speed, fill: 'backwards' });
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Sends a dot along each line, source to target, forever. Returns a function
 * that removes them. Each dot follows a copy of its line's geometry, so it
 * needs no ids and sits in the line's own coordinates.
 */
export function startFlow(lines, speed = 1) {
  const dots = [];
  for (const line of lines) {
    const d = geometry(line);
    const len = line.getTotalLength?.() ?? 0;
    if (!d || !len || !line.parentNode) continue;
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('r', '3');
    dot.setAttribute('class', 'infd-dot');
    dot.setAttribute('aria-hidden', 'true');
    const move = document.createElementNS(SVG, 'animateMotion');
    const seconds = Math.min(6, Math.max(1.2, len / 90)) / speed;
    move.setAttribute('dur', `${seconds.toFixed(2)}s`);
    move.setAttribute('repeatCount', 'indefinite');
    move.setAttribute('path', d);
    // Spread the dots out so they do not all leave at once.
    move.setAttribute('begin', `${(-Math.random() * seconds).toFixed(2)}s`);
    dot.appendChild(move);
    line.parentNode.appendChild(dot);
    dots.push(dot);
  }
  return () => dots.forEach((d) => d.remove());
}

function geometry(el) {
  if (el.tagName === 'path') return el.getAttribute('d');
  if (el.tagName === 'line') {
    const a = (n) => el.getAttribute(n) ?? '0';
    return `M${a('x1')},${a('y1')} L${a('x2')},${a('y2')}`;
  }
  return null;
}

/**
 * Dims everything in `svg` except the named boxes, the arrows between them,
 * and their labels. `names` empty clears the emphasis. With `neighbors`, the
 * boxes one arrow away stay lit too, and so do the arrows to them.
 */
export function emphasize(svg, graph, names, { neighbors = false } = {}) {
  svg.querySelectorAll('[data-infd-dim], [data-infd-hot]').forEach((el) => {
    el.removeAttribute('data-infd-dim');
    el.removeAttribute('data-infd-hot');
  });
  if (!graph || !names.length) return;
  const lit = new Set(names.filter((n) => graph.nodes.has(n)));
  if (!lit.size) return;
  const core = new Set(lit);
  if (neighbors)
    for (const e of graph.edges) {
      if (core.has(e.from)) lit.add(e.to);
      if (core.has(e.to)) lit.add(e.from);
    }
  graph.nodes.forEach((g, n) => lit.has(n) || g.setAttribute('data-infd-dim', ''));
  for (const e of graph.edges) {
    const on = neighbors ? core.has(e.from) || core.has(e.to) : lit.has(e.from) && lit.has(e.to);
    if (on) e.path.setAttribute('data-infd-hot', '');
    else [e.path, ...e.labels].forEach((el) => el.setAttribute('data-infd-dim', ''));
  }
  for (const c of graph.clusters)
    if (!c.members.some((m) => lit.has(m))) c.g.setAttribute('data-infd-dim', '');
}

/** Styles the element's shadow root adds for the effects above. */
export const MOTION_STYLE = `
.draw [data-infd-dim] { filter: opacity(.22) saturate(.4); transition: filter .2s; }
.draw [data-infd-hot] { stroke: var(--c-accent) !important; stroke-width: 2.5px !important; }
.draw g.node { transition: filter .2s; }
.draw.interactive g.node { cursor: pointer; }
.draw .infd-dot { fill: var(--c-accent); pointer-events: none; }
`;
