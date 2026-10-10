/**
 * Loads the built extension into a real (headless) Chrome and verifies the half
 * of the system the Bun harness can't reach:
 *
 *   1. the MV3 service worker registers,
 *   2. the new-tab override renders (the API-key screen on a fresh profile),
 *   3. the worker answers `subscribe` on the build port with a snapshot,
 *   4. unconfigured builds fail cleanly,
 *   5. gateway settings and model discovery work through the UI,
 *   6. a complete gateway build reads a fixture page and saves valid TSX.
 *
 * No external model API calls are made. Chrome 136+ ignores `--load-extension`, so the
 * extension is loaded over CDP's Extensions domain instead.
 *
 * Run: pnpm build && pnpm extension:test
 * Set CHROME_PATH if Chrome isn't at the default macOS location.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = join(import.meta.dir, "../apps/extension/.output/chrome-mv3");
const PORT = Number(process.env.CHROME_DEBUG_PORT || 9333);
let generationRequests = 0;
let invalidCode = false;
const fixtureCode = `import React from 'react'; export default function PersonalizedHomepage() { return <main><h1>Fixture homepage</h1><a href="https://news.example.com/story">A real fixture story</a></main>; }`;
const fixture = Bun.serve({
  port: 0,
  async fetch(request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/v1/models") return Response.json({ data: [{ id: "fixture/model" }, { id: "fixture/custom" }] });
    if (path === "/v1/chat/completions") {
      if (request.headers.get("authorization") !== "Bearer fixture-key") return new Response(null, { status: 401 });
      const body = await request.json() as any;
      if (body.model !== "fixture/custom") return new Response(null, { status: 404 });
      generationRequests++;
      const selecting = body.messages[0].content.includes("Choose up to 8 URLs");
      const content = selecting
        ? JSON.stringify({ urls: [`http://news.example.com:${fixture.port}/`] })
        : invalidCode ? "export default function PersonalizedHomepage() { return <main>" : fixtureCode;
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response('<html><head><title>Fixture news</title></head><body><main><h1>Fixture news</h1><a href="https://news.example.com/story">A real fixture story</a></main></body></html>', {
      headers: { "Content-Type": "text/html" },
    });
  },
});

if (!existsSync(join(EXT, "manifest.json"))) {
  console.error(`No build at ${EXT}. Run: pnpm build`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "hp-ext-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, pass: boolean, extra?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) failures++;
};

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    "--host-resolver-rules=MAP news.example.com 127.0.0.1",
    "--enable-unsafe-extension-debugging", // required for the CDP Extensions domain
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function getJson(path: string) {
  return (await fetch(`http://127.0.0.1:${PORT}${path}`)).json() as Promise<any>;
}

/** Minimal CDP client over a target's websocket. */
async function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiters = new Map<number, (v: any) => void>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)!(msg);
      waiters.delete(msg.id);
    }
  };
  const send = (method: string, params: unknown = {}) =>
    new Promise<any>((res) => {
      const n = ++id;
      waiters.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    send,
    close: () => ws.close(),
    async evaluate<T>(expression: string): Promise<T> {
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
      return r.result?.result?.value as T;
    },
  };
}

try {
  let version: any;
  for (let i = 0; i < 80; i++) {
    try {
      version = await getJson("/json/version");
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome devtools endpoint never came up");
  console.log(`   ${version.Browser}\n`);

  // ---- load the unpacked extension ----------------------------------------
  const browser = await cdp(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT });
  const extId: string | undefined = loaded.result?.id;
  if (!extId) throw new Error(`loadUnpacked failed: ${JSON.stringify(loaded)}`);
  console.log(`   extension id: ${extId}\n`);

  // ---- 1. service worker ---------------------------------------------------
  let sw: any;
  for (let i = 0; i < 40 && !sw; i++) {
    const targets: any[] = await getJson("/json/list");
    sw = targets.find((t) => t.type === "service_worker" && t.url.includes(extId));
    if (!sw) await sleep(250);
  }
  check("MV3 service worker registered", Boolean(sw), sw?.url.split("/").pop());

  // ---- 2. new-tab override renders ----------------------------------------
  const targets: any[] = await getJson("/json/list");
  const blank = targets.find((t) => t.type === "page");
  if (!blank) throw new Error("no page target to navigate");

  const page = await cdp(blank.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  const nav = await page.send("Page.navigate", { url: `chrome-extension://${extId}/newtab.html` });
  if (nav.result?.errorText) throw new Error(`navigate failed: ${nav.result.errorText}`);

  let href = "";
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      href = await page.evaluate<string>("location.href");
      const ready = await page.evaluate<string>("document.readyState");
      if (href.startsWith("chrome-extension://") && ready === "complete") break;
    } catch {
      /* navigation in flight */
    }
  }
  check("new-tab override loads", href.startsWith("chrome-extension://"), href);

  await sleep(2500); // let React mount
  const bodyText = await page.evaluate<string>("document.body.innerText");
  check(
    "renders the gateway connection screen",
    /Connect your model/i.test(bodyText),
    bodyText.split("\n").filter(Boolean)[0]?.slice(0, 50),
  );

  // Open a build port, send one message, and collect replies for a moment.
  const talk = (msg: object, waitMs: number) =>
    page.evaluate<string>(`
      new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: "homepage-agent" });
        const replies = [];
        port.onMessage.addListener((m) => replies.push(m));
        port.postMessage(${JSON.stringify(msg)});
        setTimeout(() => { port.disconnect(); resolve(JSON.stringify(replies)); }, ${waitMs});
      })
    `).then((raw) => JSON.parse(raw) as any[]);

  // ---- 3. subscribe → snapshot ---------------------------------------------
  const subscribed = await talk({ kind: "subscribe" }, 1500);
  const snapshot = subscribed.find((m) => m.kind === "snapshot");
  check(
    "worker answers subscribe with a build snapshot",
    Boolean(snapshot) && snapshot.state.running === false,
    JSON.stringify(subscribed[0])?.slice(0, 80),
  );

  // ---- 4. startBuild without a key fails cleanly ----------------------------
  const started = await talk({ kind: "startBuild" }, 3000);
  const error = started.find((m) => m.kind === "error");
  check("unconfigured builds report a settings error", /model connection/i.test(error?.message ?? ""), error?.message);

  // ---- 5. chrome.history is readable ---------------------------------------
  const domains = await page.evaluate<string[]>(`
    (async () => {
      const seed = [
        "https://news.ycombinator.com/",
        "https://news.ycombinator.com/item?id=1",
        "https://lobste.rs/",
        "https://arstechnica.com/",
      ];
      for (const url of seed) await chrome.history.addUrl({ url });
      await new Promise((r) => setTimeout(r, 500));
      const items = await chrome.history.search({ text: "", startTime: 0, maxResults: 100 });
      return [...new Set(items.map((i) => new URL(i.url).hostname))];
    })()
  `);
  check(
    "chrome.history is readable (seeded domains returned)",
    domains.includes("news.ycombinator.com"),
    domains.join(", "),
  );

  // ---- gateway setup and Settings, using the rendered React controls -------
  const waitUntil = async (expression: string, timeout = 10_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await page.evaluate<boolean>(expression)) return;
      await sleep(100);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const fill = async (label: string, value: string) => {
    await page.evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find(e => e.textContent.includes(${JSON.stringify(label)}));
      const input = label?.querySelector('input');
      if (!input) throw new Error('Input not found');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  };
  const click = (text: string) => page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)});
    if (!button) throw new Error('Button not found');
    button.click();
  })()`);
  await fill("API Base URL", `http://127.0.0.1:${fixture.port}/v1`);
  await fill("Gateway API key", "fixture-key");
  await click("Load models");
  await waitUntil("document.querySelectorAll('#gateway-models option').length === 2");
  check("model discovery works from the extension page", true);
  await fill("Model ID", "fixture/model");
  await click("Save connection");
  await waitUntil("document.body.innerText.includes(\"Build today's homepage\")");
  await click("⚙️ Settings");
  await waitUntil("document.body.innerText.includes('Customize your homepage')");
  await fill("Model ID", "fixture/custom");
  await click("Save");
  await waitUntil("!document.body.innerText.includes('Customize your homepage')");
  const settingsSaved = await page.evaluate<boolean>(`(async () => {
    const s = await chrome.storage.local.get(['provider', 'baseUrl', 'apiKey', 'model', 'connectionConfigured']);
    return s.provider === 'openai' && s.model === 'fixture/custom' && s.apiKey === 'fixture-key' && s.connectionConfigured === true;
  })()`);
  check("custom gateway connection persists before the first build", settingsSaved);

  // ---- settings dialog: sticky actions and a custom rebuild schedule --------
  await click("⚙️ Settings");
  await waitUntil("document.body.innerText.includes('Customize your homepage')");
  const dialogLayout = await page.evaluate<any>(`(() => {
    const list = ['.settings-body', '.settings-header', '.settings-footer'];
    const layout = Object.fromEntries(list.map(selector => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const rect = element.getBoundingClientRect();
      return [selector, { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height), scrolls: element.scrollHeight > element.clientHeight + 1 }];
    }));
    return { ...layout, viewportHeight: window.innerHeight };
  })()`);
  check(
    "settings actions stay visible inside the viewport",
    Boolean(dialogLayout[".settings-footer"]) && dialogLayout[".settings-footer"].bottom <= dialogLayout.viewportHeight + 12 &&
      dialogLayout[".settings-header"].top >= 0,
    JSON.stringify(dialogLayout),
  );
  check("only the settings body scrolls", dialogLayout[".settings-body"].scrolls === true, JSON.stringify(dialogLayout[".settings-body"]));
  await fill("Rebuild every", "15m");
  await waitUntil("document.querySelector('.settings-schedule-preview')?.textContent?.includes('15 minutes')");
  const scheduleValid = await page.evaluate<boolean>("document.querySelector('.settings-schedule-input')?.getAttribute('aria-invalid') === 'false'");
  check("a custom duration shows its next run", scheduleValid);
  await fill("Rebuild every", "0 9 * * mon");
  await waitUntil("document.querySelector('.settings-schedule-preview')?.textContent?.includes('next')");
  await fill("Rebuild every", "not a schedule");
  await waitUntil("document.querySelector('.settings-schedule-input')?.getAttribute('aria-invalid') === 'true'");
  check("an invalid schedule is flagged instead of silently accepted", true);
  await fill("Rebuild every", "1h");
  await waitUntil("document.querySelector('.settings-schedule-input')?.getAttribute('aria-invalid') === 'false'");
  await click("Save");
  await waitUntil("!document.body.innerText.includes('Customize your homepage')");
  const savedSchedule = await page.evaluate<any>("chrome.storage.local.get('rebuildSchedule')");
  check("the custom schedule persists", savedSchedule.rebuildSchedule === "1h", savedSchedule.rebuildSchedule);
  await page.evaluate(`(async () => {
    await chrome.storage.local.set({ autoRebuild: false });
    await chrome.history.addUrl({url: 'http://news.example.com:${fixture.port}/'});
    await chrome.history.addUrl({url: 'http://news.example.com:${fixture.port}/recent'});
  })()`);
  const build = () => page.evaluate<any>(`new Promise(resolve => {
    const port = chrome.runtime.connect({ name: 'homepage-agent' });
    const timer = setTimeout(() => { port.disconnect(); resolve({kind:'timeout'}); }, 45000);
    port.onMessage.addListener(message => {
      if (message.kind === 'done' || message.kind === 'error') {
        clearTimeout(timer); port.disconnect(); resolve(message);
      }
    });
    port.postMessage({ kind: 'startBuild' });
    port.postMessage({ kind: 'startBuild' });
  })`);
  const built = await build();
  check("gateway build reads a page and produces a homepage", built.kind === "done" && built.code === fixtureCode, built.message);
  check("simultaneous build requests share one run", generationRequests === 2, `${generationRequests} model requests`);
  const stored = await page.evaluate<any>("chrome.storage.local.get(['homepageData', 'gatewayBuildInProgress'])");
  check("homepage saved and interruption marker cleared", stored.homepageData?.code === fixtureCode && !stored.gatewayBuildInProgress);
  invalidCode = true;
  const badBuild = await build();
  const afterFailure = await page.evaluate<any>("chrome.storage.local.get('homepageData')");
  check("invalid TSX fails without replacing the previous homepage", badBuild.kind === "error" && afterFailure.homepageData?.code === fixtureCode);

  page.close();
  browser.close();
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  failures++;
} finally {
  fixture.stop(true);
  chrome.kill("SIGKILL");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? "\x1b[32mEXTENSION VERIFIED\x1b[0m" : `\x1b[31m${failures} check(s) failed\x1b[0m`}`,
);
process.exit(failures === 0 ? 0 : 1);
