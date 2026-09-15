/**
 * A reusable event template — `defaultTitle`/`baseDescription` are plain
 * text (no token/placeholder syntax); both are pre-filled into the publish
 * form and edited freely from there. See `src/db/eventTemplatesRepository.ts`.
 */
export interface EventTemplateEntry {
  id: number;
  name: string;
  defaultTitle: string;
  baseDescription: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
  /** Recurring-time default ("this event is always Tuesdays at 8pm") — all three null means no default. 0=Sunday..6=Saturday. */
  defaultWeekday: number | null;
  /** "HH:MM", server timezone. */
  defaultStartTime: string | null;
  /** "HH:MM", server timezone. */
  defaultEndTime: string | null;
  useFont: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Response shape of `GET /api/event-templates`. */
export interface EventTemplateListResponse {
  templates: EventTemplateEntry[];
}

/** Body of `POST`/`PUT /api/event-templates(/:id)` — `defaultWeekday`/`defaultStartTime`/`defaultEndTime` must be all set or all null. */
export interface EventTemplateBody {
  name: string;
  defaultTitle: string;
  baseDescription: string;
  defaultChannelId: string | null;
  defaultMentionRoleId: string | null;
  defaultVoiceChannelId: string | null;
  defaultWeekday: number | null;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  useFont: boolean;
}

/**
 * Body of `POST /api/events/publish` — `title`/`description` are the final,
 * already-edited plain text (possibly copied from a template's
 * `defaultTitle`/`baseDescription` and then changed, possibly typed from
 * scratch). No rendering happens server-side; a template is just a
 * convenient starting point copied into the creation form, not referenced
 * by id at publish time.
 */
export interface PublishEventBody {
  title: string;
  description: string;
  channelId: string;
  /** A real role id, the literal string `"everyone"` for @everyone, or null for no mention. */
  mentionRoleId: string | null;
  /** Null = fall back to the global default at activation. */
  voiceChannelId: string | null;
  useFont: boolean;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC. */
  endsAt: string;
}

/** Body of `PATCH /api/events/:id` — only valid while the event is still `scheduled`. */
export interface EditEventBody {
  title: string;
  description: string;
  /** ISO UTC. */
  startsAt: string;
  /** ISO UTC. */
  endsAt: string;
}

/** Body of `POST`/`PATCH /api/events/scheduled(/:id)` — a `PublishEventBody` plus when to post it. Rejected server-side if `publishAt` isn't before `startsAt`. */
export interface ScheduledEventPublishBody extends PublishEventBody {
  /** ISO UTC. */
  publishAt: string;
}

/**
 * A pending (or resolved) deferred publish — not an event yet. See the v39
 * migration comment in `src/db/index.ts`: this is intentionally its own
 * entity, not an `events` row with a draft status.
 */
export interface ScheduledEventPublishEntry {
  id: number;
  /** ISO UTC. */
  publishAt: string;
  payload: PublishEventBody;
  /** Set once posted; null while still pending or failed. */
  publishedEventId: number | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Response shape of `POST /api/events/publish` and `PATCH /api/events/:id`. */
export interface PublishedEventEntry {
  id: number;
  messageId: string;
  channelId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  configuredVoiceChannelId: string | null;
  voiceChannelId: string | null;
  trackingIncomplete: boolean;
  remindedAt: string | null;
  useFont: boolean;
  createdAt: string;
  updatedAt: string;
}
