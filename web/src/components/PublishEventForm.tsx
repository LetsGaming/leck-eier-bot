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
import type { EventTemplate, ScheduledEventPublish } from "../types";

export interface PublishEventFormProps {
  /** Create flow: prefill from a template, publish immediately or schedule. */
  template?: EventTemplate;
  /** Edit flow: editing an already-pending scheduled publish (Geplant tab) — always stays deferred, only its payload/publishAt change. */
  scheduledEdit?: ScheduledEventPublish;
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

/** Fills in a template's default title/base description (both freely editable) plus channel/role/voice-channel/time, previews the resulting embed live, and publishes it (or, ticked "Später veröffentlichen", schedules it for later — see `useScheduledEventPublishes`). Used from the Vorlagen tab's row action, the Anwesenheit tab's "Neues Event" flow, and (via `scheduledEdit`) the Geplant tab's edit action. */
export default function PublishEventForm({ template, scheduledEdit, onDone, onCancel }: PublishEventFormProps) {
  const { showError, showSuccess } = useToast();
  const channels = useChannels();
  const voiceChannels = useVoiceChannels();
  const roles = useRoles();
  const generalSettings = useGeneralSettings();
  const occurrence = template ? defaultOccurrence(template) : null;
  const payload = scheduledEdit?.payload;
  const [title, setTitle] = useState(payload?.title ?? template?.defaultTitle ?? "");
  const [description, setDescription] = useState(payload?.description ?? template?.baseDescription ?? "");
  const [channelId, setChannelId] = useState(payload?.channelId ?? template?.defaultChannelId ?? "");
  const [mentionRoleId, setMentionRoleId] = useState(payload?.mentionRoleId ?? template?.defaultMentionRoleId ?? "");
  const [voiceChannelId, setVoiceChannelId] = useState(payload?.voiceChannelId ?? template?.defaultVoiceChannelId ?? "");
  const [useFont, setUseFont] = useState(payload?.useFont ?? template?.useFont ?? false);
  const [startsAt, setStartsAt] = useState(payload ? toDatetimeLocalValue(new Date(payload.startsAt)) : (occurrence?.startsAt ?? ""));
  const [endsAt, setEndsAt] = useState(payload ? toDatetimeLocalValue(new Date(payload.endsAt)) : (occurrence?.endsAt ?? ""));
  const [deferred, setDeferred] = useState(!!scheduledEdit);
  const [publishAt, setPublishAt] = useState(scheduledEdit ? toDatetimeLocalValue(new Date(scheduledEdit.publishAt)) : "");
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

    const body = {
      title,
      description,
      channelId,
      mentionRoleId: mentionRoleId || null,
      voiceChannelId: voiceChannelId || null,
      useFont,
      startsAt: startDate.toISOString(),
      endsAt: endDate.toISOString(),
    };

    setPublishing(true);
    try {
      if (deferred) {
        if (!publishAt) return showError("Bitte einen Veröffentlichungszeitpunkt angeben.");
        const publishDate = new Date(publishAt);
        if (Number.isNaN(publishDate.getTime())) return showError("Ungültiger Veröffentlichungszeitpunkt.");
        if (publishDate >= startDate) return showError("Die Veröffentlichung muss vor dem Start liegen.");
        const scheduledBody = { ...body, publishAt: publishDate.toISOString() };
        if (scheduledEdit) await api.updateScheduledEventPublish(scheduledEdit.id, scheduledBody);
        else await api.scheduleEventPublish(scheduledBody);
        showSuccess(scheduledEdit ? "Geplante Veröffentlichung gespeichert." : "Veröffentlichung geplant.");
      } else {
        await api.publishEvent(body);
        showSuccess("Event veröffentlicht!");
      }
      onDone();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="card">
      <h2>{scheduledEdit ? `Geplante Veröffentlichung bearbeiten: ${title}` : `Event veröffentlichen: ${template?.name}`}</h2>
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

      {!scheduledEdit && (
        <label className="switch">
          <input type="checkbox" checked={deferred} onChange={(e) => setDeferred(e.target.checked)} />
          Später veröffentlichen
        </label>
      )}
      {deferred && (
        <div className="field">
          <label htmlFor="publish-at">Veröffentlichen am</label>
          <input id="publish-at" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          <div className="hint">Bis dahin wird nichts auf Discord gepostet — Änderungen sind jederzeit möglich.</div>
        </div>
      )}

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
          {publishing ? "Speichert…" : deferred ? "Planen" : "Veröffentlichen"}
        </button>
        <button onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}
