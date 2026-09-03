import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import EmojiPicker from "../components/EmojiPicker";
import RoleCheckboxList from "../components/RoleCheckboxList";
import MessagePreview from "../components/MessagePreview";
import SearchableSelect from "../components/SearchableSelect";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../components/ConfirmContext";
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
      return "Mitglieder reagieren auf die Nachricht, um eine Rolle zu wählen.";
    case "buttons":
      return "Mitglieder klicken auf einen Button unter der Nachricht. Bis zu 25 Buttons (5 pro Reihe).";
    case "dropdown":
      return "Mitglieder wählen aus einem Dropdown-Menü unter der Nachricht. Bis zu 25 Optionen.";
  }
}

function multiRemovableHint(allowMultiple: boolean, removable: boolean): string {
  const multi = allowMultiple ? "gleichzeitig mehr als eine Rolle aus diesem Panel besitzen" : "gleichzeitig nur eine Rolle aus diesem Panel besitzen";
  const remove = removable ? "eine Rolle später wieder abgeben können" : "eine Rolle nie wieder abgeben können, sobald sie sie haben (im Stil einer Regelakzeptanz)";
  return `Mitglieder können ${multi}, und ${remove}.`;
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
  roleIds: string[];
  label: string;
}

function emptyMappingDraft(): MappingDraft {
  return { emojiName: "", emojiId: null, roleIds: [], label: "" };
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
  const [busy, setBusy] = useState(false);
  const { showError, showSuccess } = useToast();
  const confirmDialog = useConfirm();

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
  // option, picking it again for a second option (even as part of a
  // different multi-role Reactions option) would just be ambiguous.
  const usedRoleIds = useMemo(
    () => new Set(selected?.mappings.flatMap((m) => m.roleIds) ?? []),
    [selected],
  );

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
      setPanels((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      showSuccess("Panel mit Discord synchronisiert.");
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMapping() {
    if (typeof selectedId !== "number") return;
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
      const saved = await api.addMapping(selectedId, {
        emojiName: mappingDraft.emojiName || null,
        emojiId: mappingDraft.emojiId,
        roleIds: mappingDraft.roleIds,
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
    setEditDraft({ emojiName: m.emojiName ?? "", emojiId: m.emojiId, roleIds: m.roleIds, label: m.label ?? "" });
  }

  function handleCancelEditMapping() {
    setEditingMappingId(null);
    setEditDraft(emptyMappingDraft());
  }

  async function handleSaveEditMapping() {
    if (typeof selectedId !== "number" || editingMappingId === null) return;
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
      const saved = await api.updateMapping(selectedId, editingMappingId, {
        emojiName: editDraft.emojiName || null,
        emojiId: editDraft.emojiId,
        roleIds: editDraft.roleIds,
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

  function roleNamesLabel(roleIds: string[]): string {
    return roleIds.map(roleName).join(", ");
  }

  function roleIsManageable(roleId: string): boolean {
    return roles.find((r) => r.id === roleId)?.manageable ?? true;
  }

  function emojiDisplay(m: { emojiId: string | null; emojiName: string | null }): string {
    if (m.emojiId) return `[${m.emojiName}]`;
    return m.emojiName ?? "—";
  }

  const optionWord = effectiveSelectionType === "reactions" ? "Reaktion" : effectiveSelectionType === "buttons" ? "Button" : "Option";

  return (
    <div>
      <h2>Reaktionsrollen</h2>

      <div className="rr-layout">
        <div className="rr-list">
          <button className={selectedId === "new" ? "active" : ""} onClick={() => selectPanel("new")}>
            + Neues Panel
          </button>
          {panels.map((p) => (
            <button key={p.id} className={selectedId === p.id ? "active" : ""} onClick={() => selectPanel(p.id)}>
              #{p.id} — {p.name}
              {!p.sent && " (Entwurf)"}
            </button>
          ))}
        </div>

        <div className="rr-editor">
          {selectedId === null ? (
            <p className="muted">Wähle links ein Panel aus oder erstelle ein neues.</p>
          ) : (
            <>
              {typeof selectedId === "number" && selected && !selected.sent && (
                <div className="alert" style={{ background: "var(--bg-inset)", border: "1px solid var(--border)" }}>
                  <strong>Entwurf</strong> — es wurde noch nichts auf Discord gepostet. Konfiguriere alles unten und
                  klicke dann auf <strong>Senden</strong>, wenn du bereit bist.
                </div>
              )}

              <div className="card">
                <h2>Nachricht</h2>

                <div className="field">
                  <label htmlFor="rr-name">Name</label>
                  <input
                    id="rr-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Gib einen eindeutigen Namen ein"
                  />
                  <div className="hint">Nur zu deiner eigenen Orientierung in dieser Liste — wird nicht in der Nachricht selbst angezeigt.</div>
                </div>

                {selectedId === "new" ? (
                  <div className="field">
                    <label htmlFor="rr-message-source">Nachrichtentyp</label>
                    <select
                      id="rr-message-source"
                      value={messageSource}
                      onChange={(e) => handleMessageSourceChange(e.target.value as MessageSource)}
                    >
                      <option value="simple">Einfache Nachricht</option>
                      <option value="embed">Eingebettete Nachricht</option>
                      <option value="existing">Bestehende Nachricht</option>
                    </select>
                    <div className="hint">
                      {messageSource === "existing"
                        ? "An eine Nachricht anhängen, die ein Admin bereits geschrieben hat (z. B. Serverregeln) — ihr Inhalt wird nie verändert, nur ihre Reaktionen. Nur Reaktionen."
                        : "Der Bot postet eine Nachricht mit den unten aufgeführten Rollen und hält sie aktuell."}
                    </div>
                  </div>
                ) : (
                  selected?.managed && (
                    <div className="field">
                      <label htmlFor="rr-message-type">Nachrichtentyp</label>
                      <select
                        id="rr-message-type"
                        value={form.messageType}
                        onChange={(e) => setForm((f) => ({ ...f, messageType: e.target.value as PanelMessageType }))}
                      >
                        <option value="text">Einfache Nachricht</option>
                        <option value="embed">Eingebettete Nachricht</option>
                      </select>
                    </div>
                  )
                )}
                {typeof selectedId === "number" && selected && !selected.managed && (
                  <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
                    An eine bestehende Nachricht angehängt — ihr Inhalt wird nie bearbeitet.
                  </p>
                )}

                <div className="field">
                  <label htmlFor="rr-selection-type">Auswahltyp</label>
                  <select
                    id="rr-selection-type"
                    value={effectiveSelectionType}
                    disabled={selectedId !== "new" || attachMode === "existing"}
                    onChange={(e) => setSelectionType(e.target.value as SelectionType)}
                  >
                    <option value="reactions">Reaktionen</option>
                    <option value="buttons" disabled={selectedId === "new" && attachMode === "existing"}>
                      Buttons
                    </option>
                    <option value="dropdown" disabled={selectedId === "new" && attachMode === "existing"}>
                      Dropdown-Menü
                    </option>
                  </select>
                  <div className="hint">
                    {selectedId === "new" ? selectionHint(selectionType) : "Für dieses Panel festgelegt."}
                  </div>
                </div>

                {isExistingMessageMode ? (
                  selectedId === "new" && (
                    <div className="field">
                      <label htmlFor="rr-message-link">Nachrichtenlink</label>
                      <input
                        id="rr-message-link"
                        type="text"
                        value={messageLink}
                        onChange={(e) => setMessageLink(e.target.value)}
                        placeholder="https://discord.com/channels/…/…/…"
                      />
                      <div className="hint">Rechtsklick auf die Nachricht → Nachrichtenlink kopieren. Ein Kanal muss nicht separat gewählt werden.</div>
                    </div>
                  )
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="rr-channel">Kanal</label>
                      <SearchableSelect
                        id="rr-channel"
                        value={form.channelId}
                        onChange={(v) => setForm((f) => ({ ...f, channelId: v }))}
                        placeholder="Kanäle durchsuchen…"
                        emptyLabel="— Kanal wählen —"
                        options={channels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
                      />
                    </div>
                    {form.messageType === "embed" && (
                      <div className="field">
                        <label htmlFor="rr-title">Embed-Titel</label>
                        <input
                          id="rr-title"
                          type="text"
                          value={form.title}
                          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                          placeholder={form.name || "Reaktionsrollen"}
                        />
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor="rr-description">Nachrichtentext</label>
                      <textarea
                        id="rr-description"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder={
                          effectiveSelectionType === "reactions"
                            ? "Reagiere, um eine Rolle zu erhalten!"
                            : "Optionaler Text, der über den Buttons/dem Menü angezeigt wird"
                        }
                      />
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={form.useFont}
                        onChange={(e) => setForm((f) => ({ ...f, useFont: e.target.checked }))}
                      />
                      Schrift verwenden
                    </label>
                    <div className="hint">
                      Formatiert Titel/Text/Beschriftungen oben mit der auf der{" "}
                      <a href="/settings">Einstellungsseite</a> festgelegten Schrift, sofern konfiguriert.
                    </div>
                  </>
                )}

                <button className="primary" onClick={handleSavePanel} disabled={busy}>
                  {selectedId === "new" ? "Entwurfspanel erstellen" : "Änderungen speichern"}
                </button>
                {typeof selectedId === "number" && selected && (
                  <>
                    {selected.sent ? (
                      <button onClick={handleSync} disabled={busy}>
                        Mit Discord synchronisieren
                      </button>
                    ) : (
                      <button className="primary" onClick={handleSend} disabled={busy || selected.mappings.length === 0}>
                        Nachricht senden
                      </button>
                    )}
                    <button className="danger" onClick={handleDeletePanel} disabled={busy}>
                      Panel löschen
                    </button>
                  </>
                )}
                {selected?.messageId && (
                  <p className="hint" style={{ marginTop: 12 }}>
                    {selected.managed ? "Gepostet als" : "Angehängt an"} Nachricht <code>{selected.messageId}</code> in #
                    {channels.find((c) => c.id === selected.channelId)?.name ?? selected.channelId}
                  </p>
                )}
              </div>

              {!isExistingMessageMode && (
                <div className="card">
                  <h2>Vorschau</h2>
                  <MessagePreview
                    messageType={form.messageType}
                    selectionType={effectiveSelectionType}
                    title={form.title || form.name}
                    description={form.description}
                    mappings={selected?.mappings ?? []}
                    resolveRoleLabel={(m) => m.label ?? roleNamesLabel(m.roleIds)}
                    fontMap={fontMap}
                    useFont={form.useFont}
                  />
                </div>
              )}

              {typeof selectedId === "number" && selected && (
                <div className="card">
                  <h2>Rollen</h2>
                  {selected.mappings.length === 0 && <p className="muted">Noch keine Rollen konfiguriert.</p>}
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
                          {effectiveSelectionType === "reactions" ? (
                            <RoleCheckboxList
                              className="grow"
                              placeholder="Rollen durchsuchen…"
                              value={editDraft.roleIds}
                              onChange={(ids) => setEditDraft((d) => ({ ...d, roleIds: ids }))}
                              options={roles
                                .filter((r) => !usedRoleIds.has(r.id) || m.roleIds.includes(r.id))
                                .map((r) => ({
                                  value: r.id,
                                  label: r.name,
                                  disabled: !r.manageable && !editDraft.roleIds.includes(r.id),
                                  hint: r.manageable ? undefined : "(nicht zuweisbar)",
                                }))}
                            />
                          ) : (
                            <SearchableSelect
                              className="grow"
                              value={editDraft.roleIds[0] ?? ""}
                              onChange={(v) => setEditDraft((d) => ({ ...d, roleIds: v ? [v] : [] }))}
                              placeholder="Rollen durchsuchen…"
                              emptyLabel="— Rolle wählen —"
                              options={roles
                                .filter((r) => !usedRoleIds.has(r.id) || m.roleIds.includes(r.id))
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
                              effectiveSelectionType === "reactions"
                                ? "Beschriftung (optional)"
                                : `${effectiveSelectionType === "buttons" ? "Button" : "Options"}text (erforderlich)`
                            }
                            value={editDraft.label}
                            onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                          />
                          <button className="primary" disabled={busy} onClick={handleSaveEditMapping}>
                            Speichern
                          </button>
                          <button disabled={busy} onClick={handleCancelEditMapping}>
                            Abbrechen
                          </button>
                        </div>
                      ) : (
                        <div className="mapping-row" key={m.id}>
                          {effectiveSelectionType === "reactions" && <span>{emojiDisplay(m)}</span>}
                          <span className="grow">
                            {roleNamesLabel(m.roleIds)}
                            {m.roleIds.some((id) => !roleIsManageable(id)) && (
                              <span className="badge warn" style={{ marginLeft: 8 }}>
                                Bot kann nicht zuweisen: {roleNamesLabel(m.roleIds.filter((id) => !roleIsManageable(id)))}
                              </span>
                            )}
                            {m.label && <span className="muted"> — {m.label}</span>}
                            {effectiveSelectionType !== "reactions" && (m.emojiId || m.emojiName) && (
                              <span className="muted"> {emojiDisplay(m)}</span>
                            )}
                          </span>
                          <button disabled={busy || editingMappingId !== null} onClick={() => handleStartEditMapping(m)}>
                            Bearbeiten
                          </button>
                          <button disabled={busy || i === 0} onClick={() => handleMove(m.id, -1)}>
                            ↑
                          </button>
                          <button disabled={busy || i === arr.length - 1} onClick={() => handleMove(m.id, 1)}>
                            ↓
                          </button>
                          <button className="danger" disabled={busy} onClick={() => handleRemoveMapping(m.id)}>
                            Entfernen
                          </button>
                        </div>
                      ),
                    )}

                  <h2 style={{ marginTop: 20 }}>
                    {atOptionCap ? `Hinzufügen (Limit von ${optionCap} erreicht)` : `${optionWord} hinzufügen`}
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
                      {effectiveSelectionType === "reactions" ? (
                        <RoleCheckboxList
                          className="grow"
                          placeholder="Rollen durchsuchen…"
                          value={mappingDraft.roleIds}
                          onChange={(ids) => setMappingDraft((d) => ({ ...d, roleIds: ids }))}
                          options={roles
                            .filter((r) => !usedRoleIds.has(r.id))
                            .map((r) => ({
                              value: r.id,
                              label: r.name,
                              disabled: !r.manageable && !mappingDraft.roleIds.includes(r.id),
                              hint: r.manageable ? undefined : "(nicht zuweisbar)",
                            }))}
                        />
                      ) : (
                        <SearchableSelect
                          className="grow"
                          value={mappingDraft.roleIds[0] ?? ""}
                          onChange={(v) => setMappingDraft((d) => ({ ...d, roleIds: v ? [v] : [] }))}
                          placeholder="Rollen durchsuchen…"
                          emptyLabel="— Rolle wählen —"
                          options={roles
                            .filter((r) => !usedRoleIds.has(r.id))
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
                          effectiveSelectionType === "reactions"
                            ? "Beschriftung (optional)"
                            : `${effectiveSelectionType === "buttons" ? "Button" : "Options"}text (erforderlich)`
                        }
                        value={mappingDraft.label}
                        onChange={(e) => setMappingDraft((d) => ({ ...d, label: e.target.value }))}
                      />
                      <button className="primary" disabled={busy} onClick={handleAddMapping}>
                        Hinzufügen
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selectedId === "new" && <p className="muted">Speichere das Panel zuerst, bevor du Rollen hinzufügst.</p>}

              {selectedId !== null && (
                <details className="card">
                  <summary>Erweiterte Optionen</summary>
                  <div style={{ marginTop: 16 }}>
                    <div className="field">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={form.allowMultiple}
                          onChange={(e) => setForm((f) => ({ ...f, allowMultiple: e.target.checked }))}
                        />
                        Mitgliedern erlauben, mehr als eine Rolle aus diesem Panel zu erhalten
                      </label>
                    </div>
                    <div className="field">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={form.removable}
                          onChange={(e) => setForm((f) => ({ ...f, removable: e.target.checked }))}
                        />
                        Mitglieder können eine Rolle wieder abgeben, sobald sie sie haben
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
                          Die Reaktion des Nutzers sofort nach der Aktion entfernen
                        </label>
                        <div className="hint">
                          Hält die Reaktionsanzahl bei 1. Wenn aktiviert, schaltet erneutes Reagieren auf dieselbe
                          Option die Rolle an/aus, statt dass das Entfernen der Reaktion sie entzieht.
                        </div>
                      </div>
                    )}

                    <div className="field">
                      <label>Erlaubte Rollen</label>
                      <RoleCheckboxList
                        placeholder="Rollen durchsuchen…"
                        value={form.allowedRoleIds}
                        onChange={(ids) => setForm((f) => ({ ...f, allowedRoleIds: ids }))}
                        options={roles.map((r) => ({ value: r.id, label: r.name }))}
                      />
                      <div className="hint">
                        Nur Mitglieder mit einer dieser Rollen dürfen das Panel benutzen. Keine ausgewählt = alle.
                      </div>
                    </div>

                    <p className="hint">
                      Diese gehören zu denselben Panel-Einstellungen oben —{" "}
                      {selectedId === "new" ? "Entwurfspanel erstellen" : "Änderungen speichern"} speichert auch sie.
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
