/**
 * Parsing without a browser. Mermaid's bundled DOMPurify reads `window` when
 * it loads, so a small server-side DOM (linkedom) stands in first. Parsing
 * checks syntax and reports the diagram type; it does not lay anything out,
 * so it needs no fonts and no headless browser.
 */
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window ??= window;
globalThis.document ??= window.document;

// Written by scripts/assemble.mjs: the same bundle the site serves at /v/<version>/.
const { default: mermaid, version } = await import("./_mermaid.mjs");

export const MAX_SOURCE = 50_000;

/** Parses one diagram. Never throws: a syntax error comes back as `ok: false`. */
export async function parseDiagram(code) {
  if (typeof code !== "string" || !code.trim()) return { ok: false, error: "No diagram source." };
  if (code.length > MAX_SOURCE) return { ok: false, error: `Source is over ${MAX_SOURCE} characters.` };
  try {
    const { diagramType } = await mermaid.parse(code);
    return { ok: true, diagramType };
  } catch (e) {
    const message = String(e?.message ?? e);
    const line = /line (\d+)/i.exec(message);
    return { ok: false, error: message, ...(line ? { line: Number(line[1]) } : {}) };
  }
}

export { version };
