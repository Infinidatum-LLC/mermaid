// The parse API, run against the assembled bundle. `npm run build` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, OPTIONS, POST } from "../api/parse.mjs";

const post = (body) => POST(new Request("http://x/api/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("accepts a valid flowchart and names its type", async () => {
  const r = await (await post({ code: "flowchart LR\n A[x]:::ai --> B{y?}\n B -->|Yes| C[z]" })).json();
  assert.equal(r.ok, true);
  assert.equal(r.diagramType, "flowchart-v2");
  assert.match(r.version, /^\d+\.\d+\.\d+/);
});

test("reports a syntax error with its line, as an answer and not a failure", async () => {
  const res = await post({ code: "flowchart LR\n A --> B\n C[broken --> D" });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.ok, false);
  // Mermaid numbers the line where it gave up: an unclosed bracket on line 3 shows at the end of input.
  assert.ok(r.line >= 3, `line ${r.line}`);
  assert.match(r.error, /Parse error/);
});

test("parses other diagram types", async () => {
  const r = await (await GET(new Request(`http://x/api/parse?code=${encodeURIComponent("sequenceDiagram\n A->>B: hi")}`))).json();
  assert.equal(r.diagramType, "sequence");
});

test("checks a batch and fails the batch when one diagram fails", async () => {
  const r = await (await post({ diagrams: { good: "flowchart TD\n A --> B", bad: "flowchart TD\n A[x --> B" } })).json();
  assert.equal(r.ok, false);
  assert.equal(r.results.good.ok, true);
  assert.equal(r.results.bad.ok, false);
});

test("refuses bad bodies and oversized input", async () => {
  const bad = await POST(new Request("http://x/api/parse", { method: "POST", body: "not json" }));
  assert.equal(bad.status, 400);
  assert.equal((await post({ code: "x".repeat(50_001) })).status, 413);
  assert.equal((await (await post({ code: "" })).json()).ok, false);
});

test("allows cross-origin calls", async () => {
  const res = OPTIONS();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});
