import type { PermissionGate } from "./permissionGate.js";

/**
 * One gated dashboard write feature, as exposed by `GET /api/access-control`
 * and `PATCH /api/access-control/:key` — see `FEATURES` in
 * `src/web/accessControl.ts`. `override` is `null` when no override is set,
 * in which case `defaultGate` is the effective gate.
 */
export interface AccessControlFeature {
  key: string;
  label: string;
  defaultGate: PermissionGate;
  override: PermissionGate | null;
}
