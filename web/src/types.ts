export type ReactionRoleMode = "toggle" | "unique" | "verify";

export interface Me {
  userId: string;
  username: string;
  avatar: string | null;
  isOwner: boolean;
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
  emojiName: string;
  emojiId: string | null;
  roleId: string;
  label: string | null;
  position: number;
}

export interface Panel {
  id: number;
  channelId: string;
  messageId: string | null;
  managed: boolean;
  mode: ReactionRoleMode;
  removeReaction: boolean;
  title: string | null;
  description: string | null;
  createdAt: string;
  mappings: Mapping[];
}

export interface PanelInput {
  channelId: string;
  mode: ReactionRoleMode;
  removeReaction: boolean;
  title: string | null;
  description: string | null;
}

export interface MappingInput {
  emojiName: string;
  emojiId: string | null;
  roleId: string;
  label: string | null;
}

export interface BirthdaySettings {
  template: string;
  channelId: string | null;
  messageId: string | null;
  cron: string;
}

export interface BirthdayEntry {
  mention: string;
  userId: string | null;
  name: string | null;
}

export type BirthdaysByDate = Record<string, BirthdayEntry[]>;

export interface CommandDef {
  name: string;
  description: string;
  permission?: "none" | "admin" | "owner";
  enabled: boolean;
  guildOnly: boolean;
}

export interface GeneralSettings {
  leaveNotificationsEnabled: boolean;
}
