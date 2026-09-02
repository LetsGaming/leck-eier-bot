import type {
  BirthdayEntryInput,
  BirthdaySettings,
  BirthdaysByDate,
  Channel,
  CommandDef,
  CreatePanelInput,
  EmojiOption,
  GeneralSettings,
  Mapping,
  MappingInput,
  Me,
  MemberAuditResponse,
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
  roles: () => request<RoleOption[]>("/discord/roles"),
  emojis: () => request<EmojiOption[]>("/discord/emojis"),

  memberAudit: (query: string) => request<MemberAuditResponse>(`/members/audit?q=${encodeURIComponent(query)}`),
  registrations: () => request<Registration[]>("/members/registrations"),
  removeRegistration: (userId: string) => request<void>(`/members/registrations/${userId}`, { method: "DELETE" }),

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
  previewBirthday: (template: string) =>
    request<{ rendered: string }>("/settings/birthday/preview", { method: "POST", ...json({ template }) }),
  syncBirthdayAnchor: () => request<{ ok: boolean }>("/settings/birthday/sync-anchor", { method: "POST" }),
  birthdays: () => request<BirthdaysByDate>("/birthdays"),
  upcomingBirthdays: () => request<UpcomingBirthday[]>("/birthdays/upcoming"),
  addBirthday: (body: BirthdayEntryInput) => request<{ id: number }>("/birthdays", { method: "POST", ...json(body) }),
  updateBirthday: (id: number, body: BirthdayEntryInput) =>
    request<{ ok: boolean }>(`/birthdays/${id}`, { method: "PATCH", ...json(body) }),
  deleteBirthday: (id: number) => request<void>(`/birthdays/${id}`, { method: "DELETE" }),

  commands: () => request<CommandDef[]>("/commands"),
  updateCommand: (name: string, body: { enabled?: boolean; guildOnly?: boolean }) =>
    request<CommandDef>(`/commands/${name}`, { method: "PATCH", ...json(body) }),

  generalSettings: () => request<GeneralSettings>("/settings/general"),
  updateGeneralSettings: (body: Partial<GeneralSettings>) =>
    request<GeneralSettings>("/settings/general", { method: "PATCH", ...json(body) }),
};

export type { Mapping };
