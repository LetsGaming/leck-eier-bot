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
  const [modChannelId, setModChannelId] = useState("");
  const [selfRegistrationEnabled, setSelfRegistrationEnabled] = useState(true);
  const [botManagesAnchor, setBotManagesAnchor] = useState(false);
  const [anchorTemplate, setAnchorTemplate] = useState("");
  const [anchorUseFont, setAnchorUseFont] = useState(false);
  const [announcementUseFont, setAnnouncementUseFont] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingAnchor, setSyncingAnchor] = useState(false);
  const { showError, showSuccess } = useToast();

  function loadAll() {
    Promise.all([api.birthdaySettings(), api.channels(), api.upcomingBirthdays()])
      .then(([s, c, u]) => {
        setSettings(s);
        setTemplate(s.template);
        setChannelId(s.channelId ?? "");
        setMessageId(s.messageId ?? "");
        setCronExpr(s.cron);
        setModChannelId(s.modChannelId ?? "");
        setSelfRegistrationEnabled(s.selfRegistrationEnabled);
        setBotManagesAnchor(s.botManagesAnchor);
        setAnchorTemplate(s.anchorTemplate);
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
      const updated = await api.updateBirthdaySettings({
        template,
        channelId: channelId || null,
        messageId: messageId || null,
        cron: cronExpr,
        modChannelId: modChannelId || null,
        selfRegistrationEnabled,
        botManagesAnchor,
        anchorTemplate,
        anchorUseFont,
        announcementUseFont,
      });
      setSettings(updated);
      setMessageId(updated.messageId ?? "");
      if (botManagesAnchor) {
        // The server already kicked off a sync in the background; wait for
        // our own explicit call so the message id shown below is current
        // rather than possibly stale until the next reload.
        await api.syncBirthdayAnchor().catch(() => undefined);
        const fresh = await api.birthdaySettings();
        setSettings(fresh);
        setMessageId(fresh.messageId ?? "");
      }
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

  async function handleSyncAnchor() {
    setSyncingAnchor(true);
    try {
      await api.syncBirthdayAnchor();
      setSettings(await api.birthdaySettings());
      setUpcoming(await api.upcomingBirthdays());
      showSuccess("Anchor message regenerated.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSyncingAnchor(false);
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
              <input
                id="messageId"
                type="text"
                value={messageId}
                onChange={(e) => setMessageId(e.target.value)}
                disabled={botManagesAnchor}
              />
              {botManagesAnchor && (
                <div className="hint">Managed automatically by the bot — see "Bot-managed message" below.</div>
              )}
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
          {!botManagesAnchor && (
            <button onClick={handleRefresh} disabled={!settings?.channelId || !settings?.messageId}>
              Refresh from message
            </button>
          )}
        </div>

        <div className="card">
          <h2>Self-registration</h2>
          <p className="muted small">
            Members can register their own birthday with <code>/setmybirthday</code>, or by just posting a date
            (e.g. <code>15.03</code>) in the birthday channel above — the bot parses it, saves it, and deletes the
            message. Self-registered birthdays are kept separately from the announcement list, so a "Refresh from
            message" above never overwrites them.
          </p>
          <label className="switch">
            <input
              type="checkbox"
              checked={selfRegistrationEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setSelfRegistrationEnabled(enabled);
                if (!enabled) setBotManagesAnchor(false);
              }}
            />
            Enable self-registration
          </label>
          {!selfRegistrationEnabled && (
            <p className="hint">
              Off: <code>/setmybirthday</code> and channel messages are ignored — whoever posted the anchor message
              has to edit it themselves, like before this feature existed.
            </p>
          )}
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
            <div className="hint">
              Where the bot posts a heads-up whenever someone registers. Optional — saved with the button above.
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Bot-managed message</h2>
          <p className="muted small">
            Instead of an admin hand-maintaining the announcement message, the bot can post and keep it updated
            itself — re-rendering it from the current birthday list after every registration.
          </p>
          <label className="switch">
            <input
              type="checkbox"
              checked={botManagesAnchor}
              disabled={!selfRegistrationEnabled}
              onChange={(e) => setBotManagesAnchor(e.target.checked)}
            />
            Let the bot manage the announcement message
          </label>
          {!selfRegistrationEnabled && <p className="hint">Requires self-registration to be enabled above.</p>}

          {botManagesAnchor && (
            <>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="anchorTemplate">Month heading template</label>
                <textarea
                  id="anchorTemplate"
                  value={anchorTemplate}
                  onChange={(e) => setAnchorTemplate(e.target.value)}
                />
                <div className="hint">
                  Placeholders: <code>{"{month}"}</code> (styled with the font below, if set), <code>{"{entries}"}</code>{" "}
                  (the dates/mentions for that month — always plain, so they render correctly on Discord).
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={anchorUseFont}
                  onChange={(e) => setAnchorUseFont(e.target.checked)}
                />
                Use font for month headings
              </label>
              <div className="hint">
                Styles <code>{"{month}"}</code> with the font set on the <a href="/settings">Settings page</a>, if
                one's configured. Everything else (dates, mentions) always renders plain.
              </div>
              <button onClick={handleSyncAnchor} disabled={syncingAnchor || !channelId}>
                {syncingAnchor ? "Regenerating…" : "Regenerate message now"}
              </button>
            </>
          )}
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
                    <th>Source</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.flatMap((b) =>
                    b.entries.map((entry, i) => (
                      <tr key={`${b.dateKey}-${i}`}>
                        <td>{b.dateKey}</td>
                        <td>{entryLabel(entry)}</td>
                        <td>
                          <span className={`badge ${entry.source === "self" ? "ok" : "warn"}`}>
                            {entry.source === "self" ? "self-registered" : "list"}
                          </span>
                        </td>
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
