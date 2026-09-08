import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm } from "./ConfirmContext";

interface UnsavedChangesContextValue {
  setUnsaved: (dirty: boolean) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

/**
 * Registers whether the calling page currently has unsaved changes, so
 * leaving it (tab close, refresh, typing a new address, or clicking another
 * in-app link) is gated behind a confirmation instead of silently dropping
 * an in-progress edit — the dashboard's template/settings fields have no
 * autosave-on-every-keystroke (deliberately: see Settings.tsx/Birthdays.tsx)
 * so a stray navigation is the one way real work gets lost with zero
 * warning. Call with the page's own aggregate dirty boolean; unregisters
 * itself automatically on unmount so a stale block can never linger after
 * navigating away.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) throw new Error("useUnsavedChanges must be used within an UnsavedChangesProvider");
  useEffect(() => {
    ctx.setUnsaved(dirty);
    return () => ctx.setUnsaved(false);
  }, [ctx, dirty]);
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  // A ref, not state: the guard only needs the *current* value inside event
  // handlers below, and re-rendering this provider on every keystroke of
  // every dirty field on every page would be pure waste.
  const dirtyRef = useRef(false);
  const confirmDialog = useConfirm();
  const navigate = useNavigate();

  const setUnsaved = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  // Tab close / refresh / typing a new address in the URL bar — the only
  // UI available at this point is the browser's own native prompt (no
  // custom dialog can run here), so this is a blunt but standard fallback.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // In-app navigation (sidebar links, in-page <Link>s). react-router v6's
  // plain <BrowserRouter> (this app doesn't use a data router — see
  // main.tsx) has no useBlocker, so this intercepts at the DOM level
  // instead: a capture-phase listener on `document` runs before a <Link>'s
  // own bubble-phase click handler, so stopping the event here pre-empts
  // the navigation entirely until the admin confirms losing the edit.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      // External links (Discord deep links, the fancy-text-generator hint,
      // …) and same-page hash anchors are real navigations/no navigations
      // this guard has no business blocking — only in-app route changes.
      if (!href || href.startsWith("http") || href.startsWith("#")) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      confirmDialog({
        title: "Ungespeicherte Änderungen",
        message: "Diese Seite hat ungespeicherte Änderungen, die beim Verlassen verloren gehen. Trotzdem fortfahren?",
        confirmLabel: "Verlassen",
      }).then((ok) => {
        if (!ok) return;
        dirtyRef.current = false;
        navigate(href);
      });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [confirmDialog, navigate]);

  return <UnsavedChangesContext.Provider value={{ setUnsaved }}>{children}</UnsavedChangesContext.Provider>;
}
