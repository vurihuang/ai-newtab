import { useState } from "react";
import { validateConnection, type ConnectionSettings } from "@/lib/storage";
import { ConnectionFields } from "./ConnectionFields";
import { btn, errorBox } from "./ui";

export function ApiKeySetup({ initialConnection, onSave }: {
  initialConnection: ConnectionSettings;
  onSave: (connection: ConnectionSettings) => Promise<void>;
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError("");
    try { await onSave(validateConnection(connection)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ maxWidth: 560, margin: "8vh auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24 }}>Connect your model</h1>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        Use Magpie or another OpenAI-compatible API to build your homepage. No Anthropic key is needed in gateway mode.
      </p>
      <ConnectionFields value={connection} onChange={setConnection} />
      {error && <p role="alert" style={errorBox}>{error}</p>}
      <button style={{ ...btn, marginTop: 16 }} disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save connection"}
      </button>
    </div>
  );
}
