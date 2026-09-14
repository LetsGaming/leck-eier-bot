import { useState } from "react";
import SearchableSelect from "./SearchableSelect";
import TemplateEditor from "./TemplateEditor";
import EventEmbedPreview from "./EventEmbedPreview";
import { useToast } from "./ToastContext";
import { useChannels } from "../hooks/useChannels";
import { useVoiceChannels } from "../hooks/useVoiceChannels";
import { useRoles } from "../hooks/useRoles";
import { useGeneralSettings } from "../hooks/useGeneralSettings";
import { api, errorMessage } from "../api";
import { toChannelOptions, toRoleOptions, EVERYONE_MENTION_OPTION, defaultChannelEmptyLabel } from "../utils/selectOptions";
import type { EventTemplate } from "../types";

export interface PublishEventFormProps {
  template: EventTemplate;
  onDone: () => void;
  onCancel: () => void;
}

/** "YYYY-MM-DDTHH:mm" for a `datetime-local` input's value, in the browser's own local time. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Next occurrence of `template`'s recurring-time default, in the *browser's*
 * local time — matching how the datetime-local fields below are already
 * interpreted (`new Date(startsAt)` on a naive string reads browser-local),
 * so a manually-typed time and an auto-prefilled one behave identically.
 * Null if the template has no default.
 */
function defaultOccurrence(template: EventTemplate): { startsAt: string; endsAt: string } | null {
  if (template.defaultWeekday === null || template.defaultStartTime === null || template.defaultEndTime === null) return null;
  const [startHour, startMinute] = template.defaultStartTime.split(":").map(Number);
  const [endHour, endMinute] = template.defaultEndTime.split(":").map(Number);
  const now = new Date();

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, startHour, startMinute, 0, 0);
    if (candidate.getDay() !== template.defaultWeekday) continue;
    if (candidate.getTime() < now.getTime()) continue;

    let end = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate(), endHour, endMinute, 0, 0);
    if (end.getTime() < candidate.getTime()) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    return { startsAt: toDatetimeLocalValue(candidate), endsAt: toDatetimeLocalValue(end) };
  }
  return null; // unreachable — every weekday occurs at least once in 8 days
}

/** Fills in a template's default title/base description (both freely editable) plus channel/role/voice-channel/time, previews the resulting embed live, and publishes it. Used both from the Vorlagen tab's row action and the Anwesenheit tab's "Neues Event" flow. */
export default function PublishEventForm({ template, onDone, onCancel }: PublishEventFormProps) {
  const { showError, showSuccess } = useToast();
  const channels = useChannels();
  const voiceChannels = useVoiceChannels();
  const roles = useRoles();
  const generalSettings = useGeneralSettings();
  const occurrence = defaultOccurrence(template);
  const [title, setTitle] = useState(template.defaultTitle);
  const [description, setDescription] = useState(template.baseDescription);
  const [channelId, setChannelId] = useState(template.defaultChannelId ?? "");
  const [mentionRoleId, setMentionRoleId] = useState(template.defaultMentionRoleId ?? "");
  const [voiceChannelId, setVoiceChannelId] = useState(template.defaultVoiceChannelId ?? "");
  const [useFont, setUseFont] = useState(template.useFont);
  const [startsAt, setStartsAt] = useState(occurrence?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(occurrence?.endsAt ?? "");
  const [publishing, setPublishing] = useState(false);

  const startIso = startsAt ? new Date(startsAt).toISOString() : null;
  const endIso = endsAt ? new Date(endsAt).toISOString() : null;

  async function publish() {
    if (!title.trim()) return showError("Bitte einen Titel angeben.");
    if (!channelId) return showError("Bitte einen Kanal wählen.");
    if (!startsAt || !endsAt) return showError("Start und Ende sind erforderlich.");
    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return showError("Ungültiges Datum.");
    if (endDate <= startDate) return showError("Das Ende muss nach dem Start liegen.");

    setPublishing(true);
    try {
      await api.publishEvent({
        title,
        description,
        channelId,
        mentionRoleId: mentionRoleId || null,
        voiceChannelId: voiceChannelId || null,
        useFont,
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
      <div className="field">
        <label htmlFor="publish-title">Titel</label>
        <input id="publish-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="publish-description">Beschreibung</label>
        <TemplateEditor id="publish-description" value={description} onChange={setDescription} channels={channels.data ?? []} />
      </div>
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
          options={[EVERYONE_MENTION_OPTION, ...toRoleOptions(roles.data ?? [])]}
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="publish-start">Start</label>
          <input id="publish-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="publish-end">Ende</label>
          <input id="publish-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="publish-voice">Anwesenheits-Sprachkanal</label>
        <SearchableSelect
          id="publish-voice"
          value={voiceChannelId}
          onChange={setVoiceChannelId}
          placeholder="Sprachkanäle durchsuchen…"
          emptyLabel={defaultChannelEmptyLabel(generalSettings.data?.eventVoiceChannelId, voiceChannels.data ?? [], "🔊 ")}
          options={toChannelOptions(voiceChannels.data ?? [], "🔊 ")}
        />
      </div>
      <label className="switch">
        <input type="checkbox" checked={useFont} onChange={(e) => setUseFont(e.target.checked)} />
        Schrift verwenden
      </label>
      <div className="hint">
        Formatiert Titel/Beschreibung mit der auf der <a href="/settings">Einstellungsseite</a> festgelegten Schrift, sofern konfiguriert.
      </div>

      <div className="card">
        <h2>Vorschau</h2>
        <EventEmbedPreview
          title={title}
          description={description}
          startsAt={startIso}
          endsAt={endIso}
          channels={channels.data ?? []}
          useFont={useFont}
          fontMap={generalSettings.data?.fontMap ?? null}
        />
      </div>

      <div className="button-row">
        <button className="primary" disabled={publishing} onClick={publish}>
          {publishing ? "Veröffentlicht…" : "Veröffentlichen"}
        </button>
        <button onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}
