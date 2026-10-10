# Architecture

## Gateway mode (default)

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

Connection settings are saved together. New installations default to Magpie;
existing installations with only an Anthropic key retain Anthropic mode.
Changing settings does not alter the connection captured by a running build.

## Anthropic Managed Agents mode

The original mode remains available. Three parties are involved:

| | Runs where | Does what |
|---|---|---|
| **Extension** (service worker) | Your browser | Hosts the build: holds the SSE stream, executes `getHistory` / `getPageHtml`, uploads page HTML, persists the homepage |
| **Extension** (new-tab page(s)) | Your browser | Thin view: subscribes to the worker over a port, renders live progress and the finished homepage |
| **Orchestration layer** | Anthropic | Runs the agent loop, persists the session event log, emits `agent.custom_tool_use` |
| **Session sandbox** | Anthropic | Runs `read` / `grep` / `glob` / `write` over the mounted pages |

The agent loop runs **in the service worker** (`apps/extension/lib/build-manager.ts`), so a build
survives closing the tab, shows up in every open tab, and can run headless on a
`chrome.alarms` schedule. The two custom tools execute in the extension too, because they
need `chrome.history` and `chrome.tabs`. Anthropic never executes them — it emits an event
and waits for a `user.custom_tool_result` on the same authenticated stream. There is no
inbound connection and no public endpoint.

```
service worker        Anthropic loop        sandbox
    │                       │                  │
    ├─ sessions.create ────▶│                  │
    ├─ events.stream ──────▶│  (open first)    │
    ├─ user.message ───────▶│                  │
    │◀─ custom_tool_use ────┤  getHistory      │
    ├─ chrome.history ──────┤                  │
    ├─ custom_tool_result ─▶│                  │
    │◀─ custom_tool_use ────┤  getPageHtml     │
    ├─ tabs + scripting     │                  │
    ├─ files.upload ───────────────────────────▶
    ├─ resources.add ──────────────────────────▶  mounts /mnt/session/uploads/pages/*.html
    ├─ custom_tool_result ─▶│                  │
    │                       ├─ grep / read ───▶│
    │◀─ agent.message ──────┤                  │
    │◀─ status_idle ────────┤  end_turn        │
    ├─ files.list(scope_id) ───────────────────▶  /mnt/session/outputs/homepage.tsx
    └─ sessions.delete ────▶│                  │
```

### Keeping the worker alive

An MV3 service worker is torn down after ~30s idle, and a build spends most of its
wall clock waiting on the model. Three things keep it alive or bring it back:

- **During a turn**, the in-flight session fetch plus a 20s self-ping
  (`runtime.getPlatformInfo`) reset the idle timer.
- **A 1-minute alarm heartbeat** calls `BuildManager.tick()`. If an
  `activeSessionId` is in storage, the worker reattaches: the orchestrator replays
  the session's event log, re-answers any tool call left hanging, and finishes.
- **The same heartbeat** drives scheduled rebuilds (`lib/auto-rebuild.ts`), so the
  first new tab of the day already shows a fresh homepage.

### Tabs are views

Each new tab connects on a port (`lib/protocol.ts`), receives a snapshot of the
build state, then streams phase/text/log deltas. Every open tab shows the same live
run. A throttled snapshot is also mirrored to storage so a tab opened while the
worker is asleep paints instantly.

The finished component renders inside a Sandpack iframe
(`entrypoints/newtab/components/HomepagePreview.tsx`): it is model-written code, so
it runs sandboxed, not in the extension's own page.

## Layout

```
packages/agent-core/      host-agnostic agent loop — imports no chrome.*, browser.*, or node:*
  gateway.ts              OpenAI-compatible client, model discovery, two-request build
  orchestrator.ts         runHomepageBuild: session lifecycle, event loop, tool dispatch, cleanup
  setup.ts                ensureAgent / ensureEnvironment (created once, cached by ID)
  prompt.ts               system prompt + per-build kickoff message
  schemas.ts              custom tool input schemas and defaults
  history-digest.ts       narrows raw history to fit a tool result
  types.ts                BrowserBridge, KVStore, RunPhase, …

apps/extension/           MV3 extension (WXT + React)
  entrypoints/
    background.ts         service worker: hosts BuildManager, alarm heartbeat
    scraper.content.ts    injected into scraped tabs: immediately return loaded HTML
    newtab/               the new-tab UI (thin client onto the worker)
  lib/
    build-manager.ts      single-flight build host, broadcast, keepalive, reattach
    browser-bridge.ts     BrowserBridge over chrome.history / chrome.tabs
    history.ts            getHistory: group and rank chrome.history by domain
    scraper.ts            getPageHtml: load URLs in a background window, sanitize HTML
    protocol.ts           page ↔ worker messages and the five UI build steps
    auto-rebuild.ts       when to rebuild on a schedule
    storage.ts            every chrome.storage key, settings, saved homepage
    transpile.ts          TSX → JS for the preview

harness/                  Bun scripts: drive agent-core with a fixture/fetch bridge, test the extension
```

## Verification

| Command | Proves |
|---|---|
| `pnpm test` | History, exclusions, gateway authentication, stream framing, cancellation, output failures and page limits |
| `pnpm gateway:run` | Real gateway build against fixture history and public-page fetches |
| `pnpm agent:run` | Full build against the real API: tools, mounting, sandbox grep/read, deliverable, cleanup |
| `pnpm agent:verify` | The deliverable transforms, evaluates and server-renders |
| `pnpm agent:resume-test` | A build killed with a tool call pending can be reattached and finished |
| `pnpm agent:retention <sessionId>` | The session and every uploaded page body are actually deleted |
| `pnpm extension:test` | Isolated headless Chrome: setup and Settings UI, model discovery, custom model persistence, real scraping of a local fixture, build concurrency and invalid TSX rejection |

`gateway:run` uses `GATEWAY_BASE_URL`, `GATEWAY_API_KEY` and `GATEWAY_MODEL` in `.env`.
It spends the gateway's upstream credits. `agent:run`, `agent:resume-test` and
`agent:retention` need `ANTHROPIC_API_KEY`; `agent:verify` is local. The
harness's bridge uses fixture history and a plain `fetch`, so it can't see
logged-in pages — that's the whole reason `getPageHtml` runs in your browser.

## Gotchas worth knowing (Anthropic mode)

**`mount_path` is always re-rooted under `/mnt/session/uploads/`.** A leading `/` is
stripped, not honored — both at session-create time and via `resources.add()`:

| requested | resolved |
|---|---|
| `/workspace/pages/x.html` | `/mnt/session/uploads/workspace/pages/x.html` |
| `/mnt/session/uploads/x.html` | `/mnt/session/uploads/x.html` |
| *(omitted)* | `/mnt/session/uploads/<file_id>` |

Always report `resource.mount_path` from the response back to the model, never the
path you asked for, or it greps a file that isn't there.

**The result event field is `custom_tool_use_id`**, not `tool_use_id`. (`tool_use_id`
belongs to `user.tool_confirmation` and `user.tool_result`.)

**Never leave an `agent.custom_tool_use` unanswered.** Every path out of the handler
must send a result — a thrown error becomes a result with `is_error: true`, never a
reason to skip the send. An unanswered tool call idles the session forever.

**Don't break on `session.status_idle` alone.** The session idles every time it waits
for a tool result. Break only on `status_terminated`, or on `status_idle` where
`stop_reason.type !== "requires_action"`. And run the terminal check for *every* event,
including deduped ones — `continue`-ing on a duplicate can skip the terminal event that
arrived in the history fetch.

**`event_start` / `event_delta` stream events carry no `id`.** Skip them before dedupe.

**`files.upload()` takes no `purpose`.** Just `{ file }`.

## Privacy

The editable blocked-sites list is enforced in agent-core's tool handlers, not
just the prompt: blocked domains are excluded from history digests and their
counts, and blocked or non-HTTP(S) page requests never reach the browser bridge.
Each scraped page's final URL is checked again before upload, so a redirect onto
a blocked host is dropped: the browser still loads it, but nothing it read is
sent. Loopback, private-IP and local-network hosts are always blocked, whatever
the list says. Subresource loads are not intercepted.

Gateway mode sends the digest and page excerpts to the configured gateway and
its upstream model provider. The extension cannot delete their logs or promise
zero retention. Generated code is stored locally; raw page excerpts are not
persisted by the extension. The key is never included in model messages or logs.

In Anthropic mode, the session event log persists every domain, title and scraped page body server-side
until deleted, and uploaded files persist independently. `runHomepageBuild` deletes
both in a `finally`. Confirm retention/ZDR eligibility against current docs before
distributing this.

The API key lives in `chrome.storage.local`, readable by anyone with access to the
browser profile. Fine for a tool you run yourself; **do not ship this to the Web Store**
without moving the key behind a proxy.
