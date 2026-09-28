/** GET /api/health — the Mermaid version this deployment serves. */
import { version } from "./_parse.mjs";

export function GET() {
  return new Response(JSON.stringify({ ok: true, version, latest: `/v/${version}/` }), {
    headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
