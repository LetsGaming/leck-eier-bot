import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../components/ConfirmContext";
import { formatAbsolute, formatRelative } from "../dateFormat";
import type { MemberAuditEntry, MemberAuditResponse, Registration, RegistrationStatus } from "../types";

const DEBOUNCE_MS = 300;

const STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending: "Ausstehend",
  registered: "Registriert",
  removed: "Entfernt",
  left: "Verlassen",
};

const STATUS_BADGE_CLASS: Record<RegistrationStatus, string> = {
  pending: "warn",
  registered: "ok",
  removed: "error",
  left: "error",
};

function RegistrationsCard() {
  const [entries, setEntries] = useState<Registration[] | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const { showError, showSuccess } = useToast();
  const confirmDialog = useConfirm();

  const load = useCallback(() => {
    api
      .registrations()
      .then(setEntries)
      .catch((err) => showError(errorMessage(err)));
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(entry: Registration) {
    const ok = await confirmDialog({
      title: "Registrierung genehmigen",
      message: `${entry.displayName} erhält die konfigurierte Registrierungsrolle und wird damit als registriert markiert. Der private Thread wird automatisch geschlossen.`,
      confirmLabel: "Genehmigen",
    });
    if (!ok) return;

    setBusyUserId(entry.userId);
    try {
      await api.approveRegistration(entry.userId);
      showSuccess("Genehmigt — Rolle vergeben.");
      load();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(entry: Registration) {
    const ok = await confirmDialog({
      title: "Registrierung zurücksetzen",
      message:
        "Der private Thread wird unwiderruflich gelöscht und das Mitglied kann das Formular erneut einreichen. Diese Aktion kann nicht rückgängig gemacht werden.",
      requireText: entry.displayName,
      confirmLabel: "Zurücksetzen",
    });
    if (!ok) return;

    setBusyUserId(entry.userId);
    try {
      await api.removeRegistration(entry.userId);
      showSuccess("Zurückgesetzt.");
      load();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusyUserId(null);
    }
  }

  if (!entries) return null;

  return (
    <div className="card">
      <h2>Registrierungen ({entries.length})</h2>
      {entries.length === 0 ? (
        <p className="muted">Noch niemand hat das Registrierungsformular eingereicht.</p>
      ) : (
        <div className="table-scroll">
          <table className="stack-on-mobile">
            <thead>
              <tr>
                <th></th>
                <th>Anzeigename</th>
                <th>Nickname</th>
                <th>Status</th>
                <th>Name (Formular)</th>
                <th>SSO-Name</th>
                <th>Alter</th>
                <th>Eingereicht</th>
                <th>Thread</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.userId}>
                  <td className="stack-plain">
                    <img src={entry.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
                  </td>
                  <td data-label="Anzeigename">{entry.displayName}</td>
                  <td className="muted" data-label="Nickname">
                    {entry.nickname ?? "—"}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${STATUS_BADGE_CLASS[entry.status]}`}>
                      {STATUS_LABELS[entry.status]}
                    </span>
                  </td>
                  <td data-label="Name (Formular)">{entry.submittedName ?? "—"}</td>
                  <td data-label="SSO-Name">{entry.submittedSsoName ?? "—"}</td>
                  <td data-label="Alter">{entry.submittedAge ?? "—"}</td>
                  <td className="mono small" data-label="Eingereicht">
                    <div>
                      {formatAbsolute(entry.submittedAt)}
                      <div className="muted small">{formatRelative(entry.submittedAt)}</div>
                    </div>
                  </td>
                  <td data-label="Thread">
                    {entry.threadUrl ? (
                      <a href={entry.threadUrl} target="_blank" rel="noreferrer">
                        Thread öffnen
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="stack-plain" style={{ display: "flex", gap: 8 }}>
                    {entry.status === "pending" && (
                      <>
                        <button disabled={busyUserId === entry.userId} onClick={() => handleApprove(entry)}>
                          Genehmigen
                        </button>
                        <button
                          className="danger"
                          disabled={busyUserId === entry.userId}
                          onClick={() => handleRemove(entry)}
                        >
                          Entfernen
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
      <td className="muted" data-label="Benutzername">
        {entry.tag}
      </td>
      <td className="muted" data-label="ID">
        <code>{entry.userId}</code>
      </td>
      <DateCell label="Beigetreten" iso={entry.joinedAt} />
      <DateCell label="Regeln akzeptiert" iso={entry.rulesAcceptedAt} />
      {showLeft && <DateCell label="Verlassen" iso={entry.leftAt} />}
    </tr>
  );
}

function MemberTable({ entries, showLeft }: { entries: MemberAuditEntry[]; showLeft: boolean }) {
  if (entries.length === 0) return <p className="muted">Niemand hier.</p>;
  return (
    <div className="table-scroll">
      <table className="stack-on-mobile">
        <thead>
          <tr>
            <th></th>
            <th>Anzeigename</th>
            <th>Benutzername</th>
            <th>ID</th>
            <th>Beigetreten</th>
            <th>Regeln akzeptiert</th>
            {showLeft && <th>Verlassen</th>}
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
      <h2>Mitgliederprüfung</h2>
      <p className="muted">
        Jedes Mitglied, das jemals auf dem Server gesehen wurde, aktuell und ehemalig. "Regeln akzeptiert" und
        "Verlassen" sind nur für Ereignisse bekannt, während derer der Bot lief — <code>—</code> bedeutet nicht
        erfasst, nicht dass es nie passiert ist. Daten werden in der konfigurierten Zeitzone angezeigt.
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
            placeholder="Namen eingeben…"
          />
        </div>
      </div>

      {loading && !results ? (
        <div className="loading">Wird geladen…</div>
      ) : (
        results && (
          <>
            <div className="card">
              <h2>Auf dem Server ({results.inGuild.length})</h2>
              <MemberTable entries={results.inGuild} showLeft={false} />
            </div>

            <div className="card">
              <h2>Server verlassen ({results.left.length})</h2>
              <MemberTable entries={results.left} showLeft={true} />
            </div>
          </>
        )
      )}

      <RegistrationsCard />
    </div>
  );
}
