import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import SearchableSelect from "../components/SearchableSelect";
import { applyFont, FONT_REFERENCE } from "../utils/font";
import type { GeneralSettings, Me, RoleOption } from "../types";

export default function Settings({ me }: { me: Me }) {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [fontMap, setFontMap] = useState("");
  const [savingFont, setSavingFont] = useState(false);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    api
      .generalSettings()
      .then((s) => {
        setSettings(s);
        setFontMap(s.fontMap ?? "");
      })
      .catch((err) => showError(errorMessage(err)));
    api.roles().then(setRoles).catch((err) => showError(errorMessage(err)));
  }, [showError]);

  async function update(patch: Partial<GeneralSettings>) {
    try {
      const updated = await api.updateGeneralSettings(patch);
      setSettings(updated);
      showSuccess("Saved.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  async function handleSaveFont() {
    setSavingFont(true);
    try {
      const updated = await api.updateGeneralSettings({ fontMap: fontMap || null });
      setSettings(updated);
      showSuccess("Saved.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingFont(false);
    }
  }

  return (
    <div>
      <h2>Settings</h2>

      <div className="card-grid">
        <div className="card">
          <h2>General</h2>
          {!settings ? (
            <div className="loading">Loading…</div>
          ) : (
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.leaveNotificationsEnabled}
                onChange={(e) => update({ leaveNotificationsEnabled: e.target.checked })}
              />
              DM the server owner when a member leaves voluntarily
            </label>
          )}
        </div>

        <div className="card">
          <h2>Font</h2>
          <p className="muted small">
            A "fancy text" font the bot can use when generating messages — set it once here, then turn it on
            per-feature wherever it applies (the birthday announcement and anchor message, a reaction-role panel's
            text). Leave blank to never style anything.
          </p>
          <div className="field">
            <label htmlFor="fontMap">Font</label>
            <input
              id="fontMap"
              type="text"
              value={fontMap}
              onChange={(e) => setFontMap(e.target.value)}
              placeholder={FONT_REFERENCE}
            />
            <div className="hint">
              Paste a stylized alphabet matching <code>{FONT_REFERENCE}</code> character for character (52 total)
              from any "fancy text" generator.
            </div>
            {fontMap &&
              ([...fontMap].length === FONT_REFERENCE.length ? (
                <div className="preview-box" style={{ marginTop: 8 }}>
                  Preview: {applyFont("The quick brown fox", fontMap)}
                </div>
              ) : (
                <div className="preview-box" style={{ marginTop: 8 }}>
                  <span className="muted">Needs exactly 52 characters (currently {[...fontMap].length}).</span>
                </div>
              ))}
          </div>
          <button className="primary" onClick={handleSaveFont} disabled={savingFont}>
            {savingFont ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="card">
          <h2>Registration</h2>
          <p className="muted small">
            When a member is manually given the registration role below, the bot automatically removes the
            register-gate role from them, so a channel gated on that role (e.g. #register) disappears once
            they're registered. Leave either field unset to disable this.
          </p>
          {!settings ? (
            <div className="loading">Loading…</div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="register-gate-role">Register-gate role</label>
                <SearchableSelect
                  id="register-gate-role"
                  value={settings.registerGateRoleId ?? ""}
                  onChange={(v) => update({ registerGateRoleId: v || null })}
                  placeholder="Search roles…"
                  emptyLabel="— none —"
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                />
                <div className="hint">The role that lets a not-yet-registered member see #register.</div>
              </div>
              <div className="field">
                <label htmlFor="registration-tier-role">Registration role (lowest tier)</label>
                <SearchableSelect
                  id="registration-tier-role"
                  value={settings.registrationTierRoleId ?? ""}
                  onChange={(v) => update({ registrationTierRoleId: v || null })}
                  placeholder="Search roles…"
                  emptyLabel="— none —"
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                />
                <div className="hint">
                  The lowest membership tier role, granted once at manual registration — not a higher tier, since
                  later promotions must not re-trigger this.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.rulesAcceptedUseDiscordScreening}
                  onChange={(e) => update({ rulesAcceptedUseDiscordScreening: e.target.checked })}
                />
                Detect "rules accepted" via Discord's membership screening instead of the register-gate role
              </label>
              <div className="hint">
                Off (default): a member is considered to have accepted the rules the moment they're granted the
                register-gate role above (i.e. reacting to the rules message) — role-based. On: use Discord's own
                membership screening "pending" flag instead, for servers that rely on that built-in feature rather
                than a reaction role. Only affects the "Rules accepted" column on{" "}
                <a href="/members">Member Audit</a>.
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Session</h2>
          <p>
            Signed in as <strong>{me.username}</strong> ({me.userId}) — role: <strong>{me.role}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
