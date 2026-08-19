import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import SearchableSelect from "../components/SearchableSelect";
import { useToast } from "../components/ToastContext";
import type { BirthdaySettings, Channel, UpcomingBirthday } from "../types";

function relativeDay(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function entryLabel(entry: { name: string | null; mention: string }): string {
  return entry.name ?? entry.mention;
}

export default function Birthdays() {
  const [settings, setSettings] = useState<BirthdaySettings | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingBirthday[] | null>(null);
  const [template, setTemplate] = useState("");
  const [channelId, setChannelId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { showError, showSuccess } = useToast();

  function loadAll() {
    Promise.all([api.birthdaySettings(), api.channels(), api.upcomingBirthdays()])
      .then(([s, c, u]) => {
        setSettings(s);
        setTemplate(s.template);
        setChannelId(s.channelId ?? "");
        setMessageId(s.messageId ?? "");
        setCronExpr(s.cron);
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
      const updated = await api.updateBirthdaySettings({
        template,
        channelId: channelId || null,
        messageId: messageId || null,
        cron: cronExpr,
      });
      setSettings(updated);
      showSuccess("Saved.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    try {
      await api.refreshBirthdayList();
      setUpcoming(await api.upcomingBirthdays());
      showSuccess("Birthday list re-scanned from the announcement message.");
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
          <button onClick={handlePreview}>Preview</button>
          {preview && (
            <div className="preview-box" style={{ marginTop: 12 }}>
              {preview}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Announcement list</h2>
          <div className="row">
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
              <label htmlFor="messageId">Anchor message ID</label>
              <input id="messageId" type="text" value={messageId} onChange={(e) => setMessageId(e.target.value)} />
            </div>
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
          <button onClick={handleRefresh} disabled={!settings?.channelId || !settings?.messageId}>
            Refresh from message
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
            {upcoming.length === 0 ? (
              <p className="muted">No birthdays parsed yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Person</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.flatMap((b) =>
                    b.entries.map((entry, i) => (
                      <tr key={`${b.dateKey}-${i}`}>
                        <td>{b.dateKey}</td>
                        <td>{entryLabel(entry)}</td>
                        <td className="muted">{relativeDay(b.daysUntil)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
