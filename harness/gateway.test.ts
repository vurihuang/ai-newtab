import { afterEach, describe, expect, test } from "bun:test";
import { listGatewayModels, normalizeGatewayUrl, runGatewayBuild, type BrowserBridge, type GatewayConfig, type RawSiteMetadata } from "@homepage/agent-core";

const component = `import React from 'react';\nexport default function PersonalizedHomepage() { return <main>Today's news</main>; }`;
const site = (domain: string): RawSiteMetadata => ({
  domain, totalVisits: 12, uniquePages: 4, lastVisitTime: Date.now(), averageVisitsPerDay: 2,
  titles: [domain], urls: [`https://${domain}/`], relevanceScore: 1,
});
const history = [site("news.example.com"), site("other.example.com"), site("mail.google.com"), site("127.0.0.1")];
const page = { url: "https://news.example.com/", title: "News", html: '<a href="/story">A real story</a>' };
let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => { server?.stop(true); server = undefined; });

function gateway(replies: Response[]) {
  const calls: { path: string; auth: string | null; body: any }[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      calls.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body: req.method === "POST" ? await req.json() : null });
      return replies.shift() ?? new Response("Unexpected request", { status: 500 });
    },
  });
  const config: GatewayConfig = { baseUrl: `http://127.0.0.1:${server.port}/v1/`, apiKey: "test-gateway-secret", model: "custom/model-id" };
  return { config, calls };
}
function json(content: string, reason = "stop") {
  return Response.json({ choices: [{ message: { content }, finish_reason: reason }] });
}
function stream(content: string, finish = true) {
  const wire = content.match(/.{1,7}/gs)!.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`).join("") +
    (finish ? 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' : "");
  const bytes = new TextEncoder().encode(wire);
  // Cut in arbitrary byte positions, including within UTF-8 characters and CRLF.
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + 13));
    offset += 13;
  } }), { headers: { "content-type": "text/event-stream" } });
}
function bridge(pages = [page]): BrowserBridge {
  return {
    async getHistory() { return { sites: history, totalSitesSeen: history.length }; },
    async getPageHtml() { return { pages, failed: [] }; },
  };
}

describe("OpenAI-compatible gateway", () => {
  test("validates API roots and does not accept URL credentials", () => {
    expect(normalizeGatewayUrl(" http://localhost:3425/v1/// ")).toBe("http://localhost:3425/v1");
    for (const url of ["file:///etc/passwd", "http://user:pass@example.com/v1", "https://example.com/v1?key=x", "https://example.com/v1#key", "https://example.com/v1/chat/completions", "not a url"]) {
      expect(() => normalizeGatewayUrl(url)).toThrow();
    }
  });

  test("discovers models and sends the configured bearer credential", async () => {
    const { config, calls } = gateway([Response.json({ data: [{ id: "z" }, { id: "a" }, { id: "z" }, { id: 7 }] })]);
    expect(await listGatewayModels(config)).toEqual(["a", "z"]);
    expect(calls[0]).toMatchObject({ path: "/v1/models", auth: "Bearer test-gateway-secret" });
  });

  test("supports unauthenticated local gateways", async () => {
    const { config, calls } = gateway([Response.json({ data: [] })]);
    await listGatewayModels({ ...config, apiKey: "" });
    expect(calls[0].auth).toBeNull();
  });

  test("does not include error bodies or secrets in authentication errors", async () => {
    const { config } = gateway([new Response("test-gateway-secret", { status: 401 })]);
    await expect(listGatewayModels(config)).rejects.toThrow("HTTP 401");
  });

  test("rejects redirects instead of forwarding credentials", async () => {
    const { config } = gateway([new Response(null, { status: 302, headers: { location: "/another-endpoint" } })]);
    await expect(listGatewayModels(config)).rejects.toThrow();
  });

  test("streams selection and TSX through a custom model, without Managed Agents", async () => {
    const { config, calls } = gateway([
      stream('```json\n{"urls":["https://news.example.com/"]}\n```'),
      stream(`\`\`\`tsx\n${component.replace("Today's news", "今天的新闻")}\n\`\`\``),
    ]);
    const result = await runGatewayBuild({ config, bridge: bridge(), userSystemPrompt: "Use Chinese" });
    expect(result.code).toContain("今天的新闻");
    expect(result.source).toBe("gateway");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.path).toBe("/v1/chat/completions");
      expect(call.body.model).toBe("custom/model-id");
      expect(call.body.stream).toBe(true);
      expect(call.body.messages[0].content).toContain("Use Chinese");
      expect(JSON.stringify(call.body)).not.toContain("test-gateway-secret");
    }
    expect(calls[0].body.messages[1].content).not.toContain("mail.google.com");
    expect(calls[0].body.messages[1].content).not.toContain("127.0.0.1");
  });

  test("filters blocked, private, unrelated and duplicate URLs before scraping", async () => {
    const { config } = gateway([
      json(JSON.stringify({ urls: [page.url, page.url, "https://mail.google.com/", "http://127.0.0.1/", "https://unseen.example/", "file:///tmp/a"] })), json(component),
    ]);
    let received: string[] = [];
    const b = bridge();
    b.getPageHtml = async ({ urls }) => { received = urls; return { pages: [page], failed: [] }; };
    await runGatewayBuild({ config, bridge: b });
    expect(received).toEqual([page.url]);
  });

  test("accepts www URLs for the normalized history domain", async () => {
    const url = "https://www.news.example.com/";
    const { config } = gateway([json(JSON.stringify({ urls: [url] })), json(component)]);
    const result = await runGatewayBuild({ config, bridge: bridge([{ ...page, url }]) });
    expect(result.code).toBe(component);
  });

  test("does not send blocked redirect content and caps each page excerpt", async () => {
    const { config, calls } = gateway([
      json(JSON.stringify({ urls: [page.url, "https://other.example.com/"] })), json(component),
    ]);
    await runGatewayBuild({ config, bridge: bridge([
      { ...page, html: "x".repeat(30_000) },
      { url: "https://other.example.com/", finalUrl: "https://mail.google.com/inbox", title: "Secret inbox", html: "PRIVATE EMAIL" } as typeof page,
    ]) });
    const payload = JSON.parse(calls[1].body.messages[1].content);
    expect(payload.pages).toHaveLength(1);
    expect(payload.pages[0].html).toHaveLength(24_000);
    expect(payload.pages[0].truncated).toBe(true);
    expect(calls[1].body.messages[1].content).not.toContain("PRIVATE EMAIL");
    expect(calls[1].body.messages[1].content).not.toContain("mail.google.com");
  });

  test("rechecks exclusions after pages load", async () => {
    const { config, calls } = gateway([json(JSON.stringify({ urls: [page.url] }))]);
    let blocked: string[] = [];
    const b = bridge();
    b.getPageHtml = async () => { blocked = ["news.example.com"]; return { pages: [page], failed: [] }; };
    await expect(runGatewayBuild({ config, bridge: b, blockedSites: async () => blocked })).rejects.toThrow("No selected pages");
    expect(calls).toHaveLength(1);
  });

  test("caps scraping at eight selected pages", async () => {
    const sites = Array.from({ length: 12 }, (_, i) => site(`site${i}.example.com`));
    const urls = sites.map((s) => `https://${s.domain}/`);
    const { config } = gateway([json(JSON.stringify({ urls })), json(component)]);
    let count = 0;
    await runGatewayBuild({ config, bridge: {
      async getHistory() { return { sites, totalSitesSeen: sites.length }; },
      async getPageHtml({ urls }) { count = urls.length; return { pages: [{ ...page, url: urls[0] }], failed: [] }; },
    } });
    expect(count).toBe(8);
  });

  test("rejects malformed selection without opening pages", async () => {
    const { config } = gateway([json("Sure, I can help!")]);
    let scraped = false;
    const b = bridge();
    b.getPageHtml = async () => { scraped = true; return { pages: [], failed: [] }; };
    await expect(runGatewayBuild({ config, bridge: b })).rejects.toThrow("valid page selection");
    expect(scraped).toBe(false);
  });

  test("rejects a disconnected stream, never accepts partial output", async () => {
    const { config } = gateway([stream('{"urls":["https://news.example.com/"]}', false)]);
    await expect(runGatewayBuild({ config, bridge: bridge() })).rejects.toThrow("before the model finished");
  });

  test("reports token truncation instead of saving incomplete TSX", async () => {
    const { config } = gateway([json(JSON.stringify({ urls: [page.url] })), json(component, "length")]);
    await expect(runGatewayBuild({ config, bridge: bridge() })).rejects.toThrow("length");
  });

  test("rejects prose instead of a homepage", async () => {
    const { config } = gateway([json(JSON.stringify({ urls: [page.url] })), json("Here is your homepage.")]);
    await expect(runGatewayBuild({ config, bridge: bridge() })).rejects.toThrow("homepage component");
  });

  test("does not call the gateway without readable history", async () => {
    const { config, calls } = gateway([]);
    const b = bridge();
    b.getHistory = async () => ({ sites: [site("mail.google.com")], totalSitesSeen: 1 });
    await expect(runGatewayBuild({ config, bridge: b })).rejects.toThrow("No readable sites");
    expect(calls).toHaveLength(0);
  });

  test("honors cancellation before any request and after scraping", async () => {
    const { config, calls } = gateway([json(JSON.stringify({ urls: [page.url] }))]);
    await expect(runGatewayBuild({ config, bridge: bridge(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    const controller = new AbortController();
    const b = bridge();
    b.getPageHtml = async () => { controller.abort(); return { pages: [page], failed: [] }; };
    await expect(runGatewayBuild({ config, bridge: b, signal: controller.signal })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
