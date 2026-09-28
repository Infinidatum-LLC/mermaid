/**
 * Headless Chromium for drawing diagrams on the server. Mermaid lays out
 * text by measuring it, so drawing (unlike parsing) needs a real browser.
 *
 * The page runs on a made-up origin and loads only the files this deployment
 * serves under /v/<version>/, read from disk. Every other request is refused,
 * so a diagram cannot reach the network.
 *
 * On Vercel (Linux) the browser comes from @sparticuz/chromium. Elsewhere set
 * CHROME_PATH, or on a Mac the installed Google Chrome is used.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { version } from "./_mermaid.mjs";

const ORIGIN = "https://render.infd.invalid";
const ROOT = fileURLToPath(new URL(`../public/v/${version}/`, import.meta.url));
const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript" };
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const localChrome = () => process.env.CHROME_PATH || (process.platform === "darwin" && existsSync(MAC_CHROME) ? MAC_CHROME : "");

let browser;

async function launch() {
  const local = localChrome();
  if (local) return puppeteer.launch({ executablePath: local, headless: true });
  const { default: chromium } = await import("@sparticuz/chromium");
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

// One browser per warm function instance; a crashed one is replaced.
async function getBrowser() {
  const current = browser && (await browser.catch(() => null));
  if (current?.connected) return current;
  browser = launch();
  return browser;
}

/** Closes the shared browser, for tests and scripts. */
export async function close() {
  const current = browser && (await browser.catch(() => null));
  browser = undefined;
  await current?.close();
}

/** True when a browser can be started here. Tests skip server drawing without one. */
export function canRender() {
  return Boolean(localChrome() || process.platform === "linux");
}

async function serve(request) {
  const url = new URL(request.url());
  if (url.origin !== ORIGIN) return request.abort("blockedbyclient");
  if (url.pathname === "/") return request.respond({ status: 200, contentType: "text/html", body: '<!doctype html><html><body style="margin:0"></body></html>' });
  const prefix = `/v/${version}/`;
  const rel = normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
  if (!url.pathname.startsWith(prefix) || rel.startsWith("..") || !(extname(rel) in TYPES)) return request.respond({ status: 404, body: "" });
  try {
    return request.respond({ status: 200, contentType: TYPES[extname(rel)], body: await readFile(join(ROOT, rel)) });
  } catch {
    return request.respond({ status: 404, body: "" });
  }
}

/**
 * A blank page on the sandbox origin, where `import("/v/<version>/diagram.js")`
 * loads this deployment's element. The caller closes it.
 */
export async function openPage() {
  const page = await (await getBrowser()).newPage();
  page.setDefaultTimeout(15_000);
  await page.setRequestInterception(true);
  page.on("request", (r) => void serve(r).catch(() => undefined));
  await page.goto(`${ORIGIN}/`);
  return page;
}

/**
 * Draws `code` and returns `{ svg }`, plus `png` (a Buffer) when `format` is "png".
 * `theme` is "light" or "dark"; `colors` overrides theme colors by name and
 * must already be validated.
 */
export async function draw(code, { format = "svg", theme = "light", colors = {}, labels = "svg", scale = 2 } = {}) {
  const page = await openPage();
  try {
    const svg = await page.evaluate(
      async ({ code, theme, colors, labels, version }) => {
        const m = await import(`/v/${version}/diagram.js`);
        return m.renderSvgString(code, { theme: m.themeFrom(theme, colors), labels });
      },
      { code, theme, colors, labels, version },
    );
    if (format !== "png") return { svg };

    const size = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
      return { w: Number(doc.getAttribute("width")) || 800, h: Number(doc.getAttribute("height")) || 600 };
    }, svg);
    await page.setViewport({ width: Math.ceil(size.w + 32), height: Math.ceil(size.h + 32), deviceScaleFactor: scale });
    await page.evaluate(
      ({ svg, bg }) => {
        const box = document.createElement("div");
        box.id = "shot";
        box.style.cssText = `display:inline-block;padding:12px;background:${bg}`;
        box.innerHTML = svg;
        document.body.replaceChildren(box);
      },
      { svg, bg: colors.card || (theme === "dark" ? "#121a20" : "#ffffff") },
    );
    const png = await (await page.$("#shot")).screenshot({ type: "png" });
    return { svg, png: Buffer.from(png) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export { version };
