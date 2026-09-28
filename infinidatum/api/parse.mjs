/**
 * POST /api/parse  { "code": "flowchart LR ..." }  or  { "diagrams": { "key": "..." } }
 * GET  /api/parse?code=...
 *
 * Checks Mermaid syntax with the hosted build, so a project can test its
 * diagrams in CI against the exact version its pages load.
 *   200 { ok: true, diagramType, version }
 *   200 { ok: false, error, line?, version }       a syntax error is an answer, not a failure
 *   200 { ok, results: { key: {...} }, version }   batch form, up to 500 diagrams
 */
import { MAX_SOURCE, parseDiagram, version } from "./_parse.mjs";

const MAX_BATCH = 500;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

export async function GET(request) {
  const code = new URL(request.url).searchParams.get("code");
  return json({ ...(await parseDiagram(code)), version });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON.", version }, 400);
  }
  if (body && typeof body.diagrams === "object" && body.diagrams !== null) {
    const entries = Object.entries(body.diagrams);
    if (entries.length > MAX_BATCH) return json({ ok: false, error: `At most ${MAX_BATCH} diagrams per request.`, version }, 413);
    const results = {};
    for (const [key, code] of entries) results[key] = await parseDiagram(code);
    return json({ ok: Object.values(results).every((r) => r.ok), results, version });
  }
  const code = body?.code;
  if (typeof code === "string" && code.length > MAX_SOURCE) return json({ ok: false, error: `Source is over ${MAX_SOURCE} characters.`, version }, 413);
  return json({ ...(await parseDiagram(code)), version });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
