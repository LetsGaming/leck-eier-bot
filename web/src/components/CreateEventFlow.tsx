import { useState } from "react";
import SearchableSelect from "./SearchableSelect";
import PublishEventForm from "./PublishEventForm";
import { useFetchedResource } from "../hooks/useFetchedResource";
import { api } from "../api";

export interface CreateEventFlowProps {
  onDone: () => void;
  onCancel: () => void;
}

/** "Neues Event" entry point on the Anwesenheit tab: pick which template to base the event on, then hand off to the same publish form the Vorlagen tab's row action uses. */
export default function CreateEventFlow({ onDone, onCancel }: CreateEventFlowProps) {
  const templates = useFetchedResource(api.eventTemplates, []);
  const [templateId, setTemplateId] = useState("");

  if (!templates.data) return <div className="loading">Wird geladen…</div>;

  const selected = templates.data.find((t) => String(t.id) === templateId) ?? null;
  if (selected) {
    return <PublishEventForm template={selected} onDone={onDone} onCancel={onCancel} />;
  }

  return (
    <div className="card">
      <h2>Neues Event</h2>
      {templates.data.length === 0 ? (
        <p className="muted">
          Noch keine Vorlagen vorhanden — leg zuerst eine auf dem Tab <strong>Vorlagen</strong> an.
        </p>
      ) : (
        <div className="field">
          <label htmlFor="create-event-template">Vorlage</label>
          <SearchableSelect
            id="create-event-template"
            value={templateId}
            onChange={setTemplateId}
            placeholder="Vorlagen durchsuchen…"
            emptyLabel="— wählen —"
            options={templates.data.map((t) => ({ value: String(t.id), label: t.name }))}
          />
        </div>
      )}
      <div className="button-row">
        <button onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
