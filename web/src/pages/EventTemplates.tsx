import { useState } from "react";
import BaseTable from "../components/BaseTable";
import SearchableSelect from "../components/SearchableSelect";
import TemplateEditor from "../components/TemplateEditor";
import TemplatePreview from "../components/TemplatePreview";
import { useConfirm } from "../components/ConfirmContext";
import { useToast } from "../components/ToastContext";
import { useChannels } from "../hooks/useChannels";
import { useVoiceChannels } from "../hooks/useVoiceChannels";
import { useRoles } from "../hooks/useRoles";
import { useFetchedResource } from "../hooks/useFetchedResource";
import { api, errorMessage } from "../api";
import { toChannelOptions, toRoleOptions } from "../utils/selectOptions";
import type { EventTemplate } from "../types";

const TIME_PLACEHOLDERS = [
  { token: "start_time", label: "Start" },
  { token: "end_time", label: "Ende" },
];

/** Every distinct `{token}` in the two fields, excluding the always-available start/end time tokens — mirrors `getTemplatePlaceholderTokens()` on the bot (`src/services/events.ts`), kept in sync by hand since it's a small, stable regex on both sides. */
function extractPlaceholders(titleTemplate: string, descriptionTemplate: string): string[] {
  const found = new Set<string>();
  const pattern = /\{([^{}]+)\}/g;
  for (const text of [titleTemplate, descriptionTemplate]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match[1] !== "start_time" && match[1] !== "end_time") found.add(match[1]!);
    }
  }
  return [...found];
}

const EMPTY_TEMPLATE: EventTemplate = {
  id: 0,
  name: "",
  titleTemplate: "",
  descriptionTemplate: "",
  defaultChannelId: null,
  defaultMentionRoleId: null,
  defaultVoiceChannelId: null,
  createdAt: "",
  updatedAt: "",
};

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
  const [form, setForm] = useState<EventTemplate>(initial ?? EMPTY_TEMPLATE);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim() || !form.titleTemplate.trim()) {
      showError("Name und Titel sind erforderlich.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name,
        titleTemplate: form.titleTemplate,
        descriptionTemplate: form.descriptionTemplate,
        defaultChannelId: form.defaultChannelId,
        defaultMentionRoleId: form.defaultMentionRoleId,
        defaultVoiceChannelId: form.defaultVoiceChannelId,
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
        <input id="template-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="template-title">Titel</label>
        <TemplateEditor
          id="template-title"
          value={form.titleTemplate}
          onChange={(v) => setForm({ ...form, titleTemplate: v })}
          channels={channels.data ?? []}
          placeholders={TIME_PLACEHOLDERS}
        />
      </div>
      <div className="field">
        <label htmlFor="template-description">Beschreibung</label>
        <TemplateEditor
          id="template-description"
          value={form.descriptionTemplate}
          onChange={(v) => setForm({ ...form, descriptionTemplate: v })}
          channels={channels.data ?? []}
          placeholders={TIME_PLACEHOLDERS}
        />
        <div className="hint">
          Eigene Platzhalter wie <code>{"{organisator}"}</code> sind erlaubt — sie werden beim Veröffentlichen abgefragt.
        </div>
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
          options={toRoleOptions(roles.data ?? [])}
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

      <div className="card">
        <h3>Vorschau</h3>
        <TemplatePreview
          template={form.titleTemplate}
          context={{ raw: { start_time: "<t:0:F>", end_time: "<t:0:F>" } }}
          channels={channels.data ?? []}
          useFont={false}
          fontMap={null}
        />
        <TemplatePreview
          template={form.descriptionTemplate}
          context={{ raw: { start_time: "<t:0:F>", end_time: "<t:0:F>" } }}
          channels={channels.data ?? []}
          useFont={false}
          fontMap={null}
        />
      </div>

      <div className="button-row">
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? "Speichert…" : "Speichern"}
        </button>
        <button className="btn btn-simple" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function PublishForm({ template, onDone, onCancel }: { template: EventTemplate; onDone: () => void; onCancel: () => void }) {
  const { showError, showSuccess } = useToast();
  const channels = useChannels();
  const roles = useRoles();
  const placeholderTokens = extractPlaceholders(template.titleTemplate, template.descriptionTemplate);
  const [placeholders, setPlaceholders] = useState<Record<string, string>>(Object.fromEntries(placeholderTokens.map((t) => [t, ""])));
  const [channelId, setChannelId] = useState(template.defaultChannelId ?? "");
  const [mentionRoleId, setMentionRoleId] = useState(template.defaultMentionRoleId ?? "");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [publishing, setPublishing] = useState(false);

  async function publish() {
    if (!channelId) return showError("Bitte einen Kanal wählen.");
    if (!startsAt || !endsAt) return showError("Start und Ende sind erforderlich.");
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return showError("Ungültiges Datum.");
    if (endDate <= startDate) return showError("Das Ende muss nach dem Start liegen.");
    if (placeholderTokens.some((t) => !placeholders[t]?.trim())) return showError("Bitte alle Platzhalter ausfüllen.");

    setPublishing(true);
    try {
      await api.publishEvent({
        titleTemplate: template.titleTemplate,
        descriptionTemplate: template.descriptionTemplate,
        placeholders,
        channelId,
        mentionRoleId: mentionRoleId || null,
        startsAt: startDate.toISOString(),
        endsAt: endDate.toISOString(),
      });
      showSuccess("Event veröffentlicht!");
      onDone();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="card">
      <h2>Event veröffentlichen: {template.name}</h2>
      {placeholderTokens.map((token) => (
        <div className="field" key={token}>
          <label htmlFor={`ph-${token}`}>{token}</label>
          <input
            id={`ph-${token}`}
            value={placeholders[token] ?? ""}
            onChange={(e) => setPlaceholders({ ...placeholders, [token]: e.target.value })}
          />
        </div>
      ))}
      <div className="field">
        <label htmlFor="publish-channel">Kanal</label>
        <SearchableSelect
          id="publish-channel"
          value={channelId}
          onChange={setChannelId}
          placeholder="Kanäle durchsuchen…"
          emptyLabel="— keiner —"
          options={toChannelOptions(channels.data ?? [])}
        />
      </div>
      <div className="field">
        <label htmlFor="publish-role">Erwähnte Rolle</label>
        <SearchableSelect
          id="publish-role"
          value={mentionRoleId}
          onChange={setMentionRoleId}
          placeholder="Rollen durchsuchen…"
          emptyLabel="— keine —"
          options={toRoleOptions(roles.data ?? [])}
        />
      </div>
      <div className="field">
        <label htmlFor="publish-start">Start</label>
        <input id="publish-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="publish-end">Ende</label>
        <input id="publish-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </div>
      <div className="button-row">
        <button className="btn btn-primary" disabled={publishing} onClick={publish}>
          {publishing ? "Veröffentlicht…" : "Veröffentlichen"}
        </button>
        <button className="btn btn-simple" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

export default function EventTemplates() {
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
      <PublishForm
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
      <div className="page-header">
        <h2>Event-Vorlagen</h2>
        <button className="btn btn-primary" onClick={() => setEditing(null)}>
          Neue Vorlage
        </button>
      </div>
      <p className="muted">
        Vorlage einmal anlegen, dann jederzeit über <em>Veröffentlichen</em> mit den passenden Werten als echtes Event posten — inklusive
        Anmeldebuttons und Erwähnung.
      </p>
      <BaseTable<EventTemplate>
        columns={[
          { key: "name", label: "Name", accessor: (t) => t.name, render: (t) => t.name },
          { key: "title", label: "Titel", render: (t) => t.titleTemplate },
          {
            key: "actions",
            label: "",
            render: (t) => (
              <div className="button-row">
                <button className="btn btn-primary btn-sm" onClick={() => setPublishingTemplate(t)}>
                  Veröffentlichen
                </button>
                <button className="btn btn-simple btn-sm" onClick={() => setEditing(t)}>
                  Bearbeiten
                </button>
                <button className="btn btn-simple btn-sm" onClick={() => remove(t)}>
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
