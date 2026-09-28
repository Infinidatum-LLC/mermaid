/**
 * GET  /api/render?code=...&format=svg|png&theme=light|dark&scale=2
 * POST /api/render  { "code": "...", "format": "png", "theme": "dark", "accent": "#ff8800" }
 *
 * Draws a diagram on the server with the same bundle and theme the pages use,
 * complete and still, as an image for places that cannot run the element:
 * email, PDFs, Markdown, social cards.
 *
 *   format   "svg" (default) or "png"
 *   theme    "light" (default) or "dark"
 *   scale    PNG pixel density, 1 to 4 (default 2)
 *   labels   "svg" (default, works everywhere) or "html" (browsers only)
 *   colors   card, panel, ink, ink-soft, rule, accent, ai, ai-bg, good, good-bg,
 *            risk, risk-bg: each a #hex color
 *
 * A syntax error answers 400 with the parse result, before a browser starts.
 * GET answers are cached by the CDN, so an <img src> costs one draw per deploy.
 */
import { MAX_SOURCE, parseDiagram } from "./_parse.mjs";
import { draw, version } from "./_browser.mjs";

const COLORS = ["card", "panel", "ink", "ink-soft", "rule", "accent", "ai", "ai-bg", "good", "good-bg", "risk", "risk-bg"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status) =>
  new Response(JSON.stringify({ ...body, version }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

/** Checks and normalizes the options. Returns `{ error, status }` or the options for draw(). */
export function readOptions(input) {
  const code = input.code;
  if (typeof code !== "string" || !code.trim()) return { error: "No diagram source.", status: 400 };
  if (code.length > MAX_SOURCE) return { error: `Source is over ${MAX_SOURCE} characters.`, status: 413 };
  const format = String(input.format ?? "svg").toLowerCase();
  if (format !== "svg" && format !== "png") return { error: 'format must be "svg" or "png".', status: 400 };
  const theme = input.theme === "dark" ? "dark" : "light";
  const labels = input.labels === "html" ? "html" : "svg";
  const scale = Math.min(4, Math.max(1, Number(input.scale) || 2));
  const colors = {};
  for (const k of COLORS) {
    if (input[k] == null || input[k] === "") continue;
    // Colors go into Mermaid source and page styles, so only plain hex is accepted.
    if (!HEX.test(String(input[k]))) return { error: `${k} must be a #hex color.`, status: 400 };
    colors[k] = String(input[k]);
  }
  return { code, format, theme, labels, scale, colors };
}

async function answer(input, cacheable) {
  const opts = readOptions(input);
  if (opts.error) return json({ ok: false, error: opts.error }, opts.status);
  const parsed = await parseDiagram(opts.code);
  if (!parsed.ok) return json(parsed, 400);
  let out;
  try {
    out = await draw(opts.code, opts);
  } catch (e) {
    return json({ ok: false, error: `Drawing failed: ${e?.message ?? e}` }, 500);
  }
  const headers = {
    ...CORS,
    "cache-control": cacheable ? "public, max-age=86400, s-maxage=31536000" : "no-store",
    "x-mermaid-version": version,
    "x-content-type-options": "nosniff",
    // An SVG opened on its own runs on this origin; it may style itself and nothing more.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  };
  if (opts.format === "png") return new Response(out.png, { headers: { ...headers, "content-type": "image/png" } });
  return new Response(out.svg, { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
}

export async function GET(request) {
  return answer(Object.fromEntries(new URL(request.url).searchParams), true);
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON." }, 400);
  }
  return answer(body ?? {}, false);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
