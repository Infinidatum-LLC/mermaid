/**
 * Saving a diagram as an SVG or PNG file.
 *
 * Both redraw the source with labels as SVG text: HTML labels sit in
 * <foreignObject>, which other programs skip and which taints a canvas in
 * some browsers, so a PNG could not be read back.
 */
import { renderSvgString } from './render.js';

/** SVG markup for `code`, drawn complete and still. */
export function toSvg(code, { theme, labels = 'svg' } = {}) {
  return renderSvgString(code, { theme, labels });
}

/** A PNG Blob for `code`, at `scale` times its natural size, on the theme's card color. */
export async function toPng(code, { theme, scale = 2 } = {}) {
  const markup = await toSvg(code, { theme });
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  const width = Math.ceil(Number(doc.getAttribute('width')) * scale);
  const height = Math.ceil(Number(doc.getAttribute('height')) * scale);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = theme?.card ?? '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png')
  );
}

/** Offers `data` (a string or Blob) to the reader as a download. */
export function download(data, filename, type = 'image/svg+xml') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
