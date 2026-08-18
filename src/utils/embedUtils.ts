import { EmbedBuilder } from "discord.js";
import { EmbedColor } from "../constants.js";

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedFooter {
  text: string;
  iconURL?: string;
}

export interface CreateEmbedOptions {
  title: string;
  description?: string;
  color?: EmbedColor;
  footer?: EmbedFooter;
  timestamp?: Date | string | number | boolean;
  fields?: EmbedField[];
}

/**
 * Creates a customizable embed.
 */
export function createEmbed({
  title,
  description,
  color = EmbedColor.Default,
  footer,
  timestamp = true,
  fields,
}: CreateEmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(color);

  if (description) embed.setDescription(description);
  if (footer?.text) embed.setFooter(footer);

  if (timestamp === true) {
    embed.setTimestamp();
  } else if (timestamp instanceof Date || typeof timestamp === "number") {
    embed.setTimestamp(timestamp);
  } else if (typeof timestamp === "string") {
    embed.setTimestamp(new Date(timestamp));
  }

  if (Array.isArray(fields)) {
    fields.forEach((f) => {
      if (f.name && f.value) embed.addFields(f);
    });
  }

  return embed;
}

interface SimpleEmbedOptions {
  footer?: EmbedFooter;
  timestamp?: Date | string | number | boolean;
}

/**
 * Shortcut for a standardized error embed.
 */
export function createErrorEmbed(message: string, { footer, timestamp = true }: SimpleEmbedOptions = {}): EmbedBuilder {
  return createEmbed({
    title: "❌ Error",
    description: message,
    color: EmbedColor.Error,
    footer,
    timestamp,
  });
}

export function createNoAdminEmbed({ footer, timestamp = true }: SimpleEmbedOptions = {}): EmbedBuilder {
  return createEmbed({
    title: "❌ Access Denied",
    description: "You need administrator permissions to use this command.",
    color: EmbedColor.Error,
    footer,
    timestamp,
  });
}

/**
 * Shortcut for a standardized success embed.
 */
export function createSuccessEmbed(message: string, { footer, timestamp = true }: SimpleEmbedOptions = {}): EmbedBuilder {
  return createEmbed({
    title: "✅ Success",
    description: message,
    color: EmbedColor.Success,
    footer,
    timestamp,
  });
}
