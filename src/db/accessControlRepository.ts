import { db } from "./index.js";
import type { PermissionGate } from "../types.js";

interface OverrideRow {
  gate_json: string;
}

const selectStmt = db.prepare<[string], OverrideRow>(
  "SELECT gate_json FROM dashboard_access_overrides WHERE feature_key = ?",
);
const selectAllStmt = db.prepare<[], { feature_key: string; gate_json: string }>(
  "SELECT feature_key, gate_json FROM dashboard_access_overrides",
);
const upsertStmt = db.prepare<{ featureKey: string; gateJson: string }>(
  `INSERT INTO dashboard_access_overrides (feature_key, gate_json) VALUES (@featureKey, @gateJson)
   ON CONFLICT(feature_key) DO UPDATE SET gate_json = @gateJson`,
);
const deleteStmt = db.prepare<[string]>("DELETE FROM dashboard_access_overrides WHERE feature_key = ?");

/** `null` = no override set for this feature — the caller falls back to its code-declared default gate. */
export function getAccessOverride(featureKey: string): PermissionGate | null {
  const row = selectStmt.get(featureKey);
  return row ? (JSON.parse(row.gate_json) as PermissionGate) : null;
}

export function getAllAccessOverrides(): Record<string, PermissionGate> {
  const out: Record<string, PermissionGate> = {};
  for (const row of selectAllStmt.all()) {
    out[row.feature_key] = JSON.parse(row.gate_json) as PermissionGate;
  }
  return out;
}

/** `gate === null` clears the override (falls back to the feature's default gate again). */
export function setAccessOverride(featureKey: string, gate: PermissionGate | null): void {
  if (gate === null) {
    deleteStmt.run(featureKey);
    return;
  }
  upsertStmt.run({ featureKey, gateJson: JSON.stringify(gate) });
}
