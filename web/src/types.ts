export type SelectionType = "reactions" | "buttons" | "dropdown";
export type PanelMessageType = "text" | "embed";

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
