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

/**
 * Endpoint, credential and model for an OpenAI-compatible gateway. The model
 * list is read from the gateway itself as soon as the endpoint is usable, so the
 * field offers real IDs instead of asking the user to remember them.
 */
export function ConnectionFields({ value, onChange }: {
  value: ConnectionSettings;
  onChange: (next: ConnectionSettings) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "loading" | "ok" | "error"; text: string } | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setStatus({ kind: "loading", text: "Reading the model list…" });
    try {
      const next = await listGatewayModels(value);
      if (id !== requestId.current) return;
      setModels(next);
      setStatus({ kind: "ok", text: next.length ? `${next.length} models available` : "The gateway returned no models" });
    } catch (error) {
      if (id !== requestId.current) return;
      setModels([]);
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not read the model list. You can still type a model ID.",
      });
    }
  }, [value.baseUrl, value.apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load, debounced so editing the endpoint or key does not spam the gateway.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 500);
    return () => clearTimeout(timer);
  }, [load]);

  const options = useMemo(
    () => (models.length ? models.map(toOption) : [{ value: DEFAULT_GATEWAY_MODEL, label: DEFAULT_GATEWAY_MODEL }]),
    [models],
  );

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
        />
        <span className="field-help">Pick one from the gateway, or type any model ID it accepts.</span>
      </div>

      <p className={`field-status${status?.kind === "error" ? " field-status-error" : ""}`} role="status">
        {status?.text ?? "Reading the model list…"}
        {status?.kind !== "loading" && (
          <button type="button" className="field-refresh" onClick={() => void load()}>
            Refresh
          </button>
        )}
      </p>

      <p className="settings-help">
        Your key stays in this browser&apos;s local extension storage and is sent only to this endpoint.
        Browsing summaries and page excerpts are sent to the gateway and its upstream model provider.
      </p>
    </fieldset>
  );
}
