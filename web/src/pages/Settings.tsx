import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import SearchableSelect from "../components/SearchableSelect";
import { applyFont, FONT_REFERENCE } from "../utils/font";
import type { GeneralSettings, Me, RoleOption } from "../types";

const ROLE_LABELS: Record<string, string> = {
  "bot-owner": "Bot-Besitzer",
  "guild-owner": "Server-Besitzer",
  admin: "Admin",
};

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
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  async function handleSaveFont() {
    setSavingFont(true);
    try {
      const updated = await api.updateGeneralSettings({ fontMap: fontMap || null });
      setSettings(updated);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingFont(false);
    }
  }

  return (
    <div>
      <h2>Einstellungen</h2>

      <div className="card-grid">
        <div className="card">
          <h2>Allgemein</h2>
          {!settings ? (
            <div className="loading">Wird geladen…</div>
          ) : (
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.leaveNotificationsEnabled}
                onChange={(e) => update({ leaveNotificationsEnabled: e.target.checked })}
              />
              Server-Besitzer per DM benachrichtigen, wenn ein Mitglied freiwillig den Server verlässt
            </label>
          )}
        </div>

        <div className="card">
          <h2>Schrift</h2>
          <p className="muted small">
            Eine "Fancy-Text"-Schrift, die der Bot beim Erstellen von Nachrichten verwenden kann — hier einmal
            festlegen und dann pro Funktion aktivieren, wo sie zutrifft (die Geburtstagsankündigung und
            Ankernachricht, der Text eines Reaktionsrollen-Panels). Leer lassen, um nichts zu formatieren.
          </p>
          <div className="field">
            <label htmlFor="fontMap">Schrift</label>
            <input
              id="fontMap"
              type="text"
              value={fontMap}
              onChange={(e) => setFontMap(e.target.value)}
              placeholder={FONT_REFERENCE}
            />
            <div className="hint">
              Füge ein stilisiertes Alphabet ein, das <code>{FONT_REFERENCE}</code> Zeichen für Zeichen entspricht
              (insgesamt 52) — aus einem beliebigen "Fancy-Text"-Generator.
            </div>
            {fontMap &&
              ([...fontMap].length === FONT_REFERENCE.length ? (
                <div className="preview-box" style={{ marginTop: 8 }}>
                  Vorschau: {applyFont("The quick brown fox", fontMap)}
                </div>
              ) : (
                <div className="preview-box" style={{ marginTop: 8 }}>
                  <span className="muted">Benötigt genau 52 Zeichen (aktuell {[...fontMap].length}).</span>
                </div>
              ))}
          </div>
          <button className="primary" onClick={handleSaveFont} disabled={savingFont}>
            {savingFont ? "Wird gespeichert…" : "Speichern"}
          </button>
        </div>

        <div className="card">
          <h2>Registrierung</h2>
          <p className="muted small">
            Wenn einem Mitglied manuell die untenstehende Registrierungsrolle gegeben wird, entfernt der Bot
            automatisch die Registrierungssperre-Rolle, sodass ein durch diese Rolle gesperrter Kanal (z. B.
            #register) verschwindet, sobald das Mitglied registriert ist. Lasse ein Feld leer, um dies zu
            deaktivieren.
          </p>
          {!settings ? (
            <div className="loading">Wird geladen…</div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="register-gate-role">Registrierungssperre-Rolle</label>
                <SearchableSelect
                  id="register-gate-role"
                  value={settings.registerGateRoleId ?? ""}
                  onChange={(v) => update({ registerGateRoleId: v || null })}
                  placeholder="Rollen durchsuchen…"
                  emptyLabel="— keine —"
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                />
                <div className="hint">Die Rolle, die einem noch nicht registrierten Mitglied #register anzeigt.</div>
              </div>
              <div className="field">
                <label htmlFor="registration-tier-role">Registrierungsrolle (niedrigste Stufe)</label>
                <SearchableSelect
                  id="registration-tier-role"
                  value={settings.registrationTierRoleId ?? ""}
                  onChange={(v) => update({ registrationTierRoleId: v || null })}
                  placeholder="Rollen durchsuchen…"
                  emptyLabel="— keine —"
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                />
                <div className="hint">
                  Die niedrigste Mitgliedschaftsstufe, die einmalig bei der manuellen Registrierung vergeben wird —
                  keine höhere Stufe, da spätere Beförderungen dies nicht erneut auslösen dürfen.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.rulesAcceptedUseDiscordScreening}
                  onChange={(e) => update({ rulesAcceptedUseDiscordScreening: e.target.checked })}
                />
                "Regeln akzeptiert" über Discords Mitgliedschafts-Screening statt der Registrierungssperre-Rolle
                erkennen
              </label>
              <div className="hint">
                Aus (Standard): Ein Mitglied gilt als hat-die-Regeln-akzeptiert, sobald es die obige
                Registrierungssperre-Rolle erhält (z. B. durch Reagieren auf die Regelnachricht) — rollenbasiert. Ein:
                verwendet stattdessen Discords eigenes "pending"-Flag des Mitgliedschafts-Screenings, für Server, die
                sich auf diese integrierte Funktion statt auf eine Reaktionsrolle verlassen. Betrifft nur die Spalte
                "Regeln akzeptiert" in der <a href="/members">Mitgliederprüfung</a>.
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Sitzung</h2>
          <p>
            Angemeldet als <strong>{me.username}</strong> ({me.userId}) — Rolle:{" "}
            <strong>{ROLE_LABELS[me.role] ?? me.role}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
