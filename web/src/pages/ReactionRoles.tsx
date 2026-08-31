import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import EmojiPicker from "../components/EmojiPicker";
import MessagePreview from "../components/MessagePreview";
import SearchableSelect from "../components/SearchableSelect";
import { useToast } from "../components/ToastContext";
import type {
  Channel,
  CreatePanelInput,
  EmojiOption,
  Mapping,
  Panel,
  PanelMessageType,
  RoleOption,
  SelectionType,
} from "../types";

const MAX_OPTIONS = 25; // Discord's own cap, for buttons and dropdowns alike.

type MessageSource = "simple" | "embed" | "existing";

function selectionHint(selectionType: SelectionType): string {
  switch (selectionType) {
    case "reactions":
      return "Members react on the message to pick a role.";
    case "buttons":
      return "Members click a button under the message. Up to 25 buttons (5 per row).";
    case "dropdown":
      return "Members pick from a dropdown menu under the message. Up to 25 options.";
  }
}

function multiRemovableHint(allowMultiple: boolean, removable: boolean): string {
  const multi = allowMultiple ? "hold more than one role from this panel at once" : "hold only one role from this panel at a time";
  const remove = removable ? "can give a role up again later" : "can never give a role back up once they have it (rules-acceptance style)";
  return `Members ${multi}, and ${remove}.`;
}

function parseMessageLink(link: string): { channelId: string; messageId: string } | null {
  const match = link.trim().match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { channelId: match[1]!, messageId: match[2]! };
}

/** Local editable buffer — title/description are plain strings ("" instead of null) since that's what a text input needs. Converted back to string | null on save. */
interface PanelFormState {
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

interface MappingDraft {
  emojiName: string;
  emojiId: string | null;
  roleId: string;
  label: string;
}

function emptyMappingDraft(): MappingDraft {
  return { emojiName: "", emojiId: null, roleId: "", label: "" };
}

export default function ReactionRoles() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [emojis, setEmojis] = useState<EmojiOption[]>([]);
  const [fontMap, setFontMap] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<PanelFormState>(emptyPanelForm());
  // Only meaningful while creating a new panel — both are fixed for the
  // panel's lifetime afterward.
  const [selectionType, setSelectionType] = useState<SelectionType>("reactions");
  const [attachMode, setAttachMode] = useState<"new" | "existing">("new");
  const [messageLink, setMessageLink] = useState("");
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>(emptyMappingDraft());
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<MappingDraft>(emptyMappingDraft());
  const [allowedRoleSearch, setAllowedRoleSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const { showError, showSuccess } = useToast();

  function loadAll() {
    Promise.all([api.panels(), api.channels(), api.roles(), api.emojis(), api.generalSettings()])
      .then(([p, c, r, e, s]) => {
        setPanels(p);
        setChannels(c);
        setRoles(r);
        setEmojis(e);
        setFontMap(s.fontMap);
      })
      .catch((err) => showError(errorMessage(err)));
  }

  useEffect(loadAll, []);

  const selected = typeof selectedId === "number" ? panels.find((p) => p.id === selectedId) ?? null : null;
  const effectiveSelectionType: SelectionType = selectedId === "new" ? selectionType : selected?.selectionType ?? "reactions";
  // True whenever the message we're pointed at isn't one the bot posts/edits
  // itself — either because we're creating a new panel in "attach" mode, or
  // because the selected existing panel was created that way (immutable).
  const isExistingMessageMode = selectedId === "new" ? attachMode === "existing" : !!selected && !selected.managed;
  const optionCap = effectiveSelectionType === "reactions" ? null : MAX_OPTIONS;
  const atOptionCap = optionCap !== null && (selected?.mappings.length ?? 0) >= optionCap;

  const messageSource: MessageSource = attachMode === "existing" ? "existing" : form.messageType === "text" ? "simple" : "embed";

  // A role can only grant one outcome per panel — once it's mapped to an
  // option, picking it again for a second option would just be ambiguous.
  const usedRoleIds = useMemo(() => new Set(selected?.mappings.map((m) => m.roleId) ?? []), [selected]);

  // Keeps already-checked roles visible even when they don't match the
  // current search, so typing never hides your existing selection.
  const filteredAllowedRoles = useMemo(() => {
    const q = allowedRoleSearch.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => r.name.toLowerCase().includes(q) || form.allowedRoleIds.includes(r.id));
  }, [roles, allowedRoleSearch, form.allowedRoleIds]);

  useEffect(() => {
    if (selectedId === "new") {
      setForm(emptyPanelForm());
      setSelectionType("reactions");
      setAttachMode("new");
      setMessageLink("");
    } else if (selected) {
      setForm(panelToForm(selected));
    }
    setMappingDraft(emptyMappingDraft());
    setEditingMappingId(null);
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

  function toggleAllowedRole(roleId: string) {
    setForm((f) => ({
      ...f,
      allowedRoleIds: f.allowedRoleIds.includes(roleId)
        ? f.allowedRoleIds.filter((id) => id !== roleId)
        : [...f.allowedRoleIds, roleId],
    }));
  }

  async function handleSavePanel() {
    if (!form.name.trim()) {
      showError("Give the panel a name.");
      return;
    }
    const attachingExisting = selectedId === "new" && attachMode === "existing";
    let existingLocation: { channelId: string; messageId: string } | null = null;
    if (attachingExisting) {
      existingLocation = parseMessageLink(messageLink);
      if (!existingLocation) {
        showError("Paste a valid message link (right-click the message → Copy Message Link).");
        return;
      }
    } else if (!form.channelId) {
      showError("Pick a channel first.");
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
        showSuccess("Panel created as a draft — add roles below, then click Send when ready.");
      } else if (typeof selectedId === "number") {
        saved = await api.updatePanel(selectedId, {
          ...form,
          title: form.title.trim() ? form.title : null,
          description: form.description.trim() ? form.description : null,
          allowedRoleIds: form.allowedRoleIds.length ? form.allowedRoleIds : null,
        });
        showSuccess(saved.sent ? "Panel saved and re-synced with Discord." : "Draft saved.");
      } else {
        return;
      }
      setPanels((prev) => {
        const exists = prev.some((p) => p.id === saved.id);
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
      });
      setSelectedId(saved.id);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePanel() {
    if (typeof selectedId !== "number") return;
    const confirmMsg =
      selected && !selected.managed
        ? "Delete this panel? The attached Discord message is left alone — only the reaction-role config is removed."
        : "Delete this panel and its Discord message?";
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await api.deletePanel(selectedId);
      setPanels((prev) => prev.filter((p) => p.id !== selectedId));
      setSelectedId(null);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (typeof selectedId !== "number") return;
    setBusy(true);
    try {
      const saved = await api.sendPanel(selectedId);
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      showSuccess("Panel sent — it's live on Discord now.");
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
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      showSuccess("Panel re-synced with Discord.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMapping() {
    if (typeof selectedId !== "number") return;
    if (!mappingDraft.roleId) {
      showError("Pick a role.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !mappingDraft.emojiName) {
      showError("Pick an emoji.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !mappingDraft.label.trim()) {
      showError(`A label is required for ${effectiveSelectionType === "buttons" ? "buttons" : "dropdown options"}.`);
      return;
    }
    if (atOptionCap) {
      showError(`Discord allows at most ${optionCap} options for this selection type.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.addMapping(selectedId, {
        emojiName: mappingDraft.emojiName || null,
        emojiId: mappingDraft.emojiId,
        roleId: mappingDraft.roleId,
        label: mappingDraft.label.trim() ? mappingDraft.label : null,
      });
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setMappingDraft(emptyMappingDraft());
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMapping(mappingId: number) {
    if (typeof selectedId !== "number") return;
    setBusy(true);
    try {
      const saved = await api.deleteMapping(selectedId, mappingId);
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleStartEditMapping(m: Mapping) {
    setEditingMappingId(m.id);
    setEditDraft({ emojiName: m.emojiName ?? "", emojiId: m.emojiId, roleId: m.roleId, label: m.label ?? "" });
  }

  function handleCancelEditMapping() {
    setEditingMappingId(null);
    setEditDraft(emptyMappingDraft());
  }

  async function handleSaveEditMapping() {
    if (typeof selectedId !== "number" || editingMappingId === null) return;
    if (!editDraft.roleId) {
      showError("Pick a role.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !editDraft.emojiName) {
      showError("Pick an emoji.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !editDraft.label.trim()) {
      showError(`A label is required for ${effectiveSelectionType === "buttons" ? "buttons" : "dropdown options"}.`);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.updateMapping(selectedId, editingMappingId, {
        emojiName: editDraft.emojiName || null,
        emojiId: editDraft.emojiId,
        roleId: editDraft.roleId,
        label: editDraft.label.trim() ? editDraft.label : null,
      });
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      handleCancelEditMapping();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(mappingId: number, direction: -1 | 1) {
    if (!selected) return;
    const ordered = [...selected.mappings].sort((a, b) => a.position - b.position).map((m) => m.id);
    const index = ordered.indexOf(mappingId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
    setBusy(true);
    try {
      const saved = await api.reorderMappings(selected.id, ordered);
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function roleName(roleId: string): string {
    return roles.find((r) => r.id === roleId)?.name ?? roleId;
  }

  function roleIsManageable(roleId: string): boolean {
    return roles.find((r) => r.id === roleId)?.manageable ?? true;
  }

  function emojiDisplay(m: { emojiId: string | null; emojiName: string | null }): string {
    if (m.emojiId) return `[${m.emojiName}]`;
    return m.emojiName ?? "—";
  }

  const optionWord = effectiveSelectionType === "reactions" ? "reaction" : effectiveSelectionType === "buttons" ? "button" : "option";

  return (
    <div>
      <h2>Reaction Roles</h2>

      <div className="rr-layout">
        <div className="rr-list">
          <button className={selectedId === "new" ? "active" : ""} onClick={() => selectPanel("new")}>
            + New panel
          </button>
          {panels.map((p) => (
            <button key={p.id} className={selectedId === p.id ? "active" : ""} onClick={() => selectPanel(p.id)}>
              #{p.id} — {p.name}
              {!p.sent && " (draft)"}
            </button>
          ))}
        </div>

        <div className="rr-editor">
          {selectedId === null ? (
            <p className="muted">Select a panel on the left, or create a new one.</p>
          ) : (
            <>
              {typeof selectedId === "number" && selected && !selected.sent && (
                <div className="alert" style={{ background: "var(--bg-inset)", border: "1px solid var(--border)" }}>
                  <strong>Draft</strong> — nothing has been posted to Discord yet. Configure everything below, then
                  click <strong>Send</strong> when you're ready.
                </div>
              )}

              <div className="card">
                <h2>Message</h2>

                <div className="field">
                  <label htmlFor="rr-name">Name</label>
                  <input
                    id="rr-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Enter a unique name"
                  />
                  <div className="hint">For your own reference in this list — not shown on the message itself.</div>
                </div>

                {selectedId === "new" ? (
                  <div className="field">
                    <label htmlFor="rr-message-source">Message type</label>
                    <select
                      id="rr-message-source"
                      value={messageSource}
                      onChange={(e) => handleMessageSourceChange(e.target.value as MessageSource)}
                    >
                      <option value="simple">Simple message</option>
                      <option value="embed">Embedded message</option>
                      <option value="existing">Existing message</option>
                    </select>
                    <div className="hint">
                      {messageSource === "existing"
                        ? "Attach to a message an admin already wrote (e.g. server rules) — its content is never touched, only its reactions. Reactions only."
                        : "The bot posts a message listing the roles below and keeps it updated."}
                    </div>
                  </div>
                ) : (
                  selected?.managed && (
                    <div className="field">
                      <label htmlFor="rr-message-type">Message type</label>
                      <select
                        id="rr-message-type"
                        value={form.messageType}
                        onChange={(e) => setForm((f) => ({ ...f, messageType: e.target.value as PanelMessageType }))}
                      >
                        <option value="text">Simple message</option>
                        <option value="embed">Embedded message</option>
                      </select>
                    </div>
                  )
                )}
                {typeof selectedId === "number" && selected && !selected.managed && (
                  <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                    Attached to an existing message — its content is never edited.
                  </p>
                )}

                <div className="field">
                  <label htmlFor="rr-selection-type">Selection type</label>
                  <select
                    id="rr-selection-type"
                    value={effectiveSelectionType}
                    disabled={selectedId !== "new" || attachMode === "existing"}
                    onChange={(e) => setSelectionType(e.target.value as SelectionType)}
                  >
                    <option value="reactions">Reactions</option>
                    <option value="buttons" disabled={selectedId === "new" && attachMode === "existing"}>
                      Buttons
                    </option>
                    <option value="dropdown" disabled={selectedId === "new" && attachMode === "existing"}>
                      Dropdown menu
                    </option>
                  </select>
                  <div className="hint">
                    {selectedId === "new" ? selectionHint(selectionType) : "Fixed for this panel."}
                  </div>
                </div>

                {isExistingMessageMode ? (
                  selectedId === "new" && (
                    <div className="field">
                      <label htmlFor="rr-message-link">Message link</label>
                      <input
                        id="rr-message-link"
                        type="text"
                        value={messageLink}
                        onChange={(e) => setMessageLink(e.target.value)}
                        placeholder="https://discord.com/channels/…/…/…"
                      />
                      <div className="hint">Right-click the message → Copy Message Link. No need to pick a channel separately.</div>
                    </div>
                  )
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="rr-channel">Channel</label>
                      <SearchableSelect
                        id="rr-channel"
                        value={form.channelId}
                        onChange={(v) => setForm((f) => ({ ...f, channelId: v }))}
                        placeholder="Search channels…"
                        emptyLabel="— pick a channel —"
                        options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
                      />
                    </div>
                    {form.messageType === "embed" && (
                      <div className="field">
                        <label htmlFor="rr-title">Embed title</label>
                        <input
                          id="rr-title"
                          type="text"
                          value={form.title}
                          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                          placeholder={form.name || "Reaction Roles"}
                        />
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor="rr-description">Message text</label>
                      <textarea
                        id="rr-description"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder={
                          effectiveSelectionType === "reactions"
                            ? "React to get a role!"
                            : "Optional text shown above the buttons/menu"
                        }
                      />
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={form.useFont}
                        onChange={(e) => setForm((f) => ({ ...f, useFont: e.target.checked }))}
                      />
                      Use font
                    </label>
                    <div className="hint">
                      Styles the title/text/labels above with the font set on the{" "}
                      <a href="/settings">Settings page</a>, if one's configured.
                    </div>
                  </>
                )}

                <button className="primary" onClick={handleSavePanel} disabled={busy}>
                  {selectedId === "new" ? "Create draft panel" : "Save changes"}
                </button>
                {typeof selectedId === "number" && selected && (
                  <>
                    {selected.sent ? (
                      <button onClick={handleSync} disabled={busy}>
                        Re-sync with Discord
                      </button>
                    ) : (
                      <button className="primary" onClick={handleSend} disabled={busy || selected.mappings.length === 0}>
                        Send message
                      </button>
                    )}
                    <button className="danger" onClick={handleDeletePanel} disabled={busy}>
                      Delete panel
                    </button>
                  </>
                )}
                {selected?.messageId && (
                  <p className="hint" style={{ marginTop: 12 }}>
                    {selected.managed ? "Posted as" : "Attached to"} message <code>{selected.messageId}</code> in #
                    {channels.find((c) => c.id === selected.channelId)?.name ?? selected.channelId}
                  </p>
                )}
              </div>

              {!isExistingMessageMode && (
                <div className="card">
                  <h2>Preview</h2>
                  <MessagePreview
                    messageType={form.messageType}
                    selectionType={effectiveSelectionType}
                    title={form.title || form.name}
                    description={form.description}
                    mappings={selected?.mappings ?? []}
                    resolveRoleLabel={(m) => m.label ?? roleName(m.roleId)}
                    fontMap={fontMap}
                    useFont={form.useFont}
                  />
                </div>
              )}

              {typeof selectedId === "number" && selected && (
                <div className="card">
                  <h2>Roles</h2>
                  {selected.mappings.length === 0 && <p className="muted">No roles configured yet.</p>}
                  {[...selected.mappings]
                    .sort((a, b) => a.position - b.position)
                    .map((m, i, arr) =>
                      editingMappingId === m.id ? (
                        <div className="mapping-row" key={m.id}>
                          <EmojiPicker
                            value={{ emojiId: editDraft.emojiId, emojiName: editDraft.emojiName || null }}
                            onChange={(v) =>
                              setEditDraft((d) => ({ ...d, emojiId: v.emojiId, emojiName: v.emojiName ?? "" }))
                            }
                            customEmojis={emojis}
                            allowEmpty={effectiveSelectionType !== "reactions"}
                          />
                          <SearchableSelect
                            className="grow"
                            value={editDraft.roleId}
                            onChange={(v) => setEditDraft((d) => ({ ...d, roleId: v }))}
                            placeholder="Search roles…"
                            emptyLabel="— pick a role —"
                            options={roles
                              .filter((r) => !usedRoleIds.has(r.id) || r.id === m.roleId)
                              .map((r) => ({
                                value: r.id,
                                label: r.name,
                                disabled: !r.manageable,
                                hint: r.manageable ? undefined : "(not assignable)",
                              }))}
                          />
                          <input
                            type="text"
                            className="grow"
                            placeholder={
                              effectiveSelectionType === "reactions"
                                ? "Label (optional)"
                                : `${effectiveSelectionType === "buttons" ? "Button" : "Option"} text (required)`
                            }
                            value={editDraft.label}
                            onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                          />
                          <button className="primary" disabled={busy} onClick={handleSaveEditMapping}>
                            Save
                          </button>
                          <button disabled={busy} onClick={handleCancelEditMapping}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="mapping-row" key={m.id}>
                          {effectiveSelectionType === "reactions" && <span>{emojiDisplay(m)}</span>}
                          <span className="grow">
                            {roleName(m.roleId)}
                            {!roleIsManageable(m.roleId) && (
                              <span className="badge warn" style={{ marginLeft: 8 }}>
                                bot can't assign this role
                              </span>
                            )}
                            {m.label && <span className="muted"> — {m.label}</span>}
                            {effectiveSelectionType !== "reactions" && (m.emojiId || m.emojiName) && (
                              <span className="muted"> {emojiDisplay(m)}</span>
                            )}
                          </span>
                          <button disabled={busy || editingMappingId !== null} onClick={() => handleStartEditMapping(m)}>
                            Edit
                          </button>
                          <button disabled={busy || i === 0} onClick={() => handleMove(m.id, -1)}>
                            ↑
                          </button>
                          <button disabled={busy || i === arr.length - 1} onClick={() => handleMove(m.id, 1)}>
                            ↓
                          </button>
                          <button className="danger" disabled={busy} onClick={() => handleRemoveMapping(m.id)}>
                            Remove
                          </button>
                        </div>
                      ),
                    )}

                  <h2 style={{ marginTop: 20 }}>
                    Add {atOptionCap ? `(limit of ${optionCap} reached)` : `a ${optionWord}`}
                  </h2>
                  {!atOptionCap && (
                    <div className="mapping-row">
                      <EmojiPicker
                        value={{ emojiId: mappingDraft.emojiId, emojiName: mappingDraft.emojiName || null }}
                        onChange={(v) =>
                          setMappingDraft((d) => ({ ...d, emojiId: v.emojiId, emojiName: v.emojiName ?? "" }))
                        }
                        customEmojis={emojis}
                        allowEmpty={effectiveSelectionType !== "reactions"}
                      />
                      <SearchableSelect
                        className="grow"
                        value={mappingDraft.roleId}
                        onChange={(v) => setMappingDraft((d) => ({ ...d, roleId: v }))}
                        placeholder="Search roles…"
                        emptyLabel="— pick a role —"
                        options={roles
                          .filter((r) => !usedRoleIds.has(r.id))
                          .map((r) => ({
                            value: r.id,
                            label: r.name,
                            disabled: !r.manageable,
                            hint: r.manageable ? undefined : "(not assignable)",
                          }))}
                      />
                      <input
                        type="text"
                        className="grow"
                        placeholder={
                          effectiveSelectionType === "reactions"
                            ? "Label (optional)"
                            : `${effectiveSelectionType === "buttons" ? "Button" : "Option"} text (required)`
                        }
                        value={mappingDraft.label}
                        onChange={(e) => setMappingDraft((d) => ({ ...d, label: e.target.value }))}
                      />
                      <button className="primary" disabled={busy} onClick={handleAddMapping}>
                        Add
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selectedId === "new" && <p className="muted">Save the panel first, then add roles to it.</p>}

              {selectedId !== null && (
                <details className="card">
                  <summary>Advanced options</summary>
                  <div style={{ marginTop: 16 }}>
                    <div className="field">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={form.allowMultiple}
                          onChange={(e) => setForm((f) => ({ ...f, allowMultiple: e.target.checked }))}
                        />
                        Allow members to get more than one role from this panel
                      </label>
                    </div>
                    <div className="field">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={form.removable}
                          onChange={(e) => setForm((f) => ({ ...f, removable: e.target.checked }))}
                        />
                        Members can give a role back up once they have it
                      </label>
                      <div className="hint">{multiRemovableHint(form.allowMultiple, form.removable)}</div>
                    </div>

                    {effectiveSelectionType === "reactions" && (
                      <div className="field">
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={form.removeReaction}
                            onChange={(e) => setForm((f) => ({ ...f, removeReaction: e.target.checked }))}
                          />
                          Remove the user's reaction immediately after acting
                        </label>
                        <div className="hint">
                          Keeps the reaction count at 1. With this on, re-reacting the same option flips the role
                          on/off instead of un-reacting revoking it.
                        </div>
                      </div>
                    )}

                    <div className="field">
                      <label>Allowed roles</label>
                      {roles.length > 8 && (
                        <input
                          type="text"
                          placeholder="Search roles…"
                          value={allowedRoleSearch}
                          onChange={(e) => setAllowedRoleSearch(e.target.value)}
                          style={{ marginBottom: 6 }}
                        />
                      )}
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          background: "var(--bg-inset)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          padding: 8,
                          maxHeight: 140,
                          overflowY: "auto",
                        }}
                      >
                        {roles.length === 0 && <span className="muted">No roles found.</span>}
                        {roles.length > 0 && filteredAllowedRoles.length === 0 && (
                          <span className="muted">No matches.</span>
                        )}
                        {filteredAllowedRoles.map((r) => (
                          <label
                            key={r.id}
                            className="switch"
                            style={{ fontSize: 13, background: "var(--bg-elevated)", padding: "2px 8px", borderRadius: 999 }}
                          >
                            <input
                              type="checkbox"
                              checked={form.allowedRoleIds.includes(r.id)}
                              onChange={() => toggleAllowedRole(r.id)}
                            />
                            {r.name}
                          </label>
                        ))}
                      </div>
                      <div className="hint">
                        Only members holding one of these roles may use the panel. None selected = everyone.
                      </div>
                    </div>

                    <p className="hint">
                      These are part of the same panel settings above —{" "}
                      {selectedId === "new" ? "Create draft panel" : "Save changes"} saves them too.
                    </p>
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
