import { useState } from "react";
import BaseTable from "../components/BaseTable";
import PublishEventForm from "../components/PublishEventForm";
import { useConfirm } from "../components/ConfirmContext";
import { useToast } from "../components/ToastContext";
import { useScheduledEventPublishes } from "../hooks/useScheduledEvents";
import { api, errorMessage } from "../api";
import type { ScheduledEventPublish } from "../types";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(entry: ScheduledEventPublish): string {
  if (entry.publishedEventId !== null) return "Veröffentlicht";
  if (entry.lastError) return `Fehlgeschlagen: ${entry.lastError}`;
  return "Ausstehend";
}

/** Pending "publish later" entries — not real events yet (see `services/events.ts`'s `publishDueScheduledEvents`), so they live on their own tab rather than mixed into the Anwesenheit list. */
export default function ScheduledEventsTab() {
  const scheduled = useScheduledEventPublishes();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ScheduledEventPublish | null>(null);

  async function remove(entry: ScheduledEventPublish) {
    const ok = await confirm({
      title: "Geplante Veröffentlichung löschen?",
      message: `"${entry.payload.title}" wird dann nicht mehr automatisch veröffentlicht.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteScheduledEventPublish(entry.id);
      showSuccess("Geplante Veröffentlichung gelöscht.");
      scheduled.reload();
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  if (editing) {
    return (
      <PublishEventForm
        scheduledEdit={editing}
        onDone={() => {
          setEditing(null);
          scheduled.reload();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <p className="muted">Wird auf "Später veröffentlichen" im Veröffentlichen-Formular angelegt; bis dahin frei bearbeitbar.</p>
      <BaseTable<ScheduledEventPublish>
        columns={[
          { key: "title", label: "Titel", render: (e) => e.payload.title },
          { key: "publishAt", label: "Veröffentlichung am", render: (e) => formatDateTime(e.publishAt) },
          { key: "startsAt", label: "Start", render: (e) => formatDateTime(e.payload.startsAt) },
          { key: "status", label: "Status", render: (e) => statusLabel(e) },
          {
            key: "actions",
            label: "",
            render: (e) => (
              <div className="button-row">
                {e.publishedEventId === null && (
                  <button onClick={() => setEditing(e)}>
                    Bearbeiten
                  </button>
                )}
                <button className="danger" onClick={() => remove(e)}>
                  Löschen
                </button>
              </div>
            ),
          },
        ]}
        rows={scheduled.data ?? []}
        rowKey={(e) => e.id}
        emptyMessage={<p className="muted">Keine geplanten Veröffentlichungen.</p>}
      />
    </div>
  );
}
