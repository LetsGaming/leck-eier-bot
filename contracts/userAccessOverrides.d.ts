import type { WebRole } from "./webRole.js";

/**
 * One row of `GET /api/user-access-overrides` — see
 * `src/db/userAccessOverridesRepository.ts`. `role` is set for a 'grant',
 * null for a 'block'.
 */
export interface UserAccessOverride {
  userId: string;
  mode: "grant" | "block";
  role: WebRole | null;
  note: string | null;
  setByUserId: string;
  setByUsername: string;
  setAt: string;
}
