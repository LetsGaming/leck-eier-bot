import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import SearchableSelect from "../components/SearchableSelect";
import Tabs from "../components/Tabs";
import TemplateEditor, { type TemplatePlaceholder } from "../components/TemplateEditor";
import TemplatePreview from "../components/TemplatePreview";
import { useChannels } from "../hooks/useChannels";
import { useGeneralSettings } from "../hooks/useGeneralSettings";
import { useRoles } from "../hooks/useRoles";
import { useVoiceChannels } from "../hooks/useVoiceChannels";
import { applyFont, FONT_REFERENCE } from "../utils/font";
import { toChannelOptions, toRoleOptions } from "../utils/selectOptions";
import type { Channel, GeneralSettings, Me, RoleOption } from "../types";

/** Sample value shown in the registration confirmation templates' live preview — matches renderConfirmation()'s `{name}` substitution exactly (see src/events/registerWatcher.ts). */
const PREVIEW_REGISTER_NAME = "Beispielperson";

/** Both registration confirmation templates (register-confirmation-template, auto-register-confirmation-template) carry only this one placeholder — see renderConfirmation() in src/services/registration.ts. */
const REGISTER_TEMPLATE_PLACEHOLDERS: TemplatePlaceholder[] = [{ token: "name", label: "Name" }];

/** Sample name/sso-name for the nickname-format preview below — same shape a real "name:"/"sso name:" submission produces. */
const PREVIEW_NICKNAME_FIRST_NAME = "Areum";
const PREVIEW_NICKNAME_SSO_LAST_NAME = "Shadowray";
/** Mirrors DISCORD_NICKNAME_MAX_LENGTH (src/constants.ts) — Discord's hard cap on a member's nickname length. */
const DISCORD_NICKNAME_MAX_LENGTH = 32;

/**
 * Mirrors `buildRegisterNickname()` in `src/services/registration.ts` —
 * same emoji + font + truncation formula, fed sample values instead of a
 * real form submission, so this card's "Nickname-Format" preview always
 * matches what the bot would actually set.
 */
function previewRegisterNickname(
  emoji: string,
  fontMap: string | null,
  useFont: boolean,
): string {
  const styledFirstName = useFont
    ? applyFont(PREVIEW_NICKNAME_FIRST_NAME.toUpperCase(), fontMap)
    : PREVIEW_NICKNAME_FIRST_NAME.toUpperCase();
  const full = `${emoji}${styledFirstName} — ${PREVIEW_NICKNAME_SSO_LAST_NAME.toLowerCase()}`;
  if ([...full].length <= DISCORD_NICKNAME_MAX_LENGTH) return full;

  const nameOnly = `${emoji}${styledFirstName}`;
  return [...nameOnly].slice(0, DISCORD_NICKNAME_MAX_LENGTH).join("");
}

const ROLE_LABELS: Record<string, string> = {
  "bot-owner": "Bot-Besitzer",
  "guild-owner": "Server-Besitzer",
  admin: "Admin",
};

const SECTIONS = [
  { id: "allgemein", label: "Allgemein" },
  { id: "registrierung", label: "Registrierung" },
  { id: "events", label: "Event-Anwesenheit" },
  { id: "konto", label: "Konto" },
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

function AllgemeinSection({
  settings,
  update,
  fontMap,
  setFontMap,
  handleSaveFont,
  savingFont,
}: AllgemeinSectionProps) {
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
              onChange={(e) =>
                update({ leaveNotificationsEnabled: e.target.checked })
              }
            />
            Server-Besitzer per DM benachrichtigen, wenn ein Mitglied freiwillig
            den Server verlässt
          </label>
        )}
      </div>

      <div className="card">
        <h2>Schrift</h2>
        <p className="muted small">
          Eine "Fancy-Text"-Schrift, einmal festgelegt und dann pro Funktion
          einzeln aktivierbar (Geburtstage, Reaktionsrollen, Registrierung).
          Leer lassen, um nichts zu formatieren.
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
            Füge ein stilisiertes Alphabet ein, das{" "}
            <code>{FONT_REFERENCE}</code> Zeichen für Zeichen entspricht
            (insgesamt 52) — z. B. erzeugt mit einem{" "}
            <a
              href="https://lingojam.com/FancyTextGenerator"
              target="_blank"
              rel="noreferrer"
            >
              Fancy-Text-Generator
            </a>
            .
          </div>
          {fontMap &&
            ([...fontMap].length === FONT_REFERENCE.length ? (
              <div className="preview-box mt-8">
                Vorschau: {applyFont("The quick brown fox", fontMap)}
              </div>
            ) : (
              <div className="preview-box mt-8">
                <span className="muted">
                  Benötigt genau 52 Zeichen (aktuell {[...fontMap].length}).
                </span>
              </div>
            ))}
        </div>
        <button
          className="primary"
          onClick={handleSaveFont}
          disabled={savingFont}
        >
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
  nicknameEmoji: string;
  setNicknameEmoji: (v: string) => void;
  handleSaveNicknameEmoji: () => void;
  savingNicknameEmoji: boolean;
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
  nicknameEmoji,
  setNicknameEmoji,
  handleSaveNicknameEmoji,
  savingNicknameEmoji,
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
    <>
      <div className="alert neutral mb-16">
        <strong>Ablauf:</strong> Mitglied postet das Formular im Kanal unten →
        Bot setzt den Nickname und öffnet einen privaten Thread → ein
        Team-Mitglied vergibt die Rolle nach der Registrierung (oder
        automatisch, siehe "Abschluss" unten) → der Bot bestätigt im Thread und
        entfernt die Rolle vor der Registrierung.
      </div>
      <div className="card-grid">
        <div className="card">
          <h2>Rollen im Registrierungsablauf</h2>
          <p className="muted small">
            Entfernt die Rolle vor der Registrierung automatisch, sobald ein
            Mitglied die Rolle nach der Registrierung erhält — so verschwindet
            z. B. #register nach der Registrierung. Lasse ein Feld leer, um
            dies zu deaktivieren.
          </p>
          {!settings ? (
            <div className="loading">Wird geladen…</div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="register-gate-role">
                  Rolle vor der Registrierung
                </label>
                <SearchableSelect
                  id="register-gate-role"
                  value={settings.registerGateRoleId ?? ""}
                  onChange={(v) => update({ registerGateRoleId: v || null })}
                  placeholder="Rollen durchsuchen…"
                  emptyLabel="— keine —"
                  options={toRoleOptions(roles)}
                />
                <div className="hint">
                  Die Rolle, die ein neues Mitglied bekommt, bevor es sich
                  registriert hat — sie schaltet den Registrierungs-Kanal (z. B.
                  #register) für dieses Mitglied frei und wird automatisch
                  wieder entzogen, sobald die Registrierung abgeschlossen ist.
                </div>
              </div>
              <div className="field">
                <label htmlFor="registration-tier-role">
                  Rolle nach der Registrierung
                </label>
                <SearchableSelect
                  id="registration-tier-role"
                  value={settings.registrationTierRoleId ?? ""}
                  onChange={(v) =>
                    update({ registrationTierRoleId: v || null })
                  }
                  placeholder="Rollen durchsuchen…"
                  emptyLabel="— keine —"
                  options={toRoleOptions(roles)}
                />
                <div className="hint">
                  Wird einmalig vergeben, sobald die Registrierung
                  abgeschlossen wird. Höhere Rollen, die ein Mitglied später
                  bekommt (Beförderungen), lösen dies nicht erneut aus — diese
                  Rolle bleibt für den Registrierungs-Abschluss reserviert.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.rulesAcceptedUseDiscordScreening}
                  onChange={(e) =>
                    update({
                      rulesAcceptedUseDiscordScreening: e.target.checked,
                    })
                  }
                />
                "Regeln akzeptiert" über Discords Mitgliedschafts-Screening
                statt der Rolle vor der Registrierung erkennen
              </label>
              <div className="hint">
                Discord bietet ein eigenes "Mitgliedschafts-Screening" an
                (Server-Einstellungen → Sicherheit), bei dem neue Mitglieder
                Regeln zustimmen müssen, bevor sie den Server sehen. Nutzt euer
                Server das? Dann schalte diesen Regler ein, damit die Spalte
                "Regeln akzeptiert" in der{" "}
                <a href="/members">Mitgliederprüfung</a> Discords eigenen Status
                statt der Rolle vor der Registrierung oben anzeigt. Falls
                unsicher: aus lassen (Standard).
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Registrierungsformular</h2>
          <p className="muted small">
            Erkennt eine "name:"/"sso name:"-Nachricht im Kanal unten (z. B. das
            Anmeldeformular) und eröffnet einen privaten Bestätigungs-Thread.
            Lasse den Kanal leer, um das Formular zu deaktivieren.
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
                  options={toChannelOptions(channels)}
                />
                <div className="hint">
                  Der Kanal, in dem der Bot auf Formular-Einreichungen achtet.
                </div>
              </div>
            </>
          )}
        </div>

        {settings && (
          <>
            <div className="card">
              <h2>Nickname-Format</h2>
              <p className="muted small">
                Der Vorname aus der "name:"-Zeile in Großbuchstaben, der
                Nachname aus dem sso-Namen klein und immer ohne Schrift.
              </p>
              <div className="field">
                <label htmlFor="register-nickname-emoji">Emoji</label>
                <input
                  id="register-nickname-emoji"
                  type="text"
                  value={nicknameEmoji}
                  onChange={(e) => setNicknameEmoji(e.target.value)}
                />
                <div className="hint">
                  Vorangestellt an jeden generierten Nickname.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.registerNicknameUseFont}
                  onChange={(e) =>
                    update({ registerNicknameUseFont: e.target.checked })
                  }
                />
                Vornamen über die globale Schrift (siehe "Schrift" oben) stylen
              </label>
              <div className="preview-box mt-8 mb-12">
                {previewRegisterNickname(
                  nicknameEmoji,
                  settings.fontMap,
                  settings.registerNicknameUseFont,
                )}
              </div>
              <button
                className="primary"
                onClick={handleSaveNicknameEmoji}
                disabled={savingNicknameEmoji}
              >
                {savingNicknameEmoji ? "Wird gespeichert…" : "Speichern"}
              </button>
            </div>

            <div className="card">
              <h2>Bestätigungstext</h2>
              <p className="muted small">
                Gepostet in den privaten Thread, sobald das Formular eingereicht
                wird.
              </p>
              <div className="field">
                <label htmlFor="register-confirmation-template">Text</label>
                <TemplateEditor
                  id="register-confirmation-template"
                  value={confirmationTemplate}
                  onChange={setConfirmationTemplate}
                  channels={channels}
                  placeholders={REGISTER_TEMPLATE_PLACEHOLDERS}
                />
                <div className="hint">
                  "Name" fügt den Vornamen aus der "name:"-Zeile ein — oder
                  tippe <code>#</code>, um direkt einen beliebigen Kanal
                  einzufügen.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.registerConfirmationUseFont}
                  onChange={(e) =>
                    update({ registerConfirmationUseFont: e.target.checked })
                  }
                />
                Text über die globale Schrift stylen
              </label>
              <div className="hint">
                Der Platzhalter (<code>{"{name}"}</code>) bleibt immer
                unformatiert.
              </div>
              <div className="preview-box mt-8 mb-12">
                {/*
                Mirrors renderConfirmation() in src/services/registration.ts:
                {name} is `raw` (never font-mapped, regardless of useFont —
                same as every other substituted value elsewhere in the app).
                A channel mention is literal `<#id>` text already (inserted
                via the `#`-trigger popover), so mockifyChannelMentions below
                is what turns it into this preview's "#name" mockup.
              */}
                <TemplatePreview
                  template={confirmationTemplate}
                  context={{ raw: { name: PREVIEW_REGISTER_NAME } }}
                  channels={channels}
                  useFont={settings.registerConfirmationUseFont}
                  fontMap={settings.fontMap}
                />
              </div>
              <button
                className="primary"
                onClick={handleSaveConfirmationTemplate}
                disabled={savingConfirmationTemplate}
              >
                {savingConfirmationTemplate ? "Wird gespeichert…" : "Speichern"}
              </button>
            </div>

            <div className="card">
              <h2>Abschluss</h2>
              <p className="muted small">
                Reguläre Registrierung: der Thread bleibt offen, bis ein
                Team-Mitglied die Rolle nach der Registrierung (siehe oben)
                manuell vergibt — der Bot postet dann den Text unten in den
                Thread und schließt ihn eine Stunde später automatisch.
              </p>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.registerAutoComplete}
                  onChange={(e) =>
                    update({ registerAutoComplete: e.target.checked })
                  }
                />
                Stattdessen sofort automatisch abschließen (ohne manuelle
                Prüfung)
              </label>
              <div className="hint">
                Vergibt die Rolle nach der Registrierung sofort bei
                Formular-Einreichung und postet den Text unten direkt. Ohne
                gesetzte Rolle nach der Registrierung (siehe oben) hat dieser
                Schalter keine Wirkung.
              </div>
              <div className="field">
                <label htmlFor="auto-register-confirmation-template">
                  Text (Registrierung abgeschlossen)
                </label>
                <TemplateEditor
                  id="auto-register-confirmation-template"
                  value={autoConfirmationTemplate}
                  onChange={setAutoConfirmationTemplate}
                  channels={channels}
                  placeholders={REGISTER_TEMPLATE_PLACEHOLDERS}
                />
                <div className="hint">Gleicher Platzhalter wie oben.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.autoRegisterConfirmationUseFont}
                  onChange={(e) =>
                    update({
                      autoRegisterConfirmationUseFont: e.target.checked,
                    })
                  }
                />
                Text über die globale Schrift stylen
              </label>
              <div className="preview-box mt-8 mb-12">
                <TemplatePreview
                  template={autoConfirmationTemplate}
                  context={{ raw: { name: PREVIEW_REGISTER_NAME } }}
                  channels={channels}
                  useFont={settings.autoRegisterConfirmationUseFont}
                  fontMap={settings.fontMap}
                />
              </div>
              <button
                className="primary"
                onClick={handleSaveAutoConfirmationTemplate}
                disabled={savingAutoConfirmationTemplate}
              >
                {savingAutoConfirmationTemplate
                  ? "Wird gespeichert…"
                  : "Speichern"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

interface EventsSectionProps {
  settings: GeneralSettings | null;
  update: (patch: Partial<GeneralSettings>) => Promise<void>;
  channels: Channel[];
  voiceChannels: Channel[];
}

function EventsSection({
  settings,
  update,
  channels,
  voiceChannels,
}: EventsSectionProps) {
  return (
    <div className="card">
      <h2>Event-Anwesenheit (Apollo)</h2>
      <p className="muted small">
        Erkennt Apollo-Events im Kanal unten und prüft anhand des Sprachkanals,
        wer teilgenommen hat (inkl. Verspätung/vorzeitigem Verlassen). Ergebnis
        unter <a href="/events">Event-Anwesenheit</a>. Lasse einen Kanal leer,
        um dies zu deaktivieren.
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
              options={toChannelOptions(channels)}
            />
            <div className="hint">
              Der Kanal, in dem Apollo seine Event-Nachrichten postet.
            </div>
          </div>
          <div className="field">
            <label htmlFor="event-voice-channel">Event-Sprachkanal</label>
            <SearchableSelect
              id="event-voice-channel"
              value={settings.eventVoiceChannelId ?? ""}
              onChange={(v) => update({ eventVoiceChannelId: v || null })}
              placeholder="Sprachkanäle durchsuchen…"
              emptyLabel="— keiner —"
              options={toChannelOptions(voiceChannels, "🔊 ")}
            />
            <div className="hint">
              Der eine Sprachkanal, in dem alle Events stattfinden. Der Bot muss
              ihn sehen können.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KontoSection({ me }: { me: Me }) {
  return (
    <div className="card">
      <h2>Konto</h2>
      <p>
        Angemeldet als <strong>{me.username}</strong> ({me.userId}) — Rolle:{" "}
        <strong>{ROLE_LABELS[me.role] ?? me.role}</strong>
      </p>
    </div>
  );
}

export default function Settings({ me }: { me: Me }) {
  const settingsRes = useGeneralSettings();
  const rolesRes = useRoles();
  const channelsRes = useChannels();
  const voiceChannelsRes = useVoiceChannels();
  const settings = settingsRes.data;
  const roles = rolesRes.data ?? [];
  const channels = channelsRes.data ?? [];
  const voiceChannels = voiceChannelsRes.data ?? [];

  const [fontMap, setFontMap] = useState("");
  const [savingFont, setSavingFont] = useState(false);
  const [nicknameEmoji, setNicknameEmoji] = useState("");
  const [savingNicknameEmoji, setSavingNicknameEmoji] = useState(false);
  const [confirmationTemplate, setConfirmationTemplate] = useState("");
  const [savingConfirmationTemplate, setSavingConfirmationTemplate] =
    useState(false);
  const [autoConfirmationTemplate, setAutoConfirmationTemplate] = useState("");
  const [savingAutoConfirmationTemplate, setSavingAutoConfirmationTemplate] =
    useState(false);
  const { showError, showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawSection = searchParams.get("section");
  const activeSection = SECTIONS.some((s) => s.id === rawSection)
    ? (rawSection as string)
    : DEFAULT_SECTION;

  function setActiveSection(id: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("section", id);
      return next;
    });
  }

  // Seeds the local editable font-map/confirmation-template fields once
  // `useGeneralSettings()` resolves — mirrors the pre-migration inline
  // `.then()` handler, just re-run whenever the underlying resource changes.
  useEffect(() => {
    const s = settingsRes.data;
    if (!s) return;
    setFontMap(s.fontMap ?? "");
    setNicknameEmoji(s.registerNicknameEmoji);
    setConfirmationTemplate(s.registerConfirmationTemplate);
    setAutoConfirmationTemplate(s.autoRegisterConfirmationTemplate);
  }, [settingsRes.data]);

  async function update(patch: Partial<GeneralSettings>) {
    try {
      const updated = await api.updateGeneralSettings(patch);
      settingsRes.setData(updated);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  async function handleSaveFont() {
    setSavingFont(true);
    try {
      const updated = await api.updateGeneralSettings({
        fontMap: fontMap || null,
      });
      settingsRes.setData(updated);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingFont(false);
    }
  }

  async function handleSaveNicknameEmoji() {
    setSavingNicknameEmoji(true);
    try {
      const updated = await api.updateGeneralSettings({
        registerNicknameEmoji: nicknameEmoji,
      });
      settingsRes.setData(updated);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingNicknameEmoji(false);
    }
  }

  async function handleSaveConfirmationTemplate() {
    setSavingConfirmationTemplate(true);
    try {
      const updated = await api.updateGeneralSettings({
        registerConfirmationTemplate: confirmationTemplate,
      });
      settingsRes.setData(updated);
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
      const updated = await api.updateGeneralSettings({
        autoRegisterConfirmationTemplate: autoConfirmationTemplate,
      });
      settingsRes.setData(updated);
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

      <Tabs
        tabs={SECTIONS}
        active={activeSection}
        onChange={setActiveSection}
      />

      <div
        role="tabpanel"
        id={`tabpanel-${activeSection}`}
        aria-labelledby={`tab-${activeSection}`}
      >
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
            nicknameEmoji={nicknameEmoji}
            setNicknameEmoji={setNicknameEmoji}
            handleSaveNicknameEmoji={handleSaveNicknameEmoji}
            savingNicknameEmoji={savingNicknameEmoji}
            confirmationTemplate={confirmationTemplate}
            setConfirmationTemplate={setConfirmationTemplate}
            handleSaveConfirmationTemplate={handleSaveConfirmationTemplate}
            savingConfirmationTemplate={savingConfirmationTemplate}
            autoConfirmationTemplate={autoConfirmationTemplate}
            setAutoConfirmationTemplate={setAutoConfirmationTemplate}
            handleSaveAutoConfirmationTemplate={
              handleSaveAutoConfirmationTemplate
            }
            savingAutoConfirmationTemplate={savingAutoConfirmationTemplate}
          />
        )}
        {activeSection === "events" && (
          <EventsSection
            settings={settings}
            update={update}
            channels={channels}
            voiceChannels={voiceChannels}
          />
        )}
        {activeSection === "konto" && <KontoSection me={me} />}
      </div>
    </div>
  );
}
