import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import { formatAbsolute, formatRelative } from "../dateFormat";
import type { MemberAuditEntry, MemberAuditResponse } from "../types";

const DEBOUNCE_MS = 300;

function DateCell({ label, iso }: { label: string; iso: string | null }) {
  return (
    <td className="mono small" data-label={label}>
      {/* A single wrapping element, not two loose children — the stacked
          mobile layout flexes each <td> (label on the left, value on the
          right), and a bare text node plus a sibling <div> would each
          become their own flex item instead of one right-aligned block. */}
      <div>
        {formatAbsolute(iso)}
        <div className="muted small">{formatRelative(iso)}</div>
      </div>
    </td>
  );
}

function MemberRow({ entry, showLeft }: { entry: MemberAuditEntry; showLeft: boolean }) {
  return (
    <tr>
      <td className="stack-plain">
        <img src={entry.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
      </td>
      <td data-label="Name">{entry.displayName}</td>
      <td className="muted" data-label="Username">
        {entry.tag}
      </td>
      <td className="muted" data-label="ID">
        <code>{entry.userId}</code>
      </td>
      <DateCell label="Joined" iso={entry.joinedAt} />
      <DateCell label="Rules accepted" iso={entry.rulesAcceptedAt} />
      {showLeft && <DateCell label="Left" iso={entry.leftAt} />}
    </tr>
  );
}

function MemberTable({ entries, showLeft }: { entries: MemberAuditEntry[]; showLeft: boolean }) {
  if (entries.length === 0) return <p className="muted">Nobody here.</p>;
  return (
    <div className="table-scroll">
      <table className="stack-on-mobile">
        <thead>
          <tr>
            <th></th>
            <th>Display name</th>
            <th>Username</th>
            <th>ID</th>
            <th>Joined</th>
            <th>Rules accepted</th>
            {showLeft && <th>Left</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <MemberRow key={entry.userId} entry={entry} showLeft={showLeft} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MemberAudit() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberAuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const { showError } = useToast();

  const trimmed = query.trim();

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .memberAudit(trimmed)
        .then(setResults)
        .catch((err) => showError(errorMessage(err)))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, showError]);

  return (
    <div>
      <h2>Member Audit</h2>
      <p className="muted">
        Every member who's ever been seen in the server, current and former. "Rules accepted" and "Left" are only
        known for events the bot was running for — <code>—</code> means not tracked, not that it never happened.
        Dates show in your own local timezone.
      </p>

      <div className="card">
        <div className="field">
          <label htmlFor="member-audit-query">Name</label>
          <input
            id="member-audit-query"
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing a name…"
          />
        </div>
      </div>

      {loading && !results ? (
        <div className="loading">Loading…</div>
      ) : (
        results && (
          <>
            <div className="card">
              <h2>In server ({results.inGuild.length})</h2>
              <MemberTable entries={results.inGuild} showLeft={false} />
            </div>

            <div className="card">
              <h2>Left server ({results.left.length})</h2>
              <MemberTable entries={results.left} showLeft={true} />
            </div>
          </>
        )
      )}
    </div>
  );
}
