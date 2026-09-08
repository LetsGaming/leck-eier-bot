import { useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import SearchableSelect from "../components/SearchableSelect";
import BaseTable, { type BaseTableColumn } from "../components/BaseTable";
import { useCommands } from "../hooks/useCommands";
import { defaultGateFor, WEB_ROLE_LABELS } from "../types";
import type { CommandDef, PermissionGate, RoleOption, WebRole } from "../types";

type GateMode = PermissionGate["mode"];

const MODE_LABELS: Record<GateMode, string> = {
  everyone: "Jeder",
  role: "Bestimmte Rolle",
  tier: "Mindest-Berechtigungsstufe",
};

function gateLabel(gate: PermissionGate, roles: RoleOption[]): string {
  switch (gate.mode) {
    case "everyone":
      return "Jeder";
    case "tier":
      return WEB_ROLE_LABELS[gate.tier];
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
  const { showError, showSuccess } = useToast();

  async function toggle(name: string, field: "enabled" | "guildOnly", value: boolean) {
    setPending(name);
    try {
      const updated = await api.updateCommand(name, { [field]: value });
      setCommands((prev) => prev?.map((c) => (c.name === name ? updated : c)) ?? null);
      showSuccess("Gespeichert.");
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
      showSuccess("Gespeichert.");
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

  const columns: BaseTableColumn<CommandDef>[] = [
    {
      key: "name",
      label: "Befehl",
      accessor: (c) => c.name,
      render: (c) => `/${c.name}`,
    },
    {
      key: "description",
      label: "Beschreibung",
      accessor: (c) => c.description,
      className: "muted",
      render: (c) => c.description,
    },
    {
      key: "permission",
      label: "Berechtigung",
      dataLabel: "Berechtigung",
      hint: (
        <>
          "Bestimmte Rolle" erlaubt genau einer Discord-Rolle deines Servers, den Befehl zu nutzen.
          "Mindest-Berechtigungsstufe" ist davon unabhängig — eine eigene, dreistufige Rangfolge dieses Bots
          (Bot-Besitzer &gt; Server-Besitzer &gt; Admin), losgelöst von Discord-Rollen: Wer die gewählte Stufe oder
          eine höhere hat, darf den Befehl nutzen.
        </>
      ),
      render: (c) => {
        const eff = effectiveGate(c);
        const mode = pendingMode[c.name] ?? eff.mode;
        return (
          <>
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
                aria-label={`/${c.name} Mindest-Berechtigungsstufe`}
                value={eff.mode === "tier" ? eff.tier : "admin"}
                disabled={pending === c.name}
                onChange={(e) => handleTierChange(c, e.target.value as WebRole)}
              >
                <option value="bot-owner">{WEB_ROLE_LABELS["bot-owner"]}</option>
                <option value="guild-owner">{WEB_ROLE_LABELS["guild-owner"]}</option>
                <option value="admin">{WEB_ROLE_LABELS.admin}</option>
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
          </>
        );
      },
    },
    {
      key: "enabled",
      label: "Aktiviert",
      accessor: (c) => (c.enabled ? 1 : 0),
      render: (c) => (
        <label className="switch">
          <input
            type="checkbox"
            aria-label={`/${c.name} aktiviert`}
            checked={c.enabled}
            disabled={pending === c.name}
            onChange={(e) => toggle(c.name, "enabled", e.target.checked)}
          />
        </label>
      ),
    },
    {
      key: "guildOnly",
      label: "Nur auf Server",
      accessor: (c) => (c.guildOnly ? 1 : 0),
      hint: "Wenn deaktiviert, kann der Befehl auch per Direktnachricht an den Bot verwendet werden.",
      render: (c) => (
        <label className="switch">
          <input
            type="checkbox"
            aria-label={`/${c.name} nur auf Server`}
            checked={c.guildOnly}
            disabled={pending === c.name}
            onChange={(e) => toggle(c.name, "guildOnly", e.target.checked)}
          />
        </label>
      ),
    },
  ];

  return (
    <div>
      <h2>Befehle</h2>
      <p className="muted small">
        Das Deaktivieren eines Befehls entfernt ihn innerhalb einer Minute aus Discords Slash-Befehlsliste — kein Neustart nötig.
      </p>
      <div className="card">
        {!commands ? (
          <div className="loading">Wird geladen…</div>
        ) : (
          <BaseTable columns={columns} rows={commands} rowKey={(c) => c.name} />
        )}
      </div>
    </div>
  );
}
