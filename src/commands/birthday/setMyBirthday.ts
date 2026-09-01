import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { upsertSelfBirthday } from "../../db/birthdaysRepository.js";
import { isValidCalendarDate, notifyBirthdayRegistration, syncAnchorMessage, toDateKey } from "../../services/birthdays.js";
import { createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { CommandName, CommandPermission } from "../../constants.js";

export const permission = CommandPermission.None;

export const data = new SlashCommandBuilder()
  .setName(CommandName.SetMyBirthday)
  .setDescription("Trage deinen eigenen Geburtstag ein.")
  .addIntegerOption((opt) =>
    opt.setName("day").setDescription("Tag des Monats").setRequired(true).setMinValue(1).setMaxValue(31),
  )
  .addIntegerOption((opt) =>
    opt.setName("month").setDescription("Monat").setRequired(true).setMinValue(1).setMaxValue(12),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const day = interaction.options.getInteger("day", true);
  const month = interaction.options.getInteger("month", true);

  if (!isValidCalendarDate(day, month)) {
    return interaction.reply({
      embeds: [createErrorEmbed("Das ist kein gültiges Datum.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const dateKey = toDateKey(day, month);
  const author = interaction.user;
  const mention = `<@${author.id}>`;
  const name =
    (interaction.member && "displayName" in interaction.member ? (interaction.member.displayName as string) : null) ??
    author.globalName ??
    author.username;

  upsertSelfBirthday({ date: dateKey, mention, userId: author.id, name });
  await notifyBirthdayRegistration(interaction.client, { mention, name, dateKey }, "command");
  await syncAnchorMessage(interaction.client);

  return interaction.reply({
    embeds: [createSuccessEmbed(`Dein Geburtstag wurde auf den **${dateKey}** gesetzt.`)],
    flags: MessageFlags.Ephemeral,
  });
}
