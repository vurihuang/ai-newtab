import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GATEWAY_MODEL, listGatewayModels } from "@homepage/agent-core";
import type { ConnectionSettings } from "@/lib/storage";
import { Combobox, type ComboOption } from "./Combobox";

/** `ark/kimi-k3` → label "kimi-k3", hint "ark". The saved value stays the full ID. */
function toOption(id: string): ComboOption {
  const slash = id.indexOf("/");
  return slash === -1
    ? { value: id, label: id }
    : { value: id, label: id.slice(slash + 1), hint: id.slice(0, slash) };
}

/** Opening the picker refreshes at most this often; focus and click arrive as a pair. */
const OPEN_REFRESH_INTERVAL_MS = 1_000;
/** Typing refreshes once it pauses, so a long model ID is one request. */
const QUERY_REFRESH_DEBOUNCE_MS = 400;

/**
 * Endpoint, credential and model for an OpenAI-compatible gateway. The model
 * list comes from the gateway itself — on mount, after an endpoint or key change,
 * whenever the picker is opened or searched, and never from a cache — so what it
 * offers matches `GET /models`. Free text is always allowed, so a model the list
 * does not mention can still be used.
 */
export function ConnectionFields({ value, onChange }: {
  value: ConnectionSettings;
  onChange: (next: ConnectionSettings) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "loading" | "error"; text: string } | null>(null);
  const requestId = useRef(0);
  const lastLoadAt = useRef(0);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setStatus({ kind: "loading", text: "Reading the model list…" });
    try {
      const next = await listGatewayModels(value);
      if (id !== requestId.current) return;
      setModels(next);
      setStatus(null);
    } catch (error) {
      if (id !== requestId.current) return;
      setModels([]);
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not read the model list. You can still type a model ID.",
      });
    } finally {
      if (id === requestId.current) lastLoadAt.current = Date.now();
    }
  }, [value.baseUrl, value.apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load, debounced so editing the endpoint or key does not spam the gateway.
  useEffect(() => {
    const timer = setTimeout(() => void load(), QUERY_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [load]);

  // Opening the picker asks for the newest list, so a provider or model added in
  // Magpie appears without reopening this dialog.
  const refreshOnOpen = useCallback(() => {
    if (Date.now() - lastLoadAt.current < OPEN_REFRESH_INTERVAL_MS) return;
    void load();
  }, [load]);

  // Searching is deliberate: refresh once the typing pauses.
  const refreshOnQuery = useCallback(() => {
    if (typing.current) clearTimeout(typing.current);
    typing.current = setTimeout(() => void load(), QUERY_REFRESH_DEBOUNCE_MS);
  }, [load]);
  useEffect(() => () => {
    if (typing.current) clearTimeout(typing.current);
  }, []);

  const options = useMemo(
    () => (models.length ? models.map(toOption) : [{ value: DEFAULT_GATEWAY_MODEL, label: DEFAULT_GATEWAY_MODEL }]),
    [models],
  );

  // The saved ID can survive a removal in Magpie; say so here rather than failing
  // later inside a build. It stays usable, because a gateway may serve IDs that
  // `GET /models` does not list.
  const modelMissing = models.length > 0 && Boolean(value.model.trim()) && !models.includes(value.model.trim());
  // Silence is the normal state: only the first load and a failure say anything.
  const visibleStatus = status?.kind === "error" || (status?.kind === "loading" && !models.length) ? status : null;

  const change = (patch: Partial<ConnectionSettings>) => onChange({ ...value, ...patch });

  return (
    <fieldset className="fields">
      <legend className="settings-section-title">Magpie gateway</legend>
      <p className="settings-help">
        Any OpenAI-compatible endpoint works. Chat Completions is used for both requests.
      </p>

      <label className="field">
        <span className="field-label">Endpoint</span>
        <input
          type="url"
          value={value.baseUrl}
          placeholder="http://127.0.0.1:3425/v1"
          spellCheck={false}
          onChange={(event) => change({ baseUrl: event.target.value })}
        />
        <span className="field-help">The API root, usually ending in /v1.</span>
      </label>

      <label className="field">
        <span className="field-label">API key</span>
        <input
          type="password"
          autoComplete="off"
          value={value.apiKey}
          spellCheck={false}
          onChange={(event) => change({ apiKey: event.target.value })}
        />
        <span className="field-help">Leave empty only if your gateway requires no authentication.</span>
      </label>

      <div className="field">
        <span className="field-label" id="model-label">Model</span>
        <Combobox
          id="model-id"
          ariaLabel="Model ID"
          value={value.model}
          onChange={(model) => change({ model })}
          options={options}
          placeholder={DEFAULT_GATEWAY_MODEL}
          emptyText="No matching model — press Escape to keep your text"
          onOpen={refreshOnOpen}
          onQuery={refreshOnQuery}
        />
        <span className="field-help">Pick one from the gateway, or type any model ID it accepts.</span>
        {modelMissing && (
          <span className="field-help field-warn">
            Not in the gateway&apos;s current list — it may have been removed in Magpie.
          </span>
        )}
      </div>

      {visibleStatus && (
        <p className={`field-status${visibleStatus.kind === "error" ? " field-status-error" : ""}`} role="status">
          {visibleStatus.text}
        </p>
      )}
    </fieldset>
  );
}
