import { useRef } from "react";
import type { KeyboardEvent } from "react";

export interface TabDef {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * A generic tab strip: `role="tablist"` of `role="tab"` buttons with
 * `aria-selected` and roving `tabIndex` (only the active tab is in the tab
 * order; ArrowLeft/ArrowRight/Home/End move focus and selection between the
 * others), matching the standard ARIA tabs pattern. Modeled on the rigor of
 * `SearchableSelect.tsx` (combobox pattern) adapted to tabs — selecting a
 * tab here activates it immediately (no separate "activate" keypress),
 * which is the conventional behavior for a tablist that swaps visible panel
 * content rather than committing a value.
 */
export default function Tabs({ tabs, active, onChange, className }: TabsProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  function focusTab(index: number) {
    const el = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index];
    el?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case "ArrowRight": {
        e.preventDefault();
        const next = (index + 1) % tabs.length;
        onChange(tabs[next].id);
        focusTab(next);
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const prev = (index - 1 + tabs.length) % tabs.length;
        onChange(tabs[prev].id);
        focusTab(prev);
        break;
      }
      case "Home": {
        e.preventDefault();
        onChange(tabs[0].id);
        focusTab(0);
        break;
      }
      case "End": {
        e.preventDefault();
        const last = tabs.length - 1;
        onChange(tabs[last].id);
        focusTab(last);
        break;
      }
    }
  }

  return (
    <div className={`tabs${className ? ` ${className}` : ""}`} role="tablist" ref={rootRef}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            className={isActive ? "active" : ""}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
