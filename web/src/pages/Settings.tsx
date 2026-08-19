import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import type { GeneralSettings, Me } from "../types";

export default function Settings({ me }: { me: Me }) {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .generalSettings()
      .then(setSettings)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function update(leaveNotificationsEnabled: boolean) {
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateGeneralSettings({ leaveNotificationsEnabled });
      setSettings(updated);
      setNotice("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div>
      <h2>Settings</h2>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="card">
        <h2>General</h2>
        {!settings ? (
          <div className="loading">Loading…</div>
        ) : (
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.leaveNotificationsEnabled}
              onChange={(e) => update(e.target.checked)}
            />
            DM the server owner when a member leaves voluntarily
          </label>
        )}
      </div>

      <div className="card">
        <h2>Session</h2>
        <p>
          Signed in as <strong>{me.username}</strong> ({me.userId}){me.isOwner ? " — bot owner" : ""}
        </p>
      </div>
    </div>
  );
}
