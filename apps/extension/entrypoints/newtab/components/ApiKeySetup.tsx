import { useState } from "react";
import { validateConnection, type ConnectionSettings } from "@/lib/storage";
import { ConnectionFields } from "./ConnectionFields";

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
    <div className="setup-screen">
      <div className="settings-modal" style={{ maxWidth: 560 }}>
        <header className="settings-header">
          <h2>Connect your model</h2>
          <p>Use Magpie or another OpenAI-compatible API to build your homepage. No Anthropic key is needed in gateway mode.</p>
        </header>
        <div className="settings-body">
          <section className="settings-section" style={{ borderBottom: "none" }}>
            <ConnectionFields value={connection} onChange={setConnection} />
          </section>
        </div>
        <footer className="settings-footer">
          <div className="settings-footer-status">
            {error && <span className="settings-error" role="alert">{error}</span>}
          </div>
          <button className="hb-btn hb-btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save connection"}
          </button>
        </footer>
      </div>
    </div>
  );
}
