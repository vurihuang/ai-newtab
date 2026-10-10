# AI Homepage — Magpie edition

This fork of [ThariqS/ai-newtab](https://github.com/ThariqS/ai-newtab) builds your new
tab through a local **Magpie** gateway, or any other OpenAI-compatible API. The
endpoint, key and model are yours to set, and the model list is read from the gateway
itself. The Anthropic mode, its SDK and its configuration are gone: no Anthropic
account is needed.

> **For agents — paste this.**
> Install this extension for me: clone `https://github.com/vurihuang/ai-newtab`, run
> `npx pnpm@10.11.1 install && npx pnpm@10.11.1 build`, load
> `apps/extension/.output/chrome-mv3` as an unpacked extension in my Chromium browser,
> then read my local Magpie endpoint and API key (Pi keeps them in
> `~/.pi/agent/models.json` under `providers.magpie`; otherwise use the link Magpie
> prints when it starts) and fill them into the new tab's connection screen before
> building one homepage.

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

## Magpie integration

![The connection form with the model list read from a running Magpie gateway](docs/magpie-settings.png)
<sub>The connection form. The model list comes from the gateway, with each ID grouped
by where it is served (`codex`, `devin`, `ark`, …).</sub>

Three fields, nothing else:

1. **Endpoint** — `http://127.0.0.1:3425/v1` by default. Use the gateway's API port,
   not its dashboard port, and stop at the `/v1` root.
2. **API key** — leave it empty for a local gateway, which does not authenticate.
   A gateway shared over the network needs a key from `magpie gateway-key list`.
3. **Model** — read from `GET /models` as soon as the endpoint answers, and re-read
   whenever the endpoint or key changes, when you open the picker, and while you
   search. Nothing is cached, so the list matches `magpie models`. An ID the list no
   longer contains is flagged, not blocked — you can still type any ID.

Prefer the terminal? `magpie serve` prints the endpoint, the key and the model count;
`magpie models` lists every model ID you can pick.

No cloud account, no server between the browser and the gateway, and the settings
stay in the extension's local storage. The same three fields point at any other
OpenAI-compatible API; models must accept text through `POST /chat/completions`.

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

1. Open a new tab and fill in the three fields above: **Endpoint**, **API key** and
   **Model**. The model list is already waiting — it is read from your gateway.
2. Click **Save connection**, then **Build today's homepage**.
3. Watch the progress view as it reads your history, chooses pages, reads them in
   the browser and writes your homepage.

Settings are available before your first build, from the button on an existing
homepage, and after a failed build — so nothing locks you out.

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
list re-reads itself when the endpoint or key changes and every time you open the
picker or search it, so a provider added in Magpie shows up without a reload; typing
a model ID by hand works even when `GET /models` is unavailable. **Save** applies
settings to the next build; **Save & rebuild** starts a build immediately. An
in-progress build keeps the connection it started with.

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
