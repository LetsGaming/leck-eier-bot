import { useState } from "react";
import BaseTable from "../components/BaseTable";
import SearchableSelect from "../components/SearchableSelect";
import TemplateEditor from "../components/TemplateEditor";
import EventEmbedPreview from "../components/EventEmbedPreview";
import PublishEventForm from "../components/PublishEventForm";
import { useConfirm } from "../components/ConfirmContext";
import { useToast } from "../components/ToastContext";
import { useChannels } from "../hooks/useChannels";
import { useVoiceChannels } from "../hooks/useVoiceChannels";
import { useRoles } from "../hooks/useRoles";
import { useGeneralSettings } from "../hooks/useGeneralSettings";
import { useFetchedResource } from "../hooks/useFetchedResource";
import { api, errorMessage } from "../api";
import { toChannelOptions, toRoleOptions, EVERYONE_MENTION_OPTION } from "../utils/selectOptions";
import type { EventTemplate } from "../types";

const EMPTY_TEMPLATE: EventTemplate = {
  id: 0,
  name: "",
  defaultTitle: "",
  baseDescription: "",
  defaultChannelId: null,
  defaultMentionRoleId: null,
  defaultVoiceChannelId: null,
  defaultWeekday: null,
  defaultStartTime: null,
  defaultEndTime: null,
  useFont: false,
  createdAt: "",
  updatedAt: "",
};

/** `Date#getDay()` convention: 0=Sunday..6=Saturday. */
const WEEKDAY_LABELS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function TemplateForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: EventTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { showError, showSuccess } = useToast();
  const channels = useChannels();
  const voiceChannels = useVoiceChannels();
  const roles = useRoles();
  const generalSettings = useGeneralSettings();
  const [form, setForm] = useState<EventTemplate>(initial ?? EMPTY_TEMPLATE);
  const [hasDefaultTime, setHasDefaultTime] = useState(initial?.defaultWeekday !== null && initial !== null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim() || !form.defaultTitle.trim()) {
      showError("Name und Standard-Titel sind erforderlich.");
      return;
    }
    if (hasDefaultTime && (!form.defaultStartTime || !form.defaultEndTime)) {
      showError("Bitte Start- und Endzeit für die Standard-Zeit angeben.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name,
        defaultTitle: form.defaultTitle,
        baseDescription: form.baseDescription,
        defaultChannelId: form.defaultChannelId,
        defaultMentionRoleId: form.defaultMentionRoleId,
        defaultVoiceChannelId: form.defaultVoiceChannelId,
        defaultWeekday: hasDefaultTime ? form.defaultWeekday : null,
        defaultStartTime: hasDefaultTime ? form.defaultStartTime : null,
        defaultEndTime: hasDefaultTime ? form.defaultEndTime : null,
        useFont: form.useFont,
      };
      if (initial) await api.updateEventTemplate(initial.id, body);
      else await api.createEventTemplate(body);
      showSuccess(initial ? "Vorlage gespeichert." : "Vorlage erstellt.");
      onSaved();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>{initial ? `Vorlage bearbeiten: ${initial.name}` : "Neue Vorlage"}</h2>
      <div className="field">
        <label htmlFor="template-name">Name</label>
        <input id="template-name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="template-title">Standard-Titel</label>
        <input
          id="template-title"
          type="text"
          value={form.defaultTitle}
          onChange={(e) => setForm({ ...form, defaultTitle: e.target.value })}
        />
        <div className="hint">Wird beim Veröffentlichen vorausgefüllt und ist dort frei bearbeitbar.</div>
      </div>
      <div className="field">
        <label htmlFor="template-description">Basis-Beschreibung</label>
        <TemplateEditor
          id="template-description"
          value={form.baseDescription}
          onChange={(v) => setForm({ ...form, baseDescription: v })}
          channels={channels.data ?? []}
        />
        <div className="hint">Wird beim Veröffentlichen vorausgefüllt — meist unverändert übernommen, bei Bedarf frei anpassbar.</div>
      </div>
      <div className="field">
        <label htmlFor="template-channel">Standard-Kanal</label>
        <SearchableSelect
          id="template-channel"
          value={form.defaultChannelId ?? ""}
          onChange={(v) => setForm({ ...form, defaultChannelId: v || null })}
          placeholder="Kanäle durchsuchen…"
          emptyLabel="— Standard aus den Einstellungen —"
          options={toChannelOptions(channels.data ?? [])}
        />
      </div>
      <div className="field">
        <label htmlFor="template-role">Erwähnte Rolle</label>
        <SearchableSelect
          id="template-role"
          value={form.defaultMentionRoleId ?? ""}
          onChange={(v) => setForm({ ...form, defaultMentionRoleId: v || null })}
          placeholder="Rollen durchsuchen…"
          emptyLabel="— keine —"
          options={[EVERYONE_MENTION_OPTION, ...toRoleOptions(roles.data ?? [])]}
        />
      </div>
      <div className="field">
        <label htmlFor="template-voice">Anwesenheits-Sprachkanal</label>
        <SearchableSelect
          id="template-voice"
          value={form.defaultVoiceChannelId ?? ""}
          onChange={(v) => setForm({ ...form, defaultVoiceChannelId: v || null })}
          placeholder="Sprachkanäle durchsuchen…"
          emptyLabel="— Standard aus den Einstellungen —"
          options={toChannelOptions(voiceChannels.data ?? [], "🔊 ")}
        />
      </div>

      <div className="field">
        <label className="switch">
          <input
            type="checkbox"
            checked={hasDefaultTime}
            onChange={(e) => {
              setHasDefaultTime(e.target.checked);
              // The weekday <select> below just *displays* a fallback of
              // Montag (1) via `value={form.defaultWeekday ?? 1}` — it never
              // writes that back to state unless the admin actually changes
              // the selection, so leaving it on its default-looking value
              // would silently save `defaultWeekday: null` while the times
              // are set, tripping the backend's all-or-nothing validation.
              if (e.target.checked && form.defaultWeekday === null) setForm((f) => ({ ...f, defaultWeekday: 1 }));
            }}
          />
          Standard-Zeit
        </label>
        <div className="hint">Für wiederkehrende Events, die immer am selben Wochentag zur selben Zeit stattfinden — wird beim Veröffentlichen als nächster passender Termin vorausgefüllt.</div>
        {hasDefaultTime && (
          <>
            <select
              value={form.defaultWeekday ?? 1}
              onChange={(e) => setForm({ ...form, defaultWeekday: Number(e.target.value) })}
              className="mt-8"
            >
              {WEEKDAY_LABELS.map((label, weekday) => (
                <option key={weekday} value={weekday}>
                  {label}
                </option>
              ))}
            </select>
            <div className="row mt-8">
              <div className="field">
                <label htmlFor="template-start-time">Startzeit</label>
                <input
                  id="template-start-time"
                  type="time"
                  value={form.defaultStartTime ?? ""}
                  onChange={(e) => setForm({ ...form, defaultStartTime: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="template-end-time">Endzeit</label>
                <input
                  id="template-end-time"
                  type="time"
                  value={form.defaultEndTime ?? ""}
                  onChange={(e) => setForm({ ...form, defaultEndTime: e.target.value })}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <label className="switch">
        <input type="checkbox" checked={form.useFont} onChange={(e) => setForm({ ...form, useFont: e.target.checked })} />
        Schrift verwenden
      </label>
      <div className="hint">
        Formatiert Titel/Beschreibung mit der auf der <a href="/settings">Einstellungsseite</a> festgelegten Schrift, sofern konfiguriert.
      </div>

      <div className="card">
        <h3>Vorschau</h3>
        <EventEmbedPreview
          title={form.defaultTitle}
          description={form.baseDescription}
          startsAt={null}
          endsAt={null}
          channels={channels.data ?? []}
          useFont={form.useFont}
          fontMap={generalSettings.data?.fontMap ?? null}
        />
      </div>

      <div className="button-row">
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? "Speichert…" : "Speichern"}
        </button>
        <button onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

export default function EventTemplatesTab() {
  const templates = useFetchedResource(api.eventTemplates, []);
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<EventTemplate | null | undefined>(undefined);
  const [publishingTemplate, setPublishingTemplate] = useState<EventTemplate | null>(null);

  async function remove(template: EventTemplate) {
    const ok = await confirm({
      title: "Vorlage löschen?",
      message: `"${template.name}" wirklich löschen? Bereits veröffentlichte Events bleiben bestehen.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteEventTemplate(template.id);
      showSuccess("Vorlage gelöscht.");
      templates.reload();
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  if (publishingTemplate) {
    return (
      <PublishEventForm
        template={publishingTemplate}
        onDone={() => setPublishingTemplate(null)}
        onCancel={() => setPublishingTemplate(null)}
      />
    );
  }

  if (editing !== undefined) {
    return (
      <TemplateForm
        initial={editing}
        onSaved={() => {
          setEditing(undefined);
          templates.reload();
        }}
        onCancel={() => setEditing(undefined)}
      />
    );
  }

  return (
    <div>
      <div className="toolbar">
        <p className="muted">
          Vorlage einmal anlegen, dann jederzeit über <em>Veröffentlichen</em> als echtes Event posten — inklusive Anmeldebuttons und
          Erwähnung.
        </p>
        <button className="primary" onClick={() => setEditing(null)}>
          Neue Vorlage
        </button>
      </div>
      <BaseTable<EventTemplate>
        columns={[
          { key: "name", label: "Name", accessor: (t) => t.name, render: (t) => t.name },
          { key: "title", label: "Standard-Titel", render: (t) => t.defaultTitle },
          {
            key: "actions",
            label: "",
            render: (t) => (
              <div className="button-row">
                <button className="primary" onClick={() => setPublishingTemplate(t)}>
                  Veröffentlichen
                </button>
                <button onClick={() => setEditing(t)}>
                  Bearbeiten
                </button>
                <button className="danger" onClick={() => remove(t)}>
                  Löschen
                </button>
              </div>
            ),
          },
        ]}
        rows={templates.data ?? []}
        rowKey={(t) => t.id}
        emptyMessage={<p className="muted">Noch keine Vorlagen — leg die erste mit "Neue Vorlage" an.</p>}
      />
    </div>
  );
}
