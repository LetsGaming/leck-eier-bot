import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import type { CommandDef } from "../types";

export default function Commands() {
  const [commands, setCommands] = useState<CommandDef[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const { showError } = useToast();

  useEffect(() => {
    api
      .commands()
      .then(setCommands)
      .catch((err) => showError(errorMessage(err)));
  }, [showError]);

  async function toggle(name: string, field: "enabled" | "guildOnly", value: boolean) {
    setPending(name);
    try {
      const updated = await api.updateCommand(name, { [field]: value });
      setCommands((prev) => prev?.map((c) => (c.name === name ? updated : c)) ?? null);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <h2>Commands</h2>
      <p className="muted">
        Disabling a command removes it from Discord's slash-command list within a minute — no restart needed.
      </p>
      <div className="card">
        {!commands ? (
          <div className="loading">Loading…</div>
        ) : (
          <div className="table-scroll">
            <table className="stack-on-mobile">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Description</th>
                  <th>Permission</th>
                  <th>Enabled</th>
                  <th>Guild only</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((c) => (
                  <tr key={c.name}>
                    <td data-label="Command">/{c.name}</td>
                    <td className="muted" data-label="Description">
                      {c.description}
                    </td>
                    <td data-label="Permission">{c.permission ?? "none"}</td>
                    <td data-label="Enabled">
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        disabled={pending === c.name}
                        onChange={(e) => toggle(c.name, "enabled", e.target.checked)}
                      />
                    </td>
                    <td data-label="Guild only">
                      <input
                        type="checkbox"
                        checked={c.guildOnly}
                        disabled={pending === c.name}
                        onChange={(e) => toggle(c.name, "guildOnly", e.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
