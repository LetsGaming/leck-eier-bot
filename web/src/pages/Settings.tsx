import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import SearchableSelect from "../components/SearchableSelect";
import Tabs from "../components/Tabs";
import { applyFont, FONT_REFERENCE } from "../utils/font";
import type { Channel, GeneralSettings, Me, RoleOption } from "../types";

const ROLE_LABELS: Record<string, string> = {
  "bot-owner": "Bot-Besitzer",
  "guild-owner": "Server-Besitzer",
  admin: "Admin",
};

const SECTIONS = [
  { id: "allgemein", label: "Allgemein" },
  { id: "registrierung", label: "Registrierung" },
  { id: "events", label: "Events (Apollo)" },
  { id: "sitzung", label: "Sitzung" },
];
const DEFAULT_SECTION = "allgemein";

interface AllgemeinSectionProps {
  settings: GeneralSettings | null;
  update: (patch: Partial<GeneralSettings>) => Promise<void>;
  fontMap: string;
  setFontMap: (v: string) => void;
  handleSaveFont: () => void;
  savingFont: boolean;
}

function AllgemeinSection({ settings, update, fontMap, setFontMap, handleSaveFont, savingFont }: AllgemeinSectionProps) {
  return (
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
    </div>
  );
}

interface RegistrierungSectionProps {
  settings: GeneralSettings | null;
  update: (patch: Partial<GeneralSettings>) => Promise<void>;
  roles: RoleOption[];
  channels: Channel[];
  confirmationTemplate: string;
  setConfirmationTemplate: (v: string) => void;
  handleSaveConfirmationTemplate: () => void;
  savingConfirmationTemplate: boolean;
  autoConfirmationTemplate: string;
  setAutoConfirmationTemplate: (v: string) => void;
  handleSaveAutoConfirmationTemplate: () => void;
  savingAutoConfirmationTemplate: boolean;
}

function RegistrierungSection({
  settings,
  update,
  roles,
  channels,
  confirmationTemplate,
  setConfirmationTemplate,
  handleSaveConfirmationTemplate,
  savingConfirmationTemplate,
  autoConfirmationTemplate,
  setAutoConfirmationTemplate,
  handleSaveAutoConfirmationTemplate,
  savingAutoConfirmationTemplate,
}: RegistrierungSectionProps) {
  return (
    <div className="card-grid">
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
        <h2>Registrierungsformular</h2>
        <p className="muted small">
          Postet ein Mitglied im unten festgelegten Kanal eine Nachricht mit einer "name:"- und einer "sso
          name:"-Zeile (z. B. das Anmeldeformular), setzt der Bot automatisch den Servernickname im Format{" "}
          <strong>💙VORNAME — nachname</strong> — der Vorname großgeschrieben (optional über die globale Schrift
          gestylt, siehe Schalter unten), der Nachname aus dem sso-Namen klein und immer ohne Schrift — und legt
          einen privaten Thread an der Nachricht an, in dem der untenstehende Bestätigungstext gepostet wird. Der
          Thread wird automatisch gelöscht, sobald dem Mitglied die Registrierungsrolle (siehe oben) vergeben wird
          — manuell durch ein Team-Mitglied, oder sofort automatisch, wenn der Schalter unten aktiviert ist (dann
          bleibt der Thread noch eine Stunde offen und zeigt den zweiten Bestätigungstext). Lasse den Kanal leer,
          um dies zu deaktivieren.
        </p>
        {!settings ? (
          <div className="loading">Wird geladen…</div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="register-channel">Registrierungs-Kanal</label>
              <SearchableSelect
                id="register-channel"
                value={settings.registerChannelId ?? ""}
                onChange={(v) => update({ registerChannelId: v || null })}
                placeholder="Kanäle durchsuchen…"
                emptyLabel="— keiner —"
                options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
              />
              <div className="hint">Der Kanal, in dem der Bot auf Formular-Einreichungen achtet.</div>
            </div>
            <div className="field">
              <label htmlFor="role-selection-channel">Rollen-Kanal</label>
              <SearchableSelect
                id="role-selection-channel"
                value={settings.roleSelectionChannelId ?? ""}
                onChange={(v) => update({ roleSelectionChannelId: v || null })}
                placeholder="Kanäle durchsuchen…"
                emptyLabel="— keiner —"
                options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
              />
              <div className="hint">
                Wird im Bestätigungstext als <code>{"{roleChannel}"}</code> eingesetzt.
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.registerNicknameUseFont}
                onChange={(e) => update({ registerNicknameUseFont: e.target.checked })}
              />
              Vornamen im generierten Nickname über die globale Schrift (siehe "Schrift" oben) stylen
            </label>
            <div className="field">
              <label htmlFor="register-confirmation-template">Bestätigungstext</label>
              <textarea
                id="register-confirmation-template"
                rows={3}
                value={confirmationTemplate}
                onChange={(e) => setConfirmationTemplate(e.target.value)}
              />
              <div className="hint">
                Platzhalter: <code>{"{name}"}</code> (aus der "name:"-Zeile) und <code>{"{roleChannel}"}</code>.
              </div>
            </div>
            <button className="primary" onClick={handleSaveConfirmationTemplate} disabled={savingConfirmationTemplate}>
              {savingConfirmationTemplate ? "Wird gespeichert…" : "Speichern"}
            </button>

            <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid var(--border)" }} />

            <label className="switch">
              <input
                type="checkbox"
                checked={settings.registerAutoComplete}
                onChange={(e) => update({ registerAutoComplete: e.target.checked })}
              />
              Registrierung automatisch abschließen (Registrierungsrolle sofort vergeben, ohne manuelle Prüfung)
            </label>
            <div className="hint">
              Aus (Standard): Der Thread bleibt offen, bis ein Team-Mitglied die Registrierungsrolle (siehe oben)
              manuell vergibt. Ein: Der Bot vergibt die Registrierungsrolle sofort bei Formular-Einreichung — der
              Thread öffnet sich trotzdem, zeigt aber den untenstehenden Text und schließt sich automatisch nach
              einer Stunde. Ohne gesetzte Registrierungsrolle (siehe oben) hat dieser Schalter keine Wirkung.
            </div>
            <div className="field">
              <label htmlFor="auto-register-confirmation-template">Bestätigungstext (automatische Registrierung)</label>
              <textarea
                id="auto-register-confirmation-template"
                rows={3}
                value={autoConfirmationTemplate}
                onChange={(e) => setAutoConfirmationTemplate(e.target.value)}
              />
              <div className="hint">
                Wird stattdessen gepostet, wenn die automatische Registrierung erfolgreich war. Gleiche
                Platzhalter: <code>{"{name}"}</code> und <code>{"{roleChannel}"}</code>.
              </div>
            </div>
            <button
              className="primary"
              onClick={handleSaveAutoConfirmationTemplate}
              disabled={savingAutoConfirmationTemplate}
            >
              {savingAutoConfirmationTemplate ? "Wird gespeichert…" : "Speichern"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface EventsSectionProps {
  settings: GeneralSettings | null;
  update: (patch: Partial<GeneralSettings>) => Promise<void>;
  channels: Channel[];
  voiceChannels: Channel[];
}

function EventsSection({ settings, update, channels, voiceChannels }: EventsSectionProps) {
  return (
    <div className="card">
      <h2>Event-Anwesenheit (Apollo)</h2>
      <p className="muted small">
        Postet der Apollo-Bot im unten festgelegten Kanal ein Event mit Zusagen/Absagen/Vielleicht-Liste, erkennt
        der Bot das automatisch, gleicht die Namen mit den Servermitgliedern ab und prüft beim Start des Events,
        wer sich im festgelegten Sprachkanal befindet — inklusive Verspätungen und vorzeitigem Verlassen bis zum
        Ende des Events. Das Ergebnis erscheint unter <a href="/events">Event-Anwesenheit</a> im Menü. Lasse einen
        Kanal leer, um dies zu deaktivieren.
      </p>
      {!settings ? (
        <div className="loading">Wird geladen…</div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="apollo-event-channel">Apollo-Event-Kanal</label>
            <SearchableSelect
              id="apollo-event-channel"
              value={settings.apolloEventChannelId ?? ""}
              onChange={(v) => update({ apolloEventChannelId: v || null })}
              placeholder="Kanäle durchsuchen…"
              emptyLabel="— keiner —"
              options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
            />
            <div className="hint">Der Kanal, in dem Apollo seine Event-Nachrichten postet.</div>
          </div>
          <div className="field">
            <label htmlFor="event-voice-channel">Event-Sprachkanal</label>
            <SearchableSelect
              id="event-voice-channel"
              value={settings.eventVoiceChannelId ?? ""}
              onChange={(v) => update({ eventVoiceChannelId: v || null })}
              placeholder="Sprachkanäle durchsuchen…"
              emptyLabel="— keiner —"
              options={voiceChannels.map((c) => ({ value: c.id, label: `🔊 ${c.name}` }))}
            />
            <div className="hint">Der eine Sprachkanal, in dem alle Events stattfinden. Der Bot muss ihn sehen können.</div>
          </div>
        </>
      )}
    </div>
  );
}

function SitzungSection({ me }: { me: Me }) {
  return (
    <div className="card">
      <h2>Sitzung</h2>
      <p>
        Angemeldet als <strong>{me.username}</strong> ({me.userId}) — Rolle:{" "}
        <strong>{ROLE_LABELS[me.role] ?? me.role}</strong>
      </p>
    </div>
  );
}

export default function Settings({ me }: { me: Me }) {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [fontMap, setFontMap] = useState("");
  const [savingFont, setSavingFont] = useState(false);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<Channel[]>([]);
  const [confirmationTemplate, setConfirmationTemplate] = useState("");
  const [savingConfirmationTemplate, setSavingConfirmationTemplate] = useState(false);
  const [autoConfirmationTemplate, setAutoConfirmationTemplate] = useState("");
  const [savingAutoConfirmationTemplate, setSavingAutoConfirmationTemplate] = useState(false);
  const { showError, showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawSection = searchParams.get("section");
  const activeSection = SECTIONS.some((s) => s.id === rawSection) ? (rawSection as string) : DEFAULT_SECTION;

  function setActiveSection(id: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("section", id);
      return next;
    });
  }

  useEffect(() => {
    api
      .generalSettings()
      .then((s) => {
        setSettings(s);
        setFontMap(s.fontMap ?? "");
        setConfirmationTemplate(s.registerConfirmationTemplate);
        setAutoConfirmationTemplate(s.autoRegisterConfirmationTemplate);
      })
      .catch((err) => showError(errorMessage(err)));
    api.roles().then(setRoles).catch((err) => showError(errorMessage(err)));
    api.channels().then(setChannels).catch((err) => showError(errorMessage(err)));
    api.voiceChannels().then(setVoiceChannels).catch((err) => showError(errorMessage(err)));
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

  async function handleSaveConfirmationTemplate() {
    setSavingConfirmationTemplate(true);
    try {
      const updated = await api.updateGeneralSettings({ registerConfirmationTemplate: confirmationTemplate });
      setSettings(updated);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingConfirmationTemplate(false);
    }
  }

  async function handleSaveAutoConfirmationTemplate() {
    setSavingAutoConfirmationTemplate(true);
    try {
      const updated = await api.updateGeneralSettings({ autoRegisterConfirmationTemplate: autoConfirmationTemplate });
      setSettings(updated);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingAutoConfirmationTemplate(false);
    }
  }

  return (
    <div>
      <h2>Einstellungen</h2>

      <Tabs tabs={SECTIONS} active={activeSection} onChange={setActiveSection} />

      <div role="tabpanel" id={`tabpanel-${activeSection}`} aria-labelledby={`tab-${activeSection}`}>
        {activeSection === "allgemein" && (
          <AllgemeinSection
            settings={settings}
            update={update}
            fontMap={fontMap}
            setFontMap={setFontMap}
            handleSaveFont={handleSaveFont}
            savingFont={savingFont}
          />
        )}
        {activeSection === "registrierung" && (
          <RegistrierungSection
            settings={settings}
            update={update}
            roles={roles}
            channels={channels}
            confirmationTemplate={confirmationTemplate}
            setConfirmationTemplate={setConfirmationTemplate}
            handleSaveConfirmationTemplate={handleSaveConfirmationTemplate}
            savingConfirmationTemplate={savingConfirmationTemplate}
            autoConfirmationTemplate={autoConfirmationTemplate}
            setAutoConfirmationTemplate={setAutoConfirmationTemplate}
            handleSaveAutoConfirmationTemplate={handleSaveAutoConfirmationTemplate}
            savingAutoConfirmationTemplate={savingAutoConfirmationTemplate}
          />
        )}
        {activeSection === "events" && (
          <EventsSection settings={settings} update={update} channels={channels} voiceChannels={voiceChannels} />
        )}
        {activeSection === "sitzung" && <SitzungSection me={me} />}
      </div>
    </div>
  );
}
