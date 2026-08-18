/**
 * Generates src/config_structure.json from the zod ConfigSchema so the
 * template file can never drift from what the app actually validates.
 * Each field's example value comes from its `.describe()` call in
 * src/config/schema.ts — update the schema, then re-run this script.
 */
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ConfigSchema } from "../src/config/schema.js";
import { CommandName } from "../src/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function example(description: string | undefined, field: string): string {
  if (description === undefined) {
    throw new Error(`ConfigSchema field "${field}" is missing a .describe() example value`);
  }
  return description;
}

const { shape } = ConfigSchema;

const template = {
  token: example(shape.token.description, "token"),
  clientId: example(shape.clientId.description, "clientId"),
  botOwnerId: example(shape.botOwnerId.description, "botOwnerId"),
  guildId: example(shape.guildId.description, "guildId"),
  birthdayListChannelId: example(shape.birthdayListChannelId.description, "birthdayListChannelId"),
  birthdayListMessageId: example(shape.birthdayListMessageId.description, "birthdayListMessageId"),
  commands: {
    [CommandName.RefreshBirthdays]: { enabled: true },
    [CommandName.ClearDm]: { enabled: true, guildOnly: false },
  },
};

// Sanity check: the generated template must satisfy the very schema it was built from.
ConfigSchema.parse(template);

const outPath = path.resolve(__dirname, "..", "src", "config_structure.json");
writeFileSync(outPath, JSON.stringify(template, null, 2) + "\n", "utf8");
console.log(`✔ Generated ${outPath}`);
