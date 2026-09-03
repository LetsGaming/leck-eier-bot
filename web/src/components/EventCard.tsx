import { Link } from "react-router-dom";
import { formatAbsolute } from "../dateFormat";
import type { EventAttendanceSummary } from "../types";
import { EVENT_STATUS_LABELS, EVENT_STATUS_BADGE_CLASS } from "../eventAttendanceLabels";

/**
 * One event's summary card on the Event-Anwesenheit list page — aggregate
 * `counts` only, no per-signup table (that's the detail route's job, a
 * different route not yet wired up — see App.tsx). The whole card is a link
 * there.
 */
export default function EventCard({ event }: { event: EventAttendanceSummary }) {
  const { counts } = event;

  return (
    <Link to={`/events/${event.id}`} className="event-card">
      <div className="card">
        <h2>{event.title}</h2>
        <p className="muted small">
          {formatAbsolute(event.startsAt)} – {formatAbsolute(event.endsAt)}
        </p>
        <div className="card-badges">
          <span className={`badge ${EVENT_STATUS_BADGE_CLASS[event.status]}`}>
            {EVENT_STATUS_LABELS[event.status]}
          </span>
          {event.trackingIncomplete && <span className="badge warn">Tracking unvollständig</span>}
          {counts.unresolved > 0 && <span className="badge warn">{counts.unresolved} offen</span>}
        </div>
        <p className="muted small">
          Zugesagt {counts.accepted} · Vielleicht {counts.tentative} · Abgesagt {counts.declined}
        </p>
        {event.status !== "scheduled" && (
          <p className="muted small">
            Pünktlich {counts.onTime} · Zu spät {counts.late} · Nicht erschienen {counts.noShow}
          </p>
        )}
      </div>
    </Link>
  );
}
