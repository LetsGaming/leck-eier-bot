import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../components/ConfirmContext";
import { usePanels } from "./usePanels";
import type { CreatePanelInput, Panel, PanelMessageType, SelectionType } from "../types";

export type MessageSource = "simple" | "embed" | "existing";

/** Local editable buffer — title/description are plain strings ("" instead of null) since that's what a text input needs. Converted back to string | null on save. */
export interface PanelFormState {
  name: string;
  channelId: string;
  messageType: PanelMessageType;
  removeReaction: boolean;
  allowMultiple: boolean;
  removable: boolean;
  allowedRoleIds: string[];
  title: string;
  description: string;
  useFont: boolean;
}

function emptyPanelForm(): PanelFormState {
  return {
    name: "",
    channelId: "",
    messageType: "text",
    removeReaction: false,
    allowMultiple: false,
    removable: true,
    allowedRoleIds: [],
    title: "",
    description: "",
    useFont: false,
  };
}

function panelToForm(panel: Panel): PanelFormState {
  return {
    name: panel.name,
    channelId: panel.channelId,
    messageType: panel.messageType,
    removeReaction: panel.removeReaction,
    allowMultiple: panel.allowMultiple,
    removable: panel.removable,
    allowedRoleIds: panel.allowedRoleIds ?? [],
    title: panel.title ?? "",
    description: panel.description ?? "",
    useFont: panel.useFont,
  };
}

function parseMessageLink(link: string): { channelId: string; messageId: string } | null {
  const match = link.trim().match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { channelId: match[1]!, messageId: match[2]! };
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Mirrors Birthdays.tsx/Settings.tsx's per-card `savedX` convention — compares against the last-persisted (or last-loaded) form snapshot so `formDirty` reflects only actual, uncommitted edits. */
function sameForm(a: PanelFormState, b: PanelFormState): boolean {
  return (
    a.name === b.name &&
    a.channelId === b.channelId &&
    a.messageType === b.messageType &&
    a.removeReaction === b.removeReaction &&
    a.allowMultiple === b.allowMultiple &&
    a.removable === b.removable &&
    a.title === b.title &&
    a.description === b.description &&
    a.useFont === b.useFont &&
    sameStringArray(a.allowedRoleIds, b.allowedRoleIds)
  );
}

/**
 * Owns the panel list resource, the currently-selected/edited panel's draft
 * form state, and the create/save/delete/send/sync handlers for it —
 * everything in `ReactionRoles.tsx` that isn't specific to a single mapping
 * row (see `useMappingEditor` for that half). `busy`/`setBusy` are exposed
 * rather than kept private because the mapping editor's handlers share the
 * exact same busy flag — one in-flight request (panel or mapping) disables
 * every button on the page, matching the pre-split behavior where both
 * lived in one component's single `busy` state.
 */
export function usePanelEditor() {
  const panelsRes = usePanels();
  const panels = panelsRes.data ?? [];
  const { showError, showSuccess } = useToast();
  const confirmDialog = useConfirm();

  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<PanelFormState>(emptyPanelForm());
  // Mirror of the last-persisted (or last-loaded) form — see
  // Birthdays.tsx/Settings.tsx's identical `savedX` convention. Reset
  // alongside `form` itself below, so it also re-syncs after a panel save
  // (the reset effect re-fires once `selected`'s object identity changes,
  // which `panelsRes.setData` does on every successful save) and correctly
  // clears `formDirty` at that point instead of leaving it permanently true.
  const [savedForm, setSavedForm] = useState<PanelFormState>(emptyPanelForm());
  const formDirty = !sameForm(form, savedForm);
  // Only meaningful while creating a new panel — both are fixed for the
  // panel's lifetime afterward.
  const [selectionType, setSelectionType] = useState<SelectionType>("reactions");
  const [attachMode, setAttachMode] = useState<"new" | "existing">("new");
  const [messageLink, setMessageLink] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = typeof selectedId === "number" ? panels.find((p) => p.id === selectedId) ?? null : null;
  const effectiveSelectionType: SelectionType = selectedId === "new" ? selectionType : selected?.selectionType ?? "reactions";
  // True whenever the message we're pointed at isn't one the bot posts/edits
  // itself — either because we're creating a new panel in "attach" mode, or
  // because the selected existing panel was created that way (immutable).
  const isExistingMessageMode = selectedId === "new" ? attachMode === "existing" : !!selected && !selected.managed;
  const messageSource: MessageSource = attachMode === "existing" ? "existing" : form.messageType === "text" ? "simple" : "embed";

  useEffect(() => {
    if (selectedId === "new") {
      const f = emptyPanelForm();
      setForm(f);
      setSavedForm(f);
      setSelectionType("reactions");
      setAttachMode("new");
      setMessageLink("");
    } else if (selected) {
      const f = panelToForm(selected);
      setForm(f);
      setSavedForm(f);
    }
  }, [selectedId, selected]);

  function selectPanel(id: number | "new") {
    setSelectedId(id);
  }

  function handleMessageSourceChange(source: MessageSource) {
    if (source === "existing") {
      setAttachMode("existing");
      setSelectionType("reactions"); // only selection type existing messages support
    } else {
      setAttachMode("new");
      setForm((f) => ({ ...f, messageType: source === "simple" ? "text" : "embed" }));
    }
  }

  async function handleSavePanel() {
    if (!form.name.trim()) {
      showError("Gib dem Panel einen Namen.");
      return;
    }
    const attachingExisting = selectedId === "new" && attachMode === "existing";
    let existingLocation: { channelId: string; messageId: string } | null = null;
    if (attachingExisting) {
      existingLocation = parseMessageLink(messageLink);
      if (!existingLocation) {
        showError("Füge einen gültigen Nachrichtenlink ein (Rechtsklick auf die Nachricht → Nachrichtenlink kopieren).");
        return;
      }
    } else if (!form.channelId) {
      showError("Wähle zuerst einen Kanal aus.");
      return;
    }
    setBusy(true);
    try {
      let saved: Panel;
      if (selectedId === "new") {
        const body: CreatePanelInput = {
          ...form,
          channelId: attachingExisting ? existingLocation!.channelId : form.channelId,
          selectionType,
          title: attachingExisting || !form.title.trim() ? null : form.title,
          description: attachingExisting || !form.description.trim() ? null : form.description,
          allowedRoleIds: form.allowedRoleIds.length ? form.allowedRoleIds : null,
          existingMessageId: attachingExisting ? existingLocation!.messageId : null,
        };
        saved = await api.createPanel(body);
        showSuccess("Panel als Entwurf erstellt — füge unten Rollen hinzu und klicke dann auf Senden, wenn du bereit bist.");
      } else if (typeof selectedId === "number") {
        saved = await api.updatePanel(selectedId, {
          ...form,
          title: form.title.trim() ? form.title : null,
          description: form.description.trim() ? form.description : null,
          allowedRoleIds: form.allowedRoleIds.length ? form.allowedRoleIds : null,
        });
        showSuccess(saved.sent ? "Panel gespeichert und mit Discord synchronisiert." : "Entwurf gespeichert.");
      } else {
        return;
      }
      panelsRes.setData((prev) => {
        const list = prev ?? [];
        const exists = list.some((p) => p.id === saved.id);
        return exists ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved];
      });
      setSelectedId(saved.id);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePanel() {
    if (typeof selectedId !== "number" || !selected) return;
    const message =
      !selected.managed
        ? "Die angehängte Discord-Nachricht bleibt unangetastet — nur die Reaktionsrollen-Konfiguration wird entfernt."
        : "Das Panel und die zugehörige Discord-Nachricht werden unwiderruflich gelöscht.";
    const ok = await confirmDialog({
      title: "Panel löschen",
      message,
      requireText: selected.managed ? selected.name : undefined,
      confirmLabel: "Löschen",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deletePanel(selectedId);
      panelsRes.setData((prev) => prev?.filter((p) => p.id !== selectedId) ?? null);
      setSelectedId(null);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(channelName: string) {
    if (typeof selectedId !== "number") return;
    const ok = await confirmDialog({
      title: "Nachricht senden",
      message: `Der Bot postet diese Nachricht jetzt live in #${channelName} — alle Mitglieder mit Zugriff auf den Kanal sehen sie sofort.`,
      confirmLabel: "Senden",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const saved = await api.sendPanel(selectedId);
      panelsRes.setData((prev) => prev?.map((p) => (p.id === saved.id ? saved : p)) ?? null);
      showSuccess("Panel gesendet — es ist jetzt live auf Discord.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    if (typeof selectedId !== "number") return;
    setBusy(true);
    try {
      const saved = await api.syncPanel(selectedId);
      panelsRes.setData((prev) => prev?.map((p) => (p.id === saved.id ? saved : p)) ?? null);
      showSuccess("Panel mit Discord synchronisiert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return {
    panelsRes,
    panels,
    selectedId,
    selectPanel,
    selected,
    form,
    setForm,
    formDirty,
    selectionType,
    setSelectionType,
    attachMode,
    messageLink,
    setMessageLink,
    busy,
    setBusy,
    effectiveSelectionType,
    isExistingMessageMode,
    messageSource,
    handleMessageSourceChange,
    handleSavePanel,
    handleDeletePanel,
    handleSend,
    handleSync,
  };
}
