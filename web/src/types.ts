export type SelectionType = "reactions" | "buttons" | "dropdown";
export type PanelMessageType = "text" | "embed";

/** Strict hierarchy, highest first: 'bot-owner' (always total access) > 'guild-owner' > 'admin'. */
export type WebRole = "bot-owner" | "guild-owner" | "admin";

export interface Me {
  userId: string;
  username: string;
  avatar: string | null;
  role: WebRole;
}

export interface Status {
  botTag: string | null;
  uptimeMs: number;
  guildName: string | null;
  guildMemberCount: number | null;
  cachedMemberCount: number;
  reactionRolePanelCount: number;
}

export interface Channel {
  id: string;
  name: string;
  position: number;
}

export interface RoleOption {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  manageable: boolean;
}

export interface EmojiOption {
  id: string;
  name: string | null;
  animated: boolean;
}

export interface Mapping {
  id: number;
  panelId: number;
  /** Null for a buttons/dropdown option with no emoji — reactions always have one. */
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}

export interface Panel {
  id: number;
  name: string;
  channelId: string;
  messageId: string | null;
  managed: boolean;
  /** Immutable after creation. */
  selectionType: SelectionType;
  /** Ignored for an unmanaged (attached-to-existing-message) panel. */
  messageType: PanelMessageType;
  /** Reactions only. */
  removeReaction: boolean;
  allowMultiple: boolean;
  removable: boolean;
  allowedRoleIds: string[] | null;
  /** Draft panels haven't been posted to Discord yet — see the Send button. */
  sent: boolean;
  title: string | null;
  description: string | null;
  /** Renders the title, message text, and button/dropdown labels through the global font set on the Settings page, if one's configured. */
  useFont: boolean;
  createdAt: string;
  mappings: Mapping[];
}

export interface PanelInput {
  name: string;
  channelId: string;
  messageType: PanelMessageType;
  removeReaction: boolean;
  allowMultiple: boolean;
  removable: boolean;
  allowedRoleIds: string[] | null;
  title: string | null;
  description: string | null;
  useFont: boolean;
}

export interface CreatePanelInput extends PanelInput {
  selectionType: SelectionType;
  /** Attach to a pre-existing message (e.g. an admin's rules post) instead of having the bot post/manage its own. Create-only, reactions-only. */
  existingMessageId: string | null;
}

export interface MappingInput {
  emojiName: string | null;
  emojiId: string | null;
  roleId: string;
  label: string | null;
}

export interface BirthdaySettings {
  template: string;
  channelId: string | null;
  messageId: string | null;
  cron: string;
  /** Channel the bot posts a heads-up to whenever someone self-registers their birthday. Null = no notification posted. */
  modChannelId: string | null;
  /** Gates both self-registration paths (`/setmybirthday` and posting a date in the birthday channel). */
  selfRegistrationEnabled: boolean;
  /** Only settable while selfRegistrationEnabled is also true. */
  botManagesAnchor: boolean;
  /** `{month}`/`{entries}` placeholder template for each month's heading in the bot-managed anchor message. */
  anchorTemplate: string;
  /** Whether the anchor message's `{month}` heading renders through the global font set on the Settings page. */
  anchorUseFont: boolean;
  /** Whether the daily birthday announcement message renders through the global font set on the Settings page. */
  announcementUseFont: boolean;
}

export interface BirthdayEntry {
  mention: string;
  userId: string | null;
  name: string | null;
  /** 'list' = parsed from the manually-maintained announcement message; 'self' = registered via `/setmybirthday` or a message in the birthday channel. */
  source: "list" | "self";
}

export type BirthdaysByDate = Record<string, BirthdayEntry[]>;

export interface UpcomingBirthday {
  dateKey: string;
  /** Whole days from now, computed server-side (0 = today, 1 = tomorrow, ...) — see docs/DATABASE.md and the daysUntil() doc comment for why this isn't a timestamp. */
  daysUntil: number;
  entries: BirthdayEntry[];
}

export interface CommandDef {
  name: string;
  description: string;
  permission?: "none" | "admin" | "owner";
  enabled: boolean;
  guildOnly: boolean;
}

export interface GeneralSettings {
  leaveNotificationsEnabled: boolean;
  /** Pasted 52-character stylized alphabet (AaBbCc...XxYyZz, one for one), set once and reused by any feature with its own "use font" toggle — see Birthdays and Reaction Roles. Null = no font configured. */
  fontMap: string | null;
}

export interface MemberSearchResult {
  id: string;
  username: string;
  tag: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string;
}
