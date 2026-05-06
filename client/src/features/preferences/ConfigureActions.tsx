import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ALL_ACTIONS, ACTION_GROUPS } from '../../shared/actions';
import type { ActionDef, HotkeyDef } from '../../shared/actions';
import { useActionPreferences } from '../../stores/ActionPreferencesContext';
import HotkeyRecorder from './HotkeyRecorder';
import Icon from '../../shared/components/Icon';
import { ArrowRight01Icon } from '@hugeicons/core-free-icons';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const SAVE_DEBOUNCE_MS = 600;

function hotkeyKey(h?: HotkeyDef): string {
    if (!h?.key) return '';
    return `${h.mod ? 'mod+' : ''}${h.shift ? 'shift+' : ''}${h.alt ? 'alt+' : ''}${h.key.toLowerCase()}`;
}

export default function ConfigureActions() {
    const { getAlias, getHotkey, savePreferences, loading } = useActionPreferences();

    const [localAliases, setLocalAliases] = useState<Record<string, string>>({});
    const [localHotkeys, setLocalHotkeys] = useState<Record<string, HotkeyDef | undefined>>({});
    const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
    const [savedIndicator, setSavedIndicator] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(ACTION_GROUPS));
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const aliasInputRef = useRef<HTMLInputElement | null>(null);
    // Keep refs so async save closures always have fresh data
    const localHotkeysRef = useRef(localHotkeys);
    localHotkeysRef.current = localHotkeys;
    const localAliasesRef = useRef(localAliases);
    localAliasesRef.current = localAliases;

    useEffect(() => {
        if (loading) return;
        const aliases: Record<string, string> = {};
        const hotkeys: Record<string, HotkeyDef | undefined> = {};
        for (const action of ALL_ACTIONS) {
            aliases[action.id] = getAlias(action.id);
            hotkeys[action.id] = getHotkey(action.id);
        }
        setLocalAliases(aliases);
        setLocalHotkeys(hotkeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading]);

    useEffect(() => {
        if (editingAliasId && aliasInputRef.current) {
            aliasInputRef.current.focus();
            aliasInputRef.current.select();
        }
    }, [editingAliasId]);

    const doSave = useCallback(async () => {
        const newPrefs = ALL_ACTIONS.map(action => ({
            actionId: action.id,
            alias: (localAliasesRef.current[action.id] ?? '').trim(),
            hotkey: {
                key: localHotkeysRef.current[action.id]?.key ?? '',
                mod: localHotkeysRef.current[action.id]?.mod ?? false,
                shift: localHotkeysRef.current[action.id]?.shift ?? false,
                alt: localHotkeysRef.current[action.id]?.alt ?? false,
            },
        }));
        await savePreferences(newPrefs);
        setSavedIndicator(true);
        setTimeout(() => setSavedIndicator(false), 1500);
    }, [savePreferences]);

    const scheduleSave = useCallback(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(doSave, SAVE_DEBOUNCE_MS);
    }, [doSave]);

    const handleAliasChange = useCallback((id: string, v: string) => setLocalAliases(p => ({ ...p, [id]: v })), []);
    const handleAliasCommit = useCallback(() => { setEditingAliasId(null); scheduleSave(); }, [scheduleSave]);

    const handleHotkeyChange = useCallback((id: string, hotkey: HotkeyDef | undefined) => {
        setLocalHotkeys(p => ({ ...p, [id]: hotkey }));
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(doSave, 100);
    }, [doSave]);

    const resetAction = useCallback((action: ActionDef) => {
        setLocalAliases(p => ({ ...p, [action.id]: action.defaultAlias }));
        setLocalHotkeys(p => ({ ...p, [action.id]: action.defaultHotkey }));
        scheduleSave();
    }, [scheduleSave]);

    // ── Hotkey conflict detection (same scope only) ────────────────────────────
    // Maps `scope:hotkeyKey` → first action name that owns it
    const hotkeyOwners = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const action of ALL_ACTIONS) {
            const k = hotkeyKey(localHotkeys[action.id]);
            if (!k) continue;
            const scopedKey = `${action.scope}:${k}`;
            if (!map[scopedKey]) map[scopedKey] = action.name;
        }
        return map;
    }, [localHotkeys]);

    const checkHotkeyConflict = useCallback((actionId: string) => (h: HotkeyDef): string | undefined => {
        const k = hotkeyKey(h);
        if (!k) return undefined;
        const scope = ALL_ACTIONS.find(a => a.id === actionId)?.scope;
        if (!scope) return undefined;
        for (const a of ALL_ACTIONS) {
            if (a.id === actionId) continue;
            if (a.scope !== scope) continue; // only same-scope conflicts
            if (hotkeyKey(localHotkeys[a.id]) === k) return a.name;
        }
        return undefined;
    }, [localHotkeys]);

    // ── Alias conflict detection (same scope only) ─────────────────────────────
    // Maps `scope:alias` → first action name that owns it
    const aliasOwners = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const action of ALL_ACTIONS) {
            const a = (localAliases[action.id] ?? '').trim().toLowerCase();
            if (!a) continue;
            const scopedKey = `${action.scope}:${a}`;
            if (!map[scopedKey]) map[scopedKey] = action.name;
        }
        return map;
    }, [localAliases]);

    const getAliasConflict = useCallback((actionId: string): string | undefined => {
        const alias = (localAliases[actionId] ?? '').trim().toLowerCase();
        if (!alias) return undefined;
        const scope = ALL_ACTIONS.find(a => a.id === actionId)?.scope;
        if (!scope) return undefined;
        const scopedKey = `${scope}:${alias}`;
        const owner = aliasOwners[scopedKey];
        const ownerAction = ALL_ACTIONS.find(a => a.id !== actionId && a.scope === scope &&
            (localAliases[a.id] ?? '').trim().toLowerCase() === alias);
        if (ownerAction) return ownerAction.name;
        return undefined;
    }, [localAliases, aliasOwners]);

    const toggleGroup = useCallback((group: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(group)) next.delete(group); else next.add(group);
            return next;
        });
    }, []);

    if (loading) return <div className="configure-actions-loading">Loading preferences…</div>;

    return (
        <div className="configure-actions">
            <div className="configure-actions-header">
                <h3 className="configure-actions-title">Configure Actions</h3>
                <p className="configure-actions-subtitle">
                    Set aliases and keyboard shortcuts. Type an alias in <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd> to run any action.
                </p>
                {savedIndicator && <span className="configure-actions-saved">Saved ✓</span>}
            </div>

            {/* Column header row */}
            <div className="configure-actions-table">
                <div className="configure-actions-row configure-actions-row-head">
                    <div className="configure-actions-col configure-actions-col-name">Name</div>
                    <div className="configure-actions-col configure-actions-col-alias">Alias</div>
                    <div className="configure-actions-col configure-actions-col-hotkey">Hotkey</div>
                    <div className="configure-actions-col configure-actions-col-reset" />
                </div>

                {ACTION_GROUPS.map(group => {
                    const actions = ALL_ACTIONS.filter(a => a.group === group);
                    if (!actions.length) return null;
                    const expanded = expandedGroups.has(group);

                    return (
                        <div key={group} className="configure-actions-group">
                            {/* Group header row — clickable to collapse/expand */}
                            <button
                                type="button"
                                className="configure-actions-group-row"
                                onClick={() => toggleGroup(group)}
                                aria-expanded={expanded}
                            >
                                <span className={`configure-actions-chevron${expanded ? ' expanded' : ''}`}>
                                    <Icon icon={ArrowRight01Icon} size={14} />
                                </span>
                                <span className="configure-actions-group-name">{group}</span>
                            </button>

                            {expanded && actions.map((action, idx) => {
                                const alias = localAliases[action.id] ?? action.defaultAlias;
                                const hotkey = localHotkeys[action.id];
                                const isEditing = editingAliasId === action.id;
                                const hk = hotkeyKey(hotkey);
                                const scopedHk = hk ? `${action.scope}:${hk}` : '';
                                const conflictOwner = scopedHk ? hotkeyOwners[scopedHk] : undefined;
                                const isHotkeyConflict = conflictOwner && conflictOwner !== action.name;
                                const aliasConflictName = getAliasConflict(action.id);
                                const isDefaultAlias = alias === action.defaultAlias;
                                const isDefaultHotkey = !hotkey?.key
                                    ? !action.defaultHotkey?.key
                                    : hotkey.key === action.defaultHotkey?.key
                                    && !!hotkey.mod === !!(action.defaultHotkey?.mod)
                                    && !!hotkey.shift === !!(action.defaultHotkey?.shift)
                                    && !!hotkey.alt === !!(action.defaultHotkey?.alt);
                                const isDefault = isDefaultAlias && isDefaultHotkey;

                                return (
                                    <div
                                        key={action.id}
                                        className={`configure-actions-row configure-actions-row-child${idx % 2 === 1 ? ' configure-actions-row-alt' : ''}`}
                                    >
                                        {/* Name */}
                                        <div className="configure-actions-col configure-actions-col-name">
                                            <span className="configure-actions-action-name">{action.name}</span>
                                        </div>

                                        {/* Alias */}
                                        <div className="configure-actions-col configure-actions-col-alias">
                                            {isEditing ? (
                                                <input
                                                    ref={aliasInputRef}
                                                    type="text"
                                                    className={`configure-actions-alias-input${aliasConflictName ? ' configure-actions-alias-input-conflict' : ''}`}
                                                    value={alias}
                                                    onChange={e => handleAliasChange(action.id, e.target.value)}
                                                    onBlur={handleAliasCommit}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' || e.key === 'Escape') {
                                                            e.preventDefault();
                                                            handleAliasCommit();
                                                        }
                                                    }}
                                                    maxLength={32}
                                                    placeholder="No alias"
                                                    title={aliasConflictName ? `Already used by "${aliasConflictName}"` : undefined}
                                                />
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={`configure-actions-alias-chip${!alias ? ' configure-actions-alias-chip-empty' : ''}${aliasConflictName ? ' configure-actions-alias-chip-conflict' : ''}`}
                                                    onClick={() => setEditingAliasId(action.id)}
                                                    title={aliasConflictName ? `Alias conflict: already used by "${aliasConflictName}"` : undefined}
                                                >
                                                    {alias || <span className="alias-placeholder">—</span>}
                                                </button>
                                            )}
                                        </div>

                                        {/* Hotkey */}
                                        <div className="configure-actions-col configure-actions-col-hotkey">
                                            <HotkeyRecorder
                                                value={hotkey}
                                                onChange={h => handleHotkeyChange(action.id, h)}
                                                checkConflict={checkHotkeyConflict(action.id)}
                                            />
                                        </div>

                                        {/* Reset */}
                                        <div className="configure-actions-col configure-actions-col-reset">
                                            {!isDefault && (
                                                <button
                                                    type="button"
                                                    className="configure-actions-reset-btn"
                                                    onClick={() => resetAction(action)}
                                                    title="Reset to default"
                                                >
                                                    Reset
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
