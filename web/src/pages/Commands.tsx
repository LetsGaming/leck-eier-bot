import { useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import SearchableSelect from "../components/SearchableSelect";
import { useCommands } from "../hooks/useCommands";
import { defaultGateFor } from "../types";
import type { CommandDef, PermissionGate, RoleOption, WebRole } from "../types";

type GateMode = PermissionGate["mode"];

const TIER_LABELS: Record<WebRole, string> = {
  "bot-owner": "Bot-Besitzer",
  "guild-owner": "Bot- oder Server-Besitzer",
  admin: "Bot-Besitzer, Server-Besitzer oder Admin",
};

const MODE_LABELS: Record<GateMode, string> = {
  everyone: "Jeder",
  role: "Rolle",
  tier: "Mindest-Stufe",
};

function gateLabel(gate: PermissionGate, roles: RoleOption[]): string {
  switch (gate.mode) {
    case "everyone":
      return "Jeder";
    case "tier":
      return TIER_LABELS[gate.tier];
    case "role": {
      const role = roles.find((r) => r.id === gate.roleId);
      return role ? `Rolle: ${role.name}` : "Rolle (unbekannt)";
    }
  }
}

function effectiveGate(c: CommandDef): PermissionGate {
  return c.permissionGate ?? defaultGateFor(c.permission);
}

export default function Commands() {
  const { commands, setCommands, roles } = useCommands();
  const [pending, setPending] = useState<string | null>(null);
  // Tracks a command mid-switch to "role" mode before a role has actually
  // been picked/saved — the underlying gate is still "everyone"/"tier" at
  // that point, so the select's displayed mode would otherwise snap back.
  const [pendingMode, setPendingMode] = useState<Record<string, GateMode>>({});
  const { showError } = useToast();

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

  async function updatePermissionGate(name: string, gate: PermissionGate) {
    setPending(name);
    try {
      const updated = await api.updateCommand(name, { permissionGate: gate });
      setCommands((prev) => prev?.map((c) => (c.name === name ? updated : c)) ?? null);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  function clearPendingMode(name: string) {
    setPendingMode((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function handleModeChange(c: CommandDef, mode: GateMode) {
    if (mode === "role") {
      // Don't save yet — wait for an actual role to be picked below.
      setPendingMode((prev) => ({ ...prev, [c.name]: "role" }));
      return;
    }
    clearPendingMode(c.name);
    if (mode === "everyone") {
      updatePermissionGate(c.name, { mode: "everyone" });
    } else {
      const eff = effectiveGate(c);
      const tier = eff.mode === "tier" ? eff.tier : "admin";
      updatePermissionGate(c.name, { mode: "tier", tier });
    }
  }

  function handleTierChange(c: CommandDef, tier: WebRole) {
    updatePermissionGate(c.name, { mode: "tier", tier });
  }

  function handleRoleChange(c: CommandDef, roleId: string) {
    clearPendingMode(c.name);
    updatePermissionGate(c.name, { mode: "role", roleId });
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
                  <th>
                    Nur auf Server
                    <p className="muted small">
                      Wenn deaktiviert, kann der Befehl auch per Direktnachricht an den Bot verwendet werden.
                    </p>
                  </th>
                </tr>
              </thead>
              <tbody>
                {commands.map((c) => {
                  const eff = effectiveGate(c);
                  const mode = pendingMode[c.name] ?? eff.mode;
                  return (
                    <tr key={c.name}>
                      <td data-label="Befehl">/{c.name}</td>
                      <td className="muted" data-label="Beschreibung">
                        {c.description}
                      </td>
                      <td data-label="Berechtigung">
                        <select
                          aria-label={`/${c.name} Berechtigungsmodus`}
                          value={mode}
                          disabled={pending === c.name}
                          onChange={(e) => handleModeChange(c, e.target.value as GateMode)}
                        >
                          <option value="everyone">{MODE_LABELS.everyone}</option>
                          <option value="role">{MODE_LABELS.role}</option>
                          <option value="tier">{MODE_LABELS.tier}</option>
                        </select>
                        {mode === "tier" && (
                          <select
                            aria-label={`/${c.name} Mindest-Stufe`}
                            value={eff.mode === "tier" ? eff.tier : "admin"}
                            disabled={pending === c.name}
                            onChange={(e) => handleTierChange(c, e.target.value as WebRole)}
                          >
                            <option value="bot-owner">{TIER_LABELS["bot-owner"]}</option>
                            <option value="guild-owner">{TIER_LABELS["guild-owner"]}</option>
                            <option value="admin">{TIER_LABELS.admin}</option>
                          </select>
                        )}
                        {mode === "role" && (
                          <SearchableSelect
                            id={`perm-role-${c.name}`}
                            value={eff.mode === "role" ? eff.roleId : ""}
                            onChange={(v) => handleRoleChange(c, v)}
                            placeholder="Rollen durchsuchen…"
                            emptyLabel="— Rolle wählen —"
                            options={roles.map((r) => ({ value: r.id, label: r.name }))}
                            disabled={pending === c.name}
                          />
                        )}
                        <p className="muted small">Standard: {gateLabel(defaultGateFor(c.permission), roles)}</p>
                      </td>
                      <td data-label="Aktiviert">
                        <label className="switch">
                          <input
                            type="checkbox"
                            aria-label={`/${c.name} aktiviert`}
                            checked={c.enabled}
                            disabled={pending === c.name}
                            onChange={(e) => toggle(c.name, "enabled", e.target.checked)}
                          />
                        </label>
                      </td>
                      <td data-label="Nur auf Server">
                        <label className="switch">
                          <input
                            type="checkbox"
                            aria-label={`/${c.name} nur auf Server`}
                            checked={c.guildOnly}
                            disabled={pending === c.name}
                            onChange={(e) => toggle(c.name, "guildOnly", e.target.checked)}
                          />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
