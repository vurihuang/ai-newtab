# Architecture

## Gateway mode

`packages/agent-core/gateway.ts` uses an OpenAI-compatible API directly:

1. Read the browser history, excluding blocked and local-network domains.
2. Send its bounded digest to `POST {baseUrl}/chat/completions` to select pages.
3. Validate the returned JSON, permit only history domains, deduplicate and cap
   the selection at 8 pages. Read those pages through the existing browser bridge.
4. Recheck exclusions and redirect destinations. Send at most 24,000 characters
   of cleaned HTML per page in a second Chat Completions request.
5. Collect streamed text, reject incomplete responses, and validate TSX syntax
   in the worker before saving. The new-tab page renders in the existing Sandpack iframe.

The model ID is a free-form string. `GET {baseUrl}/models` is optional discovery;
manual model IDs do not depend on it. Both endpoints use the configured bearer
key, if present. HTTP redirects are rejected. API roots can be localhost even
though localhost remains prohibited as a scraped source.

The extension owns orchestration; no Managed Agents, tool-calling API, cloud
sandbox or remote file store is required. Raw excerpts stay in worker memory.
The current pipeline does not progressively read large files: excerpts are
truncated, so items below the limit may be omitted. Models must support text
Chat Completions; Responses-only and Anthropic Messages-only gateways are not supported.

The existing 20-second keepalive and streaming connection let a build survive
closing its view. An interrupted worker cannot resume a gateway request. A
persisted `gatewayBuildInProgress` marker surfaces that interruption on wake,
then is cleared rather than repeatedly retrying. The user can rebuild, and the
normal automatic rebuild schedule still applies. The last good homepage remains
available if generation or TSX validation fails.

Connection settings are saved together, and the model list is read from
`GET {baseUrl}/models` after every endpoint or key change (debounced), so the
field offers real IDs while still accepting free text. Changing settings does not
alter the connection captured by a running build.

## Layout

```
packages/agent-core/      host-agnostic agent loop — imports no chrome.*, browser.*, or node:*
  gateway.ts              OpenAI-compatible client, model discovery, two-request build
  defaults.ts             the caps shared by digest, excerpts and waits
  history-digest.ts       narrows raw history to fit in a context window
  types.ts                BrowserBridge, KVStore, RunPhase, …

apps/extension/           MV3 extension (WXT + React)
  entrypoints/
    background.ts         service worker: hosts BuildManager, alarm heartbeat
    scraper.content.ts    injected into scraped tabs: immediately return loaded HTML
    newtab/
      components/Combobox.tsx   styled dropdown that still accepts free text
  lib/
    build-manager.ts      single-flight build host, broadcast, keepalive, interruption marker
    browser-bridge.ts     BrowserBridge over chrome.history / chrome.tabs
    history.ts            getHistory: group and rank chrome.history by domain
    scraper.ts            getPageHtml: load URLs in a background window, sanitize HTML
    protocol.ts           page ↔ worker messages and the five UI build steps
    auto-rebuild.ts       when to rebuild: the policy and the Settings presets
    schedule.ts           duration/cron grammar, next-run math, human preview
    storage.ts            every chrome.storage key, settings, saved homepage
    transpile.ts          TSX → JS for the preview

harness/                  Bun scripts: drive agent-core with a fixture/fetch bridge, test the extension
```

## Verification

| Command | Proves |
|---|---|
| `pnpm test` | History, exclusions, gateway authentication, stream framing, cancellation, output failures and page limits |
| `pnpm gateway:run` | Real gateway build against fixture history and public-page fetches |
| `pnpm agent:verify` | The deliverable transforms, evaluates and server-renders |
| `pnpm extension:test` | Isolated headless Chrome: setup and Settings UI, automatic model discovery, the styled dropdown, custom model persistence, real scraping of a local fixture, build concurrency and invalid TSX rejection |

`gateway:run` uses `GATEWAY_BASE_URL`, `GATEWAY_API_KEY` and `GATEWAY_MODEL` in `.env`
and spends the gateway's upstream credits. `agent:verify` is local. The harness's
bridge uses fixture history and a plain `fetch`, so it can't see logged-in pages —
that's the whole reason `getPageHtml` runs in your browser.

## Privacy

The editable blocked-sites list is enforced in agent-core, not just in the
prompt: blocked domains are excluded from history digests and their counts, and
blocked or non-HTTP(S) page requests never reach the browser bridge. Each scraped
page's final URL is checked again before its excerpt is sent, so a redirect onto
a blocked host is dropped: the browser still loads it, but nothing it read is
sent. Loopback, private-IP and local-network hosts are always blocked, whatever
the list says. Subresource loads are not intercepted.

The digest and page excerpts are sent to the configured gateway and its upstream
model provider. The extension cannot delete their logs or promise zero retention.
Generated code is stored locally; raw page excerpts are not persisted by the
extension. The key is never included in model messages or logs.

The API key lives in `chrome.storage.local`, readable by anyone with access to the
browser profile. Fine for a tool you run yourself; **do not ship this to the Web Store**
without moving the key behind a proxy.
