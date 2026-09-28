# Infinidatum Mermaid

Infinidatum's own Mermaid, built from this fork and served from Vercel, so every project loads diagrams from one place we control instead of a public CDN.

Everything Infinidatum adds lives in this folder. The rest of the repository is upstream Mermaid, so pulling upstream changes stays a clean merge.

## What it serves

| Path                               | What                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `/v/<version>/diagram.js`          | `<infd-diagram>`: a themed flowchart that builds in flow order, with Next step and Replay.  |
| `/v/<version>/mermaid.esm.min.mjs` | The fork's Mermaid, as an ES module.                                                        |
| `/v/<version>/mermaid.min.js`      | The same, as a classic script.                                                              |
| `/latest/...`                      | The same files, following the fork. Cached five minutes. Use `/v/<version>/` in production. |
| `POST /api/parse`                  | Syntax check with this exact build. `{ code }` or `{ diagrams: { key: code } }`.            |
| `GET /api/health`                  | The version being served.                                                                   |

`/v/<version>/` is cached for a year and never changes. The landing page documents the element's attributes and theme variables, with a live playground.

## Use it

```html
<script type="module" src="https://<host>/v/12.0.0/diagram.js"></script>

<infd-diagram
  caption="A person checks every draft."
  alt="Staff ask, the AI drafts, a person reviews, then it is sent."
>
  flowchart LR A[Staff ask]:::person --> B[AI drafts]:::ai --> C[Review]:::check --> D[Send]:::done
</infd-diagram>
```

In React or Next.js, load the script once and render the element. Pass the source as its child text, or set `ref.current.code`.

Box classes: `person`, `ai`, `check`, `risk`, `done`. Colors come from `--infd-*` custom properties on any ancestor; see the landing page.

## Build and deploy

Vercel project root: `infinidatum/`. It installs the monorepo, runs `pnpm build:mermaid` at the root, then `scripts/assemble.mjs` copies the build, the element and the landing page into `public/` and points the API at the same bundle. A merge to `develop` deploys.

Locally:

```bash
pnpm install && pnpm build:mermaid        # at the repo root
cd infinidatum && npm install && npm run build && npm test
```

## Releasing a new Mermaid version

Merge upstream into `develop`. The version comes from `packages/mermaid/package.json`, and a deploy serves only that version: the old `/v/<version>/` path stops working. Before the merge, list the projects that pin the old path and move them in the same change window.
