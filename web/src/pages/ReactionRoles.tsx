import MappingForm from "../components/MappingForm";
import RoleCheckboxList from "../components/RoleCheckboxList";
import SearchableSelect from "../components/SearchableSelect";
import TemplateEditor from "../components/TemplateEditor";
import TemplatePreview from "../components/TemplatePreview";
import { useUnsavedChanges } from "../components/UnsavedChangesContext";
import { useChannels } from "../hooks/useChannels";
import { useEmojis } from "../hooks/useEmojis";
import { useGeneralSettings } from "../hooks/useGeneralSettings";
import { usePanelEditor } from "../hooks/usePanelEditor";
import type { MessageSource } from "../hooks/usePanelEditor";
import { useMappingEditor } from "../hooks/useMappingEditor";
import { useRoles } from "../hooks/useRoles";
import { buildCoreResolvers, mockifyChannelMentions, renderTemplate } from "../utils/messageTemplate";
import type { Mapping, PanelMessageType, SelectionType } from "../types";

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

/**
 * `MessagePreview.tsx`'s panel-shape-specific mockup chrome (Discord-bubble
 * header, embed box, reactions/buttons/dropdown rows), folded in here now
 * that this is the one remaining caller — see the design spec's "Migration
 * of existing features" section. `TemplatePreview` (used below, in the
 * `Vorschau` card) handles just the token-resolved title/body text; button
 * and dropdown option labels aren't template-editable text (they're plain
 * role names, no `{token}` syntax expected), so they're styled directly via
 * the mirror engine's `renderTemplate()` here instead of through a full
 * `TemplatePreview` block — matching `reactionRoles.ts`'s real `styled()`
 * helper, which does exactly the same for every one of these strings
 * (title, body, and each button/dropdown label) on the bot side.
 */
function previewEmojiNode(mapping: Mapping) {
  if (mapping.emojiId) {
    return (
      <img
        src={`https://cdn.discordapp.com/emojis/${mapping.emojiId}.png`}
        alt={mapping.emojiName ?? ""}
        className="message-preview-emoji-img"
      />
    );
  }
  return mapping.emojiName;
}

function previewBodyText(
  description: string,
  selectionType: SelectionType,
  sorted: Mapping[],
  resolveRoleLabel: (m: Mapping) => string,
): string {
  if (selectionType !== "reactions") return description || "";
  const lines = sorted.map((m) => `${m.emojiId ? `[${m.emojiName}]` : (m.emojiName ?? "")} — ${resolveRoleLabel(m)}`);
  return [description, lines.join("\n")].filter(Boolean).join("\n\n");
}

export default function ReactionRoles() {
  const channelsRes = useChannels();
  const rolesRes = useRoles();
  const emojisRes = useEmojis();
  const generalRes = useGeneralSettings();
  const channels = channelsRes.data ?? [];
  const roles = rolesRes.data ?? [];
  const emojis = emojisRes.data ?? [];
  const fontMap = generalRes.data?.fontMap ?? null;

  const {
    panels,
    panelsRes,
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
  } = usePanelEditor();

  const {
    mappingDraft,
    setMappingDraft,
    editingMappingId,
    editDraft,
    setEditDraft,
    optionCap,
    atOptionCap,
    usedRoleIds,
    mappingsDirty,
    handleAddMapping,
    handleRemoveMapping,
    handleStartEditMapping,
    handleCancelEditMapping,
    handleSaveEditMapping,
    handleMove,
  } = useMappingEditor(selected, effectiveSelectionType, panelsRes, busy, setBusy);

  // Closes the exact gap the last critique flagged: this page has the same
  // manual-save-button shape as Settings/Birthdays, so an admin has every
  // reason to expect the same "don't lose my edit" protection those pages
  // already have.
  useUnsavedChanges(formDirty || mappingsDirty);

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
                <div className="alert neutral">
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
                  <p className="hint hint-tight">
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
                        <TemplateEditor
                          id="rr-title"
                          value={form.title}
                          onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                          channels={channels}
                          placeholder={form.name || "Reaktionsrollen"}
                        />
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor="rr-description">Nachrichtentext</label>
                      <TemplateEditor
                        id="rr-description"
                        value={form.description}
                        onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                        channels={channels}
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

                <div className="save-row">
                  <button
                    className="primary"
                    onClick={handleSavePanel}
                    disabled={busy || (selectedId !== "new" && !formDirty)}
                  >
                    {selectedId === "new" ? "Entwurfspanel erstellen" : "Änderungen speichern"}
                  </button>
                  {formDirty && !busy && <span className="muted small">Ungespeicherte Änderungen</span>}
                </div>
                {typeof selectedId === "number" && selected && (
                  <>
                    {selected.sent ? (
                      <button onClick={handleSync} disabled={busy}>
                        Mit Discord synchronisieren
                      </button>
                    ) : (
                      <button
                        className="primary"
                        onClick={() => handleSend(channels.find((c) => c.id === selected.channelId)?.name ?? selected.channelId)}
                        disabled={busy || selected.mappings.length === 0}
                      >
                        Nachricht senden
                      </button>
                    )}
                    <button className="danger" onClick={handleDeletePanel} disabled={busy}>
                      Panel löschen
                    </button>
                  </>
                )}
                {selected?.messageId && (
                  <p className="hint mt-12">
                    {selected.managed ? "Gepostet als" : "Angehängt an"} Nachricht <code>{selected.messageId}</code> in #
                    {channels.find((c) => c.id === selected.channelId)?.name ?? selected.channelId}
                  </p>
                )}
              </div>

              {!isExistingMessageMode &&
                (() => {
                  const previewMappings = [...(selected?.mappings ?? [])].sort((a, b) => a.position - b.position);
                  const resolveRoleLabel = (m: Mapping) => m.label ?? roleNamesLabel(m.roleIds);
                  const titleTemplate = form.title || form.name;
                  const bodyTemplate = previewBodyText(form.description, effectiveSelectionType, previewMappings, resolveRoleLabel);
                  // Button/dropdown option labels aren't template textareas —
                  // styled directly via the mirror engine, matching
                  // reactionRoles.ts's real styled() call shape exactly
                  // (renderTemplate with no context, `useFont`/`fontMap` as
                  // configured for this panel).
                  const styleLabel = (text: string) =>
                    mockifyChannelMentions(
                      renderTemplate(text, {}, buildCoreResolvers(channels), { useFont: form.useFont, fontMap }),
                      channels,
                    );

                  return (
                    <div className="card">
                      <h2>Vorschau</h2>
                      <div className="message-preview">
                        <div className="message-preview-header">
                          <div className="message-preview-avatar">🤖</div>
                          <div>
                            <span className="message-preview-author">
                              leck-eier-bot <span className="message-preview-bot-tag">BOT</span>
                            </span>
                            <span className="muted message-preview-timestamp">Heute um 12:00</span>
                          </div>
                        </div>

                        {form.messageType === "embed" ? (
                          <div className="message-preview-embed">
                            {titleTemplate && (
                              <div className="message-preview-embed-title">
                                <TemplatePreview
                                  template={titleTemplate}
                                  context={{}}
                                  channels={channels}
                                  useFont={form.useFont}
                                  fontMap={fontMap}
                                />
                              </div>
                            )}
                            <div className="message-preview-embed-desc">
                              {bodyTemplate ? (
                                <TemplatePreview
                                  template={bodyTemplate}
                                  context={{}}
                                  channels={channels}
                                  useFont={form.useFont}
                                  fontMap={fontMap}
                                />
                              ) : (
                                <span className="muted">Keine Beschreibung festgelegt.</span>
                              )}
                            </div>
                          </div>
                        ) : bodyTemplate ? (
                          <div className="message-preview-text">
                            <TemplatePreview
                              template={bodyTemplate}
                              context={{}}
                              channels={channels}
                              useFont={form.useFont}
                              fontMap={fontMap}
                            />
                          </div>
                        ) : (
                          <div className="message-preview-text">
                            <span className="muted">Kein Nachrichtentext festgelegt.</span>
                          </div>
                        )}

                        {effectiveSelectionType === "reactions" && (
                          <div className="message-preview-reactions">
                            {previewMappings.length === 0 && <span className="muted">Noch keine Rollen hinzugefügt.</span>}
                            {previewMappings.map((m) => (
                              <span className="message-preview-reaction" key={m.id}>
                                {previewEmojiNode(m)} <span className="muted">1</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {effectiveSelectionType === "buttons" && (
                          <div className="message-preview-buttons">
                            {previewMappings.length === 0 && <span className="muted">Noch keine Buttons hinzugefügt.</span>}
                            {previewMappings.map((m) => (
                              <span className="message-preview-button" key={m.id}>
                                {previewEmojiNode(m)} {styleLabel(resolveRoleLabel(m))}
                              </span>
                            ))}
                          </div>
                        )}

                        {effectiveSelectionType === "dropdown" && (
                          <div className="message-preview-dropdown">
                            <span className="muted">
                              {previewMappings.length === 0
                                ? "Noch keine Optionen hinzugefügt"
                                : previewMappings.length === 1
                                  ? styleLabel(resolveRoleLabel(previewMappings[0]!))
                                  : `${styleLabel(resolveRoleLabel(previewMappings[0]!))} +${previewMappings.length - 1} weitere`}
                            </span>
                            <span>▾</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {typeof selectedId === "number" && selected && (
                <div className="card">
                  <h2>Rollen</h2>
                  {selected.mappings.length === 0 && <p className="muted">Noch keine Rollen konfiguriert.</p>}
                  {[...selected.mappings]
                    .sort((a, b) => a.position - b.position)
                    .map((m, i, arr) =>
                      editingMappingId === m.id ? (
                        <MappingForm
                          key={m.id}
                          draft={editDraft}
                          setDraft={setEditDraft}
                          onSubmit={handleSaveEditMapping}
                          submitLabel="Speichern"
                          onCancel={handleCancelEditMapping}
                          cancelLabel="Abbrechen"
                          selectionType={effectiveSelectionType}
                          emojis={emojis}
                          roles={roles}
                          usedRoleIds={usedRoleIds}
                          extraAllowedRoleIds={m.roleIds}
                          busy={busy}
                        />
                      ) : (
                        <div className="mapping-row" key={m.id}>
                          {effectiveSelectionType === "reactions" && <span>{emojiDisplay(m)}</span>}
                          <span className="grow">
                            {roleNamesLabel(m.roleIds)}
                            {m.roleIds.some((id) => !roleIsManageable(id)) && (
                              <span className="badge warn ml-8">
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

                  <h2 className="mt-20">
                    {atOptionCap ? `Hinzufügen (Limit von ${optionCap} erreicht)` : `${optionWord} hinzufügen`}
                  </h2>
                  {!atOptionCap && (
                    <MappingForm
                      draft={mappingDraft}
                      setDraft={setMappingDraft}
                      onSubmit={handleAddMapping}
                      submitLabel="Hinzufügen"
                      selectionType={effectiveSelectionType}
                      emojis={emojis}
                      roles={roles}
                      usedRoleIds={usedRoleIds}
                      busy={busy}
                    />
                  )}
                </div>
              )}

              {selectedId === "new" && <p className="muted">Speichere das Panel zuerst, bevor du Rollen hinzufügst.</p>}

              {selectedId !== null && (
                <details className="card">
                  <summary>Erweiterte Optionen</summary>
                  <div className="mt-16">
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
