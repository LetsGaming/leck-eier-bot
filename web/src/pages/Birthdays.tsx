import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import SearchableSelect from "../components/SearchableSelect";
import BaseTable, { type BaseTableColumn } from "../components/BaseTable";
import TemplateEditor, { type TemplatePlaceholder } from "../components/TemplateEditor";
import TemplatePreview from "../components/TemplatePreview";
import { useConfirm } from "../components/ConfirmContext";
import { useToast } from "../components/ToastContext";
import { useUnsavedChanges } from "../components/UnsavedChangesContext";
import { useBirthdaySettings } from "../hooks/useBirthdaySettings";
import { useChannels } from "../hooks/useChannels";
import { useGeneralSettings } from "../hooks/useGeneralSettings";
import { useMemberNames } from "../hooks/useMemberNames";
import { useUpcomingBirthdays } from "../hooks/useUpcomingBirthdays";
import { applyFont } from "../utils/font";
import { toChannelOptions } from "../utils/selectOptions";
import type { BirthdayEntry, UpcomingBirthday } from "../types";

interface EntryRow {
  b: UpcomingBirthday;
  entry: BirthdayEntry;
}

/** Sample values shown in the live preview — the real message uses the actual member's mention/nick/everyone-ping at send time. */
const PREVIEW_CONTEXT = { userMention: "@Beispielperson", everyoneMention: "@everyone", userNick: "Beispielperson" };
const PREVIEW_MONTH = "März";
const PREVIEW_ENTRIES = "📅 05.03: @Beispielperson";

/** See renderBirthdayTemplate() in src/services/birthdays.ts. */
const ANNOUNCEMENT_TEMPLATE_PLACEHOLDERS: TemplatePlaceholder[] = [
  { token: "userMention", label: "Person (@-Erwähnung)" },
  { token: "userNick", label: "Servername" },
  { token: "everyoneMention", label: "@everyone" },
];
/** See buildAnchorParts() in src/services/birthdays.ts. */
const ANCHOR_TEMPLATE_PLACEHOLDERS: TemplatePlaceholder[] = [
  { token: "month", label: "Monat" },
  { token: "entries", label: "Geburtstagsliste" },
];

/** Matches the "minute hour * * *" shape produced by the time-of-day picker below — anything else (step values, weekday lists, …) is treated as a custom schedule and edited as raw cron. */
const DAILY_CRON_PATTERN = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;

function cronToTimeInput(cron: string): string | null {
  const match = DAILY_CRON_PATTERN.exec(cron.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeInputToCron(time: string): string {
  const [hour, minute] = time.split(":");
  return `${Number(minute)} ${Number(hour)} * * *`;
}

function relativeDay(days: number): string {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

/**
 * Never falls back to `entry.mention`'s raw `<@id>` markup — an admin-added
 * entry with only a Discord-user-ID (no `name`) would otherwise show that
 * literal, unrendered mention text everywhere, including inside the delete
 * confirmation's "this is permanent" moment. `names` (from `useMemberNames`)
 * resolves it to the same display name Member Audit already shows for that
 * person; a genuinely unknown id (never seen by the bot) falls back to a
 * plain-language placeholder instead of exposing the raw id format.
 */
function entryLabel(entry: { userId: string | null; name: string | null; mention: string }, names: Record<string, string>): string {
  if (entry.name) return entry.name;
  if (entry.userId) return names[entry.userId] ?? `Unbekanntes Mitglied (${entry.userId})`;
  return entry.mention;
}

/** Links to the member overview when a Discord account is linked (`userId` non-null) — list-entered, name-only entries have none. */
function EntryLabelLink({
  entry,
  names,
}: {
  entry: { userId: string | null; name: string | null; mention: string };
  names: Record<string, string>;
}) {
  const label = entryLabel(entry, names);
  return entry.userId ? <Link to={`/members/${entry.userId}`}>{label}</Link> : <>{label}</>;
}

interface EntryDraft {
  id: number | null;
  day: string;
  month: string;
  userId: string;
  name: string;
}

const EMPTY_DRAFT: EntryDraft = { id: null, day: "", month: "", userId: "", name: "" };

export default function Birthdays() {
  const settingsRes = useBirthdaySettings();
  const channelsRes = useChannels();
  const upcomingRes = useUpcomingBirthdays();
  const generalRes = useGeneralSettings();
  const channels = channelsRes.data ?? [];
  const upcoming = upcomingRes.data;
  const fontMap = generalRes.data?.fontMap ?? null;

  // Only entries the app can't already name outright (admin-added by
  // Discord-user-ID with no `name` on file) need a lookup — see
  // entryLabel()'s doc comment.
  const unnamedIds: string[] = [];
  for (const group of upcoming ?? []) {
    for (const entry of group.entries) {
      if (entry.userId && !entry.name) unnamedIds.push(entry.userId);
    }
  }
  const memberNames = useMemberNames(unnamedIds);

  const [template, setTemplate] = useState("");
  const [channelId, setChannelId] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [advancedCron, setAdvancedCron] = useState(false);
  const [modChannelId, setModChannelId] = useState("");
  const [anchorTemplate, setAnchorTemplate] = useState("");
  const [anchorIntro, setAnchorIntro] = useState("");
  const [anchorUseFont, setAnchorUseFont] = useState(false);
  const [announcementUseFont, setAnnouncementUseFont] = useState(false);
  const [showAnnouncementPreview, setShowAnnouncementPreview] = useState(false);
  const [showAnchorPreview, setShowAnchorPreview] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingRegistration, setSavingRegistration] = useState(false);
  const [syncingAnchor, setSyncingAnchor] = useState(false);
  // Mirrors of the last-*persisted* value per card — see Settings.tsx's
  // identical convention. Each of this page's 3 cards saves independently
  // (see handleSaveTemplate/handleSaveSchedule/handleSaveRegistration
  // below); this is what lets each card's own "Speichern" disable itself
  // when there's nothing left to save in *that* card specifically, instead
  // of one button 2 cards away silently covering all three (the exact bug
  // this pass fixes).
  const [savedTemplate, setSavedTemplate] = useState("");
  const [savedAnnouncementUseFont, setSavedAnnouncementUseFont] = useState(false);
  const [savedChannelId, setSavedChannelId] = useState("");
  const [savedCronExpr, setSavedCronExpr] = useState("");
  const [savedModChannelId, setSavedModChannelId] = useState("");
  const [savedAnchorIntro, setSavedAnchorIntro] = useState("");
  const [savedAnchorTemplate, setSavedAnchorTemplate] = useState("");
  const [savedAnchorUseFont, setSavedAnchorUseFont] = useState(false);
  const templateDirty = template !== savedTemplate || announcementUseFont !== savedAnnouncementUseFont;
  const scheduleDirty = channelId !== savedChannelId || cronExpr !== savedCronExpr;
  const registrationDirty =
    modChannelId !== savedModChannelId ||
    anchorIntro !== savedAnchorIntro ||
    anchorTemplate !== savedAnchorTemplate ||
    anchorUseFont !== savedAnchorUseFont;
  useUnsavedChanges(templateDirty || scheduleDirty || registrationDirty);
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const [savingEntry, setSavingEntry] = useState(false);
  const { showError, showSuccess } = useToast();
  const confirmDialog = useConfirm();

  // Seeds the local editable form fields once `useBirthdaySettings()`
  // resolves — mirrors the pre-migration `loadAll()`'s destructuring of `s`,
  // just re-run whenever the underlying resource changes instead of once
  // inline in a combined `Promise.all` handler.
  useEffect(() => {
    const s = settingsRes.data;
    if (!s) return;
    setTemplate(s.template);
    setSavedTemplate(s.template);
    setChannelId(s.channelId ?? "");
    setSavedChannelId(s.channelId ?? "");
    setCronExpr(s.cron);
    setSavedCronExpr(s.cron);
    setAdvancedCron(cronToTimeInput(s.cron) === null);
    setModChannelId(s.modChannelId ?? "");
    setSavedModChannelId(s.modChannelId ?? "");
    setAnchorTemplate(s.anchorTemplate);
    setSavedAnchorTemplate(s.anchorTemplate);
    setAnchorIntro(s.anchorIntro ?? "");
    setSavedAnchorIntro(s.anchorIntro ?? "");
    setAnchorUseFont(s.anchorUseFont);
    setSavedAnchorUseFont(s.anchorUseFont);
    setAnnouncementUseFont(s.announcementUseFont);
    setSavedAnnouncementUseFont(s.announcementUseFont);
  }, [settingsRes.data]);

  async function handleSaveTemplate() {
    setSavingTemplate(true);
    try {
      await api.updateBirthdaySettings({ template, announcementUseFont });
      setSavedTemplate(template);
      setSavedAnnouncementUseFont(announcementUseFont);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    try {
      await api.updateBirthdaySettings({ channelId: channelId || null, cron: cronExpr });
      setSavedChannelId(channelId);
      setSavedCronExpr(cronExpr);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleSaveRegistration() {
    setSavingRegistration(true);
    try {
      await api.updateBirthdaySettings({
        modChannelId: modChannelId || null,
        anchorTemplate,
        anchorIntro: anchorIntro || null,
        anchorUseFont,
      });
      setSavedModChannelId(modChannelId);
      setSavedAnchorTemplate(anchorTemplate);
      setSavedAnchorIntro(anchorIntro);
      setSavedAnchorUseFont(anchorUseFont);
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingRegistration(false);
    }
  }

  async function handleSyncAnchor() {
    setSyncingAnchor(true);
    try {
      await api.syncBirthdayAnchor();
      upcomingRes.reload();
      showSuccess("Ankernachricht neu generiert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSyncingAnchor(false);
    }
  }

  function startEdit(entry: BirthdayEntry, dateKey: string) {
    const [dd, mm] = dateKey.split(".");
    setDraft({ id: entry.id, day: dd ?? "", month: mm ?? "", userId: entry.userId ?? "", name: entry.name ?? "" });
  }

  async function handleSaveEntry() {
    const day = parseInt(draft.day, 10);
    const month = parseInt(draft.month, 10);
    if (!day || !month) {
      showError("Gib einen Tag und einen Monat ein.");
      return;
    }
    if (!draft.userId.trim() && !draft.name.trim()) {
      showError("Gib eine Discord-Benutzer-ID oder einen Namen an.");
      return;
    }
    setSavingEntry(true);
    try {
      const body = { day, month, userId: draft.userId.trim() || null, name: draft.name.trim() || null };
      if (draft.id === null) {
        await api.addBirthday(body);
      } else {
        await api.updateBirthday(draft.id, body);
      }
      setDraft(EMPTY_DRAFT);
      upcomingRes.reload();
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleDeleteEntry(entry: { id: number; userId: string | null; name: string | null; mention: string }) {
    const ok = await confirmDialog({
      title: "Geburtstag entfernen",
      message: `Der Eintrag für ${entryLabel(entry, memberNames)} wird unwiderruflich entfernt und verschwindet auch aus der Ankernachricht.`,
      confirmLabel: "Entfernen",
    });
    if (!ok) return;
    try {
      await api.deleteBirthday(entry.id);
      upcomingRes.reload();
      showSuccess("Entfernt.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  // Ties (multiple dates the same number of days out) all count as "next up".
  const nextUp = upcoming && upcoming.length > 0 ? upcoming.filter((b) => b.daysUntil === upcoming[0]!.daysUntil) : [];

  // Flattened one row per entry (a date can hold more than one person) —
  // BaseTable's sort engine needs a flat array, not `upcoming`'s
  // date-grouped shape.
  const entryRows = useMemo(
    () => (upcoming ?? []).flatMap((b) => b.entries.map((entry) => ({ b, entry }))),
    [upcoming],
  );
  const entryColumns: BaseTableColumn<EntryRow>[] = [
    {
      key: "date",
      label: "Datum",
      // `daysUntil` is already the correct chronological ordering for
      // "Datum" (the entries API only ever returns each date's next
      // upcoming occurrence, so it doubles as calendar order).
      accessor: (r) => r.b.daysUntil,
      render: (r) => r.b.dateKey,
    },
    {
      key: "person",
      label: "Person",
      accessor: (r) => entryLabel(r.entry, memberNames),
      render: (r) => <EntryLabelLink entry={r.entry} names={memberNames} />,
    },
    {
      key: "source",
      label: "Quelle",
      accessor: (r) => r.entry.source,
      render: (r) => (
        <span className={`badge ${r.entry.source === "self" ? "ok" : "warn"}`}>
          {r.entry.source === "self" ? "selbst registriert" : "Liste"}
        </span>
      ),
    },
    { key: "relative", label: "", className: "muted stack-plain", render: (r) => relativeDay(r.b.daysUntil) },
    {
      key: "actions",
      label: "",
      className: "stack-plain",
      render: (r) => (
        <>
          <button onClick={() => startEdit(r.entry, r.b.dateKey)}>Bearbeiten</button>{" "}
          <button className="danger" onClick={() => handleDeleteEntry(r.entry)}>
            Löschen
          </button>
        </>
      ),
    },
  ];

  return (
    <div>
      <h2>Geburtstage</h2>

      {!upcoming ? (
        <div className="loading">Wird geladen…</div>
      ) : (
        <>
          {nextUp.length > 0 && (
            <div className="stat-grid">
              {nextUp.map((b) => (
                <div className="stat-tile" key={b.dateKey}>
                  <div className="label">Als Nächstes — {relativeDay(b.daysUntil)}</div>
                  <div className="value fs-18">
                    {b.dateKey}
                  </div>
                  <div className="muted">
                    {b.entries.map((entry, i) => (
                      <Fragment key={entry.id}>
                        {i > 0 && ", "}
                        <EntryLabelLink entry={entry} names={memberNames} />
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h2>Eingetragene Geburtstage</h2>
            <p className="muted small">
              Einträge hinzufügen, bearbeiten oder entfernen — die Ankernachricht wird automatisch aktualisiert.
            </p>

            <div className="row mb-12">
              <div className="field field-narrow">
                <label htmlFor="entryDay">Tag</label>
                <input
                  id="entryDay"
                  type="number"
                  min={1}
                  max={31}
                  value={draft.day}
                  onChange={(e) => setDraft((d) => ({ ...d, day: e.target.value }))}
                />
              </div>
              <div className="field field-narrow">
                <label htmlFor="entryMonth">Monat</label>
                <input
                  id="entryMonth"
                  type="number"
                  min={1}
                  max={12}
                  value={draft.month}
                  onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="entryUserId">Discord-Benutzer-ID</label>
                <input
                  id="entryUserId"
                  type="text"
                  placeholder="optional"
                  value={draft.userId}
                  onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="entryName">Name</label>
                <input
                  id="entryName"
                  type="text"
                  placeholder="optional, wenn eine Benutzer-ID gesetzt ist"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="field field-auto">
                <label>&nbsp;</label>
                <button className="primary" onClick={handleSaveEntry} disabled={savingEntry}>
                  {draft.id === null ? "Hinzufügen" : "Änderung speichern"}
                </button>
                {draft.id !== null && (
                  <button onClick={() => setDraft(EMPTY_DRAFT)} className="ml-8">
                    Abbrechen
                  </button>
                )}
              </div>
            </div>

            {upcoming.length > 0 && (
              <div className="hint mb-12">
                Mit "selbst registriert" markierte Einträge wurden vom Mitglied selbst hinzugefügt und können hier
                bei Bedarf weiterhin korrigiert werden.
              </div>
            )}
            <BaseTable
              columns={entryColumns}
              rows={entryRows}
              rowKey={(r) => r.entry.id}
              emptyMessage={<p className="muted">Noch keine Geburtstage eingetragen.</p>}
            />
          </div>

          <div className="card-grid">
            <div className="card">
              <h2>Nachrichtenvorlage</h2>
              <div className="field">
                <label htmlFor="template">Vorlage</label>
                <TemplateEditor
                  id="template"
                  value={template}
                  onChange={setTemplate}
                  channels={channels}
                  placeholders={ANNOUNCEMENT_TEMPLATE_PLACEHOLDERS}
                />
                <div className="hint">
                  "Person" fügt eine @-Erwähnung ein, "Servername" den
                  Anzeigenamen auf diesem Server.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={announcementUseFont}
                  onChange={(e) => setAnnouncementUseFont(e.target.checked)}
                />
                Schrift verwenden
              </label>
              <div className="hint">
                Formatiert die Ankündigung mit der auf der <a href="/settings">Einstellungsseite</a> festgelegten
                Schrift, sofern konfiguriert.
              </div>
              <label className="switch mt-12">
                <input
                  type="checkbox"
                  checked={showAnnouncementPreview}
                  onChange={(e) => setShowAnnouncementPreview(e.target.checked)}
                />
                Vorschau
              </label>
              {showAnnouncementPreview && (
                <div className="mt-12">
                  {/*
                    Mirrors buildBirthdayMessage()/renderBirthdayTemplate() in
                    src/services/birthdays.ts EXACTLY as it actually behaves
                    today (post-Task-7-fix), not a naive reading of the
                    engine's own styled/raw split: the backend substitutes
                    {userMention}/{everyoneMention}/{userNick} unstyled first,
                    then hand-applies applyFont() to the WHOLE resulting
                    string. Since applyFont() is a pure, position-independent
                    character map, font-mapping the fully-assembled string is
                    byte-identical to font-mapping the template's literal text
                    and each substituted value independently — which is
                    exactly what passing these three tokens through
                    renderTemplate()'s `styled` bucket (with useFont set to
                    the real announcementUseFont toggle) does. So, unlike
                    buildAnchorParts below, this one call is a faithful
                    single-shot mirror of the real backend behavior.
                  */}
                  <div className="preview-box">
                    <TemplatePreview
                      template={template}
                      context={{ styled: PREVIEW_CONTEXT }}
                      channels={channels}
                      useFont={announcementUseFont}
                      fontMap={fontMap}
                    />
                  </div>
                </div>
              )}
              <div className="save-row mt-12">
                <button
                  className="primary"
                  onClick={handleSaveTemplate}
                  disabled={savingTemplate || !templateDirty}
                >
                  {savingTemplate ? "Wird gespeichert…" : "Speichern"}
                </button>
                {templateDirty && !savingTemplate && <span className="muted small">Ungespeicherte Änderungen</span>}
              </div>
            </div>

            <div className="card">
              <h2>Ankernachricht &amp; tägliche Ankündigung</h2>
              <p className="muted small">
                Legt fest, wo der Bot die Geburtstagsliste postet und wann er die tägliche Ankündigung sendet.
              </p>
              <div className="field">
                <label htmlFor="channel">Kanal</label>
                <SearchableSelect
                  id="channel"
                  value={channelId}
                  onChange={setChannelId}
                  placeholder="Kanäle durchsuchen…"
                  emptyLabel="— keiner —"
                  options={toChannelOptions(channels)}
                />
                <div className="hint">
                  Der Bot pflegt die Geburtstagsliste hier automatisch (aufgeteilt auf mehrere Nachrichten, falls sie
                  Discords 2000-Zeichen-Limit überschreitet) und postet hier auch die tägliche Ankündigung.
                </div>
              </div>
              <div className="field">
                <label htmlFor="cron">Uhrzeit der täglichen Aufgabe</label>
                {advancedCron ? (
                  <>
                    <input
                      id="cron"
                      type="text"
                      className="mono-input"
                      value={cronExpr}
                      onChange={(e) => setCronExpr(e.target.value)}
                    />
                    <div className="hint">
                      Cron-Ausdruck (Serverzeit), z. B. <code>0 0 * * *</code> für Mitternacht.{" "}
                      <button type="button" className="link-button" onClick={() => setAdvancedCron(false)}>
                        Zurück zur Uhrzeit-Auswahl
                      </button>{" "}
                      (nur möglich, wenn der Ausdruck einer festen Uhrzeit entspricht).
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      id="cron"
                      type="time"
                      value={cronToTimeInput(cronExpr) ?? "00:00"}
                      onChange={(e) => setCronExpr(timeInputToCron(e.target.value))}
                    />
                    <div className="hint">
                      Der Bot postet die tägliche Ankündigung um diese Uhrzeit (Serverzeit). Für Wochentags- oder
                      Intervall-Zeitpläne:{" "}
                      <button type="button" className="link-button" onClick={() => setAdvancedCron(true)}>
                        Cron-Ausdruck manuell bearbeiten
                      </button>
                      .
                    </div>
                  </>
                )}
              </div>
              <div className="save-row">
                <button
                  className="primary"
                  onClick={handleSaveSchedule}
                  disabled={savingSchedule || !scheduleDirty}
                >
                  {savingSchedule ? "Wird gespeichert…" : "Speichern"}
                </button>
                {scheduleDirty && !savingSchedule && <span className="muted small">Ungespeicherte Änderungen</span>}
              </div>
            </div>

            <div className="card">
              <h2>Selbstregistrierung</h2>
              <p className="muted small">
                Mitglieder können ihren eigenen Geburtstag mit <code>/setmybirthday</code> eintragen oder einfach ein
                Datum (z. B. <code>15.03</code>) im obigen Geburtstagskanal posten — der Bot erkennt es, speichert es
                und löscht die Nachricht.
              </p>
              <div className="field">
                <label htmlFor="modChannel">Kanal für Registrierungsbenachrichtigungen</label>
                <SearchableSelect
                  id="modChannel"
                  value={modChannelId}
                  onChange={setModChannelId}
                  placeholder="Kanäle durchsuchen…"
                  emptyLabel="— keiner —"
                  options={toChannelOptions(channels)}
                />
                <div className="hint">Wo der Bot einen Hinweis postet, wenn sich jemand registriert. Optional.</div>
              </div>
              <div className="field">
                <label htmlFor="anchorIntro">Einleitungstext</label>
                <textarea
                  id="anchorIntro"
                  value={anchorIntro}
                  onChange={(e) => setAnchorIntro(e.target.value)}
                  placeholder="z. B. Nutze /setmybirthday oder poste dein Datum hier, um dich zu registrieren!"
                />
                <div className="hint">
                  Wird einmal über allen Monaten angezeigt — anders als die Vorlage unten nie wiederholt und nie mit
                  Schrift formatiert. Leer lassen, um nichts anzuzeigen.
                </div>
              </div>
              <div className="field">
                <label htmlFor="anchorTemplate">Vorlage für Monatsüberschriften</label>
                <TemplateEditor
                  id="anchorTemplate"
                  value={anchorTemplate}
                  onChange={setAnchorTemplate}
                  channels={channels}
                  placeholders={ANCHOR_TEMPLATE_PLACEHOLDERS}
                />
                <div className="hint">
                  "Monat" wird mit der Schrift unten formatiert, "Geburtstagsliste" (die Daten/Erwähnungen für diesen
                  Monat) bleibt immer unformatiert.
                </div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={anchorUseFont} onChange={(e) => setAnchorUseFont(e.target.checked)} />
                Schrift für Monatsüberschriften verwenden
              </label>
              <div className="hint">
                Verwendet die auf der <a href="/settings">Einstellungsseite</a> festgelegte Schrift, sofern
                konfiguriert.
              </div>
              <label className="switch mt-12">
                <input
                  type="checkbox"
                  checked={showAnchorPreview}
                  onChange={(e) => setShowAnchorPreview(e.target.checked)}
                />
                Vorschau
              </label>
              {showAnchorPreview && (
                <div className="mt-12">
                  {/*
                    Mirrors buildAnchorParts() in src/services/birthdays.ts
                    EXACTLY as it actually behaves today (post-Task-7-fix):
                    unlike the announcement template above, the anchor
                    template's own literal text (e.g. "Born in ") must NEVER
                    be font-mapped, only {month}'s substituted value — the
                    backend deliberately bypasses renderTemplate()'s own font
                    pass for this reason (see buildAnchorParts()'s doc
                    comment) by hand-applying applyFont() to just the month
                    heading, then rendering with useFont:false. Reproduced
                    here identically: font-map PREVIEW_MONTH by hand, pass it
                    (and the unstyled entries line) through TemplatePreview's
                    `raw` bucket with useFont hardcoded to false.
                  */}
                  <div className="preview-box">
                    <TemplatePreview
                      template={anchorTemplate}
                      context={{
                        raw: {
                          month: applyFont(PREVIEW_MONTH, anchorUseFont ? fontMap : null),
                          entries: PREVIEW_ENTRIES,
                        },
                      }}
                      channels={channels}
                      useFont={false}
                      fontMap={null}
                    />
                  </div>
                </div>
              )}
              <div className="save-row mt-12">
                <button
                  className="primary"
                  onClick={handleSaveRegistration}
                  disabled={savingRegistration || !registrationDirty}
                >
                  {savingRegistration ? "Wird gespeichert…" : "Speichern"}
                </button>
                {registrationDirty && !savingRegistration && (
                  <span className="muted small">Ungespeicherte Änderungen</span>
                )}
              </div>
              <button onClick={handleSyncAnchor} disabled={syncingAnchor || !channelId} className="mt-8">
                {syncingAnchor ? "Wird neu generiert…" : "Nachricht jetzt neu generieren"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
