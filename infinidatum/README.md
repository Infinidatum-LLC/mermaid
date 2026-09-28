# Infinidatum Mermaid

Infinidatum's own Mermaid, built from this fork and served from Vercel, so every project loads diagrams from one place we control instead of a public CDN.

Everything Infinidatum adds lives in this folder. The rest of the repository is upstream Mermaid, so pulling upstream changes stays a clean merge.

## What it serves

| Path                               | What                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `/v/<version>/diagram.js`          | `<infd-diagram>`: a themed diagram that builds in the order it reads, with step controls.   |
| `/v/<version>/client.js`           | Client SDK: `render`, `embed`, `embedUrl`, `parse`, `renderSvg`, `renderPng`, `imageUrl`.   |
| `/v/<version>/embed.html#code=...` | One diagram for an `<iframe>`; `/embed` redirects to the latest.                            |
| `/v/<version>/mermaid.esm.min.mjs` | The fork's Mermaid, as an ES module.                                                        |
| `/v/<version>/mermaid.min.js`      | The same, as a classic script.                                                              |
| `/latest/...`                      | The same files, following the fork. Cached five minutes. Use `/v/<version>/` in production. |
| `POST /api/parse`                  | Syntax check with this exact build. `{ code }` or `{ diagrams: { key: code } }`.            |
| `GET/POST /api/render`             | The diagram as SVG or PNG, drawn in headless Chrome. GET answers are CDN-cached.            |
| `GET /api/oembed?url=...`          | oEmbed for embed page links.                                                                |
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

What builds step by step: flowcharts, state and class diagrams (by distance from the start) and sequence diagrams (message by message). Other types draw still. Opt-in extras: `theme="dark|auto"`, `flow="dots"`, `focus="A,B"`, `tools="zoom fullscreen export"`, `speed`, `src="file.mmd"`, and `%% step A, B | caption` comments for narrated steps. Hover highlighting is on unless `highlight="none"`. Methods and events are listed at the top of `src/diagram.js`.

Other ways in, all from one import of `client.js`:

```js
import * as infd from 'https://<host>/v/12.0.0/client.js';
infd.embed('#box', code, { caption: 'In an iframe', theme: 'dark' }); // auto-sized iframe
const png = await infd.renderPng(code, { theme: 'dark' }); // drawn on the server
const src = infd.imageUrl(code); // <img src>, email, Markdown
```

## Source layout

`src/diagram.js` is the element; `src/lib/` holds its parts (theme, render, steps, motion, viewport, export). `scripts/assemble.mjs` bundles them with esbuild into one `diagram.js` per release, with Mermaid left as its own file. `api/_browser.mjs` runs that bundle in headless Chromium (`@sparticuz/chromium` on Vercel) for `/api/render`; its page can load only the release's own files.

## Build and deploy

Vercel project root: `infinidatum/`. It installs the monorepo, runs `pnpm build:mermaid` at the root, then `scripts/assemble.mjs` copies the build, the element and the landing page into `public/` and points the API at the same bundle. A merge to `develop` deploys.

Locally:

```bash
pnpm install && pnpm build:mermaid        # at the repo root
cd infinidatum && npm install && npm run build && npm test
```

The drawing tests need Chrome: set `CHROME_PATH`, or have Google Chrome installed on a Mac. Without it they are skipped.

## Releasing a new Mermaid version

Merge upstream into `develop`. The version comes from `packages/mermaid/package.json`, and a deploy serves only that version: the old `/v/<version>/` path stops working. Before the merge, list the projects that pin the old path and move them in the same change window.
