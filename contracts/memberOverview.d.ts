/**
 * One member's full dashboard-visible history — identity/audit timeline,
 * registration status, birthday, and event-attendance — aggregated across
 * `memberRecordsRepository`/`birthdaysRepository`/`eventAttendanceRepository`
 * (`src/db/*.ts`) so the frontend doesn't need to separately query three
 * silos keyed by the same Discord `userId`. Response shape of
 * `GET /api/members/:userId` — see `src/web/routes/memberAudit.ts`. 404 if no
 * `MemberRecord` exists for `userId` at all (a userId with zero footprint
 * isn't a valid overview target) — `registration`/`birthday`/`eventHistory`
 * are otherwise independently nullable/empty, not error conditions.
 *
 * `registration.status`/`eventHistory[].choice`/
 * `eventHistory[].attendanceStatus`'s literal unions mirror the bot's
 * `RegistrationStatus`/`ApolloRsvpChoice`/`AttendanceStatus` types
 * (`src/types.ts`) inline — same convention as
 * `contracts/registrations.d.ts`/`contracts/eventAttendance.d.ts`.
 */
export interface MemberOverview {
  userId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  inGuild: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  rulesAcceptedAt: string | null;
  /** `null` if this member has never submitted a registration-form. */
  registration: {
    status: "pending" | "registered" | "removed" | "left";
    submittedAt: string | null;
  } | null;
  /** `null` if this member has no birthday on file. Day/month only — no year, birthdays repeat annually. */
  birthday: { day: number; month: number } | null;
  /** Every event this member has ever signed up for (any RSVP choice), newest event first. Empty array, not null, when there's none. */
  eventHistory: MemberOverviewEventEntry[];
}

export interface MemberOverviewEventEntry {
  eventId: number;
  eventTitle: string;
  /** ISO UTC. */
  startsAt: string;
  choice: "accepted" | "declined" | "tentative";
  /** Null while the event is still 'scheduled', and always null for a 'declined' choice (never tracked). */
  attendanceStatus: "on_time" | "late" | "no_show" | "left_early" | "not_tracked" | null;
}
