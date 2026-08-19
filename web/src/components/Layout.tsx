import type { ComponentType, ReactNode, SVGProps } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import {
  IconBirthdays,
  IconCommands,
  IconFindUser,
  IconOverview,
  IconReactionRoles,
  IconSettings,
} from "./NavIcons";
import type { Me } from "../types";

const NAV_ITEMS: Array<{ to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; end?: boolean }> = [
  { to: "/", label: "Overview", icon: IconOverview, end: true },
  { to: "/reaction-roles", label: "Reaction Roles", icon: IconReactionRoles },
  { to: "/birthdays", label: "Birthdays", icon: IconBirthdays },
  { to: "/commands", label: "Commands", icon: IconCommands },
  { to: "/find-user", label: "Find User", icon: IconFindUser },
  { to: "/settings", label: "Settings", icon: IconSettings },
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
            <item.icon />
            {item.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="user">
          Signed in as <strong>{me.username}</strong> ({me.role})
          <div>
            <button onClick={handleLogout} style={{ marginTop: 8 }}>
              Log out
            </button>
          </div>
        </div>
      </nav>
      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  );
}
