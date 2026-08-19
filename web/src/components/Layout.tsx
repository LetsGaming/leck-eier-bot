import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { Me } from "../types";

const NAV_ITEMS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/", label: "Overview", end: true },
  { to: "/reaction-roles", label: "Reaction Roles" },
  { to: "/birthdays", label: "Birthdays" },
  { to: "/commands", label: "Commands" },
  { to: "/settings", label: "Settings" },
];

interface LayoutProps {
  me: Me;
  onLogout: () => void;
  children: ReactNode;
}

export default function Layout({ me, onLogout, children }: LayoutProps) {
  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <h1>leck-eier-bot</h1>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {item.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="user">
          Signed in as <strong>{me.username}</strong>
          {me.isOwner ? " (owner)" : ""}
          <div>
            <button onClick={handleLogout} style={{ marginTop: 8 }}>
              Log out
            </button>
          </div>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
