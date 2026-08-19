import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import type { GeneralSettings, Me } from "../types";

export default function Settings({ me }: { me: Me }) {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    api
      .generalSettings()
      .then(setSettings)
      .catch((err) => showError(errorMessage(err)));
  }, [showError]);

  async function update(leaveNotificationsEnabled: boolean) {
    try {
      const updated = await api.updateGeneralSettings({ leaveNotificationsEnabled });
      setSettings(updated);
      showSuccess("Saved.");
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  return (
    <div>
      <h2>Settings</h2>

      <div className="card-grid">
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
    </div>
  );
}
