// INFD FLOW: the browser-free flowchart (src/flow) and /api/flow. Plain Node,
// no build and no Chrome needed.
// MUTATE BEFORE TRUSTING: each test names the change that must turn it red.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FlowError, checkFlow, parseFlow } from "../src/flow/parse.js";
import { candidateLayouts, layoutBreaks, layoutFlow } from "../src/flow/layout.js";
import { FLOW_CSS, flowFigure, flowSvg } from "../src/flow/svg.js";
import { GET, POST, readFlowOptions } from "../api/flow.mjs";

/** Shapes that stress the layout: chains, fans, labeled fans, long arrows, loop-backs, decisions. */
const FIXTURES = {
  chain:
    "flowchart LR\n  A[Staff ask a question]:::person --> B[AI drafts an answer]:::ai --> C[Person checks the facts]:::check --> D[Send to the member]:::done",
  decision:
    "flowchart TD\n  A[Ask]:::person --> B[Draft]:::ai --> C{Right?}\n  C -->|Yes| D[Send]:::done\n  C -->|No, fix the facts first| E[Fix]:::risk\n  E -.->|Try again| B",
  fanIn:
    "flowchart TD\n  A[Scope our own controls] --> B[Owner, inventory and access]\n  A --> C[Model and prompt changes]\n  A --> D[Rerun the baseline after changes]\n  B --> E[Opinion on our controls]:::check\n  C --> E\n  D --> E",
  labeledFanIn:
    "flowchart LR\n  A[Request]:::person --> B{Kind?}\n  B -->|Loan question| C[Lending]\n  B -->|Card dispute| D[Cards]\n  B -->|Anything else| E[Member service]\n  C -->|Answered| F[Close the ticket]:::done\n  D -->|Answered| F\n  E -->|Answered| F",
  labeledFanOut:
    "flowchart TD\n  A{Which desk?} -->|Lending questions| B[Loans]\n  A -->|Card disputes and fraud| C[Cards]\n  A -->|Everything else, by phone| D[Desk]",
  longArrow: "flowchart LR\n  A[Start] --> B[Two] --> C[Three] --> D[Four]\n  A -->|Skip ahead when it is simple| D",
  loops:
    "flowchart TD\n  A[Prompt]:::person --> B[Model]:::ai --> C{Good enough?}:::check\n  C -->|No| A\n  C -->|Yes| D[Use it]:::done\n  D -.->|Next week| B",
  quoted: 'flowchart LR\n  A["Ask (in plain words)"]:::person --> B["Draft: a reply, [redacted]"]:::ai --> C[Done]:::done',
  selfLoop: "flowchart LR\n  A[Poll] --> A\n  A --> B[Stop]:::risk",
};

/** What is wrong with a layout: overlapping boxes, or anything outside the drawing. */
function geometry(l) {
  const out = [];
  const boxes = [
    ...l.nodes.map((n) => ({ name: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
    ...l.edges.flatMap((e, i) => (e.labelBox ? [{ name: `label ${i}`, ...e.labelBox }] : [])),
  ];
  for (const b of boxes) {
    if (b.x < 0 || b.y < 0 || b.x + b.w > l.width + 0.5 || b.y + b.h > l.height + 0.5) out.push(`${b.name} outside`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.name} overlaps ${b.name}`);
    }
  }
  return out;
}

describe("the parser", () => {
  // MUTATION: let parseFlow accept an unknown class — a box would draw with no color.
  test("names the line it cannot read", () => {
    assert.throws(() => parseFlow("flowchart LR\n  A[Ask]:::person --> B[Draft]:::warning"), /line 2: unknown class warning/);
    assert.throws(() => parseFlow("flowchart LR\n  A[Ask --> B"), FlowError);
    assert.throws(() => parseFlow("graph TD\n  A --> B"), /line 1/);
    assert.throws(() => parseFlow("flowchart LR\n  A --> B\n  style A fill:#f00"), /line 3/);
    assert.throws(() => parseFlow("flowchart LR\n  A[Ask] & B[Draft] --> C"), /line 2/);
    assert.throws(() => parseFlow("flowchart LR\n  A(Round) --> B"), /round and other shapes/);
    assert.throws(() => parseFlow("flowchart LR\n  A[<b>Bold</b>] --> B"), /line 2/);
  });

  // MUTATION: drop the quoted-label branch — a label with parentheses would fail.
  test("reads boxes, decisions, quoted labels, chains, dotted and labeled arrows", () => {
    const f = parseFlow(`flowchart TD
  A["Ask (in plain words)"]:::person --> B[Draft]:::ai --> C{Right?}
  C -->|Yes| D[Send]:::done
  C -.->|Later| A`);
    assert.equal(f.direction, "TD");
    assert.deepEqual(
      f.nodes.map((n) => [n.id, n.label, n.shape, n.cls]),
      [
        ["A", "Ask (in plain words)", "box", "person"],
        ["B", "Draft", "box", "ai"],
        ["C", "Right?", "decision", undefined],
        ["D", "Send", "box", "done"],
      ],
    );
    assert.deepEqual(f.edges, [
      { from: "A", to: "B", label: undefined, dotted: undefined },
      { from: "B", to: "C", label: undefined, dotted: undefined },
      { from: "C", to: "D", label: "Yes", dotted: undefined },
      { from: "C", to: "A", label: "Later", dotted: true },
    ]);
  });

  // MUTATION: count line numbers from the first non-blank line — errors would point at the wrong line.
  test("allows blank lines before the header and keeps line numbers true", () => {
    assert.equal(parseFlow("\n\n  flowchart LR\n  A --> B").nodes.length, 2);
    assert.throws(() => parseFlow("\nflowchart LR\n  A --> B\n  C[x"), /line 4/);
  });

  // MUTATION: let checkFlow throw — a caller could not fall back to full Mermaid.
  test("checkFlow answers instead of throwing", () => {
    assert.equal(checkFlow(FIXTURES.chain).ok, true);
    const bad = checkFlow("flowchart LR\n  A --> B\n  subgraph X");
    assert.deepEqual([bad.ok, bad.line], [false, 3]);
    assert.deepEqual(checkFlow("sequenceDiagram\n A->>B: hi"), {
      ok: false,
      error: 'line 1: start with "flowchart LR" or "flowchart TD"',
      line: 1,
    });
  });
});

describe("the layout", () => {
  // MUTATION: set NODE_GAP negative, or drop `reserve` from breadth() — boxes or a fan's labels would sit on each other.
  test("lays out every fixture both ways, wide and narrow, with nothing overlapping or outside", () => {
    const problems = [];
    for (const [key, code] of Object.entries(FIXTURES)) {
      const flow = parseFlow(code);
      for (const dir of ["LR", "TD"]) {
        for (const narrow of [false, true])
          problems.push(...geometry(layoutFlow(flow, dir, narrow)).map((p) => `${key} ${dir}${narrow ? " narrow" : ""}: ${p}`));
      }
    }
    assert.deepEqual(problems, []);
  });

  // MUTATION: rank boxes by order of appearance — a branch would step backwards.
  test("ranks every box after the box its forward arrow comes from", () => {
    const l = layoutFlow(parseFlow("flowchart LR\n  A --> B --> C --> D\n  A --> D\n  D -.-> B"));
    assert.deepEqual(Object.fromEntries(l.nodes.map((n) => [n.id, n.rank])), {
      A: 0,
      B: 1,
      C: 2,
      D: 3,
    });
    assert.equal(l.ranks, 4);
  });

  // MUTATION: route a long arrow straight from A to D — it would run through B and C.
  test("routes a long arrow around the boxes it skips", () => {
    const l = layoutFlow(parseFlow("flowchart LR\n  A --> B --> C --> D\n  A --> D"));
    const b = l.nodes.find((n) => n.id === "B");
    const long = l.edges.find((e) => e.from === "A" && e.to === "D");
    const ys = [...long.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
    assert.equal(
      ys.every((y) => y > b.y && y < b.y + b.h),
      false,
    );
  });

  // MUTATION: always pick layout 0 in layoutBreaks — a wide LR flow would shrink to a smudge on a phone.
  test("turns a long left-to-right flow on a narrow column, and keeps it on a wide one", () => {
    const flow = parseFlow(
      "flowchart LR\n  A[Staff ask a question]:::person --> B[AI drafts an answer]:::ai --> C[Person checks the facts]:::check --> D[Fix what is wrong]:::risk --> E[Send to the member]:::done",
    );
    const breaks = layoutBreaks([layoutFlow(flow), layoutFlow(flow, "TD")]);
    const at = (w) => breaks.find((b) => w >= b.from && w <= b.to).pick;
    assert.equal(at(340), 1);
    assert.equal(at(1000), 0);
  });

  // MUTATION: drop the narrow candidates — four boxes side by side would scroll on a phone.
  test("wraps a wide fan-out tighter on a phone column", () => {
    const layouts = candidateLayouts(parseFlow(FIXTURES.fanIn));
    const pick = layoutBreaks(layouts).find((b) => 340 >= b.from && 340 <= b.to).pick;
    assert.ok(pick >= 2, `picked ${pick}`);
    assert.ok(layouts[pick].width < layouts[0].width);
  });
});

describe("the drawing", () => {
  const code =
    "flowchart LR\n  A[Ask & answer]:::person --> B[Draft]:::ai --> C{Right?}\n  C -->|Yes| D[Send]:::done\n  C -->|No| E[Fix]:::risk";
  const html = flowFigure(code, {
    caption: "Where a person checks.",
    alt: 'Staff ask, the AI drafts, a "person" checks.',
  });

  // MUTATION: emit the source for a script to draw — no picture without the script.
  test("is complete in the HTML, with no script and nothing to fetch", () => {
    assert.match(html, /<svg/);
    assert.doesNotMatch(html, /<script|https?:\/\/(?!www\.w3\.org)/);
    assert.ok(html.match(/class="dg-node /g).length >= 5);
  });

  // MUTATION: drop data-r — the player would have nothing to build in order.
  test("marks every box and arrow with its rank, and the figure with the rank count", () => {
    assert.match(html, /class="dg-node dg-person" data-r="0"/);
    assert.match(html, /class="dg-edge" data-r="1"/);
    assert.match(html, /data-ranks="4"/);
  });

  // MUTATION: stop escaping labels or alt text — page text could break out of the SVG.
  test("escapes every word it writes", () => {
    assert.match(html, /Ask &amp; answer/);
    assert.match(html, /a &quot;person&quot; checks/);
    assert.doesNotMatch(flowFigure(code, { caption: "<img src=x onerror=alert(1)>" }), /<img/);
  });

  // MUTATION: put words only inside the SVG — a screen reader would hear nothing.
  test("hides the drawing from screen readers and says the flow in words", () => {
    assert.match(html, /<svg[^>]*aria-hidden="true"/);
    assert.match(html, /<p class="dg-sr">Staff ask/);
    assert.match(html, /Good outcome/);
  });

  // MUTATION: drop the container queries — a phone would get the wide drawing.
  test("switches drawings by container width, not by script", () => {
    const fan = flowFigure(FIXTURES.chain);
    assert.match(fan, /@container \(max-width:\d+px\)/);
    assert.ok(fan.match(/<svg/g).length >= 2);
  });

  // MUTATION: drop the --infd-* fallbacks — <infd-diagram>'s theme variables would not reach the flow.
  test("colors from --infd-* variables, with light and dark presets", () => {
    assert.match(FLOW_CSS, /--dg-ai:var\(--infd-ai,#2c65aa\)/);
    assert.match(FLOW_CSS, /data-theme=dark\]\{[^}]*--dg-ai:var\(--infd-ai,#7fb0ea\)/);
  });

  // MUTATION: leave the theme off standalone SVG — an <img> would draw black boxes.
  test("bakes a theme into a standalone SVG", () => {
    const svg = flowSvg(layoutFlow(parseFlow(code)), { theme: "dark" });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /--dg-card:#121a20/);
  });
});

describe("/api/flow", () => {
  const post = (body) =>
    POST(
      new Request("http://x/api/flow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  test("draws an SVG over GET, cacheable, with the asked colors", async () => {
    const res = await GET(new Request(`http://x/api/flow?accent=%23ff8800&code=${encodeURIComponent(FIXTURES.decision)}`));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /image\/svg\+xml/);
    assert.match(res.headers.get("cache-control"), /s-maxage/);
    const svg = await res.text();
    assert.match(svg, /--dg-accent:#ff8800/);
    assert.match(svg, />Fix</);
  });

  test("answers html and json", async () => {
    const html = await (await post({ code: FIXTURES.chain, format: "html", theme: "auto", caption: "A chain." })).text();
    assert.match(html, /^<style>/);
    assert.match(html, /data-theme="auto"/);
    assert.match(html, /<figcaption>A chain\.<\/figcaption>/);
    const r = await (await post({ code: FIXTURES.chain, format: "json", direction: "td" })).json();
    assert.equal(r.ok, true);
    assert.equal(r.layout.direction, "TD");
    assert.equal(r.layout.nodes.length, 4);
  });

  // MUTATION: draw whatever parses loosely — a diagram outside the subset would draw wrong.
  test("answers source outside the subset with the line, as a 400", async () => {
    const res = await post({ code: "flowchart LR\n  A --> B\n  click A call x()" });
    assert.equal(res.status, 400);
    const r = await res.json();
    assert.deepEqual([r.ok, r.line], [false, 3]);
  });

  test("accepts only hex colors, known formats and directions", () => {
    assert.equal(readFlowOptions({ code: "flowchart LR\n A-->B", accent: "red;}" }).status, 400);
    assert.equal(readFlowOptions({ code: "flowchart LR\n A-->B", format: "png" }).status, 400);
    assert.equal(readFlowOptions({ code: "flowchart LR\n A-->B", direction: "RL" }).status, 400);
    assert.equal(readFlowOptions({ code: "" }).status, 400);
    assert.equal(readFlowOptions({ code: "x".repeat(10_001) }).status, 413);
    const ok = readFlowOptions({ code: "flowchart LR\n A-->B", theme: "auto" });
    assert.deepEqual([ok.format, ok.theme], ["svg", "light"], "auto is for html only");
  });
});
