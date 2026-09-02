import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { setDisplayTimezone } from "./dateFormat";
import type { Me } from "./types";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import ReactionRoles from "./pages/ReactionRoles";
import Birthdays from "./pages/Birthdays";
import Commands from "./pages/Commands";
import MemberAudit from "./pages/MemberAudit";
import EventAttendance from "./pages/EventAttendance";
import Settings from "./pages/Settings";

export default function App() {
  // undefined = still checking; null = logged out; Me = logged in.
  const [me, setMe] = useState<Me | null | undefined>(undefined);

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
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/reaction-roles" element={<ReactionRoles />} />
        <Route path="/birthdays" element={<Birthdays />} />
        <Route path="/commands" element={<Commands />} />
        <Route path="/members" element={<MemberAudit />} />
        <Route path="/events" element={<EventAttendance />} />
        <Route path="/settings" element={<Settings me={me} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
