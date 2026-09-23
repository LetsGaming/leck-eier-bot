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
import { useUnsavedChanges } from "../components/UnsavedChangesContext";
import { useVoiceChannels } from "../hooks/useVoiceChannels";
import { applyFont, FONT_REFERENCE } from "../utils/font";
import { toChannelOptions, toRoleOptions } from "../utils/selectOptions";
import { useAccessControl } from "../hooks/useAccessControl";
import { useUserAccessOverrides } from "../hooks/useUserAccessOverrides";
import { useTemporaryGrants } from "../hooks/useTemporaryGrants";
import { useApiTokens } from "../hooks/useApiTokens";
import { useMemberNames } from "../hooks/useMemberNames";
import { formatAbsolute } from "../dateFormat";
import { hasCapability, WEB_ROLE_LABELS } from "../types";
import type {
  AccessControlFeature,
  ApiTokenCreated,
  Channel,
  GeneralSettings,
  Me,
  PermissionGate,
  RoleOption,
  TemporaryGrant,
  UserAccessOverride,
  WebRole,
} from "../types";

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
  fontMapDirty: boolean;
  canWrite: boolean;
}

function AllgemeinSection({
  settings,
  update,
  fontMap,
  setFontMap,
  handleSaveFont,
  savingFont,
  fontMapDirty,
  canWrite,
}: AllgemeinSectionProps) {
  const [showFontPreview, setShowFontPreview] = useState(false);

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
            Füge ein stilisiertes Alphabet ein, das <code>{FONT_REFERENCE}</code> Zeichen für Zeichen entspricht
            (insgesamt 52) — z. B. von{" "}
            <a href="https://lingojam.com/FancyTextGenerator" target="_blank" rel="noreferrer">
              lingojam.com/FancyTextGenerator
            </a>
            : dort <code>{FONT_REFERENCE}</code> eintippen und eine der Ausgaben hier einfügen.
          </div>
          {fontMap && [...fontMap].length !== FONT_REFERENCE.length && (
            <div className="preview-box mt-8">
              <span className="muted">
                Benötigt genau 52 Zeichen (aktuell {[...fontMap].length}).
              </span>
            </div>
          )}
          {fontMap && [...fontMap].length === FONT_REFERENCE.length && (
            <>
              <div className="mt-8">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={showFontPreview}
                    onChange={(e) => setShowFontPreview(e.target.checked)}
                  />
                  Vorschau
                </label>
              </div>
              {showFontPreview && (
                <div className="preview-box mt-8">{applyFont("The quick brown fox", fontMap)}</div>
              )}
            </>
          )}
        </div>
        {canWrite && (
          <div className="save-row">
            <button
              className="primary"
              onClick={handleSaveFont}
              disabled={savingFont || !fontMapDirty}
            >
              {savingFont ? "Wird gespeichert…" : "Speichern"}
            </button>
            {fontMapDirty && !savingFont && <span className="muted small">Ungespeicherte Änderungen</span>}
          </div>
        )}
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
  nicknameEmojiDirty: boolean;
  confirmationTemplate: string;
  setConfirmationTemplate: (v: string) => void;
  handleSaveConfirmationTemplate: () => void;
  savingConfirmationTemplate: boolean;
  confirmationTemplateDirty: boolean;
  autoConfirmationTemplate: string;
  setAutoConfirmationTemplate: (v: string) => void;
  handleSaveAutoConfirmationTemplate: () => void;
  savingAutoConfirmationTemplate: boolean;
  autoConfirmationTemplateDirty: boolean;
  canWrite: boolean;
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
  nicknameEmojiDirty,
  confirmationTemplate,
  setConfirmationTemplate,
  handleSaveConfirmationTemplate,
  savingConfirmationTemplate,
  confirmationTemplateDirty,
  autoConfirmationTemplate,
  setAutoConfirmationTemplate,
  handleSaveAutoConfirmationTemplate,
  savingAutoConfirmationTemplate,
  autoConfirmationTemplateDirty,
  canWrite,
}: RegistrierungSectionProps) {
  const [showNicknamePreview, setShowNicknamePreview] = useState(false);
  const [showConfirmationPreview, setShowConfirmationPreview] = useState(false);
  const [showAutoConfirmationPreview, setShowAutoConfirmationPreview] = useState(false);

  return (
    <>
      <div className="alert neutral mb-16">
        <strong>Ablauf:</strong>
        <ol className="alert-steps">
          <li>Mitglied postet das Formular im Kanal unten</li>
          <li>Bot setzt den Nickname und öffnet einen privaten Thread</li>
          <li>
            Team-Mitglied vergibt die Rolle nach der Registrierung (oder automatisch, siehe "Abschluss" unten)
          </li>
          <li>Bot bestätigt im Thread und entfernt die Rolle vor der Registrierung</li>
        </ol>
      </div>
      <div className="card-grid card-grid-registration">
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
              <div className="field">
                <label htmlFor="dashboard-moderator-role">
                  Dashboard-Moderator-Rolle
                </label>
                <SearchableSelect
                  id="dashboard-moderator-role"
                  value={settings.dashboardModeratorRoleId ?? ""}
                  onChange={(v) => update({ dashboardModeratorRoleId: v || null })}
                  placeholder="Rollen durchsuchen…"
                  emptyLabel="— keine —"
                  options={toRoleOptions(roles)}
                />
                <div className="hint">
                  Mitglieder mit dieser Rolle erhalten die niedrigste
                  Dashboard-Berechtigungsstufe (nur Lesezugriff, außer wo
                  unten unter "Zugriff" explizit erlaubt).
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
              <div className="mt-12">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={showNicknamePreview}
                    onChange={(e) => setShowNicknamePreview(e.target.checked)}
                  />
                  Vorschau
                </label>
              </div>
              {showNicknamePreview && (
                <div className="preview-box mt-8 mb-12">
                  {previewRegisterNickname(
                    nicknameEmoji,
                    settings.fontMap,
                    settings.registerNicknameUseFont,
                  )}
                </div>
              )}
              {canWrite && (
                <div className="save-row">
                  <button
                    className="primary"
                    onClick={handleSaveNicknameEmoji}
                    disabled={savingNicknameEmoji || !nicknameEmojiDirty}
                  >
                    {savingNicknameEmoji ? "Wird gespeichert…" : "Speichern"}
                  </button>
                  {nicknameEmojiDirty && !savingNicknameEmoji && (
                    <span className="muted small">Ungespeicherte Änderungen</span>
                  )}
                </div>
              )}
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
              <label className="switch mt-12">
                <input
                  type="checkbox"
                  checked={showConfirmationPreview}
                  onChange={(e) => setShowConfirmationPreview(e.target.checked)}
                />
                Vorschau
              </label>
              {showConfirmationPreview && (
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
              )}
              {canWrite && (
                <div className="save-row">
                  <button
                    className="primary"
                    onClick={handleSaveConfirmationTemplate}
                    disabled={savingConfirmationTemplate || !confirmationTemplateDirty}
                  >
                    {savingConfirmationTemplate ? "Wird gespeichert…" : "Speichern"}
                  </button>
                  {confirmationTemplateDirty && !savingConfirmationTemplate && (
                    <span className="muted small">Ungespeicherte Änderungen</span>
                  )}
                </div>
              )}
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
              <div className="mt-12">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={showAutoConfirmationPreview}
                    onChange={(e) => setShowAutoConfirmationPreview(e.target.checked)}
                  />
                  Vorschau
                </label>
              </div>
              {showAutoConfirmationPreview && (
                <div className="preview-box mt-8 mb-12">
                  <TemplatePreview
                    template={autoConfirmationTemplate}
                    context={{ raw: { name: PREVIEW_REGISTER_NAME } }}
                    channels={channels}
                    useFont={settings.autoRegisterConfirmationUseFont}
                    fontMap={settings.fontMap}
                  />
                </div>
              )}
              {canWrite && (
                <div className="save-row">
                  <button
                    className="primary"
                    onClick={handleSaveAutoConfirmationTemplate}
                    disabled={savingAutoConfirmationTemplate || !autoConfirmationTemplateDirty}
                  >
                    {savingAutoConfirmationTemplate ? "Wird gespeichert…" : "Speichern"}
                  </button>
                  {autoConfirmationTemplateDirty && !savingAutoConfirmationTemplate && (
                    <span className="muted small">Ungespeicherte Änderungen</span>
                  )}
                </div>
              )}
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
      <h2>Event-Anwesenheit</h2>
      <p className="muted small">
        Prüft anhand des Sprachkanals, wer an einem Event teilgenommen hat
        (inkl. Verspätung/vorzeitigem Verlassen). Ergebnis unter{" "}
        <a href="/events">Event-Anwesenheit</a>. Lasse den Sprachkanal leer,
        um dies zu deaktivieren.
      </p>
      {!settings ? (
        <div className="loading">Wird geladen…</div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="default-event-channel">Standard-Event-Kanal</label>
            <SearchableSelect
              id="default-event-channel"
              value={settings.defaultEventChannelId ?? ""}
              onChange={(v) => update({ defaultEventChannelId: v || null })}
              placeholder="Kanäle durchsuchen…"
              emptyLabel="— keiner —"
              options={toChannelOptions(channels)}
            />
            <div className="hint">
              Kanal, in dem ein neu erstelltes Event landet, wenn weder die Vorlage noch das Erstellungsformular einen eigenen Kanal festlegt.
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
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.eventChannelCleanupEnabled}
              onChange={(e) =>
                update({ eventChannelCleanupEnabled: e.target.checked })
              }
            />
            Event-Kanal nach Event-Ende automatisch leeren
          </label>
          {settings.eventChannelCleanupEnabled && (
            <div className="field">
              <label htmlFor="event-channel-cleanup-delay">
                Wartezeit nach Event-Ende (Stunden)
              </label>
              <input
                id="event-channel-cleanup-delay"
                type="number"
                min={0}
                max={720}
                value={settings.eventChannelCleanupDelayHours}
                onChange={(e) =>
                  update({
                    eventChannelCleanupDelayHours: Number(e.target.value),
                  })
                }
              />
              <div className="hint">
                Nachrichten noch geplanter oder laufender Events bleiben
                erhalten.
              </div>
            </div>
          )}
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
        Angemeldet als <strong>{me.username}</strong> ({me.userId}) — Berechtigungsstufe:{" "}
        <strong>{WEB_ROLE_LABELS[me.role] ?? me.role}</strong>
      </p>
    </div>
  );
}

function accessGateLabel(gate: PermissionGate, roles: RoleOption[]): string {
  switch (gate.mode) {
    case "everyone":
      return "Jeder (angemeldet)";
    case "tier":
      return WEB_ROLE_LABELS[gate.tier];
    case "role": {
      const role = roles.find((r) => r.id === gate.roleId);
      return role ? `Rolle: ${role.name}` : "Rolle (unbekannt)";
    }
  }
}

/**
 * Reconfigures which dashboard tier/role may use each gated write feature
 * (see `FEATURES` in `src/web/accessControl.ts`) — the same `PermissionGate`
 * shape (and same three modes) already used for slash-command permissions
 * on the Commands page, applied to the dashboard's own routes instead.
 * Bot-owner/guild-owner only — see `canManageAccess` above and
 * `requireRole` on the backend route.
 */
function AccessControlSection() {
  const { features, setFeatures } = useAccessControl();
  const rolesRes = useRoles();
  const roles = rolesRes.data ?? [];
  const [pending, setPending] = useState<string | null>(null);
  const { showError, showSuccess } = useToast();

  async function save(key: string, gate: PermissionGate | null) {
    setPending(key);
    try {
      const updated = await api.updateAccessControlOverride(key, gate);
      setFeatures((prev) => prev?.map((f) => (f.key === key ? updated : f)) ?? null);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="card">
      <h2>Zugriff</h2>
      <p className="muted small">
        Wer welche Dashboard-Aktion nutzen darf — unabhängig von den Discord-Slash-Befehlen oben. "Zurücksetzen"
        stellt den Standardwert wieder her.
      </p>
      {!features.length ? (
        <div className="loading">Wird geladen…</div>
      ) : (
        features.map((f: AccessControlFeature) => {
          const effective = f.override ?? f.defaultGate;
          const busy = pending === f.key;
          return (
            <div key={f.key} className="field">
              <label htmlFor={`access-mode-${f.key}`}>{f.label}</label>
              <select
                id={`access-mode-${f.key}`}
                value={effective.mode}
                disabled={busy}
                onChange={(e) => {
                  const mode = e.target.value as PermissionGate["mode"];
                  if (mode === "everyone") save(f.key, { mode: "everyone" });
                  else if (mode === "tier") save(f.key, { mode: "tier", tier: "admin" });
                  // "role" mode waits for an actual role pick below.
                }}
              >
                <option value="everyone">Jeder (angemeldet)</option>
                <option value="tier">Mindest-Berechtigungsstufe</option>
                <option value="role">Bestimmte Rolle</option>
              </select>
              {effective.mode === "tier" && (
                <select
                  aria-label={`${f.label} Mindest-Berechtigungsstufe`}
                  value={effective.tier}
                  disabled={busy}
                  onChange={(e) => save(f.key, { mode: "tier", tier: e.target.value as WebRole })}
                >
                  <option value="bot-owner">{WEB_ROLE_LABELS["bot-owner"]}</option>
                  <option value="guild-owner">{WEB_ROLE_LABELS["guild-owner"]}</option>
                  <option value="admin">{WEB_ROLE_LABELS.admin}</option>
                  <option value="moderator">{WEB_ROLE_LABELS.moderator}</option>
                </select>
              )}
              {effective.mode === "role" && (
                <SearchableSelect
                  id={`access-role-${f.key}`}
                  value={effective.roleId}
                  onChange={(v) => v && save(f.key, { mode: "role", roleId: v })}
                  placeholder="Rollen durchsuchen…"
                  emptyLabel="— Rolle wählen —"
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                  disabled={busy}
                />
              )}
              <div className="hint">
                Standard: {accessGateLabel(f.defaultGate, roles)}
                {f.override && (
                  <>
                    {" · "}
                    <button className="link-button" disabled={busy} onClick={() => save(f.key, null)}>
                      Zurücksetzen
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Grant or block a specific Discord user's dashboard access, independent of
 * their guild roles — see the `resolveDashboardRole()` doc comment in
 * `src/web/auth.ts`. Bot-owner-only (see `canManageAccess`'s caller): this
 * is the single most powerful lever in the system, since it can grant or
 * deny literally anyone, including a guild-owner.
 */
function UserAccessOverridesSection() {
  const { overrides, setOverrides } = useUserAccessOverrides();
  const names = useMemberNames(overrides.map((o) => o.userId));
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState("");
  const [mode, setMode] = useState<"grant" | "block">("grant");
  const [role, setRole] = useState<WebRole>("moderator");
  const [note, setNote] = useState("");

  async function add() {
    if (!userId.trim()) return;
    setBusy(true);
    try {
      const saved = await api.setUserAccessOverride(
        userId.trim(),
        mode === "grant" ? { mode: "grant", role } : { mode: "block", note: note.trim() || null },
      );
      setOverrides((prev) => [...(prev ?? []).filter((o) => o.userId !== saved.userId), saved]);
      setUserId("");
      setNote("");
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: UserAccessOverride) {
    setBusy(true);
    try {
      await api.clearUserAccessOverride(target.userId);
      setOverrides((prev) => (prev ?? []).filter((o) => o.userId !== target.userId));
      showSuccess("Entfernt.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Benutzer-Zugriff</h2>
      <p className="muted small">
        Erlaubt oder sperrt einzelne Discord-Nutzer unabhängig von ihren Server-Rollen — z. B. um jemandem ohne
        passende Rolle Zugriff zu geben, oder um jemanden sofort auszuschließen, ohne Discord-Rollen anzufassen.
      </p>
      {overrides.map((o) => (
        <div key={o.userId} className="field">
          <div>
            <strong>{names[o.userId] ?? o.userId}</strong> —{" "}
            {o.mode === "grant" ? `Zugriff: ${WEB_ROLE_LABELS[o.role!]}` : `Gesperrt${o.note ? ` (${o.note})` : ""}`}
          </div>
          <div className="hint">
            Gesetzt von {o.setByUsername} · {formatAbsolute(o.setAt)}{" "}
            <button className="link-button" disabled={busy} onClick={() => remove(o)}>
              Entfernen
            </button>
          </div>
        </div>
      ))}
      <div className="field">
        <label htmlFor="user-override-id">Discord-Nutzer-ID</label>
        <input id="user-override-id" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="123456789012345678" />
        <select value={mode} onChange={(e) => setMode(e.target.value as "grant" | "block")}>
          <option value="grant">Zugriff gewähren</option>
          <option value="block">Sperren</option>
        </select>
        {mode === "grant" ? (
          <select value={role} onChange={(e) => setRole(e.target.value as WebRole)}>
            <option value="bot-owner">{WEB_ROLE_LABELS["bot-owner"]}</option>
            <option value="guild-owner">{WEB_ROLE_LABELS["guild-owner"]}</option>
            <option value="admin">{WEB_ROLE_LABELS.admin}</option>
            <option value="moderator">{WEB_ROLE_LABELS.moderator}</option>
          </select>
        ) : (
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Grund (optional)" />
        )}
        <button disabled={busy || !userId.trim()} onClick={add}>
          Speichern
        </button>
      </div>
    </div>
  );
}

/** `expiresAt` is always in the future for a still-active grant (server-side filtered) — a static computed string is enough, no ticking timer. */
function formatCountdown(expiresAt: string): string {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return "abgelaufen";
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  if (hours >= 24) return `läuft ab in ${Math.floor(hours / 24)}T ${hours % 24}Std.`;
  if (hours > 0) return `läuft ab in ${hours}Std. ${minutes}Min.`;
  return `läuft ab in ${minutes}Min.`;
}

const GRANT_DURATION_PRESETS = [
  { label: "1 Stunde", minutes: 60 },
  { label: "4 Stunden", minutes: 240 },
  { label: "24 Stunden", minutes: 1440 },
  { label: "7 Tage", minutes: 10080 },
];

/** Time-boxed elevation to a higher tier — see `applyTemporaryGrant()` in `src/web/accessControl.ts`. Bot-owner/guild-owner. */
function TemporaryGrantsSection() {
  const { grants, setGrants } = useTemporaryGrants();
  const names = useMemberNames(grants.map((g) => g.userId));
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<WebRole>("admin");
  const [durationMinutes, setDurationMinutes] = useState(GRANT_DURATION_PRESETS[0].minutes);

  async function add() {
    if (!userId.trim()) return;
    setBusy(true);
    try {
      const grant = await api.createTemporaryGrant({ userId: userId.trim(), role, durationMinutes });
      setGrants((prev) => [...(prev ?? []), grant]);
      setUserId("");
      showSuccess("Gewährt.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(grant: TemporaryGrant) {
    setBusy(true);
    try {
      await api.revokeTemporaryGrant(grant.id);
      setGrants((prev) => (prev ?? []).filter((g) => g.id !== grant.id));
      showSuccess("Widerrufen.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Temporäre Berechtigungen</h2>
      <p className="muted small">
        Hebt einen Nutzer für eine begrenzte Zeit auf eine höhere Berechtigungsstufe an — läuft danach von selbst ab,
        keine Gefahr eines vergessenen Dauerzugriffs.
      </p>
      {grants.map((g) => (
        <div key={g.id} className="field">
          <div>
            <strong>{names[g.userId] ?? g.userId}</strong> — {WEB_ROLE_LABELS[g.role]}
          </div>
          <div className="hint">
            {formatCountdown(g.expiresAt)} · gewährt von {g.grantedByUsername}{" "}
            <button className="link-button" disabled={busy} onClick={() => revoke(g)}>
              Widerrufen
            </button>
          </div>
        </div>
      ))}
      <div className="field">
        <label htmlFor="temp-grant-id">Discord-Nutzer-ID</label>
        <input id="temp-grant-id" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="123456789012345678" />
        <select value={role} onChange={(e) => setRole(e.target.value as WebRole)}>
          <option value="bot-owner">{WEB_ROLE_LABELS["bot-owner"]}</option>
          <option value="guild-owner">{WEB_ROLE_LABELS["guild-owner"]}</option>
          <option value="admin">{WEB_ROLE_LABELS.admin}</option>
          <option value="moderator">{WEB_ROLE_LABELS.moderator}</option>
        </select>
        <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
          {GRANT_DURATION_PRESETS.map((p) => (
            <option key={p.minutes} value={p.minutes}>
              {p.label}
            </option>
          ))}
        </select>
        <button disabled={busy || !userId.trim()} onClick={add}>
          Gewähren
        </button>
      </div>
    </div>
  );
}

/** Read-only bearer tokens for non-interactive integrations — see `GET /api/public/status` in `src/web/server.ts`. Bot-owner-only. */
function ApiTokensSection() {
  const { tokens, setTokens } = useApiTokens();
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);

  async function create() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const token = await api.createApiToken(label.trim());
      setCreated(token);
      setTokens((prev) => [{ ...token }, ...(prev ?? [])]);
      setLabel("");
      showSuccess("Erstellt.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setBusy(true);
    try {
      await api.revokeApiToken(id);
      setTokens((prev) => (prev ?? []).filter((t) => t.id !== id));
      if (created?.id === id) setCreated(null);
      showSuccess("Widerrufen.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>API-Token</h2>
      <p className="muted small">
        Lesezugriff für nicht-interaktive Integrationen (z. B. ein Status-Widget) — ohne menschliche Anmeldung, aber
        beschränkt auf die öffentliche Community-Übersicht (<code>GET /api/public/status</code>).
      </p>
      {created && (
        <div className="field">
          <div className="hint">Dieser Token wird nicht erneut angezeigt — jetzt kopieren.</div>
          <input readOnly value={created.rawToken} onFocus={(e) => e.currentTarget.select()} className="mono" />
        </div>
      )}
      {tokens.map((t) => (
        <div key={t.id} className="field">
          <div>
            <strong>{t.label}</strong>
          </div>
          <div className="hint">
            Erstellt {formatAbsolute(t.createdAt)} von {t.createdByUsername} · zuletzt genutzt{" "}
            {t.lastUsedAt ? formatAbsolute(t.lastUsedAt) : "nie"}{" "}
            <button className="link-button" disabled={busy} onClick={() => revoke(t.id)}>
              Widerrufen
            </button>
          </div>
        </div>
      ))}
      <div className="field">
        <label htmlFor="api-token-label">Bezeichnung</label>
        <input id="api-token-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Status-Widget" />
        <button disabled={busy || !label.trim()} onClick={create}>
          Erstellen
        </button>
      </div>
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
  // Mirrors of the last-*persisted* value for each manually-saved field
  // (the toggles/selects elsewhere on this page autosave via `update()` and
  // don't need this — see the module doc comment on save-row usage below).
  // Comparing against these, not against `settingsRes.data`, is what lets
  // "Speichern" disable itself once there's nothing left to save and lets
  // the "Ungespeicherte Änderungen" indicator and the cross-page navigation
  // guard (useUnsavedChanges) both know the true dirty state.
  const [savedFontMap, setSavedFontMap] = useState("");
  const [savedNicknameEmoji, setSavedNicknameEmoji] = useState("");
  const [savedConfirmationTemplate, setSavedConfirmationTemplate] = useState("");
  const [savedAutoConfirmationTemplate, setSavedAutoConfirmationTemplate] = useState("");
  const fontMapDirty = fontMap !== savedFontMap;
  const nicknameEmojiDirty = nicknameEmoji !== savedNicknameEmoji;
  const confirmationTemplateDirty = confirmationTemplate !== savedConfirmationTemplate;
  const autoConfirmationTemplateDirty = autoConfirmationTemplate !== savedAutoConfirmationTemplate;
  useUnsavedChanges(fontMapDirty || nicknameEmojiDirty || confirmationTemplateDirty || autoConfirmationTemplateDirty);
  const { showError, showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canWrite = hasCapability(me, "settings.write");
  // Managing the access-control overrides themselves is never delegable to
  // admin/moderator — same reasoning as PATCH /api/access-control on the
  // backend (see routes/accessControl.ts) — so the tab that edits them is
  // hidden rather than merely disabled for anyone below guild-owner.
  const canManageAccess = me.role === "bot-owner" || me.role === "guild-owner";
  const sections = canManageAccess ? [...SECTIONS, { id: "zugriff", label: "Zugriff" }] : SECTIONS;

  const rawSection = searchParams.get("section");
  const activeSection = sections.some((s) => s.id === rawSection)
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
    setSavedFontMap(s.fontMap ?? "");
    setNicknameEmoji(s.registerNicknameEmoji);
    setSavedNicknameEmoji(s.registerNicknameEmoji);
    setConfirmationTemplate(s.registerConfirmationTemplate);
    setSavedConfirmationTemplate(s.registerConfirmationTemplate);
    setAutoConfirmationTemplate(s.autoRegisterConfirmationTemplate);
    setSavedAutoConfirmationTemplate(s.autoRegisterConfirmationTemplate);
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
      setSavedFontMap(fontMap);
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
      setSavedNicknameEmoji(nicknameEmoji);
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
      setSavedConfirmationTemplate(confirmationTemplate);
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
      setSavedAutoConfirmationTemplate(autoConfirmationTemplate);
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
        tabs={sections}
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
            fontMapDirty={fontMapDirty}
            canWrite={canWrite}
          />
        )}
        {activeSection === "registrierung" && (
          <RegistrierungSection
            settings={settings}
            update={update}
            roles={roles}
            channels={channels}
            canWrite={canWrite}
            nicknameEmoji={nicknameEmoji}
            setNicknameEmoji={setNicknameEmoji}
            handleSaveNicknameEmoji={handleSaveNicknameEmoji}
            savingNicknameEmoji={savingNicknameEmoji}
            nicknameEmojiDirty={nicknameEmojiDirty}
            confirmationTemplate={confirmationTemplate}
            setConfirmationTemplate={setConfirmationTemplate}
            handleSaveConfirmationTemplate={handleSaveConfirmationTemplate}
            savingConfirmationTemplate={savingConfirmationTemplate}
            confirmationTemplateDirty={confirmationTemplateDirty}
            autoConfirmationTemplate={autoConfirmationTemplate}
            setAutoConfirmationTemplate={setAutoConfirmationTemplate}
            handleSaveAutoConfirmationTemplate={
              handleSaveAutoConfirmationTemplate
            }
            savingAutoConfirmationTemplate={savingAutoConfirmationTemplate}
            autoConfirmationTemplateDirty={autoConfirmationTemplateDirty}
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
        {activeSection === "zugriff" && canManageAccess && (
          <>
            <AccessControlSection />
            <TemporaryGrantsSection />
            {me.role === "bot-owner" && <UserAccessOverridesSection />}
            {me.role === "bot-owner" && <ApiTokensSection />}
          </>
        )}
      </div>
    </div>
  );
}
