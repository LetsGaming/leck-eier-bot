import { useState } from "react";
import { Link } from "react-router-dom";
import SearchableSelect from "./SearchableSelect";
import { formatAbsolute } from "../dateFormat";
import type { EventAttendance, EventSignup } from "../types";
import { CHOICE_BADGE_CLASS, CHOICE_LABELS } from "../eventAttendanceLabels";
import { LatenessCell, ResultCell } from "./AttendanceBadges";

export default function SignupRow({
  signup,
  event,
  memberOptions,
  onLink,
}: {
  signup: EventSignup;
  event: EventAttendance;
  memberOptions: Array<{ value: string; label: string; hint: string }>;
  onLink: (userId: string | null) => Promise<void>;
}) {
  const [linking, setLinking] = useState(false);
  const needsLink = signup.matchSource === "unmatched" || signup.matchSource === "ambiguous";

  async function handlePick(userId: string) {
    setLinking(true);
    try {
      await onLink(userId || null);
    } finally {
      setLinking(false);
    }
  }

  return (
    <tr>
      <td className="stack-plain">
        {signup.avatarUrl ? (
          <img src={signup.avatarUrl} alt="" width={28} height={28} className="avatar-round" />
        ) : (
          <div className="avatar-placeholder" />
        )}
      </td>
      <td data-label="Mitglied">
        {signup.displayName ? (
          <>
            {signup.userId ? <Link to={`/members/${signup.userId}`}>{signup.displayName}</Link> : signup.displayName}
            {signup.displayName !== signup.rawName && <div className="muted small">{signup.rawName}</div>}
          </>
        ) : (
          <>
            <em>{signup.rawName}</em>{" "}
            <span className="badge warn">{signup.matchSource === "ambiguous" ? "Mehrdeutig" : "Nicht zugeordnet"}</span>
          </>
        )}
      </td>
      <td data-label="Anmeldung">
        <span className={`badge ${CHOICE_BADGE_CLASS[signup.choice]}`}>{CHOICE_LABELS[signup.choice]}</span>
        {signup.withdrawnAt && <div className="muted small">zurückgezogen</div>}
      </td>
      <td data-label="Ergebnis">
        <ResultCell signup={signup} />
      </td>
      <td data-label="Verspätung">
        <LatenessCell signup={signup} event={event} />
      </td>
      <td className="mono small" data-label="Beigetreten">
        {formatAbsolute(signup.firstJoinedAt)}
      </td>
      <td className="mono small" data-label="Verlassen">
        {formatAbsolute(signup.lastLeftAt)}
      </td>
      <td>
        {needsLink ? (
          <SearchableSelect
            value=""
            onChange={handlePick}
            disabled={linking}
            placeholder="Mitglied zuordnen…"
            options={memberOptions}
          />
        ) : signup.matchSource === "manual" ? (
          <button className="danger" disabled={linking} onClick={() => handlePick("")}>
            Verknüpfung lösen
          </button>
        ) : null}
      </td>
    </tr>
  );
}
