import type { ApolloEventStatus, ApolloRsvpChoice, AttendanceStatus } from "./types";

export const EVENT_STATUS_LABELS: Record<ApolloEventStatus, string> = {
  scheduled: "Geplant",
  active: "Läuft",
  completed: "Abgeschlossen",
  cancelled: "Abgesagt",
};
export const EVENT_STATUS_BADGE_CLASS: Record<ApolloEventStatus, string> = {
  scheduled: "warn",
  active: "ok",
  completed: "",
  cancelled: "error",
};

export const CHOICE_LABELS: Record<ApolloRsvpChoice, string> = {
  accepted: "Zugesagt",
  declined: "Abgesagt",
  tentative: "Vielleicht",
};
export const CHOICE_BADGE_CLASS: Record<ApolloRsvpChoice, string> = {
  accepted: "ok",
  declined: "error",
  tentative: "warn",
};

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  on_time: "Pünktlich",
  late: "Zu spät",
  no_show: "Nicht erschienen",
  left_early: "Früher gegangen",
  not_tracked: "Nicht getrackt",
};
export const ATTENDANCE_BADGE_CLASS: Record<AttendanceStatus, string> = {
  on_time: "ok",
  late: "warn",
  no_show: "error",
  left_early: "warn",
  not_tracked: "",
};
