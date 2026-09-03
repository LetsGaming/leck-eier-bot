import type { EventAttendance, EventSignup } from "../types";
import { formatAbsolute } from "../dateFormat";
import { ATTENDANCE_BADGE_CLASS, ATTENDANCE_LABELS } from "../eventAttendanceLabels";

// Mirrors APOLLO_ATTENDANCE_TIER_*_MINUTES in src/constants.ts — display thresholds only.
const TIER_MILD_MINUTES = 5;
const TIER_MODERATE_MINUTES = 15;
const TIER_SEVERE_MINUTES = 30;

type SeverityTier = "fine" | "mild" | "moderate" | "severe";

/** Both lateness and early-leave are graded on the same scale — under 5 min is still logged, just neutrally colored. */
export function severityTier(minutes: number | null): SeverityTier | null {
  if (minutes === null) return null;
  if (minutes < TIER_MILD_MINUTES) return "fine";
  if (minutes < TIER_MODERATE_MINUTES) return "mild";
  if (minutes < TIER_SEVERE_MINUTES) return "moderate";
  return "severe";
}

/**
 * "fine" (under 5 min) is bare `.badge` — no colour modifier — rather than
 * `.ok`: it's still worth surfacing (see LatenessCell), but green reads as
 * "good", and being a couple minutes late isn't. Mirrors the "no modifier
 * class" convention already used for `EVENT_STATUS_BADGE_CLASS.completed` in
 * eventAttendanceLabels.ts.
 */
export const TIER_BADGE_CLASS: Record<SeverityTier, string> = {
  fine: "",
  mild: "warn",
  moderate: "moderate",
  severe: "severe",
};

/** Strictly the bucket badge — Pünktlich/Zu spät/Nicht erschienen/Früher gegangen/Nicht getrackt. No minutes, no tiering; see LatenessCell for that. */
export function ResultCell({ signup }: { signup: EventSignup }) {
  if (signup.attendanceStatus === null) return <span className="muted">—</span>;
  return <span className={`badge ${ATTENDANCE_BADGE_CLASS[signup.attendanceStatus]}`}>{ATTENDANCE_LABELS[signup.attendanceStatus]}</span>;
}

/**
 * Dedicated "Verspätung" cell — lateness and early-leave are independent
 * facts (someone can be both late AND leave early at once), so both are
 * shown together, never collapsed into a single "worse tier wins" badge.
 * Renders a muted "—" when neither minutes value is positive (covers
 * on_time-with-zero-minutes, no_show, not_tracked, and null signups).
 */
export function LatenessCell({ signup, event }: { signup: EventSignup; event: EventAttendance }) {
  const lateTier = signup.lateMinutes !== null && signup.lateMinutes > 0 ? severityTier(signup.lateMinutes) : null;
  const earlyTier = signup.earlyMinutes !== null && signup.earlyMinutes > 0 ? severityTier(signup.earlyMinutes) : null;

  if (!lateTier && !earlyTier) return <span className="muted">—</span>;

  return (
    <div className="stack-plain" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
      {lateTier && (
        <span
          className={`badge ${TIER_BADGE_CLASS[lateTier]}`}
          title={`Beigetreten ${formatAbsolute(signup.firstJoinedAt)} — Start war ${formatAbsolute(event.startsAt)}`}
        >
          {`+${signup.lateMinutes} Min. zu spät`}
        </span>
      )}
      {earlyTier && (
        <span
          className={`badge ${TIER_BADGE_CLASS[earlyTier]}`}
          title={`Verlassen ${formatAbsolute(signup.lastLeftAt)} — Ende war ${formatAbsolute(event.endsAt)}`}
        >
          {`−${signup.earlyMinutes} Min. früher gegangen`}
        </span>
      )}
    </div>
  );
}
