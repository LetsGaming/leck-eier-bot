import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../components/ConfirmContext";
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
  const confirmDialog = useConfirm();

  // Bulk "set minimum permission tier" — row selection plus the names
  // currently mid-batch-update, mirroring `pending` above but for many rows
  // at once.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState<WebRole>("admin");
  const [pendingNames, setPendingNames] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const filteredCommands = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands ?? [];
    return (commands ?? []).filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
  })();

  // "Alle auswählen" selects/counts against the currently filtered rows, not
  // the full list — matching what's actually visible and clickable.
  const commandNames = filteredCommands.map((c) => c.name);
  const allSelected = commandNames.length > 0 && commandNames.every((n) => selected.has(n));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && !allSelected;
    }
  }, [selected, allSelected]);

  function toggleSelect(name: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(checked ? new Set(commandNames) : new Set());
  }

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

  async function handleBulkApply() {
    const names = Array.from(selected);
    if (names.length === 0) return;

    const ok = await confirmDialog({
      title: "Mindest-Berechtigungsstufe setzen",
      message: `${names.length} Befehle werden auf "${WEB_ROLE_LABELS[bulkTier]}" gesetzt.`,
      confirmLabel: "Anwenden",
    });
    if (!ok) return;

    setPendingNames(new Set(names));
    try {
      const results = await Promise.allSettled(
        names.map((name) => api.updateCommand(name, { permissionGate: { mode: "tier", tier: bulkTier } })),
      );

      const updated = new Map<string, CommandDef>();
      const failed: string[] = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") updated.set(names[i], result.value);
        else failed.push(names[i]);
      });

      if (updated.size > 0) {
        setCommands((prev) => prev?.map((c) => updated.get(c.name) ?? c) ?? null);
      }

      if (failed.length === 0) {
        showSuccess(`${updated.size} Befehle aktualisiert.`);
        setSelected(new Set());
      } else if (updated.size === 0) {
        showError(`Aktualisierung fehlgeschlagen für: ${failed.map((n) => `/${n}`).join(", ")}`);
      } else {
        showError(`${updated.size} aktualisiert, fehlgeschlagen für: ${failed.map((n) => `/${n}`).join(", ")}`);
        // Keep only the failures selected so retrying the batch is a single click.
        setSelected(new Set(failed));
      }
    } finally {
      setPendingNames(new Set());
    }
  }

  function handleRoleChange(c: CommandDef, roleId: string) {
    clearPendingMode(c.name);
    updatePermissionGate(c.name, { mode: "role", roleId });
  }

  function isRowBusy(name: string): boolean {
    return pending === name || pendingNames.has(name);
  }

  const columns: BaseTableColumn<CommandDef>[] = [
    {
      key: "select",
      label: (
        <input
          type="checkbox"
          ref={selectAllRef}
          aria-label="Alle Befehle auswählen"
          checked={allSelected}
          disabled={commandNames.length === 0}
          onChange={(e) => toggleSelectAll(e.target.checked)}
        />
      ),
      dataLabel: "Auswählen",
      render: (c) => (
        <input
          type="checkbox"
          aria-label={`/${c.name} auswählen`}
          checked={selected.has(c.name)}
          disabled={isRowBusy(c.name)}
          onChange={(e) => toggleSelect(c.name, e.target.checked)}
        />
      ),
    },
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
      className: "stack-column",
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
              disabled={isRowBusy(c.name)}
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
                disabled={isRowBusy(c.name)}
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
                disabled={isRowBusy(c.name)}
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
            disabled={isRowBusy(c.name)}
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
            disabled={isRowBusy(c.name)}
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
          <>
            {commands.length > 6 && (
              <div className="field">
                <input
                  type="text"
                  aria-label="Befehle durchsuchen"
                  placeholder="Befehle durchsuchen…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            {selected.size > 0 && (
              <div className="bulk-bar">
                <span>{selected.size} ausgewählt</span>
                <div className="bulk-bar-actions">
                  <select
                    aria-label="Ziel-Mindest-Berechtigungsstufe für Auswahl"
                    value={bulkTier}
                    disabled={pendingNames.size > 0}
                    onChange={(e) => setBulkTier(e.target.value as WebRole)}
                  >
                    <option value="bot-owner">{WEB_ROLE_LABELS["bot-owner"]}</option>
                    <option value="guild-owner">{WEB_ROLE_LABELS["guild-owner"]}</option>
                    <option value="admin">{WEB_ROLE_LABELS.admin}</option>
                  </select>
                  <button className="primary" disabled={pendingNames.size > 0} onClick={handleBulkApply}>
                    Anwenden
                  </button>
                  <button disabled={pendingNames.size > 0} onClick={() => setSelected(new Set())}>
                    Auswahl aufheben
                  </button>
                </div>
              </div>
            )}
            {filteredCommands.length === 0 ? (
              <p className="muted">Keine Befehle gefunden.</p>
            ) : (
              <BaseTable columns={columns} rows={filteredCommands} rowKey={(c) => c.name} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
