/**
 * Fills a fresh (already-migrated) database with realistic mock data, so
 * the dashboard shows actual content instead of empty-state placeholders
 * when explored under DEV_MOCK_DISCORD=true. Only ever run against the DB
 * scripts/dev-up.mjs just created — refuses to run otherwise (see the
 * DEV_MOCK_DISCORD guard below) so it can never touch a real database.
 *
 * User ids here intentionally match the five members in
 * src/web/mockDiscordClient.ts's MOCK_MEMBER_SPECS, so member records
 * seeded here line up with the live (mock) member cache the running
 * backend exposes — cross-linking, avatars, and display names all resolve
 * to the same five people instead of dangling ids.
 *
 * Must run AFTER the backend has started at least once: recordRulesAccepted
 * is an UPDATE against an existing member_records row, and those rows are
 * only created when the backend's boot sequence seeds them from the mock
 * member cache (src/index.ts's devMockDiscord branch) — see dev-up.mjs's
 * run order.
 */
import { insertBirthday } from "../src/db/birthdaysRepository.js";
import {
  recordRulesAccepted,
  recordLeave,
  savePendingRegistration,
  upsertJoin,
} from "../src/db/memberRecordsRepository.js";
import { createPanel, upsertMapping } from "../src/db/reactionRolesRepository.js";
import { upsertApolloEvent, setEventActive, setEventCompleted, replaceEventSignups, setSignupAttendance, listSignups } from "../src/db/eventAttendanceRepository.js";
import { SelectionType, PanelMessageType } from "../src/constants.js";

if (process.env.DEV_MOCK_DISCORD !== "true") {
  console.error("Refusing to seed: DEV_MOCK_DISCORD must be \"true\". This script only ever runs against a disposable mock database.");
  process.exit(1);
}

const MOCK_USER = {
  yuki: "100000000000000001",
  lark: "100000000000000002",
  ghost: "100000000000000003",
  sable: "100000000000000004",
  nightOwl: "100000000000000005",
};

// --- Birthdays ---------------------------------------------------------
insertBirthday({ date: "05.03", mention: `<@${MOCK_USER.yuki}>`, userId: MOCK_USER.yuki, name: null });
insertBirthday({ date: "18.07", mention: `<@${MOCK_USER.lark}>`, userId: MOCK_USER.lark, name: null });
insertBirthday({ date: "24.12", mention: `<@${MOCK_USER.ghost}>`, userId: MOCK_USER.ghost, name: null });
insertBirthday({ date: "02.01", mention: "@Ehemalige Person", userId: null, name: "Ehemalige Person" });

// --- Member records: rules accepted / former members --------------------
const now = new Date();
const daysAgo = (days: number): string => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

recordRulesAccepted(MOCK_USER.yuki, daysAgo(400));
recordRulesAccepted(MOCK_USER.lark, daysAgo(200));
recordRulesAccepted(MOCK_USER.ghost, daysAgo(90));
recordRulesAccepted(MOCK_USER.sable, daysAgo(28));

// A former member — left the server, still has history for the audit view.
recordLeave({
  userId: "100000000000000099",
  username: "departed_wanderer",
  displayName: "Departed Wanderer",
  avatar: null,
  timestamp: daysAgo(45),
});

// A still-pending registration awaiting manual review — savePendingRegistration
// only UPDATEs an existing row, so this member has to "join" first.
const PENDING_USER_ID = "100000000000000098";
upsertJoin({ userId: PENDING_USER_ID, username: "newcomer", displayName: "Neuling", avatar: null, joinedAt: daysAgo(1) });
savePendingRegistration({
  userId: PENDING_USER_ID,
  threadId: "mock-thread-pending-1",
  submittedAt: daysAgo(1),
  name: "Neuling",
  ssoName: "newcomer",
  age: "21",
});

// --- Reaction roles: one draft (unsent) panel ---------------------------
const panel = createPanel({
  name: "Interessen",
  channelId: "mock-channel-general",
  selectionType: SelectionType.Reactions,
  messageType: PanelMessageType.Text,
  removeReaction: false,
  allowMultiple: true,
  removable: true,
  allowedRoleIds: null,
  title: "Wähle deine Interessen",
  description: "Reagiere, um eine Rolle zu erhalten.",
  useFont: false,
});
upsertMapping({ panelId: panel.id, emojiName: "🎮", emojiId: null, roleIds: ["mock-role-member"], label: "Gaming", position: 0 });
upsertMapping({ panelId: panel.id, emojiName: "🎨", emojiId: null, roleIds: ["mock-role-member"], label: "Kreativ", position: 1 });

// --- Apollo events: one completed with tracked signups -------------------
const event = upsertApolloEvent({
  apolloEventId: "mock-apollo-1",
  messageId: "mock-message-event-1",
  channelId: "mock-channel-general",
  title: "Wöchentlicher Raid-Abend",
  startsAt: daysAgo(7),
  endsAt: daysAgo(7),
});
setEventActive(event.id, "mock-channel-voice", daysAgo(7));
replaceEventSignups(
  event.id,
  [
    { rawName: "Yuki", normalizedName: "yuki", choice: "Tank", userId: MOCK_USER.yuki, matchSource: "auto" },
    { rawName: "Lark", normalizedName: "lark", choice: "Heal", userId: MOCK_USER.lark, matchSource: "auto" },
    { rawName: "Ghost", normalizedName: "ghost", choice: "DPS", userId: MOCK_USER.ghost, matchSource: "auto" },
    { rawName: "Unbekannt#0000", normalizedName: "unbekannt#0000", choice: "DPS", userId: null, matchSource: "unmatched" },
  ],
  "active",
);
setEventCompleted(event.id, daysAgo(7));
for (const signup of listSignups(event.id)) {
  if (signup.userId === null) continue;
  setSignupAttendance(signup.id, {
    attendanceStatus: signup.userId === MOCK_USER.ghost ? "late" : "on_time",
    firstJoinedAt: daysAgo(7),
    lastLeftAt: daysAgo(7),
    lateMinutes: signup.userId === MOCK_USER.ghost ? 12 : 0,
    earlyMinutes: 0,
  });
}

console.log("✔ Mock data seeded: 4 birthdays, 4 member records (incl. 1 former, 1 pending), 1 reaction-role panel, 1 completed event with 4 signups.");
