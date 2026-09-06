/**
 * A member who's ever posted a self-service registration-form submission,
 * regardless of outcome — see `src/events/registerWatcher.ts`. Response
 * shape of `GET /api/members/registrations` (as array elements) — see
 * `src/web/routes/registrations.ts`.
 *
 * `status`'s literal union mirrors the bot's `RegistrationStatus` type
 * (`src/types.ts`) inline rather than re-exporting it, keeping this contract
 * free of any import into the bot's own module graph:
 * - 'pending' = form submitted, awaiting staff action, private thread open.
 * - 'registered' = staff granted the registration-tier role.
 * - 'removed' = manually reset from the dashboard so the member can resubmit.
 * - 'left' = the member left/was kicked/was banned while still 'pending'.
 */
export interface RegistrationEntry {
  userId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
  status: "pending" | "registered" | "removed" | "left";
  /** ISO UTC — when the registration was submitted. */
  submittedAt: string | null;
  /** Jump link to the private thread. Null once resolved (registered/removed/left) — the thread no longer exists. */
  threadUrl: string | null;
  /** Raw `name:` field value, as submitted. */
  submittedName: string | null;
  /** Raw `sso name:` field value, as submitted (the full value, not just the surname used for the nickname). */
  submittedSsoName: string | null;
  /** Raw `alter:` field value, as submitted. Null if the member left it out. */
  submittedAge: string | null;
}
