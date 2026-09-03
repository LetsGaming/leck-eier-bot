import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import SearchableSelect from "../components/SearchableSelect";
import { useToast } from "../components/ToastContext";
import type { BirthdayEntry, Channel, UpcomingBirthday } from "../types";

function relativeDay(days: number): string {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

function entryLabel(entry: { name: string | null; mention: string }): string {
  return entry.name ?? entry.mention;
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
  const [channels, setChannels] = useState<Channel[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingBirthday[] | null>(null);
  const [template, setTemplate] = useState("");
  const [channelId, setChannelId] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [modChannelId, setModChannelId] = useState("");
  const [anchorTemplate, setAnchorTemplate] = useState("");
  const [anchorIntro, setAnchorIntro] = useState("");
  const [anchorUseFont, setAnchorUseFont] = useState(false);
  const [announcementUseFont, setAnnouncementUseFont] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingAnchor, setSyncingAnchor] = useState(false);
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const [savingEntry, setSavingEntry] = useState(false);
  const { showError, showSuccess } = useToast();

  function loadAll() {
    Promise.all([api.birthdaySettings(), api.channels(), api.upcomingBirthdays()])
      .then(([s, c, u]) => {
        setTemplate(s.template);
        setChannelId(s.channelId ?? "");
        setCronExpr(s.cron);
        setModChannelId(s.modChannelId ?? "");
        setAnchorTemplate(s.anchorTemplate);
        setAnchorIntro(s.anchorIntro ?? "");
        setAnchorUseFont(s.anchorUseFont);
        setAnnouncementUseFont(s.announcementUseFont);
        setChannels(c);
        setUpcoming(u);
      })
      .catch((err) => showError(errorMessage(err)));
  }

  useEffect(loadAll, []);

  async function handlePreview() {
    try {
      const { rendered } = await api.previewBirthday(template);
      setPreview(rendered);
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateBirthdaySettings({
        template,
        channelId: channelId || null,
        cron: cronExpr,
        modChannelId: modChannelId || null,
        anchorTemplate,
        anchorIntro: anchorIntro || null,
        anchorUseFont,
        announcementUseFont,
      });
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncAnchor() {
    setSyncingAnchor(true);
    try {
      await api.syncBirthdayAnchor();
      setUpcoming(await api.upcomingBirthdays());
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
      setUpcoming(await api.upcomingBirthdays());
      showSuccess("Gespeichert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleDeleteEntry(id: number) {
    try {
      await api.deleteBirthday(id);
      setUpcoming(await api.upcomingBirthdays());
      showSuccess("Entfernt.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  // Ties (multiple dates the same number of days out) all count as "next up".
  const nextUp = upcoming && upcoming.length > 0 ? upcoming.filter((b) => b.daysUntil === upcoming[0]!.daysUntil) : [];

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
                  <div className="value" style={{ fontSize: 18 }}>
                    {b.dateKey}
                  </div>
                  <div className="muted">{b.entries.map(entryLabel).join(", ")}</div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h2>Eingetragene Geburtstage</h2>
            <p className="muted small">
              Füge hier einen Eintrag hinzu, bearbeite oder entferne ihn — die Ankernachricht wird automatisch
              aktualisiert. Mit "selbst registriert" markierte Einträge wurden vom Mitglied selbst hinzugefügt und
              können bei Bedarf hier weiterhin korrigiert werden.
            </p>

            <div className="row" style={{ alignItems: "flex-end", marginBottom: 12 }}>
              <div className="field" style={{ maxWidth: 90 }}>
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
              <div className="field" style={{ maxWidth: 90 }}>
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
              <div className="field" style={{ flex: "0 0 auto" }}>
                <label>&nbsp;</label>
                <button className="primary" onClick={handleSaveEntry} disabled={savingEntry}>
                  {draft.id === null ? "Hinzufügen" : "Änderung speichern"}
                </button>
                {draft.id !== null && (
                  <button onClick={() => setDraft(EMPTY_DRAFT)} style={{ marginLeft: 8 }}>
                    Abbrechen
                  </button>
                )}
              </div>
            </div>

            {upcoming.length === 0 ? (
              <p className="muted">Noch keine Geburtstage eingetragen.</p>
            ) : (
              <div className="table-scroll">
                <table className="stack-on-mobile">
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Person</th>
                      <th>Quelle</th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.flatMap((b) =>
                      b.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td data-label="Datum">{b.dateKey}</td>
                          <td data-label="Person">{entryLabel(entry)}</td>
                          <td data-label="Quelle">
                            <span className={`badge ${entry.source === "self" ? "ok" : "warn"}`}>
                              {entry.source === "self" ? "selbst registriert" : "Liste"}
                            </span>
                          </td>
                          <td className="muted stack-plain">{relativeDay(b.daysUntil)}</td>
                          <td className="stack-plain">
                            <button onClick={() => startEdit(entry, b.dateKey)}>Bearbeiten</button>{" "}
                            <button className="danger" onClick={() => handleDeleteEntry(entry.id)}>
                              Löschen
                            </button>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-grid">
            <div className="card">
              <h2>Nachrichtenvorlage</h2>
              <div className="field">
                <label htmlFor="template">Vorlage</label>
                <textarea id="template" value={template} onChange={(e) => setTemplate(e.target.value)} />
                <div className="hint">
                  Platzhalter: <code>{"{userMention}"}</code>, <code>{"{userNick}"}</code>,{" "}
                  <code>{"{everyoneMention}"}</code>
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
              <button onClick={handlePreview}>Vorschau</button>
              {preview && (
                <div className="preview-box" style={{ marginTop: 12 }}>
                  {preview}
                </div>
              )}
            </div>

            <div className="card">
              <h2>Ankernachricht &amp; tägliche Ankündigung</h2>
              <p className="muted small">
                Der Bot postet und pflegt die Geburtstagsliste selbst im unten angegebenen Kanal (aufgeteilt auf
                mehrere Nachrichten, falls die vollständige Liste Discords 2000-Zeichen-Limit überschreitet) und
                postet dort auch die tägliche Ankündigung.
              </p>
              <div className="field">
                <label htmlFor="channel">Kanal</label>
                <SearchableSelect
                  id="channel"
                  value={channelId}
                  onChange={setChannelId}
                  placeholder="Kanäle durchsuchen…"
                  emptyLabel="— keiner —"
                  options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
                />
              </div>
              <div className="field">
                <label htmlFor="cron">Zeitplan der täglichen Aufgabe (Cron)</label>
                <input id="cron" type="text" value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} />
                <div className="hint">
                  Standard: <code>0 0 * * *</code> (Mitternacht, Serverzeit)
                </div>
              </div>
              <button className="primary" onClick={handleSave} disabled={saving}>
                {saving ? "Wird gespeichert…" : "Speichern"}
              </button>
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
                  options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
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
                <textarea
                  id="anchorTemplate"
                  value={anchorTemplate}
                  onChange={(e) => setAnchorTemplate(e.target.value)}
                />
                <div className="hint">
                  Platzhalter: <code>{"{month}"}</code> (mit der Schrift unten formatiert, falls gesetzt),{" "}
                  <code>{"{entries}"}</code> (die Daten/Erwähnungen für diesen Monat — immer unformatiert, damit sie
                  auf Discord korrekt angezeigt werden).
                </div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={anchorUseFont} onChange={(e) => setAnchorUseFont(e.target.checked)} />
                Schrift für Monatsüberschriften verwenden
              </label>
              <div className="hint">
                Formatiert <code>{"{month}"}</code> mit der auf der <a href="/settings">Einstellungsseite</a>{" "}
                festgelegten Schrift, sofern konfiguriert. Alles andere (Daten, Erwähnungen) wird immer unformatiert
                dargestellt.
              </div>
              <button onClick={handleSyncAnchor} disabled={syncingAnchor || !channelId} style={{ marginTop: 8 }}>
                {syncingAnchor ? "Wird neu generiert…" : "Nachricht jetzt neu generieren"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
