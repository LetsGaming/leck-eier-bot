import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import type { CommandDef } from "../types";

const PERMISSION_LABELS: Record<string, string> = {
  none: "keine",
  admin: "admin",
  owner: "besitzer",
};

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
      <h2>Befehle</h2>
      <p className="muted">
        Das Deaktivieren eines Befehls entfernt ihn innerhalb einer Minute aus Discords Slash-Befehlsliste — kein Neustart nötig.
      </p>
      <div className="card">
        {!commands ? (
          <div className="loading">Wird geladen…</div>
        ) : (
          <div className="table-scroll">
            <table className="stack-on-mobile">
              <thead>
                <tr>
                  <th>Befehl</th>
                  <th>Beschreibung</th>
                  <th>Berechtigung</th>
                  <th>Aktiviert</th>
                  <th>Nur auf Server</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((c) => (
                  <tr key={c.name}>
                    <td data-label="Befehl">/{c.name}</td>
                    <td className="muted" data-label="Beschreibung">
                      {c.description}
                    </td>
                    <td data-label="Berechtigung">{PERMISSION_LABELS[c.permission ?? "none"] ?? c.permission}</td>
                    <td data-label="Aktiviert">
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        disabled={pending === c.name}
                        onChange={(e) => toggle(c.name, "enabled", e.target.checked)}
                      />
                    </td>
                    <td data-label="Nur auf Server">
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
