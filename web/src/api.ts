import type {
  BirthdayEntryInput,
  BirthdaySettings,
  BirthdaysByDate,
  Channel,
  CommandDef,
  CreatePanelInput,
  EmojiOption,
  EventAttendance,
  EventAttendanceListResponse,
  EventMonths,
  GeneralSettings,
  InGuildMembersResponse,
  Mapping,
  MappingInput,
  Me,
  MemberAuditResponse,
  MemberOverview,
  PermissionGate,
  Registration,
  UpcomingBirthday,
  Panel,
  PanelInput,
  RoleOption,
  Status,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data && String(data.error)) || res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

export const api = {
  me: () => request<Me>("/me"),
  logout: () => fetch("/auth/logout", { method: "POST", credentials: "same-origin" }),

  status: () => request<Status>("/status"),

  channels: () => request<Channel[]>("/discord/channels"),
  voiceChannels: () => request<Channel[]>("/discord/voice-channels"),
  roles: () => request<RoleOption[]>("/discord/roles"),
  emojis: () => request<EmojiOption[]>("/discord/emojis"),

  memberAudit: (query: string, opts: { limit?: number; offset?: number } = {}) => {
    const search = new URLSearchParams({ q: query });
    if (opts.limit !== undefined) search.set("limit", String(opts.limit));
    if (opts.offset !== undefined) search.set("offset", String(opts.offset));
    return request<MemberAuditResponse>(`/members/audit?${search.toString()}`);
  },
  // Lightweight variant of memberAudit() for callers (e.g.
  // EventAttendanceDetail.tsx's member-linking dropdown) that only need
  // currently-in-guild members — skips the former-members query server-side.
  inGuildMembers: (query = "") =>
    request<InGuildMembersResponse>(`/members/audit?inGuildOnly=1&q=${encodeURIComponent(query)}`),
  registrations: (query = "", opts: { limit?: number; offset?: number } = {}) => {
    const search = new URLSearchParams({ q: query });
    if (opts.limit !== undefined) search.set("limit", String(opts.limit));
    if (opts.offset !== undefined) search.set("offset", String(opts.offset));
    return request<Registration[]>(`/members/registrations?${search.toString()}`);
  },
  memberOverview: (userId: string) => request<MemberOverview>(`/members/${userId}`),
  removeRegistration: (userId: string) => request<void>(`/members/registrations/${userId}`, { method: "DELETE" }),
  approveRegistration: (userId: string) =>
    request<void>(`/members/registrations/${userId}/approve`, { method: "POST" }),

  eventAttendanceList: (params: { month?: string; q?: string; scope?: "month" | "all"; problems?: "0" | "1" } = {}) => {
    const search = new URLSearchParams();
    if (params.month) search.set("month", params.month);
    if (params.q) search.set("q", params.q);
    if (params.scope) search.set("scope", params.scope);
    if (params.problems) search.set("problems", params.problems);
    const qs = search.toString();
    return request<EventAttendanceListResponse>(`/events/attendance${qs ? `?${qs}` : ""}`);
  },
  eventAttendanceMonths: () => request<EventMonths>("/events/attendance/months"),
  eventAttendance: (id: number) => request<EventAttendance>(`/events/attendance/${id}`),
  linkEventSignup: (signupId: number, userId: string | null) =>
    request<EventAttendance>(`/events/attendance/signups/${signupId}`, { method: "PATCH", ...json({ userId }) }),
  deleteEventAttendance: (id: number) => request<void>(`/events/attendance/${id}`, { method: "DELETE" }),

  panels: () => request<Panel[]>("/reaction-roles/panels"),
  createPanel: (body: CreatePanelInput) => request<Panel>("/reaction-roles/panels", { method: "POST", ...json(body) }),
  updatePanel: (id: number, body: PanelInput) =>
    request<Panel>(`/reaction-roles/panels/${id}`, { method: "PATCH", ...json(body) }),
  deletePanel: (id: number) => request<void>(`/reaction-roles/panels/${id}`, { method: "DELETE" }),
  syncPanel: (id: number) => request<Panel>(`/reaction-roles/panels/${id}/sync`, { method: "POST" }),
  sendPanel: (id: number) => request<Panel>(`/reaction-roles/panels/${id}/send`, { method: "POST" }),
  addMapping: (panelId: number, body: MappingInput) =>
    request<Panel>(`/reaction-roles/panels/${panelId}/mappings`, { method: "POST", ...json(body) }),
  updateMapping: (panelId: number, mappingId: number, body: MappingInput) =>
    request<Panel>(`/reaction-roles/panels/${panelId}/mappings/${mappingId}`, { method: "PATCH", ...json(body) }),
  deleteMapping: (panelId: number, mappingId: number) =>
    request<Panel>(`/reaction-roles/panels/${panelId}/mappings/${mappingId}`, { method: "DELETE" }),
  reorderMappings: (panelId: number, orderedIds: number[]) =>
    request<Panel>(`/reaction-roles/panels/${panelId}/mappings/reorder`, { method: "POST", ...json({ orderedIds }) }),

  birthdaySettings: () => request<BirthdaySettings>("/settings/birthday"),
  updateBirthdaySettings: (body: Partial<BirthdaySettings>) =>
    request<BirthdaySettings>("/settings/birthday", { method: "PATCH", ...json(body) }),
  syncBirthdayAnchor: () => request<{ ok: boolean }>("/settings/birthday/sync-anchor", { method: "POST" }),
  birthdays: () => request<BirthdaysByDate>("/birthdays"),
  upcomingBirthdays: () => request<UpcomingBirthday[]>("/birthdays/upcoming"),
  addBirthday: (body: BirthdayEntryInput) => request<{ id: number }>("/birthdays", { method: "POST", ...json(body) }),
  updateBirthday: (id: number, body: BirthdayEntryInput) =>
    request<{ ok: boolean }>(`/birthdays/${id}`, { method: "PATCH", ...json(body) }),
  deleteBirthday: (id: number) => request<void>(`/birthdays/${id}`, { method: "DELETE" }),

  commands: () => request<CommandDef[]>("/commands"),
  updateCommand: (
    name: string,
    body: { enabled?: boolean; guildOnly?: boolean; permissionGate?: PermissionGate | null },
  ) => request<CommandDef>(`/commands/${name}`, { method: "PATCH", ...json(body) }),

  generalSettings: () => request<GeneralSettings>("/settings/general"),
  updateGeneralSettings: (body: Partial<GeneralSettings>) =>
    request<GeneralSettings>("/settings/general", { method: "PATCH", ...json(body) }),
};

export type { Mapping };
