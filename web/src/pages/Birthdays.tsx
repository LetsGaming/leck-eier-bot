import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import SearchableSelect from "../components/SearchableSelect";
import { useToast } from "../components/ToastContext";
import type { BirthdayEntry, Channel, UpcomingBirthday } from "../types";

function relativeDay(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
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
      showSuccess("Saved.");
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
      showSuccess("Anchor message regenerated.");
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
      showError("Enter a day and month.");
      return;
    }
    if (!draft.userId.trim() && !draft.name.trim()) {
      showError("Provide a Discord user ID or a name.");
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
      showSuccess("Saved.");
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
      showSuccess("Removed.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  // Ties (multiple dates the same number of days out) all count as "next up".
  const nextUp = upcoming && upcoming.length > 0 ? upcoming.filter((b) => b.daysUntil === upcoming[0]!.daysUntil) : [];

  return (
    <div>
      <h2>Birthdays</h2>

      <div className="card-grid">
        <div className="card">
          <h2>Message template</h2>
          <div className="field">
            <label htmlFor="template">Template</label>
            <textarea id="template" value={template} onChange={(e) => setTemplate(e.target.value)} />
            <div className="hint">
              Placeholders: <code>{"{userMention}"}</code>, <code>{"{userNick}"}</code>, <code>{"{everyoneMention}"}</code>
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={announcementUseFont}
              onChange={(e) => setAnnouncementUseFont(e.target.checked)}
            />
            Use font
          </label>
          <div className="hint">
            Styles the announcement with the font set on the <a href="/settings">Settings page</a>, if one's
            configured.
          </div>
          <button onClick={handlePreview}>Preview</button>
          {preview && (
            <div className="preview-box" style={{ marginTop: 12 }}>
              {preview}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Anchor message &amp; daily announcement</h2>
          <p className="muted small">
            The bot posts and maintains the birthday list itself in the channel below (splitting it across more than
            one message if the full list ever outgrows Discord's 2000-character limit), and posts the daily
            announcement there too.
          </p>
          <div className="field">
            <label htmlFor="channel">Channel</label>
            <SearchableSelect
              id="channel"
              value={channelId}
              onChange={setChannelId}
              placeholder="Search channels…"
              emptyLabel="— none —"
              options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
            />
          </div>
          <div className="field">
            <label htmlFor="cron">Daily job schedule (cron)</label>
            <input id="cron" type="text" value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} />
            <div className="hint">
              Default: <code>0 0 * * *</code> (midnight, server time)
            </div>
          </div>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="card">
          <h2>Self-registration</h2>
          <p className="muted small">
            Members can register their own birthday with <code>/setmybirthday</code>, or by just posting a date
            (e.g. <code>15.03</code>) in the birthday channel above — the bot parses it, saves it, and deletes the
            message.
          </p>
          <div className="field">
            <label htmlFor="modChannel">Registration notifications channel</label>
            <SearchableSelect
              id="modChannel"
              value={modChannelId}
              onChange={setModChannelId}
              placeholder="Search channels…"
              emptyLabel="— none —"
              options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
            />
            <div className="hint">Where the bot posts a heads-up whenever someone registers. Optional.</div>
          </div>
          <div className="field">
            <label htmlFor="anchorIntro">Intro note</label>
            <textarea
              id="anchorIntro"
              value={anchorIntro}
              onChange={(e) => setAnchorIntro(e.target.value)}
              placeholder="e.g. Use /setmybirthday or post your date here to register!"
            />
            <div className="hint">
              Shown once above all the months — unlike the template below, never repeated and never font-styled.
              Leave blank to show nothing.
            </div>
          </div>
          <div className="field">
            <label htmlFor="anchorTemplate">Month heading template</label>
            <textarea id="anchorTemplate" value={anchorTemplate} onChange={(e) => setAnchorTemplate(e.target.value)} />
            <div className="hint">
              Placeholders: <code>{"{month}"}</code> (styled with the font below, if set), <code>{"{entries}"}</code>{" "}
              (the dates/mentions for that month — always plain, so they render correctly on Discord).
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={anchorUseFont} onChange={(e) => setAnchorUseFont(e.target.checked)} />
            Use font for month headings
          </label>
          <div className="hint">
            Styles <code>{"{month}"}</code> with the font set on the <a href="/settings">Settings page</a>, if
            one's configured. Everything else (dates, mentions) always renders plain.
          </div>
          <button onClick={handleSyncAnchor} disabled={syncingAnchor || !channelId} style={{ marginTop: 8 }}>
            {syncingAnchor ? "Regenerating…" : "Regenerate message now"}
          </button>
        </div>
      </div>

      {!upcoming ? (
        <div className="loading">Loading…</div>
      ) : (
        <>
          {nextUp.length > 0 && (
            <div className="stat-grid">
              {nextUp.map((b) => (
                <div className="stat-tile" key={b.dateKey}>
                  <div className="label">Next up — {relativeDay(b.daysUntil)}</div>
                  <div className="value" style={{ fontSize: 18 }}>
                    {b.dateKey}
                  </div>
                  <div className="muted">{b.entries.map(entryLabel).join(", ")}</div>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h2>Registered birthdays</h2>
            <p className="muted small">
              Add, edit, or remove an entry here — the anchor message updates automatically. Entries marked
              "self-registered" were added by the member themselves and can still be corrected here if needed.
            </p>

            <div className="row" style={{ alignItems: "flex-end", marginBottom: 12 }}>
              <div className="field" style={{ maxWidth: 90 }}>
                <label htmlFor="entryDay">Day</label>
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
                <label htmlFor="entryMonth">Month</label>
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
                <label htmlFor="entryUserId">Discord user ID</label>
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
                  placeholder="optional if a user ID is set"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <button className="primary" onClick={handleSaveEntry} disabled={savingEntry}>
                {draft.id === null ? "Add" : "Save edit"}
              </button>
              {draft.id !== null && <button onClick={() => setDraft(EMPTY_DRAFT)}>Cancel</button>}
            </div>

            {upcoming.length === 0 ? (
              <p className="muted">No birthdays registered yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="stack-on-mobile">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Person</th>
                      <th>Source</th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.flatMap((b) =>
                      b.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td data-label="Date">{b.dateKey}</td>
                          <td data-label="Person">{entryLabel(entry)}</td>
                          <td data-label="Source">
                            <span className={`badge ${entry.source === "self" ? "ok" : "warn"}`}>
                              {entry.source === "self" ? "self-registered" : "list"}
                            </span>
                          </td>
                          <td className="muted stack-plain">{relativeDay(b.daysUntil)}</td>
                          <td className="stack-plain">
                            <button onClick={() => startEdit(entry, b.dateKey)}>Edit</button>{" "}
                            <button onClick={() => handleDeleteEntry(entry.id)}>Delete</button>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
