import { useRef, useState } from "react";
import { DEFAULT_GATEWAY_MODEL, DEFAULT_MODEL, listGatewayModels, MODEL_CHOICES } from "@homepage/agent-core";
import type { ConnectionSettings } from "@/lib/storage";
import { btn } from "./ui";

const field = { width: "100%", boxSizing: "border-box" as const, padding: 10, marginTop: 6, border: "1px solid #ddd", borderRadius: 4, fontSize: 14 };
const label = { display: "block", marginTop: 14, color: "#333", fontSize: 14 };

export function ConnectionFields({ value, onChange }: {
  value: ConnectionSettings;
  onChange: (next: ConnectionSettings) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const requestId = useRef(0);
  const change = (patch: Partial<ConnectionSettings>) => {
    requestId.current++;
    setLoading(false);
    setStatus("");
    if (patch.baseUrl !== undefined || patch.apiKey !== undefined || patch.provider !== undefined) setModels([]);
    onChange({ ...value, ...patch });
  };
  const loadModels = async () => {
    const id = ++requestId.current;
    setLoading(true);
    setStatus("");
    try {
      const next = await listGatewayModels(value);
      if (id !== requestId.current) return;
      setModels(next);
      setStatus(`Loaded ${next.length} models. Choose one or enter a model ID manually.`);
    } catch (error) {
      if (id !== requestId.current) return;
      setStatus(error instanceof Error ? error.message : "Could not load models. You can still enter a model ID manually.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, color: "#333" }}>Model connection</legend>
      <label style={label}>
        API provider
        <select style={field} value={value.provider} onChange={(e) => {
          const provider = e.target.value as ConnectionSettings["provider"];
          change({ provider, apiKey: "", model: provider === "openai" ? DEFAULT_GATEWAY_MODEL : DEFAULT_MODEL });
        }}>
          <option value="openai">OpenAI-compatible gateway (Magpie)</option>
          <option value="anthropic">Anthropic Managed Agents</option>
        </select>
      </label>
      {value.provider === "openai" && (
        <label style={label}>
          API Base URL
          <input style={field} type="url" value={value.baseUrl} placeholder="http://127.0.0.1:3425/v1" onChange={(e) => change({ baseUrl: e.target.value })} />
        </label>
      )}
      <label style={label}>
        {value.provider === "openai" ? "Gateway API key (optional if your gateway requires no authentication)" : "Anthropic API key"}
        <input style={field} type="password" autoComplete="off" value={value.apiKey} onChange={(e) => change({ apiKey: e.target.value })} />
      </label>
      <label style={label}>
        Model ID
        {value.provider === "openai" ? (
          <input style={field} list="gateway-models" value={value.model} placeholder={DEFAULT_GATEWAY_MODEL} onChange={(e) => change({ model: e.target.value })} />
        ) : (
          <select style={field} value={value.model} onChange={(e) => change({ model: e.target.value })}>
            {MODEL_CHOICES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
      </label>
      <datalist id="gateway-models">{models.map((id) => <option key={id} value={id} />)}</datalist>
      {value.provider === "openai" && (
        <>
          <button type="button" style={{ ...btn, marginTop: 12 }} disabled={loading} onClick={() => void loadModels()}>
            {loading ? "Loading models…" : "Load models"}
          </button>
          <p style={{ color: "#666", fontSize: 12 }}>Use the exact model ID from your gateway, without a client-side provider prefix. The model must support Chat Completions text output.</p>
        </>
      )}
      {status && <p role="status" style={{ color: "#555", fontSize: 13 }}>{status}</p>}
      <p style={{ color: "#666", fontSize: 12 }}>
        Your key stays in this browser&apos;s local extension storage and is sent only to the selected API.
        Browsing summaries and page excerpts are sent to that API and its model provider.
      </p>
    </fieldset>
  );
}
