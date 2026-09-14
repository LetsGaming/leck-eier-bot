import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../components/ConfirmContext";
import BaseTable, { type BaseTableColumn } from "../components/BaseTable";
import { formatAbsolute, formatRelative } from "../dateFormat";
import { useMemberAudit } from "../hooks/useMemberAudit";
import { useRegistrations } from "../hooks/useRegistrations";
import { hasCapability } from "../types";
import type { Me, MemberAuditEntry, Registration, RegistrationStatus } from "../types";

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

function RegistrationsCard({ query, me }: { query: string; me: Me }) {
  const canWrite = hasCapability(me, "registrations.write");
  const { data: entries, reload: load } = useRegistrations(query);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const { showError, showSuccess } = useToast();
  const confirmDialog = useConfirm();

  // Bulk approve/reject — only "pending" rows can be acted on, same as the
  // per-row actions column below.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const pendingIds = (entries ?? []).filter((e) => e.status === "pending").map((e) => e.userId);
  const allSelected = pendingIds.length > 0 && selected.size === pendingIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && !allSelected;
    }
  });

  // Drop any selected id that's no longer a pending registration (search
  // change, reload after an action, status flip) so the count/bar can't go
  // stale.
  useEffect(() => {
    setSelected((prev) => {
      const validIds = new Set((entries ?? []).filter((e) => e.status === "pending").map((e) => e.userId));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [entries]);

  function toggleSelect(userId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelected(checked ? new Set(pendingIds) : new Set());
  }

  async function handleApprove(entry: Registration) {
    const ok = await confirmDialog({
      title: "Registrierung genehmigen",
      message: `${entry.displayName} erhält die konfigurierte Rolle nach der Registrierung und wird damit als registriert markiert. Der private Thread wird automatisch geschlossen.`,
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

  async function handleBulkApprove() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const ok = await confirmDialog({
      title: "Registrierungen genehmigen",
      message: `${ids.length} Mitglieder erhalten die konfigurierte Rolle nach der Registrierung und werden damit als registriert markiert. Die privaten Threads werden automatisch geschlossen.`,
      confirmLabel: "Genehmigen",
    });
    if (!ok) return;

    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.approveRegistration(id)));
      const failed = ids.filter((_, i) => results[i].status === "rejected");

      if (failed.length === 0) {
        showSuccess(`${ids.length} Registrierungen genehmigt.`);
        setSelected(new Set());
      } else if (failed.length === ids.length) {
        showError(`Genehmigung fehlgeschlagen für ${failed.length} Registrierungen.`);
      } else {
        showError(`${ids.length - failed.length} genehmigt, ${failed.length} fehlgeschlagen.`);
        setSelected(new Set(failed));
      }
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkRemove() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const ok = await confirmDialog({
      title: "Registrierungen zurücksetzen",
      message: `Die privaten Threads von ${ids.length} Registrierungen werden unwiderruflich gelöscht und die Mitglieder können das Formular erneut einreichen. Diese Aktion kann nicht rückgängig gemacht werden.`,
      confirmLabel: "Zurücksetzen",
      danger: true,
    });
    if (!ok) return;

    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.removeRegistration(id)));
      const failed = ids.filter((_, i) => results[i].status === "rejected");

      if (failed.length === 0) {
        showSuccess(`${ids.length} Registrierungen zurückgesetzt.`);
        setSelected(new Set());
      } else if (failed.length === ids.length) {
        showError(`Zurücksetzen fehlgeschlagen für ${failed.length} Registrierungen.`);
      } else {
        showError(`${ids.length - failed.length} zurückgesetzt, ${failed.length} fehlgeschlagen.`);
        setSelected(new Set(failed));
      }
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  if (!entries) return null;

  const columns: BaseTableColumn<Registration>[] = [
    ...(canWrite
      ? [
          {
            key: "select",
            label: (
              <input
                type="checkbox"
                ref={selectAllRef}
                aria-label="Alle ausstehenden Registrierungen auswählen"
                checked={allSelected}
                disabled={bulkBusy || pendingIds.length === 0}
                onChange={(e) => toggleSelectAll(e.target.checked)}
              />
            ),
            dataLabel: "Auswählen",
            render: (e) =>
              e.status === "pending" ? (
                <input
                  type="checkbox"
                  aria-label={`${e.displayName} auswählen`}
                  checked={selected.has(e.userId)}
                  disabled={bulkBusy}
                  onChange={(ev) => toggleSelect(e.userId, ev.target.checked)}
                />
              ) : (
                <span className="muted">—</span>
              ),
          } satisfies BaseTableColumn<Registration>,
        ]
      : []),
    { key: "avatar", label: "", render: (e) => <img src={e.avatarUrl} alt="" width={28} height={28} className="avatar-round" />, className: "stack-plain" },
    {
      key: "displayName",
      label: "Anzeigename",
      accessor: (e) => e.displayName,
      render: (e) => <Link to={`/members/${e.userId}`}>{e.displayName}</Link>,
    },
    { key: "nickname", label: "Nickname", accessor: (e) => e.nickname, className: "muted", render: (e) => e.nickname ?? "—" },
    {
      key: "status",
      label: "Status",
      accessor: (e) => STATUS_LABELS[e.status],
      render: (e) => <span className={`badge ${STATUS_BADGE_CLASS[e.status]}`}>{STATUS_LABELS[e.status]}</span>,
    },
    { key: "submittedName", label: "Name (Formular)", accessor: (e) => e.submittedName, render: (e) => e.submittedName ?? "—" },
    { key: "submittedSsoName", label: "SSO-Name", accessor: (e) => e.submittedSsoName, render: (e) => e.submittedSsoName ?? "—" },
    { key: "submittedAge", label: "Alter", accessor: (e) => e.submittedAge, render: (e) => e.submittedAge ?? "—" },
    {
      key: "submittedAt",
      label: "Eingereicht",
      accessor: (e) => e.submittedAt,
      className: "mono small",
      render: (e) => (
        <div>
          {formatAbsolute(e.submittedAt)}
          <div className="muted small">{formatRelative(e.submittedAt)}</div>
        </div>
      ),
    },
    {
      key: "thread",
      label: "Thread",
      render: (e) =>
        e.threadUrl ? (
          <a href={e.threadUrl} target="_blank" rel="noreferrer">
            Thread öffnen
          </a>
        ) : (
          <span className="muted">—</span>
        ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            label: "",
            className: "stack-plain",
            render: (e) =>
              e.status === "pending" && (
                <div className="actions-row">
                  <button disabled={busyUserId === e.userId || bulkBusy} onClick={() => handleApprove(e)}>
                    Genehmigen
                  </button>
                  <button className="danger" disabled={busyUserId === e.userId || bulkBusy} onClick={() => handleRemove(e)}>
                    Entfernen
                  </button>
                </div>
              ),
          } satisfies BaseTableColumn<Registration>,
        ]
      : []),
  ];

  return (
    <div className="card">
      <h2>Registrierungen ({entries.length})</h2>
      {canWrite && selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} ausgewählt</span>
          <div className="bulk-bar-actions">
            <button className="primary" disabled={bulkBusy} onClick={handleBulkApprove}>
              Genehmigen
            </button>
            <button className="danger" disabled={bulkBusy} onClick={handleBulkRemove}>
              Entfernen
            </button>
            <button disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}
      <BaseTable
        columns={columns}
        rows={entries}
        rowKey={(e) => e.userId}
        emptyMessage={
          <p className="muted">
            {query ? "Keine Registrierung entspricht der Suche." : "Noch niemand hat das Registrierungsformular eingereicht."}
          </p>
        }
      />
    </div>
  );
}

function dateCell(iso: string | null) {
  return (
    // A single wrapping element, not two loose children — the stacked
    // mobile layout flexes each <td> (label on the left, value on the
    // right), and a bare text node plus a sibling <div> would each become
    // their own flex item instead of one right-aligned block.
    <div>
      {formatAbsolute(iso)}
      <div className="muted small">{formatRelative(iso)}</div>
    </div>
  );
}

function MemberTable({ entries, showLeft }: { entries: MemberAuditEntry[]; showLeft: boolean }) {
  const columns: BaseTableColumn<MemberAuditEntry>[] = [
    { key: "avatar", label: "", render: (e) => <img src={e.avatarUrl} alt="" width={28} height={28} className="avatar-round" />, className: "stack-plain" },
    {
      key: "displayName",
      label: "Anzeigename",
      accessor: (e) => e.displayName,
      render: (e) => <Link to={`/members/${e.userId}`}>{e.displayName}</Link>,
    },
    { key: "tag", label: "Benutzername", accessor: (e) => e.tag, className: "muted", render: (e) => e.tag },
    { key: "userId", label: "ID", accessor: (e) => e.userId, className: "muted", render: (e) => <code>{e.userId}</code> },
    {
      key: "joinedAt",
      label: "Beigetreten",
      accessor: (e) => e.joinedAt,
      className: "mono small",
      render: (e) => dateCell(e.joinedAt),
    },
    {
      key: "rulesAcceptedAt",
      label: "Regeln akzeptiert",
      accessor: (e) => e.rulesAcceptedAt,
      className: "mono small",
      render: (e) => dateCell(e.rulesAcceptedAt),
    },
    ...(showLeft
      ? [
          {
            key: "leftAt",
            label: "Verlassen",
            accessor: (e: MemberAuditEntry) => e.leftAt,
            className: "mono small",
            render: (e: MemberAuditEntry) => dateCell(e.leftAt),
          } satisfies BaseTableColumn<MemberAuditEntry>,
        ]
      : []),
  ];

  return (
    <BaseTable
      columns={columns}
      rows={entries}
      rowKey={(e) => e.userId}
      emptyMessage={<p className="muted">Niemand hier.</p>}
    />
  );
}

export default function MemberAudit({ me }: { me: Me }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const trimmed = query.trim();

  // Single debounce point for the whole page — both the member-audit fetch
  // below and RegistrationsCard (which receives debouncedQuery as a prop)
  // key off this one timer instead of each running their own.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const { data: results, loading } = useMemberAudit(debouncedQuery);

  return (
    <div>
      <h2>Mitgliederprüfung</h2>
      <p className="muted">
        Jedes Mitglied, das jemals auf dem Server gesehen wurde. Die Suche durchsucht alle drei Listen unten — auf
        dem Server, den Server verlassen und Registrierungen.
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
          <div className="hint">
            "Regeln akzeptiert" und "Verlassen" sind nur für Ereignisse bekannt, während derer der Bot lief —{" "}
            <code>—</code> bedeutet nicht erfasst, nicht dass es nie passiert ist. Daten werden in der konfigurierten
            Zeitzone angezeigt.
          </div>
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

      <RegistrationsCard query={debouncedQuery} me={me} />
    </div>
  );
}
