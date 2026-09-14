import { useState } from "react";
import BaseTable, { type BaseTableColumn } from "../components/BaseTable";
import { formatAbsolute, formatRelative } from "../dateFormat";
import { useAuditLog } from "../hooks/useAuditLog";
import { WEB_ROLE_LABELS } from "../types";
import type { AuditLogEntry } from "../types";

/** bot-owner-only accountability log of every dashboard mutation (see `docs/DASHBOARD.md`'s RBAC section) — who did what, not what changed. */
export default function AuditLog() {
  const [page, setPage] = useState(0);
  const { entries, total, loading, pageSize } = useAuditLog(page);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const columns: BaseTableColumn<AuditLogEntry>[] = [
    {
      key: "at",
      label: "Zeitpunkt",
      className: "mono small",
      render: (e) => (
        <div>
          {formatAbsolute(e.at)}
          <div className="muted small">{formatRelative(e.at)}</div>
        </div>
      ),
    },
    {
      key: "user",
      label: "Nutzer",
      render: (e) => (
        <div>
          {e.username}
          <div className="muted small">{WEB_ROLE_LABELS[e.role] ?? e.role}</div>
        </div>
      ),
    },
    { key: "method", label: "Methode", className: "mono small", render: (e) => e.method },
    { key: "path", label: "Aktion", className: "mono small", render: (e) => e.path },
    {
      key: "status",
      label: "Status",
      render: (e) => <span className={`badge ${e.statusCode < 400 ? "ok" : "error"}`}>{e.statusCode}</span>,
    },
  ];

  return (
    <div>
      <h2>Audit-Log</h2>
      <p className="muted">
        Jede Änderung über das Dashboard (nicht nur Lesezugriffe), mit Zeitpunkt, Nutzer und deren Berechtigungsstufe
        zum Zeitpunkt der Aktion — nur für Bot-Besitzer sichtbar.
      </p>

      <div className="card">
        {loading && entries.length === 0 ? (
          <div className="loading">Wird geladen…</div>
        ) : (
          <>
            <BaseTable
              columns={columns}
              rows={entries}
              rowKey={(e) => e.id}
              emptyMessage={<p className="muted">Noch keine Einträge.</p>}
            />
            {pageCount > 1 && (
              <div className="actions-row mt-8">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Zurück
                </button>
                <span className="muted small">
                  Seite {page + 1} von {pageCount}
                </span>
                <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
                  Weiter
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
