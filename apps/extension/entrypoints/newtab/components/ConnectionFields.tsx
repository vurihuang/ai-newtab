import { useRef, useState } from "react";
import { DEFAULT_GATEWAY_MODEL, DEFAULT_MODEL, listGatewayModels, MODEL_CHOICES } from "@homepage/agent-core";
import type { ConnectionSettings } from "@/lib/storage";

/** Model discovery is optional: manual IDs work even when GET /models does not. */
function loadModelsLabel(loading: boolean) {
  return loading ? "Loading…" : "Load models";
}

export function ConnectionFields({ value, onChange }: {
  value: ConnectionSettings;
  onChange: (next: ConnectionSettings) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const requestId = useRef(0);
  const change = (patch: Partial<ConnectionSettings>) => {
    requestId.current++;
    setLoading(false);
    setStatus(null);
    if (patch.baseUrl !== undefined || patch.apiKey !== undefined || patch.provider !== undefined) setModels([]);
    onChange({ ...value, ...patch });
  };
  const loadModels = async () => {
    const id = ++requestId.current;
    setLoading(true);
    setStatus(null);
    try {
      const next = await listGatewayModels(value);
      if (id !== requestId.current) return;
      setModels(next);
      setStatus({ kind: "ok", text: `Loaded ${next.length} models. Pick one or type an ID.` });
    } catch (error) {
      if (id !== requestId.current) return;
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not load models. You can still type a model ID.",
      });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  return (
    <fieldset className="fields">
      <legend className="settings-section-title">Model connection</legend>
      <p className="settings-help">
        The gateway answers OpenAI-compatible Chat Completions requests.
      </p>

      <label className="field">
        <span className="field-label">API provider</span>
        <select
          value={value.provider}
          onChange={(e) => {
            const provider = e.target.value as ConnectionSettings["provider"];
            change({ provider, apiKey: "", model: provider === "openai" ? DEFAULT_GATEWAY_MODEL : DEFAULT_MODEL });
          }}
        >
          <option value="openai">OpenAI-compatible gateway (Magpie)</option>
          <option value="anthropic">Anthropic Managed Agents</option>
        </select>
      </label>

      {value.provider === "openai" && (
        <label className="field">
          <span className="field-label">API Base URL</span>
          <input
            type="url"
            value={value.baseUrl}
            placeholder="http://127.0.0.1:3425/v1"
            spellCheck={false}
            onChange={(e) => change({ baseUrl: e.target.value })}
          />
          <span className="field-help">The API root, usually ending in /v1.</span>
        </label>
      )}

      <label className="field">
        <span className="field-label">
          {value.provider === "openai" ? "Gateway API key" : "Anthropic API key"}
        </span>
        <input
          type="password"
          autoComplete="off"
          value={value.apiKey}
          spellCheck={false}
          onChange={(e) => change({ apiKey: e.target.value })}
        />
        {value.provider === "openai" && (
          <span className="field-help">Leave empty only if your gateway requires no authentication.</span>
        )}
      </label>

      <label className="field">
        <span className="field-label">Model ID</span>
        <span className="field-row">
          {value.provider === "openai" ? (
            <input
              list="gateway-models"
              value={value.model}
              placeholder={DEFAULT_GATEWAY_MODEL}
              spellCheck={false}
              onChange={(e) => change({ model: e.target.value })}
            />
          ) : (
            <select value={value.model} onChange={(e) => change({ model: e.target.value })}>
              {MODEL_CHOICES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          {value.provider === "openai" && (
            <button type="button" className="hb-btn hb-btn-ghost" disabled={loading} onClick={() => void loadModels()}>
              {loadModelsLabel(loading)}
            </button>
          )}
        </span>
      </label>
      <datalist id="gateway-models">{models.map((id) => <option key={id} value={id} />)}</datalist>

      {status && (
        <p className={`field-status ${status.kind === "error" ? "field-status-error" : ""}`} role="status">
          {status.text}
        </p>
      )}

      <p className="settings-help">
        Your key stays in this browser&apos;s local extension storage and is sent only to the selected API.
        Browsing summaries and page excerpts are sent to that API and its model provider.
      </p>
    </fieldset>
  );
}
