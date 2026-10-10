import { useEffect, useRef, useState } from "react";
import { normalizeBlockList } from "@homepage/agent-core";
import { validateConnection, type ConnectionSettings } from "@/lib/storage";
import { ConnectionFields } from "./ConnectionFields";
import { describeSchedule, isOffText, parseSchedule, PRESET_SCHEDULES } from "@/lib/auto-rebuild";

export function SettingsModal({
  initialPrompt,
  blockedSites,
  connection,
  autoRebuild,
  onToggleAutoRebuild,
  rebuildSchedule,
  onChangeSchedule,
  onClose,
  onSave,
}: {
  initialPrompt: string;
  blockedSites: string[];
  connection: ConnectionSettings;
  autoRebuild: boolean;
  onToggleAutoRebuild: (next: boolean) => void;
  rebuildSchedule: string;
  onChangeSchedule: (next: string) => void;
  onClose: () => void;
  onSave: (prompt: string, blockedSites: string[], connection: ConnectionSettings, rebuild: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialPrompt);
  const [blockedDraft, setBlockedDraft] = useState(blockedSites.join("\n"));
  const [connectionDraft, setConnectionDraft] = useState(connection);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const schedule = parseSchedule(rebuildSchedule);
  // "off" is a deliberate choice; only an unparseable value is a problem.
  const scheduleProblem = !isOffText(rebuildSchedule) && schedule.kind === "off"
    ? "Use a duration like 15m, 1h, 1d, or a five-field cron expression such as 0 9 * * *."
    : "";
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the dialog so Escape works and Tab stays inside it during the first tab cycle.
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const save = async (rebuild: boolean) => {
    setSaving(true);
    setError("");
    try {
      await onSave(draft, normalizeBlockList(blockedDraft.split("\n")), validateConnection(connectionDraft), rebuild);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1}>
        <header className="settings-header">
          <h2 id="settings-title">Customize your homepage</h2>
          <p>These instructions apply to every build.</p>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Instructions</h3>
            <p className="settings-help">Describe what to show and how it should look. This takes priority over the agent's defaults.</p>
            <textarea
              className="settings-textarea settings-textarea-tall"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. 'A quiet one-column digest. Five things worth reading, with one line on why.'"
              aria-label="Homepage instructions"
            />
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Sites the agent never reads</h3>
            <p className="settings-help" id="blocked-sites-help">
              One host per line. Subdomains are included; <code>*.example.com</code> matches wildcards.
            </p>
            <textarea
              className="settings-textarea settings-textarea-list"
              value={blockedDraft}
              onChange={(e) => setBlockedDraft(e.target.value)}
              aria-labelledby="blocked-sites-help"
              spellCheck={false}
            />
          </section>

          <section className="settings-section">
            <ConnectionFields value={connectionDraft} onChange={setConnectionDraft} />
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Rebuild automatically</h3>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={autoRebuild}
                onChange={(e) => onToggleAutoRebuild(e.target.checked)}
              />
              <span className="settings-toggle-text">
                Rebuild in the background
                <span className="settings-help">Once your homepage is older than the schedule, your next tab shows a fresh one.</span>
              </span>
            </label>
            <label className="settings-inline" data-disabled={!autoRebuild}>
              <span>Rebuild every</span>
              <input
                className="settings-schedule-input"
                list="rebuild-schedules"
                type="text"
                value={rebuildSchedule}
                disabled={!autoRebuild}
                spellCheck={false}
                aria-label="Rebuild schedule"
                aria-invalid={Boolean(scheduleProblem)}
                placeholder="12h"
                onChange={(e) => onChangeSchedule(e.target.value)}
              />
              <span className="settings-schedule-preview">
                {scheduleProblem || describeSchedule(schedule)}
              </span>
              <datalist id="rebuild-schedules">
                {PRESET_SCHEDULES.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </datalist>
            </label>
            <p className="settings-help">
              Pick a preset or type your own: <code>15m</code>, <code>1h</code>, <code>2d</code>, or cron such as
              <code>0 9 * * *</code> and <code>0 9 * * mon</code>. Type <code>off</code> to disable.
            </p>
          </section>
        </div>

        <footer className="settings-footer">
          <div className="settings-footer-status">
            {error ? (
              <span className="settings-error" role="alert">{error}</span>
            ) : (
              <span className="settings-help">Settings apply to your next build.</span>
            )}
          </div>
          <button className="hb-btn hb-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="hb-btn hb-btn-ghost" disabled={saving} onClick={() => void save(false)}>Save</button>
          <button className="hb-btn hb-btn-primary" disabled={saving} onClick={() => void save(true)}>
            {saving ? "Saving…" : "Save & rebuild"}
          </button>
        </footer>
      </div>
    </div>
  );
}
