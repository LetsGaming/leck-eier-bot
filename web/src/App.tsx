import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { setDisplayTimezone } from "./dateFormat";
import type { Me } from "./types";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import ReactionRoles from "./pages/ReactionRoles";
import Birthdays from "./pages/Birthdays";
import Commands from "./pages/Commands";
import MemberAudit from "./pages/MemberAudit";
import EventAttendance from "./pages/EventAttendance";
import EventAttendanceDetail from "./pages/EventAttendanceDetail";
import Settings from "./pages/Settings";

export default function App() {
  // undefined = still checking; null = logged out; Me = logged in.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const location = useLocation();

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setDisplayTimezone(m.timezone);
        setMe(m);
      })
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="loading">Wird geladen…</div>;
  if (me === null) return <Login />;

  return (
    <Layout me={me} onLogout={() => setMe(null)}>
      {/* Keyed on the route so navigating away from a crashed page remounts
          the boundary fresh instead of continuing to show the old fallback. */}
      <ErrorBoundary key={location.pathname}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/reaction-roles" element={<ReactionRoles />} />
          <Route path="/birthdays" element={<Birthdays />} />
          <Route path="/commands" element={<Commands />} />
          <Route path="/members" element={<MemberAudit />} />
          <Route path="/events" element={<EventAttendance />} />
          <Route path="/events/:eventId" element={<EventAttendanceDetail />} />
          <Route path="/settings" element={<Settings me={me} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  );
}
