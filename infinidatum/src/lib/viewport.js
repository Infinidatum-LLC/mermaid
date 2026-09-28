/**
 * Zoom and pan for a drawing inside a scrolling box.
 *
 * Zoom changes the SVG's width rather than applying a transform, so the box's
 * own scrollbars, touch scrolling and keyboard scrolling keep working. Drag
 * with the mouse to pan; Ctrl or ⌘ with the wheel, or a pinch on a trackpad,
 * zooms around the pointer.
 */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

export class Viewport {
  #box;
  #svg = null;
  #base = 0;
  #zoom = 1;
  #drag = null;
  #onChange;

  constructor(box, onChange = () => undefined) {
    this.#box = box;
    this.#onChange = onChange;
    box.addEventListener('wheel', this.#wheel, { passive: false });
    box.addEventListener('pointerdown', this.#down);
  }

  get zoom() {
    return this.#zoom;
  }

  /** Call after each draw, once the SVG has its fitted width. */
  attach(svg) {
    this.#svg = svg;
    this.#base = parseFloat(svg.style.width) || svg.viewBox.baseVal.width;
    this.#zoom = 1;
    this.#onChange(1);
  }

  /** Fits the drawing to the box, both ways, for fullscreen. */
  fitTo(width, height) {
    if (!this.#svg) return;
    const { width: w, height: h } = this.#svg.viewBox.baseVal;
    if (!w || !h) return;
    this.#base = Math.round(w * Math.min(width / w, height / h));
    this.#zoom = 0;
    this.set(1);
  }

  set(zoom, at) {
    if (!this.#svg) return;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const box = this.#box;
    const r = box.getBoundingClientRect();
    const px = at ? at.x - r.left : box.clientWidth / 2;
    const py = at ? at.y - r.top : box.clientHeight / 2;
    const ratio = this.#zoom ? z / this.#zoom : 1;
    const x = (box.scrollLeft + px) * ratio - px;
    const y = (box.scrollTop + py) * ratio - py;
    this.#zoom = z;
    this.#svg.style.width = `${Math.round(this.#base * z)}px`;
    box.scrollLeft = x;
    box.scrollTop = y;
    box.classList.toggle('zoomed', z !== 1);
    this.#onChange(z);
  }

  zoomBy(factor, at) {
    this.set(this.#zoom * factor, at);
  }

  reset() {
    this.set(1);
    this.#box.scrollLeft = 0;
    this.#box.scrollTop = 0;
  }

  destroy() {
    this.#box.removeEventListener('wheel', this.#wheel);
    this.#box.removeEventListener('pointerdown', this.#down);
  }

  #wheel = (e) => {
    if (!this.#svg || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.zoomBy(Math.exp(-e.deltaY / 300), { x: e.clientX, y: e.clientY });
  };

  #down = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !this.#svg) return;
    const box = this.#box;
    if (box.scrollWidth <= box.clientWidth && box.scrollHeight <= box.clientHeight) return;
    this.#drag = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
    box.setPointerCapture(e.pointerId);
    box.classList.add('panning');
    const move = (m) => {
      if (!this.#drag) return;
      box.scrollLeft = this.#drag.left - (m.clientX - this.#drag.x);
      box.scrollTop = this.#drag.top - (m.clientY - this.#drag.y);
    };
    const up = () => {
      this.#drag = null;
      box.classList.remove('panning');
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  };
}
