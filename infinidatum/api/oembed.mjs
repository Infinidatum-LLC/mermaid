/**
 * GET /api/oembed?url=<embed URL>&maxwidth=&maxheight=
 *
 * oEmbed (https://oembed.com) for embed.html links, so a CMS that speaks
 * oEmbed turns a pasted diagram link into the iframe. Only this
 * deployment's own embed pages are accepted.
 */
import { version } from "./_mermaid.mjs";

const EMBED_PATH = /^\/(?:v\/[^/]+|latest)\/embed\.html$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function GET(request) {
  const self = new URL(request.url);
  const params = self.searchParams;
  if ((params.get("format") ?? "json") !== "json") return json({ error: "Only json is supported." }, 501);
  let target;
  try {
    target = new URL(params.get("url") ?? "");
  } catch {
    return json({ error: "url must be an embed page URL." }, 400);
  }
  if (target.host !== self.host || !EMBED_PATH.test(target.pathname)) return json({ error: "url must be an embed page on this host." }, 404);

  const settings = new URLSearchParams(target.hash.slice(1) || target.search.slice(1));
  const size = (max, fallback) => Math.max(120, Math.min(fallback, Number(max) || Infinity));
  const width = size(params.get("maxwidth"), 720);
  const height = size(params.get("maxheight"), 420);
  const title = settings.get("caption") || settings.get("alt") || "Diagram";
  return json({
    version: "1.0",
    type: "rich",
    provider_name: "Infinidatum Mermaid",
    provider_url: self.origin,
    title,
    width,
    height,
    html: `<iframe src="${escape(target.href)}" width="${width}" height="${height}" title="${escape(title)}" loading="lazy" style="border:0;max-width:100%"></iframe>`,
    mermaid_version: version,
  });
}
