import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
} from "discord.js";

/**
 * Creates a customizable embed.
 * @param {object} options - Options for the embed.
 * @param {string} options.title - The title of the embed.
 * @param {string} [options.description] - The description text.
 * @param {number} [options.color=0x00bfff] - The embed color.
 * @param {object} [options.footer] - Footer object with a `text` property.
 * @param {Date|string|number|boolean} [options.timestamp=true] - A Date or true to use current time, false to omit.
 * @returns {EmbedBuilder} - The constructed embed.
 */
export function createEmbed({
  title,
  description,
  color = 0x00bfff,
  footer,
  timestamp = true,
}) {
  const embed = new EmbedBuilder().setTitle(title).setColor(color);

  if (description) embed.setDescription(description);
  if (footer?.text) embed.setFooter(footer);
  if (timestamp === true) {
    embed.setTimestamp();
  } else if (
    timestamp instanceof Date ||
    typeof timestamp === "number" ||
    typeof timestamp === "string"
  ) {
    embed.setTimestamp(timestamp);
  }

  return embed;
}

/**
 * Adds multiple fields to an embed from a plain array.
 * @param {EmbedBuilder} embed - The embed to modify.
 * @param {Array} fields - Array of field objects: { name, value, inline }.
 * @returns {EmbedBuilder}
 */
export function addFieldsBulk(embed, fields = []) {
  if (!Array.isArray(fields)) return embed;
  return embed.addFields(fields);
}

/**
 * Shortcut for a standardized error embed.
 */
export function createErrorEmbed(message, { footer, timestamp = true } = {}) {
  return createEmbed({
    title: "❌ Error",
    description: message,
    color: 0xff5555,
    footer,
    timestamp,
  });
}

export function createNoAdminEmbed({ footer, timestamp = true } = {}) {
  return createEmbed({
    title: "❌ Access Denied",
    description: "You need administrator permissions to use this command.",
    color: 0xff5555,
    footer,
    timestamp,
  });
}

/**
 * Shortcut for a standardized success embed.
 */
export function createSuccessEmbed(message, { footer, timestamp = true } = {}) {
  return createEmbed({
    title: "✅ Success",
    description: message,
    color: 0x55ff55,
    footer,
    timestamp,
  });
}

/**
 * Shortcut for a standardized info embed.
 */
export function createInfoEmbed(message, { footer, timestamp = true } = {}) {
  return createEmbed({
    title: "ℹ️ Info",
    description: message,
    color: 0x3498db,
    footer,
    timestamp,
  });
}

/**
 * Embed with thumbnail image.
 */
export function createEmbedWithThumbnail({
  title,
  description,
  thumbnail,
  color = 0x00bfff,
  footer,
  timestamp = true,
}) {
  const embed = createEmbed({ title, description, color, footer, timestamp });
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

/**
 * Generates pagination buttons based on current page state.
 */
export function createPaginationButtons(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("first")
      .setLabel("⏮️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("◀️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1),

    new ButtonBuilder()
      .setCustomId("last")
      .setLabel("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

/**
 * Handles pagination interaction for a message using embed pages.
 */
export async function handlePagination(message, interaction, embeds) {
  let page = 0;
  const totalPages = embeds.length;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({
        content: "These buttons aren't for you.",
        ephemeral: true,
      });
    }

    switch (i.customId) {
      case "first":
        page = 0;
        break;
      case "prev":
        if (page > 0) page--;
        break;
      case "next":
        if (page < totalPages - 1) page++;
        break;
      case "last":
        page = totalPages - 1;
        break;
    }

    try {
      await i.update({
        embeds: [embeds[page]],
        components: [createPaginationButtons(page, totalPages)],
      });
    } catch (err) {
      console.warn("Failed to update page during pagination:", err.message);
    }
  });

  collector.on("end", async () => {
    if (interaction.ephemeral) return;
    try {
      await message.edit({ components: [] });
    } catch (err) {
      console.warn(
        "Failed to remove buttons after pagination timeout:",
        err.message
      );
    }
  });
}