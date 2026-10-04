/**
 * Builds a flowFigure() drawing in flow order: every box and arrow carries
 * `data-r`, its rank from the start, and this reveals them one rank at a time
 * when the figure scrolls into view. Next step walks it by hand; Replay builds
 * it again. Opacity and a line draw only, both in FLOW_CSS (.dg-off, .dg-in).
 *
 * The drawing is complete in the HTML. This hides it only once it knows it can
 * show it again: with motion allowed and two or more ranks. Reduced motion, a
 * print, or no script all get the still picture.
 */
const STEP_MS = 450;

/**
 * Attaches the player to one figure. Returns a function that detaches it.
 * @param {HTMLElement} figure  the .dg <figure> written by flowFigure()
 * @param {{ stepMs?: number }} [options]
 */
export function playFlow(figure, { stepMs = STEP_MS } = {}) {
  const ranks = Number(figure.dataset.ranks) || 0;
  if (figure.dataset.animate === 'none' || ranks < 2) return () => {};
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};
  if (typeof IntersectionObserver !== 'function') return () => {};

  const doc = figure.ownerDocument;
  let shown = 0;
  let timer;

  const controls = doc.createElement('div');
  controls.className = 'dg-controls';
  const nextBtn = doc.createElement('button');
  nextBtn.type = 'button';
  const replayBtn = doc.createElement('button');
  replayBtn.type = 'button';
  replayBtn.textContent = 'Replay';
  const status = doc.createElement('span');
  status.setAttribute('aria-live', 'polite');
  controls.append(nextBtn, replayBtn, status);
  figure.querySelector('.dg-frame')?.after(controls);

  const paint = (n, fresh) => {
    for (const el of figure.querySelectorAll('[data-r]')) {
      const on = Number(el.dataset.r) < n;
      const was = !el.classList.contains('dg-off');
      el.classList.toggle('dg-off', !on);
      if (!on) el.classList.remove('dg-in');
      else if (fresh && !was) el.classList.add('dg-in');
    }
    shown = n;
    nextBtn.textContent = shown >= ranks ? 'Step from the start' : 'Next step';
    status.textContent = `Step ${Math.min(shown, ranks)} of ${ranks}`;
  };
  const stop = () => clearTimeout(timer);
  const play = () => {
    stop();
    paint(0, false);
    let n = 0;
    const tick = () => {
      paint(++n, true);
      if (n < ranks) timer = setTimeout(tick, stepMs);
    };
    timer = setTimeout(tick, 60);
  };
  const next = () => {
    stop();
    paint(shown >= ranks ? 1 : shown + 1, true);
  };
  nextBtn.addEventListener('click', next);
  replayBtn.addEventListener('click', play);

  paint(0, false);
  const seen = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      seen.disconnect();
      play();
    },
    { threshold: 0.35 }
  );
  seen.observe(figure);

  return () => {
    seen.disconnect();
    stop();
    controls.remove();
    paint(ranks, false);
  };
}

/** Attaches the player to every flow figure under `root` that has none yet. */
export function playAll(root = document) {
  for (const fig of root.querySelectorAll('figure.dg[data-ranks]:not([data-played])')) {
    fig.dataset.played = '';
    playFlow(fig);
  }
}
