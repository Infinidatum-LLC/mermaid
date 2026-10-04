/**
 * GET  /api/flow?code=...&format=svg|html|json&theme=light|dark&direction=LR|TD
 * POST /api/flow  { "code": "...", "format": "html", "theme": "dark", "accent": "#ff8800" }
 *
 * Draws a flowchart in the INFD FLOW subset (src/flow/parse.js) with no
 * browser and no Mermaid: parsing, layout and SVG are plain functions, so an
 * answer takes milliseconds and the function cold-starts in a few. For other
 * diagram types, or syntax outside the subset, use /api/render.
 *
 *   format     "svg" (default): a standalone image, colors baked in
 *              "html": a <figure> that fits its column by container query,
 *                       with its stylesheet; paste into server HTML
 *              "json": the parsed flow and its layout, for your own drawing
 *   theme      "light" (default) or "dark"; "auto" too for html
 *   direction  "LR" or "TD" turns the flow; default as authored (svg, json)
 *   caption, alt  html only: the sentence above, and the flow in words
 *   colors     card, panel, ink, ink-soft, rule, accent, ai, ai-bg, good,
 *              good-bg, risk, risk-bg: each a #hex color (svg only)
 *
 * Source outside the subset answers 400 { ok: false, error, line }.
 * GET answers are cached by the CDN.
 */
import { checkFlow } from "../src/flow/parse.js";
import { layoutFlow } from "../src/flow/layout.js";
import { FLOW_CSS, flowFigure, flowSvg } from "../src/flow/svg.js";
import { themeFrom } from "../src/lib/theme.js";

export const MAX_SOURCE = 10_000;

const COLORS = ["card", "panel", "ink", "ink-soft", "rule", "accent", "ai", "ai-bg", "good", "good-bg", "risk", "risk-bg"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status, cache = "no-store") =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache, ...CORS },
  });

/** Checks and normalizes the options. Returns `{ error, status }` or the options. */
export function readFlowOptions(input) {
  const code = input.code;
  if (typeof code !== "string" || !code.trim()) return { error: "No diagram source.", status: 400 };
  if (code.length > MAX_SOURCE) return { error: `Source is over ${MAX_SOURCE} characters.`, status: 413 };
  const format = String(input.format ?? "svg").toLowerCase();
  if (!["svg", "html", "json"].includes(format)) return { error: 'format must be "svg", "html" or "json".', status: 400 };
  const theme = input.theme === "dark" ? "dark" : input.theme === "auto" && format === "html" ? "auto" : "light";
  const direction = input.direction == null || input.direction === "" ? undefined : String(input.direction).toUpperCase();
  if (direction !== undefined && direction !== "LR" && direction !== "TD") return { error: 'direction must be "LR" or "TD".', status: 400 };
  const colors = {};
  for (const k of COLORS) {
    if (input[k] == null || input[k] === "") continue;
    // Colors go into a stylesheet, so only plain hex is accepted.
    if (!HEX.test(String(input[k]))) return { error: `${k} must be a #hex color.`, status: 400 };
    colors[k] = String(input[k]);
  }
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : undefined);
  return {
    code,
    format,
    theme,
    direction,
    colors,
    caption: text(input.caption),
    alt: text(input.alt),
  };
}

function answer(input, cacheable) {
  const opts = readFlowOptions(input);
  if (opts.error) return json({ ok: false, error: opts.error }, opts.status);
  const checked = checkFlow(opts.code);
  if (!checked.ok) return json(checked, 400);
  const { flow } = checked;
  const headers = {
    ...CORS,
    "cache-control": cacheable ? "public, max-age=86400, s-maxage=31536000" : "no-store",
    "x-content-type-options": "nosniff",
  };
  if (opts.format === "json") {
    return json({ ok: true, flow, layout: layoutFlow(flow, opts.direction) }, 200, headers["cache-control"]);
  }
  if (opts.format === "html") {
    const html = `<style>${FLOW_CSS}</style>${flowFigure(flow, { caption: opts.caption, alt: opts.alt, theme: opts.theme })}`;
    return new Response(html, {
      headers: { ...headers, "content-type": "text/html; charset=utf-8" },
    });
  }
  const svg = flowSvg(layoutFlow(flow, opts.direction), {
    theme: themeFrom(opts.theme, opts.colors),
  });
  return new Response(svg, {
    headers: {
      ...headers,
      "content-type": "image/svg+xml; charset=utf-8",
      // An SVG opened on its own runs on this origin; it may style itself and nothing more.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export function GET(request) {
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
