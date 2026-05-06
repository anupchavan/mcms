import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ALL_ACTIONS, ACTION_BY_ID, type HotkeyDef } from '../shared/actions';
import { useAuth } from './AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActionPref {
    actionId: string;
    /** User-defined alias; empty string means use default. */
    alias: string;
    /** User-defined hotkey; key='' means use default. */
    hotkey: HotkeyDef & { key: string };
}

interface ActionPreferencesContextValue {
    /** All prefs as stored — includes only overridden actions. */
    prefs: ActionPref[];
    /** Resolved alias for an action (user override or default). */
    getAlias: (actionId: string) => string;
    /** Resolved hotkey for an action (user override, or default, or undefined). */
    getHotkey: (actionId: string) => HotkeyDef | undefined;
    /** Persist the entire prefs array to the server. */
    savePreferences: (newPrefs: ActionPref[]) => Promise<void>;
    /** Update a single action's alias and/or hotkey without full save. */
    updatePref: (actionId: string, patch: Partial<Omit<ActionPref, 'actionId'>>) => void;
    /** Flush pending local changes to the server. */
    flush: () => Promise<void>;
    loading: boolean;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ActionPreferencesContext = createContext<ActionPreferencesContextValue | null>(null);

export function useActionPreferences() {
    const ctx = useContext(ActionPreferencesContext);
    if (!ctx) throw new Error('useActionPreferences must be used inside ActionPreferencesProvider');
    return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ActionPreferencesProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const [prefs, setPrefs] = useState<ActionPref[]>([]);
    const [loading, setLoading] = useState(true);
    // Debounce flush ref
    const flushTimerRef = { current: null as ReturnType<typeof setTimeout> | null };

    // Load from server on mount
    useEffect(() => {
        if (!user?.token) { setLoading(false); return; }
        fetch(`${API_BASE}/profile/action-preferences`, {
            headers: { Authorization: `Bearer ${user.token}` },
        })
            .then(r => r.ok ? r.json() : { actionPreferences: [] })
            .then(data => {
                setPrefs(Array.isArray(data.actionPreferences) ? data.actionPreferences : []);
            })
            .catch(() => setPrefs([]))
            .finally(() => setLoading(false));
    }, [user?.token]);

    const getAlias = useCallback((actionId: string): string => {
        const pref = prefs.find(p => p.actionId === actionId);
        if (pref?.alias) return pref.alias;
        return ACTION_BY_ID[actionId]?.defaultAlias ?? '';
    }, [prefs]);

    const getHotkey = useCallback((actionId: string): HotkeyDef | undefined => {
        const pref = prefs.find(p => p.actionId === actionId);
        if (pref?.hotkey?.key) return pref.hotkey;
        return ACTION_BY_ID[actionId]?.defaultHotkey;
    }, [prefs]);

    const savePreferences = useCallback(async (newPrefs: ActionPref[]) => {
        if (!user?.token) return;
        setPrefs(newPrefs);
        await fetch(`${API_BASE}/profile/action-preferences`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${user.token}`,
            },
            body: JSON.stringify({ actionPreferences: newPrefs }),
        });
    }, [user?.token]);

    const updatePref = useCallback((actionId: string, patch: Partial<Omit<ActionPref, 'actionId'>>) => {
        setPrefs(prev => {
            const idx = prev.findIndex(p => p.actionId === actionId);
            if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], ...patch };
                return updated;
            }
            return [...prev, { actionId, alias: '', hotkey: { key: '', mod: false, shift: false, alt: false }, ...patch }];
        });
    }, []);

    const flush = useCallback(async () => {
        if (!user?.token) return;
        // Read current prefs from state closure
        await fetch(`${API_BASE}/profile/action-preferences`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${user.token}`,
            },
            body: JSON.stringify({ actionPreferences: prefs }),
        });
    }, [user?.token, prefs]);

    // Build a lookup: alias → actionId for the palette
    const aliasMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const action of ALL_ACTIONS) {
            const alias = getAlias(action.id);
            if (alias) map[alias.toLowerCase()] = action.id;
        }
        return map;
    }, [getAlias]);

    const value = useMemo<ActionPreferencesContextValue>(() => ({
        prefs,
        getAlias,
        getHotkey,
        savePreferences,
        updatePref,
        flush,
        loading,
        // Expose aliasMap for command palette use
        ...({ aliasMap } as any),
    }), [prefs, getAlias, getHotkey, savePreferences, updatePref, flush, loading, aliasMap]);

    return (
        <ActionPreferencesContext.Provider value={value}>
            {children}
        </ActionPreferencesContext.Provider>
    );
}

/** Convenience: alias → actionId lookup (available on context value as aliasMap). */
export function useAliasMap(): Record<string, string> {
    const ctx = useContext(ActionPreferencesContext) as any;
    return ctx?.aliasMap ?? {};
}
