import { useEffect, useState } from "react";
import SearchableSelect from "./SearchableSelect";
import TemplateEditor from "./TemplateEditor";
import EventEmbedPreview from "./EventEmbedPreview";
import { useToast } from "./ToastContext";
import { useChannels } from "../hooks/useChannels";
import { useVoiceChannels } from "../hooks/useVoiceChannels";
import { useRoles } from "../hooks/useRoles";
import { useGeneralSettings } from "../hooks/useGeneralSettings";
import { useEventConflicts } from "../hooks/useEventConflicts";
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

/** Fills in a template's default title/base description (both freely editable) plus channel/role/voice-channel/time, previews the resulting embed live, and publishes it (or, ticked "Später veröffentlichen", schedules it for later — see `useScheduledEventPublishes`). Used from the Vorlagen tab's row action, the Anwesenheit tab's "Neues Event" flow, and (via `scheduledEdit`) the Geplant tab's edit action. */
export default function PublishEventForm({ template, scheduledEdit, onDone, onCancel }: PublishEventFormProps) {
  const { showError, showSuccess } = useToast();
  const channels = useChannels();
  const voiceChannels = useVoiceChannels();
  const roles = useRoles();
  const generalSettings = useGeneralSettings();
  const payload = scheduledEdit?.payload;
  const [title, setTitle] = useState(payload?.title ?? template?.defaultTitle ?? "");
  const [description, setDescription] = useState(payload?.description ?? template?.baseDescription ?? "");
  const [channelId, setChannelId] = useState(payload?.channelId ?? template?.defaultChannelId ?? "");
  const [mentionRoleId, setMentionRoleId] = useState(payload?.mentionRoleId ?? template?.defaultMentionRoleId ?? "");
  const [voiceChannelId, setVoiceChannelId] = useState(payload?.voiceChannelId ?? template?.defaultVoiceChannelId ?? "");
  const [useFont, setUseFont] = useState(payload?.useFont ?? template?.useFont ?? false);
  const [startsAt, setStartsAt] = useState(payload ? toDatetimeLocalValue(new Date(payload.startsAt)) : "");
  const [endsAt, setEndsAt] = useState(payload ? toDatetimeLocalValue(new Date(payload.endsAt)) : "");
  const [deferred, setDeferred] = useState(!!scheduledEdit);
  const [publishAt, setPublishAt] = useState(scheduledEdit ? toDatetimeLocalValue(new Date(scheduledEdit.publishAt)) : "");
  const [publishing, setPublishing] = useState(false);

  // Create mode only (not editing a pending publish): prefill from the
  // template's recurring-time default, server-computed so it already skips
  // a date that's taken (see services/eventConflicts.ts) — replaces a former
  // client-side reimplementation that couldn't see the database. Only fills
  // in while both fields are still empty, so it never clobbers a value the
  // user already typed while this was in flight.
  useEffect(() => {
    if (!template || scheduledEdit) return;
    let cancelled = false;
    api
      .nextTemplateOccurrence(template.id)
      .then((occurrence) => {
        if (cancelled || !occurrence) return;
        setStartsAt((current) => current || toDatetimeLocalValue(new Date(occurrence.startsAt)));
        setEndsAt((current) => current || toDatetimeLocalValue(new Date(occurrence.endsAt)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, scheduledEdit]);

  const startIso = startsAt ? new Date(startsAt).toISOString() : null;
  const endIso = endsAt ? new Date(endsAt).toISOString() : null;
  const conflicts = useEventConflicts(startIso, scheduledEdit?.id);

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
      {conflicts.length > 0 && (
        <div className="card attention-card">
          <h2>Für diesen Tag ist bereits etwas geplant</h2>
          <ul className="attention-list">
            {conflicts.map((c) => (
              <li key={`${c.kind}-${c.id}`}>
                <strong>{c.title}</strong> — {c.kind === "event" ? "Start" : "Start (geplant)"}{" "}
                {new Date(c.startsAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
                {c.kind === "scheduledPublish" && " — noch nicht veröffentlicht"}
              </li>
            ))}
          </ul>
        </div>
      )}

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
