import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import type { BirthdaysByDate, BirthdaySettings, Channel } from "../types";

export default function Birthdays() {
  const [settings, setSettings] = useState<BirthdaySettings | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdaysByDate | null>(null);
  const [template, setTemplate] = useState("");
  const [channelId, setChannelId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.birthdaySettings(), api.channels(), api.birthdays()])
      .then(([s, c, b]) => {
        setSettings(s);
        setTemplate(s.template);
        setChannelId(s.channelId ?? "");
        setMessageId(s.messageId ?? "");
        setCronExpr(s.cron);
        setChannels(c);
        setBirthdays(b);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function handlePreview() {
    setError(null);
    try {
      const { rendered } = await api.previewBirthday(template);
      setPreview(rendered);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateBirthdaySettings({
        template,
        channelId: channelId || null,
        messageId: messageId || null,
        cron: cronExpr,
      });
      setSettings(updated);
      setNotice("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    setError(null);
    setNotice(null);
    try {
      await api.refreshBirthdayList();
      setBirthdays(await api.birthdays());
      setNotice("Birthday list re-scanned from the announcement message.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const sortedDates = birthdays ? Object.keys(birthdays).sort() : [];

  return (
    <div>
      <h2>Birthdays</h2>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

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
            <select id="channel" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">— none —</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
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

      <div className="card">
        <h2>Upcoming birthdays</h2>
        {!birthdays ? (
          <div className="loading">Loading…</div>
        ) : sortedDates.length === 0 ? (
          <p className="muted">No birthdays parsed yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Person</th>
              </tr>
            </thead>
            <tbody>
              {sortedDates.flatMap((date) =>
                birthdays[date]!.map((entry, i) => (
                  <tr key={`${date}-${i}`}>
                    <td>{date}</td>
                    <td>{entry.name ?? entry.mention}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
