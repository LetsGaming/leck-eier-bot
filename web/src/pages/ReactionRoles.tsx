import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import EmojiPicker from "../components/EmojiPicker";
import type {
  Channel,
  CreatePanelInput,
  EmojiOption,
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
}

function emptyPanelForm(): PanelFormState {
  return {
    name: "",
    channelId: "",
    messageType: "embed",
    removeReaction: false,
    allowMultiple: false,
    removable: true,
    allowedRoleIds: [],
    title: "",
    description: "",
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
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<PanelFormState>(emptyPanelForm());
  // Only meaningful while creating a new panel — both are fixed for the
  // panel's lifetime afterward.
  const [selectionType, setSelectionType] = useState<SelectionType>("reactions");
  const [attachMode, setAttachMode] = useState<"new" | "existing">("new");
  const [messageLink, setMessageLink] = useState("");
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>(emptyMappingDraft());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loadAll() {
    Promise.all([api.panels(), api.channels(), api.roles(), api.emojis()])
      .then(([p, c, r, e]) => {
        setPanels(p);
        setChannels(c);
        setRoles(r);
        setEmojis(e);
      })
      .catch((err) => setError(errorMessage(err)));
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
  }, [selectedId, selected]);

  function selectPanel(id: number | "new") {
    setError(null);
    setNotice(null);
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
      setError("Give the panel a name.");
      return;
    }
    const attachingExisting = selectedId === "new" && attachMode === "existing";
    let existingLocation: { channelId: string; messageId: string } | null = null;
    if (attachingExisting) {
      existingLocation = parseMessageLink(messageLink);
      if (!existingLocation) {
        setError("Paste a valid message link (right-click the message → Copy Message Link).");
        return;
      }
    } else if (!form.channelId) {
      setError("Pick a channel first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
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
        setNotice("Panel created as a draft — add roles below, then click Send when ready.");
      } else if (typeof selectedId === "number") {
        saved = await api.updatePanel(selectedId, {
          ...form,
          title: form.title.trim() ? form.title : null,
          description: form.description.trim() ? form.description : null,
          allowedRoleIds: form.allowedRoleIds.length ? form.allowedRoleIds : null,
        });
        setNotice(saved.sent ? "Panel saved and re-synced with Discord." : "Draft saved.");
      } else {
        return;
      }
      setPanels((prev) => {
        const exists = prev.some((p) => p.id === saved.id);
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
      });
      setSelectedId(saved.id);
    } catch (err) {
      setError(errorMessage(err));
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
    setError(null);
    try {
      await api.deletePanel(selectedId);
      setPanels((prev) => prev.filter((p) => p.id !== selectedId));
      setSelectedId(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (typeof selectedId !== "number") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.sendPanel(selectedId);
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setNotice("Panel sent — it's live on Discord now.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    if (typeof selectedId !== "number") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.syncPanel(selectedId);
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setNotice("Panel re-synced with Discord.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMapping() {
    if (typeof selectedId !== "number") return;
    if (!mappingDraft.roleId) {
      setError("Pick a role.");
      return;
    }
    if (effectiveSelectionType === "reactions" && !mappingDraft.emojiName) {
      setError("Pick an emoji.");
      return;
    }
    if (effectiveSelectionType !== "reactions" && !mappingDraft.label.trim()) {
      setError(`A label is required for ${effectiveSelectionType === "buttons" ? "buttons" : "dropdown options"}.`);
      return;
    }
    if (atOptionCap) {
      setError(`Discord allows at most ${optionCap} options for this selection type.`);
      return;
    }
    setBusy(true);
    setError(null);
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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMapping(mappingId: number) {
    if (typeof selectedId !== "number") return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.deleteMapping(selectedId, mappingId);
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    } catch (err) {
      setError(errorMessage(err));
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
    setError(null);
    try {
      const saved = await api.reorderMappings(selected.id, ordered);
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    } catch (err) {
      setError(errorMessage(err));
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
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

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
                      <select
                        id="rr-channel"
                        value={form.channelId}
                        onChange={(e) => setForm((f) => ({ ...f, channelId: e.target.value }))}
                      >
                        <option value="">— pick a channel —</option>
                        {channels.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.name}
                          </option>
                        ))}
                      </select>
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

              {typeof selectedId === "number" && selected && (
                <div className="card">
                  <h2>Roles</h2>
                  {selected.mappings.length === 0 && <p className="muted">No roles configured yet.</p>}
                  {[...selected.mappings]
                    .sort((a, b) => a.position - b.position)
                    .map((m, i, arr) => (
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
                    ))}

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
                      <select
                        className="grow"
                        value={mappingDraft.roleId}
                        onChange={(e) => setMappingDraft((d) => ({ ...d, roleId: e.target.value }))}
                      >
                        <option value="">— pick a role —</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id} disabled={!r.manageable}>
                            {r.name}
                            {!r.manageable ? " (not assignable)" : ""}
                          </option>
                        ))}
                      </select>
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
                        {roles.map((r) => (
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
