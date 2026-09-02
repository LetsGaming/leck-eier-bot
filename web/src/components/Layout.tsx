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

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
  /** Reads a pending-work count off `NavBadgeCounts` for this item's badge. */
  countKey?: keyof NavBadgeCounts;
}

interface NavBadgeCounts {
  pendingRegistrationCount: number;
  unmatchedSignupCount: number;
}

// Grouped (with a visual divider, see below) rather than one flat list:
// "needs attention" items accumulate ongoing work an admin checks
// regularly, "setup & config" items are visited far less often.
const ATTENTION_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Übersicht", icon: IconOverview, end: true },
  { to: "/members", label: "Mitgliederprüfung", icon: IconMembers, countKey: "pendingRegistrationCount" },
  { to: "/events", label: "Event-Anwesenheit", icon: IconEvents, countKey: "unmatchedSignupCount" },
];
const SETUP_NAV_ITEMS: NavItem[] = [
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

function NavLinks({ items, counts }: { items: NavItem[]; counts: NavBadgeCounts | null }) {
  return (
    <>
      {items.map((item) => {
        const count = item.countKey && counts ? counts[item.countKey] : 0;
        return (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
            <item.icon />
            {item.label}
            {count > 0 && (
              <span className="badge warn nav-badge" aria-label={`${count} ausstehend`}>
                {count}
              </span>
            )}
          </NavLink>
        );
      })}
    </>
  );
}

export default function Layout({ me, onLogout, children }: LayoutProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [counts, setCounts] = useState<NavBadgeCounts | null>(null);
  const location = useLocation();

  // Refetched on every navigation so approving a registration or resolving
  // an unmatched signup clears the sidebar badge without a full reload.
  useEffect(() => {
    api
      .status()
      .then((s) =>
        setCounts({
          pendingRegistrationCount: s.pendingRegistrationCount,
          unmatchedSignupCount: s.unmatchedSignupCount,
        }),
      )
      .catch(() => {});
  }, [location.pathname]);

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
        <NavLinks items={ATTENTION_NAV_ITEMS} counts={counts} />
        <div className="nav-divider" role="separator" />
        <NavLinks items={SETUP_NAV_ITEMS} counts={counts} />
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
