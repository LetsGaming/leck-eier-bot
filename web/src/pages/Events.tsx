import { useSearchParams } from "react-router-dom";
import Tabs from "../components/Tabs";
import EventAttendancePage from "./EventAttendance";
import EventTemplatesTab from "./EventTemplates";
import ScheduledEventsTab from "./ScheduledEvents";

const TABS = [
  { id: "anwesenheit", label: "Anwesenheit" },
  { id: "vorlagen", label: "Vorlagen" },
  { id: "geplant", label: "Geplant" },
];
const DEFAULT_TAB = "anwesenheit";

/** Merges event attendance/creation and template management under one page with tabs, matching Settings.tsx's `?tab=` pattern. */
export default function Events() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab = TABS.some((t) => t.id === rawTab) ? (rawTab as string) : DEFAULT_TAB;

  function setActiveTab(id: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", id);
      return next;
    });
  }

  return (
    <div>
      <h2>Event</h2>
      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "anwesenheit" && <EventAttendancePage />}
        {activeTab === "vorlagen" && <EventTemplatesTab />}
        {activeTab === "geplant" && <ScheduledEventsTab />}
      </div>
    </div>
  );
}
