import { useEffect } from "react";
import type { RefObject } from "react";

export type ClickOutsideRef = RefObject<HTMLElement | null>;

/**
 * Closes a popover/dropdown on an outside `mousedown` and, opt-in, on
 * `Escape` — the pattern previously hand-duplicated (document listener +
 * `.contains()` check + cleanup) across EmojiPicker, MonthPicker,
 * SearchableSelect, and TemplateEditor.
 *
 * `refs` accepts one or more roots — anything inside any of them counts as
 * "inside" (SearchableSelect's portal-rendered popover needs a second root
 * alongside its trigger). `onClose` is read fresh whenever the listener
 * (re)subscribes rather than tracked as a dependency, so callers can pass an
 * inline closure without resubscribing on every render.
 */
export function useClickOutside(refs: ClickOutsideRef | ClickOutsideRef[], onClose: () => void, active: boolean, escape = false) {
  useEffect(() => {
    if (!active) return;
    const refList = Array.isArray(refs) ? refs : [refs];

    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (refList.some((r) => r.current?.contains(target))) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", onDocClick);
    if (escape) document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      if (escape) document.removeEventListener("keydown", onKeyDown);
    };
    // `refs`/`onClose` intentionally omitted: refs are stable ref objects,
    // and onClose only ever calls stable setters/closures, so reading it
    // fresh at (re)subscribe time (on `active`/`escape` change) is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, escape]);
}
