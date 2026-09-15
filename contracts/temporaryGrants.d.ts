import type { WebRole } from "./webRole.js";

/** One active time-boxed elevation grant — see `src/db/temporaryGrantsRepository.ts`. */
export interface TemporaryGrant {
  id: number;
  userId: string;
  role: WebRole;
  expiresAt: string;
  grantedByUserId: string;
  grantedByUsername: string;
  grantedAt: string;
  revokedAt: string | null;
}
