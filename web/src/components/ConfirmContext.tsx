import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /**
   * Set for irreversible/destructive actions — the confirm button stays
   * disabled until the admin types this exact word (case-insensitive),
   * matching the friction level to what's actually at stake (see the
   * dashboard critique's P0 finding on undifferentiated `window.confirm()`
   * usage). Omit for reversible/low-stakes confirmations.
   */
  requireText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button with `.danger` styling. Defaults to true when `requireText` is set. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

function ConfirmDialog({ pending, onClose }: { pending: PendingConfirm; onClose: (result: boolean) => void }) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (pending.requireText ? inputRef.current : cancelRef.current)?.focus();
  }, [pending.requireText]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose(false);
        return;
      }
      // Minimal focus trap — keeps Tab from leaving the dialog while it's open.
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, [href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const canConfirm = !pending.requireText || typed.trim().toLowerCase() === pending.requireText.trim().toLowerCase();
  const isDanger = pending.danger ?? !!pending.requireText;

  return (
    <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div
        className="confirm-dialog card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        ref={dialogRef}
      >
        <h2 id="confirm-dialog-title">{pending.title}</h2>
        <p id="confirm-dialog-message" className="muted">
          {pending.message}
        </p>
        {pending.requireText && (
          <div className="field">
            <label htmlFor="confirm-dialog-input">
              Tippe <strong>{pending.requireText}</strong> zur Bestätigung
            </label>
            <input
              id="confirm-dialog-input"
              ref={inputRef}
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}
        <div className="confirm-dialog-actions">
          <button ref={pending.requireText ? undefined : cancelRef} onClick={() => onClose(false)}>
            {pending.cancelLabel ?? "Abbrechen"}
          </button>
          <button className={isDanger ? "danger" : ""} disabled={!canConfirm} onClick={() => onClose(true)}>
            {pending.confirmLabel ?? "Bestätigen"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirmFn = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const handleClose = useCallback(
    (result: boolean) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirmFn}>
      {children}
      {pending && <ConfirmDialog pending={pending} onClose={handleClose} />}
    </ConfirmContext.Provider>
  );
}
