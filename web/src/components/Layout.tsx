import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../api";
import {
  IconBirthdays,
  IconCommands,
  IconEvents,
  IconMembers,
  IconOverview,
  IconReactionRoles,
  IconSettings,
} from "./NavIcons";
import type { Me } from "../types";

const NAV_ITEMS: Array<{ to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; end?: boolean }> = [
  { to: "/", label: "Übersicht", icon: IconOverview, end: true },
  { to: "/members", label: "Mitgliederprüfung", icon: IconMembers },
  { to: "/events", label: "Event-Anwesenheit", icon: IconEvents },
  { to: "/reaction-roles", label: "Reaktionsrollen", icon: IconReactionRoles },
  { to: "/birthdays", label: "Geburtstage", icon: IconBirthdays },
  { to: "/commands", label: "Befehle", icon: IconCommands },
  { to: "/settings", label: "Einstellungen", icon: IconSettings },
];

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

interface LayoutProps {
  me: Me;
  onLogout: () => void;
  children: ReactNode;
}

export default function Layout({ me, onLogout, children }: LayoutProps) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Below the mobile breakpoint the sidebar is an off-canvas drawer — close
  // it on every navigation so picking a page doesn't leave it covering the
  // content you just asked for.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // While the drawer covers the screen, the page underneath shouldn't also
  // scroll, and Escape is a natural way to dismiss it.
  useEffect(() => {
    if (!navOpen) return;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  return (
    <div className="app-shell">
      <header className="mobile-topbar">
        <button
          className="menu-toggle"
          aria-label={navOpen ? "Menü schließen" : "Menü öffnen"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          <MenuIcon />
        </button>
        <span>leck-eier-bot</span>
      </header>

      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}

      <nav className={`sidebar${navOpen ? " open" : ""}`}>
        <h1>leck-eier-bot</h1>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
            <item.icon />
            {item.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="user">
          Angemeldet als <strong>{me.username}</strong> ({me.role})
          <div>
            <button onClick={handleLogout} style={{ marginTop: 8 }}>
              Abmelden
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
