import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import type { Channel, EmojiOption, Panel, PanelInput, ReactionRoleMode, RoleOption } from "../types";

const MODE_HINTS: Record<ReactionRoleMode, string> = {
  toggle: "React grants the role, un-reacting revokes it.",
  unique: "Only one option in this panel can be held at a time — picking a new one revokes the previous role and clears its reaction.",
  verify: "React grants the role. Un-reacting never revokes it (good for rules-acceptance / one-way opt-ins).",
};

/** Local editable buffer — unlike `PanelInput`, title/description are plain strings ("" instead of null) since that's what a text input needs. Converted back to string | null on save. */
interface PanelFormState {
  channelId: string;
  mode: ReactionRoleMode;
  removeReaction: boolean;
  title: string;
  description: string;
}

function emptyPanelForm(): PanelFormState {
  return { channelId: "", mode: "toggle", removeReaction: false, title: "", description: "" };
}

function panelToForm(panel: Panel): PanelFormState {
  return {
    channelId: panel.channelId,
    mode: panel.mode,
    removeReaction: panel.removeReaction,
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

  useEffect(() => {
    if (selectedId === "new") {
      setForm(emptyPanelForm());
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

  async function handleSavePanel() {
    if (!form.channelId) {
      setError("Pick a channel first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: PanelInput = {
        ...form,
        title: form.title.trim() ? form.title : null,
        description: form.description.trim() ? form.description : null,
      };
      let saved: Panel;
      if (selectedId === "new") {
        saved = await api.createPanel(body);
      } else if (typeof selectedId === "number") {
        saved = await api.updatePanel(selectedId, body);
      } else {
        return;
      }
      setPanels((prev) => {
        const exists = prev.some((p) => p.id === saved.id);
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
      });
      setSelectedId(saved.id);
      setNotice("Panel saved and posted/updated in Discord.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePanel() {
    if (typeof selectedId !== "number") return;
    if (!confirm("Delete this panel and its Discord message?")) return;
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
    if (!mappingDraft.emojiName || !mappingDraft.roleId) {
      setError("Pick both an emoji and a role.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.addMapping(selectedId, {
        emojiName: mappingDraft.emojiName,
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

  function emojiDisplay(m: { emojiId: string | null; emojiName: string }): string {
    return m.emojiId ? `[${m.emojiName}]` : m.emojiName;
  }

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
              #{p.id} — {p.title || "Untitled"}
            </button>
          ))}
        </div>

        <div className="rr-editor">
          {selectedId === null ? (
            <p className="muted">Select a panel on the left, or create a new one.</p>
          ) : (
            <>
              <div className="card">
                <h2>Panel settings</h2>
                <div className="field">
                  <label htmlFor="rr-title">Title</label>
                  <input
                    id="rr-title"
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Reaction Roles"
                  />
                </div>
                <div className="field">
                  <label htmlFor="rr-description">Description</label>
                  <textarea
                    id="rr-description"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Optional text shown above the role list"
                  />
                </div>
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
                <div className="field">
                  <label htmlFor="rr-mode">Mode</label>
                  <select
                    id="rr-mode"
                    value={form.mode}
                    onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as ReactionRoleMode }))}
                  >
                    <option value="toggle">Toggle</option>
                    <option value="unique">Unique (one at a time)</option>
                    <option value="verify">Verify (add-only)</option>
                  </select>
                  <div className="mode-hint">{MODE_HINTS[form.mode]}</div>
                </div>
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
                    Keeps the reaction count at 1. With this on, re-reacting the same option{" "}
                    {form.mode === "verify" ? "does nothing else — verify never revokes." : "flips the role on/off"}.
                  </div>
                </div>
                <button className="primary" onClick={handleSavePanel} disabled={busy}>
                  {selectedId === "new" ? "Create panel" : "Save changes"}
                </button>
                {typeof selectedId === "number" && (
                  <>
                    <button onClick={handleSync} disabled={busy}>
                      Re-sync with Discord
                    </button>
                    <button className="danger" onClick={handleDeletePanel} disabled={busy}>
                      Delete panel
                    </button>
                  </>
                )}
                {selected?.messageId && (
                  <p className="hint" style={{ marginTop: 12 }}>
                    Posted as message <code>{selected.messageId}</code> in #{channels.find((c) => c.id === selected.channelId)?.name ?? selected.channelId}
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
                        <span>{emojiDisplay(m)}</span>
                        <span className="grow">
                          {roleName(m.roleId)}
                          {!roleIsManageable(m.roleId) && (
                            <span className="badge warn" style={{ marginLeft: 8 }}>
                              bot can't assign this role
                            </span>
                          )}
                          {m.label && <span className="muted"> — {m.label}</span>}
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

                  <h2 style={{ marginTop: 20 }}>Add a role</h2>
                  <div className="mapping-row">
                    <input
                      type="text"
                      style={{ width: 90 }}
                      placeholder="🎉"
                      value={mappingDraft.emojiId ? "" : mappingDraft.emojiName}
                      onChange={(e) => setMappingDraft((d) => ({ ...d, emojiName: e.target.value, emojiId: null }))}
                    />
                    <select
                      value={mappingDraft.emojiId ?? ""}
                      onChange={(e) => {
                        const emoji = emojis.find((em) => em.id === e.target.value);
                        if (!emoji) {
                          setMappingDraft((d) => ({ ...d, emojiId: null }));
                        } else {
                          setMappingDraft((d) => ({ ...d, emojiId: emoji.id, emojiName: emoji.name ?? emoji.id }));
                        }
                      }}
                    >
                      <option value="">or pick a server emoji…</option>
                      {emojis.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
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
                      placeholder="Label (optional)"
                      value={mappingDraft.label}
                      onChange={(e) => setMappingDraft((d) => ({ ...d, label: e.target.value }))}
                    />
                    <button className="primary" disabled={busy} onClick={handleAddMapping}>
                      Add
                    </button>
                  </div>
                </div>
              )}

              {selectedId === "new" && (
                <p className="muted">Save the panel first, then add roles to it.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
