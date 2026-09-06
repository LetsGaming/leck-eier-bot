/**
 * Response shape of `GET /api/status` — see `src/web/routes/status.ts`.
 * `communitySnapshot` is computed for every logged-in dashboard role;
 * `botOwnerStats` is populated only when the requesting session's role is
 * 'bot-owner' (see `WebRole`, `contracts/webRole.d.ts`) and is `null`
 * otherwise.
 */
export interface Status {
  /** Registrations awaiting staff review. */
  pendingRegistrationCount: number;
  /** Apollo event signups still needing a manual member link. */
  unmatchedSignupCount: number;
  communitySnapshot: CommunitySnapshot;
  /** `null` unless the requesting session's role is 'bot-owner'. */
  botOwnerStats: BotOwnerStats | null;
}

/**
 * Attention/awareness items relevant to every dashboard role, not just the
 * bot owner — see `src/db/birthdaysRepository.ts`'s `listBirthdaysInNextDays()`,
 * `src/db/memberRecordsRepository.ts`'s `listRecentMemberActivity()`, and
 * `src/db/eventAttendanceRepository.ts`'s `listEventsInRange()`/
 * `summarizeSignupsForEvents()` for how each field is computed.
 */
export interface CommunitySnapshot {
  /** Live guild member count, or `null` if the member cache/guild isn't available yet. */
  memberCount: number | null;
  birthdaysThisWeek: CommunitySnapshotBirthday[];
  upcomingEvents: CommunitySnapshotEvent[];
  recentAuditActivity: CommunitySnapshotActivity[];
}

export interface CommunitySnapshotBirthday {
  /** Null for a list-entered, name-only birthday with no linked Discord account. */
  userId: string | null;
  name: string | null;
  mention: string;
  /** ISO UTC — the resolved next occurrence (this year's, or next year's if this year's has already passed). */
  date: string;
}

export interface CommunitySnapshotEvent {
  id: number;
  title: string;
  /** ISO UTC. */
  startsAt: string;
  signupCount: number;
}

/**
 * `event`'s literal union mirrors `RecentMemberActivity["event"]`
 * (`src/db/memberRecordsRepository.ts`) inline — same convention as
 * `contracts/registrations.d.ts`/`contracts/eventAttendance.d.ts`.
 */
export interface CommunitySnapshotActivity {
  userId: string;
  displayName: string;
  event: "joined" | "left" | "rulesAccepted";
  /** ISO UTC. */
  at: string;
}

/** Bot-health fields meaningful only to the bot owner — hidden from guild-owner/admin sessions. */
export interface BotOwnerStats {
  botTag: string | null;
  uptimeMs: number;
  cachedMemberCount: number;
  reactionRolePanelCount: number;
}
