import type { GuildMember } from "discord.js";
import { getSettings } from "../db/settingsRepository.js";
import { completeRegistration } from "../events/registerWatcher.js";
import type { BotClient } from "../types.js";

/**
 * A member only sees #register while holding the register-gate role
 * (granted via reaction to the rules message). Once staff manually grant
 * the lowest membership tier role at registration, the gate role no longer
 * serves any purpose and is stripped so the channel disappears for them.
 * `registrationTierRoleId` must be the lowest tier specifically — later
 * promotions swap between higher tiers and must never re-trigger this.
 */
export async function stripRegisterGateRoleIfJustRegistered(
  client: BotClient,
  oldMember: GuildMember,
  newMember: GuildMember,
): Promise<void> {
  const { registerGateRoleId, registrationTierRoleId } = getSettings();
  if (!registerGateRoleId || !registrationTierRoleId) return;

  const justGotRegistrationTier =
    !oldMember.roles.cache.has(registrationTierRoleId) && newMember.roles.cache.has(registrationTierRoleId);
  if (!justGotRegistrationTier) return;

  // The pending-registration thread's job (see registerWatcher.ts) is done
  // the moment staff grant the tier role, regardless of whether this member
  // ever held the gate role in the first place.
  await completeRegistration(client, newMember.id);

  if (!newMember.roles.cache.has(registerGateRoleId)) return;

  await newMember.roles.remove(registerGateRoleId, "Registriert — benötigt #register-Sichtbarkeit nicht mehr");
}
