import type { Dispatch, SetStateAction } from "react";
import EmojiPicker from "./EmojiPicker";
import RoleCheckboxList from "./RoleCheckboxList";
import SearchableSelect from "./SearchableSelect";
import type { MappingDraft } from "../hooks/useMappingEditor";
import type { EmojiOption, RoleOption, SelectionType } from "../types";

interface MappingFormProps {
  draft: MappingDraft;
  setDraft: Dispatch<SetStateAction<MappingDraft>>;
  onSubmit: () => void;
  submitLabel: string;
  /** Present only for the edit-existing-mapping form — renders a second button next to submit. */
  onCancel?: () => void;
  cancelLabel?: string;
  selectionType: SelectionType;
  emojis: EmojiOption[];
  roles: RoleOption[];
  usedRoleIds: Set<string>;
  /**
   * Role ids that stay selectable even though they're in `usedRoleIds` —
   * used by the edit form to keep the mapping-being-edited's own roles
   * pickable (it's not "used by another option", it's used by this one).
   * The add-new form has nothing to exempt, so it defaults to none.
   */
  extraAllowedRoleIds?: string[];
  busy: boolean;
}

/**
 * Renders one emoji/role(s)/label row plus its submit (and optional cancel)
 * button — the shape shared by both the "add a new mapping" row and the
 * "edit an existing mapping" row in `ReactionRoles.tsx`, which were
 * previously two near-identical, hand-duplicated JSX blocks.
 */
export default function MappingForm({
  draft,
  setDraft,
  onSubmit,
  submitLabel,
  onCancel,
  cancelLabel,
  selectionType,
  emojis,
  roles,
  usedRoleIds,
  extraAllowedRoleIds = [],
  busy,
}: MappingFormProps) {
  const isRoleAllowed = (roleId: string) => !usedRoleIds.has(roleId) || extraAllowedRoleIds.includes(roleId);

  return (
    <div className="mapping-row">
      <EmojiPicker
        value={{ emojiId: draft.emojiId, emojiName: draft.emojiName || null }}
        onChange={(v) => setDraft((d) => ({ ...d, emojiId: v.emojiId, emojiName: v.emojiName ?? "" }))}
        customEmojis={emojis}
        allowEmpty={selectionType !== "reactions"}
      />
      {selectionType === "reactions" ? (
        <RoleCheckboxList
          className="grow"
          placeholder="Rollen durchsuchen…"
          value={draft.roleIds}
          onChange={(ids) => setDraft((d) => ({ ...d, roleIds: ids }))}
          options={roles
            .filter((r) => isRoleAllowed(r.id))
            .map((r) => ({
              value: r.id,
              label: r.name,
              disabled: !r.manageable && !draft.roleIds.includes(r.id),
              hint: r.manageable ? undefined : "(nicht zuweisbar)",
            }))}
        />
      ) : (
        <SearchableSelect
          className="grow"
          value={draft.roleIds[0] ?? ""}
          onChange={(v) => setDraft((d) => ({ ...d, roleIds: v ? [v] : [] }))}
          placeholder="Rollen durchsuchen…"
          emptyLabel="— Rolle wählen —"
          options={roles
            .filter((r) => isRoleAllowed(r.id))
            .map((r) => ({
              value: r.id,
              label: r.name,
              disabled: !r.manageable,
              hint: r.manageable ? undefined : "(nicht zuweisbar)",
            }))}
        />
      )}
      <input
        type="text"
        className="grow"
        placeholder={
          selectionType === "reactions"
            ? "Beschriftung (optional)"
            : `${selectionType === "buttons" ? "Button" : "Options"}text (erforderlich)`
        }
        value={draft.label}
        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
      />
      <button className="primary" disabled={busy} onClick={onSubmit}>
        {submitLabel}
      </button>
      {onCancel && (
        <button disabled={busy} onClick={onCancel}>
          {cancelLabel ?? "Abbrechen"}
        </button>
      )}
    </div>
  );
}
