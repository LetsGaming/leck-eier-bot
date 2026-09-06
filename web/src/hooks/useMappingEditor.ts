import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import type { FetchedResource } from "./useFetchedResource";
import type { Mapping, Panel, SelectionType } from "../types";

const MAX_OPTIONS = 25; // Discord's own cap, for buttons and dropdowns alike.

export interface MappingDraft {
  emojiName: string;
  emojiId: string | null;
  roleIds: string[];
  label: string;
}

function emptyMappingDraft(): MappingDraft {
  return { emojiName: "", emojiId: null, roleIds: [], label: "" };
}

/**
 * Owns the add-new-mapping and edit-existing-mapping draft state for the
 * given panel, plus the add/edit/remove/reorder handlers. `busy`/`setBusy`
 * are shared with `usePanelEditor` (passed in, not owned here) so a panel
 * save and a mapping save disable the exact same set of buttons, matching
 * pre-split behavior.
 *
 * The reset effect keys on `panel` itself (its object identity), not just
 * its id — `usePanels`'s `setData` swaps in a new `Panel` object after
 * every mutation (including mapping add/edit/remove/reorder), so this
 * mirrors the original component's single `useEffect([selectedId, selected])`,
 * which cleared both drafts on every one of those object-identity changes
 * too, not just on switching panels.
 */
export function useMappingEditor(
  panel: Panel | null,
  effectiveSelectionType: SelectionType,
  panelsRes: FetchedResource<Panel[]>,
  busy: boolean,
  setBusy: Dispatch<SetStateAction<boolean>>,
) {
  const { showError } = useToast();
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>(emptyMappingDraft());
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<MappingDraft>(emptyMappingDraft());

  const optionCap = effectiveSelectionType === "reactions" ? null : MAX_OPTIONS;
  const atOptionCap = optionCap !== null && (panel?.mappings.length ?? 0) >= optionCap;

  // A role can only grant one outcome per panel — once it's mapped to an
  // option, picking it again for a second option (even as part of a
  // different multi-role Reactions option) would just be ambiguous.
  const usedRoleIds = useMemo(() => new Set(panel?.mappings.flatMap((m) => m.roleIds) ?? []), [panel]);

  useEffect(() => {
    setMappingDraft(emptyMappingDraft());
    setEditingMappingId(null);
  }, [panel]);

  async function handleAddMapping() {
    if (!panel) return;
    if (mappingDraft.roleIds.length === 0) {
      showError("Wähle mindestens eine Rolle aus.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !mappingDraft.emojiName) {
      showError("Wähle ein Emoji aus.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !mappingDraft.label.trim()) {
      showError(`Für ${effectiveSelectionType === "buttons" ? "Buttons" : "Dropdown-Optionen"} ist eine Beschriftung erforderlich.`);
      return;
    }
    if (atOptionCap) {
      showError(`Discord erlaubt maximal ${optionCap} Optionen für diesen Auswahltyp.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.addMapping(panel.id, {
        emojiName: mappingDraft.emojiName || null,
        emojiId: mappingDraft.emojiId,
        roleIds: mappingDraft.roleIds,
        label: mappingDraft.label.trim() ? mappingDraft.label : null,
      });
      panelsRes.setData((prev) => prev?.map((p) => (p.id === saved.id ? saved : p)) ?? null);
      setMappingDraft(emptyMappingDraft());
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMapping(mappingId: number) {
    if (!panel) return;
    setBusy(true);
    try {
      const saved = await api.deleteMapping(panel.id, mappingId);
      panelsRes.setData((prev) => prev?.map((p) => (p.id === saved.id ? saved : p)) ?? null);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleStartEditMapping(m: Mapping) {
    setEditingMappingId(m.id);
    setEditDraft({ emojiName: m.emojiName ?? "", emojiId: m.emojiId, roleIds: m.roleIds, label: m.label ?? "" });
  }

  function handleCancelEditMapping() {
    setEditingMappingId(null);
    setEditDraft(emptyMappingDraft());
  }

  async function handleSaveEditMapping() {
    if (!panel || editingMappingId === null) return;
    if (editDraft.roleIds.length === 0) {
      showError("Wähle mindestens eine Rolle aus.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !editDraft.emojiName) {
      showError("Wähle ein Emoji aus.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !editDraft.label.trim()) {
      showError(`Für ${effectiveSelectionType === "buttons" ? "Buttons" : "Dropdown-Optionen"} ist eine Beschriftung erforderlich.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.updateMapping(panel.id, editingMappingId, {
        emojiName: editDraft.emojiName || null,
        emojiId: editDraft.emojiId,
        roleIds: editDraft.roleIds,
        label: editDraft.label.trim() ? editDraft.label : null,
      });
      panelsRes.setData((prev) => prev?.map((p) => (p.id === saved.id ? saved : p)) ?? null);
      handleCancelEditMapping();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(mappingId: number, direction: -1 | 1) {
    if (!panel) return;
    const ordered = [...panel.mappings].sort((a, b) => a.position - b.position).map((m) => m.id);
    const index = ordered.indexOf(mappingId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
    setBusy(true);
    try {
      const saved = await api.reorderMappings(panel.id, ordered);
      panelsRes.setData((prev) => prev?.map((p) => (p.id === saved.id ? saved : p)) ?? null);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return {
    mappingDraft,
    setMappingDraft,
    editingMappingId,
    editDraft,
    setEditDraft,
    optionCap,
    atOptionCap,
    usedRoleIds,
    handleAddMapping,
    handleRemoveMapping,
    handleStartEditMapping,
    handleCancelEditMapping,
    handleSaveEditMapping,
    handleMove,
    busy,
  };
}
