// <infd-diagram> in headless Chrome, against the assembled bundle. `npm run build` first.
// Skipped without Chrome (see render.test.mjs).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { canRender, close, openPage, version } from "../api/_browser.mjs";

const skip = !canRender() && "no Chrome to draw with";
let page;

before(async () => {
  if (skip) return;
  page = await openPage();
  await page.evaluate((v) => import(`/v/${v}/diagram.js`), version);
});
after(close);

/** Draws `code` with `attrs`, still, and returns what the element reports. */
const drawn = (code, attrs = {}) =>
  page.evaluate(
    async (code, attrs) => {
      const el = document.createElement("infd-diagram");
      el.setAttribute("animate", "none");
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      const done = new Promise((ok, fail) => {
        el.addEventListener("infd-drawn", ok, { once: true });
        el.addEventListener("infd-error", (e) => fail(new Error(String(e.detail?.message ?? e.detail))), { once: true });
      });
      el.code = code;
      document.body.replaceChildren(el);
      await done;
      const r = el.shadowRoot;
      return {
        steps: el.steps.map((s) => ({ nodes: s.nodes.length, edges: s.edges.length, labels: s.labels.length, caption: s.caption })),
        dim: r.querySelectorAll("[data-infd-dim]").length,
        dots: r.querySelectorAll(".infd-dot").length,
        say: r.querySelector(".say").textContent,
        tools: [...r.querySelectorAll("[data-tool]")].filter((b) => !b.hidden).map((b) => b.dataset.act),
      };
    },
    code,
    attrs,
  );

test("a flowchart builds by distance from the start, loops back last", { skip }, async () => {
  const r = await drawn("flowchart LR\n A --> B --> C\n B -->|no| D\n D --> B");
  assert.deepEqual(r.steps.map((s) => s.nodes), [1, 1, 2]);
  assert.equal(r.steps[2].edges, 3, "B→C, B→D and the loop back D→B draw with the last rank");
});

test("a sequence diagram builds participants, then each message and note in order", { skip }, async () => {
  const r = await drawn("sequenceDiagram\n A->>B: one\n Note over A: n\n B-->>A: two");
  assert.equal(r.steps.length, 3);
  assert.ok(r.steps[0].nodes >= 2, "participants come with the first message");
  assert.deepEqual(r.steps.map((s) => s.edges), [1, 0, 1]);
  assert.deepEqual(r.steps.map((s) => s.labels), [1, 0, 1]);
});

test("state and class diagrams build too, with unnamed arrows matched by geometry", { skip }, async () => {
  const state = await drawn("stateDiagram-v2\n [*] --> Idle\n Idle --> Busy: go\n Busy --> [*]");
  assert.equal(state.steps.length, 4);
  assert.equal(state.steps.reduce((n, s) => n + s.edges, 0), 3);
  const cls = await drawn("classDiagram\n Animal <|-- Dog\n Dog --> Bone");
  assert.equal(cls.steps.length, 3);
});

test("scripted steps set the order and captions; unnamed boxes come last", { skip }, async () => {
  const r = await drawn("flowchart TD\n %% step C | First C\n %% step A, B | Then the rest\n A --> B --> C --> D");
  assert.deepEqual(r.steps.map((s) => s.nodes), [1, 2, 1]);
  assert.deepEqual(r.steps.map((s) => s.caption), ["First C", "Then the rest", ""]);
  assert.equal(r.say, "Then the rest", "the last caption stays up");
});

test("focus dims the rest; flow dots follow the arrows; tools show on request", { skip }, async () => {
  const r = await drawn("flowchart LR\n A --> B --> C", { focus: "A,B", flow: "dots", tools: "zoom export" });
  assert.ok(r.dim >= 2, "C and the B→C arrow dim");
  assert.equal(r.dots, 2);
  assert.deepEqual(r.tools, ["out", "reset", "in", "svg", "png"]);
});

test("other diagram types draw still", { skip }, async () => {
  const r = await drawn('pie title Pets\n "Dogs" : 3\n "Cats" : 2');
  assert.equal(r.steps.length, 0);
});

test("exports SVG without HTML labels and a readable PNG", { skip }, async () => {
  const out = await page.evaluate(async () => {
    const el = document.querySelector("infd-diagram");
    const drawn = new Promise((ok) => el.addEventListener("infd-drawn", ok, { once: true }));
    el.code = "flowchart LR\n A[Ask]:::ai --> B[Send]";
    await drawn;
    const svg = await el.toSvg();
    const png = await el.toPng();
    return { svg: svg.slice(0, 5), fo: svg.includes("foreignObject"), type: png.type, size: png.size };
  });
  assert.equal(out.svg, "<svg ");
  assert.equal(out.fo, false);
  assert.equal(out.type, "image/png");
  assert.ok(out.size > 1000);
});
