import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import type { Status } from "../types";

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

export default function Overview() {
  const [status, setStatus] = useState<Status | null>(null);
  const { showError } = useToast();

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((err) => showError(errorMessage(err)));
  }, [showError]);

  return (
    <div>
      <h2>Overview</h2>
      {!status ? (
        <div className="loading">Loading…</div>
      ) : (
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="label">Bot</div>
            <div className="value">{status.botTag ?? "—"}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Uptime</div>
            <div className="value">{formatUptime(status.uptimeMs)}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Guild</div>
            <div className="value">{status.guildName ?? "—"}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Members</div>
            <div className="value">{status.guildMemberCount ?? "—"}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Cached members</div>
            <div className="value">{status.cachedMemberCount}</div>
          </div>
          <div className="stat-tile">
            <div className="label">Reaction-role panels</div>
            <div className="value">{status.reactionRolePanelCount}</div>
          </div>
        </div>
      )}
      <div className="card">
        <h2>Quick links</h2>
        <p>
          <Link to="/reaction-roles">Manage reaction-role panels</Link>
        </p>
        <p>
          <Link to="/birthdays">Edit the birthday template &amp; schedule</Link>
        </p>
        <p>
          <Link to="/commands">Enable or disable commands</Link>
        </p>
      </div>
    </div>
  );
}
