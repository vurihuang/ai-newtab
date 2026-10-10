# AI Homepage — Magpie / OpenAI-compatible fork

This fork of [ThariqS/ai-newtab](https://github.com/ThariqS/ai-newtab) runs on any
OpenAI-compatible gateway — [Magpie](https://github.com/vurihuang/magpie) by default —
with a configurable endpoint, API key and model ID. The Anthropic mode, its SDK and
its configuration have been removed; no Anthropic account is needed.

[中文 Magpie 安装与配置指南](docs/MAGPIE.zh-CN.md)

**A new tab that reads the internet for you.**

AI Homepage replaces Chrome's new-tab page with one that's written for you. An
agent looks at what you've actually been browsing, opens the pages you follow
(signed in as you), and writes a fresh homepage from what it finds there. It
rebuilds itself in the background, so each new tab is up to date.

![An example homepage in a morning-newspaper style](docs/preview.png)
<sub>Illustration. Your homepage is built from your own browsing, so its stories will be different.</sub>

A morning newspaper is just one look. You can describe any look and the next build
follows it: a quiet one-column digest, a dense dashboard, a green-on-black
terminal, a zine.

> **Privacy, up front.** The extension sends a browsing-history summary and
> cleaned page excerpts to the endpoint you configure and its upstream model
> provider. Pages load in your signed-in browser and may contain private content.
> At most 8 excerpts are sent, capped at 24,000 characters each; raw pages stay in
> worker memory. Retention on the gateway and provider is governed by their
> settings. Your API key stays in the extension's local storage. See
> [ARCHITECTURE.md](./ARCHITECTURE.md#privacy).

---

## Install

You need Chrome (or another Chromium browser such as Ego), [Node.js](https://nodejs.org) 20+,
and an OpenAI-compatible gateway with a text model. The default endpoint is a local
Magpie at `http://127.0.0.1:3425/v1`.

```bash
git clone https://github.com/vurihuang/ai-newtab.git
cd ai-newtab
npx pnpm@10.11.1 install
npx pnpm@10.11.1 build
```

(If you already have [pnpm](https://pnpm.io), plain `pnpm install && pnpm build` works too.)

Then load it into Chrome:

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `apps/extension/.output/chrome-mv3`.

If Chrome asks whether to keep the changed new-tab page, choose **Keep it**.

## Your first homepage

1. Open a new tab. Enter the **Endpoint** (default `http://127.0.0.1:3425/v1`) and
   your gateway **API key**. The key may be empty only for gateways without
   authentication.
2. Pick a **Model** from the list. The extension reads it from the gateway as soon
   as the endpoint answers, so the dropdown shows real IDs, such as
   `group/auto-deepseek-v4-1-flash`. Type any other model ID if you prefer — the
   field accepts free text. Use the API's own ID, without a client-side
   `magpie/` prefix. Models must accept text via `POST /chat/completions`;
   a Responses-only endpoint is not supported.
3. Click **Save connection**, then **Build today's homepage**.
4. Watch the progress view as it reads your history, chooses pages, reads them
   in the browser and writes your homepage.

Use the API port, not Magpie's web dashboard port. The Base URL is the API root,
usually ending in `/v1`; do not append `/chat/completions` or `/models`.
Settings are available before your first build and after a failed build.

The first build takes a few minutes. You can close the tab while it runs, since
the build lives in the extension's background worker and appears in any new tab
you open.

## Make it yours

Click **⚙️ Settings** on the new tab.

**Instructions.** Anything you write here goes into every build and takes priority
over the agent's own defaults. This box sets both the content and the look:

| You write | You get |
| --- | --- |
| *"A morning newspaper. Serif type, a big masthead, a lead story, a column of briefs."* | A broadsheet front page |
| *"One calm column. No images. Five things worth reading, with one line on why."* | A quiet reading list |
| *"Dense dashboard: GitHub PRs and issues first, then Hacker News, then everything else."* | A work cockpit |
| *"Green-on-black terminal, monospace, like a 1980s BBS."* | Exactly that |
| *"Skip sports and politics. Always show the weather and my next three calendar events."* | Your rules, every day |

**Rebuild schedule.** Type a duration (`15m`, `1h`, `2d`) or a five-field cron
expression (`0 9 * * *`). The field previews when the next rebuild is due and
flags a value it cannot parse.

Click **Save & rebuild** to apply them right away.

**Sites the agent never reads.** Enter one host per line; subdomains are included,
and `*.example.com` is supported. The editable defaults include common webmail,
sign-in and document hosts. **Save & rebuild** saves the list and applies it to
history summaries and URLs requested through `getPageHtml`. A page that redirects
onto a blocked host is dropped before its content is uploaded. Local-network
addresses (localhost, private IPs, `.local` and `.internal` hosts) are always blocked.

**Model connection.** Change the endpoint, API key and model in Settings. The model
list is re-read automatically whenever the endpoint or key changes, and **Refresh**
re-reads it on demand; typing a model ID by hand works even when `GET /models` is
unavailable. **Save** applies settings to the next build; **Save & rebuild** starts
a build immediately. An in-progress build keeps the connection it started with.

**Rebuild automatically.** On by default. Once your homepage is older than the
schedule you set, the extension rebuilds it quietly in the background. Pick a
preset or type your own:

- **Duration:** `15m`, `1h`, `2d`, `1w`, or a bare number of hours (`12`).
- **Cron:** five fields at minute resolution — `0 9 * * *` (daily at 09:00),
  `0 9 * * mon` (Mondays), `*/30 8-18 * * *` (every 30 minutes while you work).
  `*`, ranges, lists, steps and three-letter names are accepted.
- **Off:** `off` disables the schedule; the field shows when the next run is due.

It only starts after you've built once by hand, and a failed build retries at
the next scheduled time rather than in a loop, so it never loops. Durations are
measured from your last build; a cron boundary counts once.

**↻ Rebuild** in the top-right corner rebuilds right away.

## Good to know

- **Cost.** Two text requests per successful build: page selection and homepage
  generation. Your gateway's upstream billing applies. Disable automatic rebuilds
  if you prefer to trigger every build yourself.
- **What it can see.** It ranks the sites in your history and opens up to 8 of
  them per build. It skips search engines, webmail, banking and logged-out
  marketing pages. Anything it can't open is reported, not hidden.
- **Links are real.** Every link on the page comes from a page the agent actually
  read. It's told never to invent a URL.
- **Interrupted builds.** Closing a tab does not stop a build. If the browser or
  the worker stops, the new tab reports the interruption; click **Rebuild** to
  start again.
- **Local gateway.** Magpie must be running during generation. Local addresses
  are allowed for the API connection; they remain blocked as browsing sources.
- **Updating.** After pulling new code, run `npx pnpm@10.11.1 build` again, then
  click the reload icon on the extension in `chrome://extensions`.

## How it works

The extension reads and filters your history, asks the model to choose up to 8 URLs
from those domains, reads the pages in your signed-in browser, then sends bounded
HTML excerpts to the model for a React component. Both model calls use streaming
Chat Completions. The worker validates TSX syntax before replacing the last
homepage, and the new tab renders it in a sandboxed iframe.

There is no server and no cloud session: the extension talks to your gateway
directly, and the browser-side work happens in the extension's own worker.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the request flow, the layout, and
the privacy notes.

## Development

```
packages/agent-core   the gateway client and build pipeline: no chrome.* or node:*
apps/extension        the MV3 extension (WXT + React)
harness               Bun scripts that run agent-core outside Chrome, and test the built extension
```

```bash
pnpm dev                 # WXT with hot reload
pnpm typecheck           # all packages
pnpm test                # unit tests (no API calls; needs Bun)
pnpm extension:test      # loads the built extension into headless Chrome (no API calls)

cp .env.example .env     # configure GATEWAY_*, then:
pnpm gateway:run         # real gateway + fixture history + public-page fetches
pnpm agent:verify        # check the last generated output renders
```

## Status

Early and experimental. It's a tool you run yourself with your own key. Don't
publish it to a store as-is: anyone with access to the browser profile can read
the stored API key.

## License

MIT
