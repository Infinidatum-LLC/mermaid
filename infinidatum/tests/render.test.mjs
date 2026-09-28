// The render and oEmbed APIs. Drawing needs Chrome: set CHROME_PATH, or have
// Google Chrome installed on a Mac; without one the drawing tests are skipped.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, readOptions } from "../api/render.mjs";
import { GET as oembed } from "../api/oembed.mjs";
import { canRender, close } from "../api/_browser.mjs";

const skip = !canRender() && "no Chrome to draw with";
const post = (body) => POST(new Request("http://x/api/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

after(close);

test("draws an SVG with text labels and the theme's classes", { skip }, async () => {
  const res = await post({ code: "flowchart LR\n A[Ask]:::person --> B[Draft]:::ai" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /image\/svg\+xml/);
  const svg = await res.text();
  assert.match(svg, /^<svg/);
  assert.ok(!svg.includes("foreignObject"), "labels are SVG text");
  assert.match(svg, /Ask/);
  assert.match(svg, /#e4eefa/i, "the ai class color");
});

test("draws a PNG, dark and at the asked scale, cacheable over GET", { skip }, async () => {
  const code = "sequenceDiagram\n A->>B: hi";
  const res = await GET(new Request(`http://x/api/render?format=png&theme=dark&scale=1&code=${encodeURIComponent(code)}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control"), /s-maxage/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]);
});

test("answers a syntax error with the parse result, without drawing", async () => {
  const res = await post({ code: "flowchart LR\n A[x --> B" });
  assert.equal(res.status, 400);
  const r = await res.json();
  assert.equal(r.ok, false);
  assert.match(r.error, /Parse error/);
});

test("accepts only hex colors and known formats", () => {
  assert.equal(readOptions({ code: "graph TD\n A-->B", accent: "red;}\nclick A call x()" }).status, 400);
  assert.equal(readOptions({ code: "graph TD\n A-->B", format: "gif" }).status, 400);
  assert.equal(readOptions({ code: "" }).status, 400);
  assert.equal(readOptions({ code: "x".repeat(50_001) }).status, 413);
  const ok = readOptions({ code: "graph TD\n A-->B", accent: "#ff8800", scale: 9, theme: "dark" });
  assert.deepEqual([ok.colors.accent, ok.scale, ok.theme, ok.format, ok.labels], ["#ff8800", 4, "dark", "svg", "svg"]);
});

test("oEmbed wraps this host's embed pages in an iframe, and nothing else", async () => {
  const url = "https://h.example/v/12.0.0/embed.html#code=graph%20TD&caption=A%20%22quoted%22%20flow";
  const r = await (await oembed(new Request(`https://h.example/api/oembed?maxwidth=500&url=${encodeURIComponent(url)}`))).json();
  assert.equal(r.type, "rich");
  assert.equal(r.width, 500);
  assert.equal(r.title, 'A "quoted" flow');
  assert.match(r.html, /^<iframe src="https:\/\/h\.example\/v\/12\.0\.0\/embed\.html#/);
  assert.ok(!r.html.includes('"quoted"'), "attributes are escaped");
  const other = await oembed(new Request(`https://h.example/api/oembed?url=${encodeURIComponent("https://evil.example/v/1/embed.html")}`));
  assert.equal(other.status, 404);
});
