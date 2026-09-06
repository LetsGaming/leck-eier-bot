import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that only updates `delayMs` after `value` stops
 * changing — the generic form of the hand-rolled `useState` + `useEffect` +
 * `setTimeout` debounce every search box in this codebase used to reinvent
 * (see `MemberAudit.tsx`'s `debouncedQuery` for the pre-extraction shape).
 *
 * Feeding the *debounced* value into a `useFetchedResource` `deps` array
 * (rather than the raw, every-keystroke value) means the fetch only fires
 * once typing settles, and the array stays honest — no
 * `eslint-disable-next-line react-hooks/exhaustive-deps` needed to hide a
 * deliberately-incomplete dependency list.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
