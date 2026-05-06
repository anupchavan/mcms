/**
 * CommandPalette — cmd+K modal.
 *
 * Alias-match priority:  exact alias > prefix > fuzzy name/keyword > everything else
 * Meeting-scope actions are hidden when not on the live meeting page.
 * Results: meeting/archive results + people results from API.
 * Transcript snippets shown under each meeting result as sub-rows.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ALL_ACTIONS } from '../../shared/actions';
import type { ActionDef } from '../../shared/actions';
import { useActionPreferences } from '../../stores/ActionPreferencesContext';
import { useAuth } from '../../stores/AuthContext';
import Icon from '../../shared/components/Icon';
import { getInitials, getAvatarHue } from '../../shared/utils/avatarColor';
import {
    Search01Icon,
    Settings02Icon,
    Home11Icon,
    CheckListIcon,
    Video01Icon,
    Calendar02Icon,
    Archive03Icon,
    UserIcon,
    Sun03Icon,
    SidebarLeft01Icon,
    FullScreenIcon,
    Notification01Icon,
    Mic01Icon,
    CameraVideoIcon,
    Loading03Icon,
    UserGroupIcon,
    Note01Icon,
    FlashIcon,
    TaskAdd01Icon,
    Logout02Icon,
    Cancel01Icon,
    BubbleChatIcon,
    Doc01Icon,
    SparklesIcon,
} from '@hugeicons/core-free-icons';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const SEARCH_DEBOUNCE_MS = 240;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// ── Icon map ──────────────────────────────────────────────────────────────────
const ACTION_ICONS: Record<string, any> = {
    'nav.dashboard': Home11Icon,
    'nav.tasks': CheckListIcon,
    'nav.meeting': Video01Icon,
    'nav.scheduled': Calendar02Icon,
    'nav.archives': Archive03Icon,
    'nav.preferences': Settings02Icon,
    'nav.settings': UserIcon,
    'meeting.new': Calendar02Icon,
    'meeting.join': Video01Icon,
    'global.theme': Sun03Icon,
    'global.sidebar': SidebarLeft01Icon,
    'global.fullscreen': FullScreenIcon,
    'global.notifications': Notification01Icon,
    'meeting.mic': Mic01Icon,
    'meeting.camera': CameraVideoIcon,
    'meeting.recording': Loading03Icon,
    'meeting.participants': UserGroupIcon,
    'meeting.agenda.add': Note01Icon,
    'meeting.task.add': TaskAdd01Icon,
    'meeting.leave': Logout02Icon,
    'meeting.end': Cancel01Icon,
    'dock.toggle': SidebarLeft01Icon,
    'dock.agenda': Note01Icon,
    'dock.chat': BubbleChatIcon,
    'dock.transcript': Doc01Icon,
    'dock.minutes': SparklesIcon,
    'dock.actions': FlashIcon,
};

// ── Alias-priority ranking ────────────────────────────────────────────────────
function scoreAction(
    action: ActionDef,
    query: string,
    /** actionId → alias string */
    actionToAlias: Record<string, string>,
): number | null {
    if (!query) return 0; // show all when empty
    const q = query.toLowerCase().trim();
    const alias = (actionToAlias[action.id] ?? '').toLowerCase();
    const name = action.name.toLowerCase();
    const keywords = (action.keywords ?? []).map(k => k.toLowerCase());

    if (alias && alias === q) return 1;          // exact alias
    if (alias && alias.startsWith(q)) return 2;  // alias prefix
    if (name.startsWith(q)) return 3;            // name prefix
    if (alias && alias.includes(q)) return 4;    // alias contains
    if (name.includes(q)) return 5;              // name contains
    if (keywords.some(k => k.includes(q))) return 6;
    if ((action.description ?? '').toLowerCase().includes(q)) return 7;
    return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function HotkeyDisplay({ hotkey }: { hotkey?: { key: string; mod?: boolean; shift?: boolean; alt?: boolean } }) {
    if (!hotkey?.key) return null;
    const parts: string[] = [];
    if (hotkey.mod) parts.push(isMac ? '⌘' : 'Ctrl');
    if (hotkey.shift) parts.push('⇧');
    if (hotkey.alt) parts.push(isMac ? '⌥' : 'Alt');
    parts.push(hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key);
    return (
        <span className="cp-hotkey">
            {parts.map((p, i) => <kbd key={i} className="cp-kbd">{p}</kbd>)}
        </span>
    );
}

function AliasChip({ alias }: { alias: string }) {
    if (!alias) return null;
    return <span className="cp-alias-chip">{alias}</span>;
}

function truncate(text: string, max = 80): string {
    return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatDate(dateStr: string) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
        return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
    } catch { return ''; }
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    handlers: Record<string, () => void>;
}

// ── Item types for the unified nav list ──────────────────────────────────────
type PaletteItem =
    | { type: 'action'; data: ActionDef }
    | { type: 'meeting'; data: any }
    | { type: 'person'; data: any };

// ── Main component ────────────────────────────────────────────────────────────
export default function CommandPalette({ open, onClose, handlers }: CommandPaletteProps) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const { getAlias, getHotkey } = useActionPreferences();

    // Detect context — controls which scope-restricted actions are visible
    const inMeeting = /^\/(meeting|meetings\/|rooms\/)/.test(location.pathname);
    const inArchive = /^\/archives\//.test(location.pathname);
    const inTasks = location.pathname === '/tasks';

    const [query, setQuery] = useState('');
    const [meetingResults, setMeetingResults] = useState<any[]>([]);
    const [personResults, setPersonResults] = useState<any[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    // Track latest search query to avoid stale setState
    const latestQueryRef = useRef('');

    useEffect(() => {
        if (open) {
            setQuery('');
            setMeetingResults([]);
            setPersonResults([]);
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 30);
        }
    }, [open]);

    // actionId → alias (correct direction)
    const actionToAlias = useMemo(() => {
        const map: Record<string, string> = {};
        for (const action of ALL_ACTIONS) {
            map[action.id] = getAlias(action.id);
        }
        return map;
    }, [getAlias]);

    // Filtered + ranked actions — scope-restricted actions hidden outside their context
    const rankedActions = useMemo(() => {
        const results: Array<{ action: ActionDef; score: number }> = [];
        for (const action of ALL_ACTIONS) {
            if (action.scope === 'meeting' && !inMeeting) continue;
            if (action.scope === 'archive' && !inArchive) continue;
            if (action.scope === 'tasks' && !inTasks) continue;
            const score = scoreAction(action, query, actionToAlias);
            if (score !== null) results.push({ action, score });
        }
        results.sort((a, b) => a.score - b.score || a.action.name.localeCompare(b.action.name));
        return results.map(r => r.action);
    }, [query, actionToAlias, inMeeting, inArchive, inTasks]);

    // API search — both meetings and people
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const q = query.trim();
        latestQueryRef.current = q;
        if (q.length < 2) {
            setMeetingResults([]);
            setPersonResults([]);
            setSearchLoading(false);
            return;
        }
        setSearchLoading(true);
        debounceRef.current = setTimeout(async () => {
            if (latestQueryRef.current !== q) return;
            try {
                const headers = { Authorization: `Bearer ${user?.token}` };
                const [meetingsRes, personsRes] = await Promise.all([
                    fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`, { headers }),
                    fetch(`${API_BASE}/users/search?q=${encodeURIComponent(q)}`, { headers }),
                ]);
                if (latestQueryRef.current !== q) return;
                setMeetingResults(meetingsRes.ok ? await meetingsRes.json() : []);
                setPersonResults(personsRes.ok ? await personsRes.json() : []);
            } catch {
                setMeetingResults([]);
                setPersonResults([]);
            }
            setSearchLoading(false);
        }, SEARCH_DEBOUNCE_MS);
    }, [query, user?.token]);

    // Flat keyboard-navigable items (actions + top-level meeting & person rows)
    const navItems = useMemo<PaletteItem[]>(() => [
        ...rankedActions.map(a => ({ type: 'action' as const, data: a })),
        ...meetingResults.map(m => ({ type: 'meeting' as const, data: m })),
        ...personResults.map(p => ({ type: 'person' as const, data: p })),
    ], [rankedActions, meetingResults, personResults]);

    useEffect(() => {
        setSelectedIndex(i => Math.min(i, Math.max(navItems.length - 1, 0)));
    }, [navItems]);

    useEffect(() => {
        const row = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`) as HTMLElement | null;
        row?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const executeAction = useCallback((action: ActionDef) => {
        onClose();
        if (handlers[action.id]) { handlers[action.id](); return; }
        const navPaths: Record<string, string> = {
            'nav.dashboard': '/', 'nav.tasks': '/tasks', 'nav.meeting': '/meeting',
            'nav.scheduled': '/scheduled', 'nav.archives': '/archives',
            'nav.preferences': '/preferences', 'nav.settings': '/settings',
            'meeting.join': '/meeting',
        };
        if (navPaths[action.id]) navigate(navPaths[action.id]);
    }, [handlers, navigate, onClose]);

    const executeMeeting = useCallback((m: any, transcriptText?: string) => {
        onClose();
        const id = m.id ?? m.shortId ?? m._id;
        if (!id) return;
        if (m.status === 'completed') {
            const path = transcriptText
                ? `/archives/${id}?q=${encodeURIComponent(transcriptText)}`
                : `/archives/${id}`;
            navigate(path);
        } else {
            navigate(`/meetings/${id}`);
        }
    }, [navigate, onClose]);

    const executePerson = useCallback((p: any) => {
        // Navigate to profile or search for their meetings
        onClose();
        navigate(`/archives?participant=${encodeURIComponent(p.name || p.email)}`);
    }, [navigate, onClose]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { onClose(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, navItems.length - 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const item = navItems[selectedIndex];
            if (!item) return;
            if (item.type === 'action') executeAction(item.data);
            else if (item.type === 'meeting') executeMeeting(item.data);
            else executePerson(item.data);
        }
    }, [navItems, selectedIndex, executeAction, executeMeeting, executePerson, onClose]);

    const hasApiResults = meetingResults.length > 0 || personResults.length > 0;
    const showApiSection = query.trim().length >= 2;

    if (!open) return null;

    return createPortal(
        <div className="cp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="cp-modal" role="dialog" aria-label="Command Palette">
                {/* Search */}
                <div className="cp-search-row">
                    <Icon icon={Search01Icon} size={16} className="cp-search-icon" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="cp-search-input"
                        placeholder="Search actions, meetings, people…"
                        value={query}
                        onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                        onKeyDown={handleKeyDown}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {query && (
                        <button type="button" className="cp-search-clear" onClick={() => { setQuery(''); setSelectedIndex(0); }}>
                            esc
                        </button>
                    )}
                </div>

                {/* Results */}
                <div className="cp-list" ref={listRef}>
                    {/* Actions */}
                    {rankedActions.length > 0 && (
                        <div className="cp-section">
                            {!query && <div className="cp-section-header">Actions</div>}
                            {rankedActions.map((action, i) => {
                                const alias = actionToAlias[action.id] ?? '';
                                const hotkey = getHotkey(action.id);
                                const IconComp = ACTION_ICONS[action.id] ?? FlashIcon;
                                const isSelected = i === selectedIndex;
                                return (
                                    <button
                                        key={action.id}
                                        type="button"
                                        data-idx={i}
                                        className={`cp-row${isSelected ? ' cp-row-selected' : ''}`}
                                        onClick={() => executeAction(action)}
                                        onMouseEnter={() => setSelectedIndex(i)}
                                    >
                                        <span className="cp-row-icon">
                                            <Icon icon={IconComp} size={15} />
                                        </span>
                                        <span className="cp-row-name">{action.name}</span>
                                        {alias && <AliasChip alias={alias} />}
                                        <span className="cp-row-right">
                                            <span className="cp-badge cp-badge-group">{action.group}</span>
                                            <HotkeyDisplay hotkey={hotkey} />
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* API results */}
                    {showApiSection && (
                        <>
                            {searchLoading && (
                                <div className="cp-search-loading">
                                    <span className="archive-searching-loading">
                                        <span className="archive-searching-spin" />
                                        Searching…
                                    </span>
                                </div>
                            )}

                            {!searchLoading && meetingResults.length > 0 && (
                                <div className="cp-section">
                                    <div className="cp-section-header">Meetings &amp; Archives</div>
                                    {meetingResults.map((m, i) => {
                                        const gIdx = rankedActions.length + i;
                                        const isSelected = gIdx === selectedIndex;
                                        const snippets: any[] = m.matchedTranscripts?.slice(0, 2) ?? [];
                                        return (
                                            <div key={m._id ?? i} className="cp-meeting-group">
                                                <button
                                                    type="button"
                                                    data-idx={gIdx}
                                                    className={`cp-row${isSelected ? ' cp-row-selected' : ''}`}
                                                    onClick={() => executeMeeting(m)}
                                                    onMouseEnter={() => setSelectedIndex(gIdx)}
                                                >
                                                    <span className="cp-row-icon">
                                                        <Icon icon={m.status === 'completed' ? Archive03Icon : Video01Icon} size={15} />
                                                    </span>
                                                    <span className="cp-row-name">{m.title}</span>
                                                    {m.date && <span className="cp-row-meta">{formatDate(m.date)}</span>}
                                                    <span className="cp-row-right">
                                                        <span className={`cp-badge ${m.status === 'completed' ? 'cp-badge-archive' : 'cp-badge-meeting'}`}>
                                                            {m.status === 'completed' ? 'Archive' : 'Meeting'}
                                                        </span>
                                                    </span>
                                                </button>
                                                {snippets.map((t, si) => (
                                                    <button
                                                        key={si}
                                                        type="button"
                                                        className="cp-transcript-snippet"
                                                        onClick={() => executeMeeting(m, t.text)}
                                                        title="Jump to this transcript section"
                                                    >
                                                        <span className="cp-snippet-speaker">{t.speaker || 'Unknown'}</span>
                                                        <span className="cp-snippet-text">{truncate(t.text, 90)}</span>
                                                        <span className="cp-snippet-arrow">→ transcript</span>
                                                    </button>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {!searchLoading && personResults.length > 0 && (
                                <div className="cp-section">
                                    <div className="cp-section-header">People</div>
                                    {personResults.map((p, i) => {
                                        const gIdx = rankedActions.length + meetingResults.length + i;
                                        const isSelected = gIdx === selectedIndex;
                                        const initials = getInitials(p.name || p.email || '?');
                                        const hue = getAvatarHue(p._id || p.email || '');
                                        return (
                                            <button
                                                key={p._id ?? i}
                                                type="button"
                                                data-idx={gIdx}
                                                className={`cp-row${isSelected ? ' cp-row-selected' : ''}`}
                                                onClick={() => executePerson(p)}
                                                onMouseEnter={() => setSelectedIndex(gIdx)}
                                            >
                                                <span className="cp-row-icon cp-avatar-icon" style={{ ['--avatar-hue' as any]: hue }}>
                                                    {p.profileImage
                                                        ? <img src={p.profileImage} alt="" className="cp-avatar-img" />
                                                        : <span className="cp-avatar-initials">{initials}</span>
                                                    }
                                                </span>
                                                <span className="cp-row-name">{p.name || p.email}</span>
                                                {p.name && <span className="cp-row-meta">{p.email}</span>}
                                                <span className="cp-row-right">
                                                    <span className="cp-badge cp-badge-group">Person</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {!searchLoading && !hasApiResults && rankedActions.length === 0 && (
                                <div className="cp-empty cp-empty-full">No results for "{query}"</div>
                            )}
                        </>
                    )}

                    {/* Empty state when no query */}
                    {!query && rankedActions.length === 0 && (
                        <div className="cp-empty cp-empty-full">No actions available</div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
