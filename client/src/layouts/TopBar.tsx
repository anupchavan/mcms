import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../shared/components/Icon';
import {
    Search01Icon,
    Notification01Icon,
    UserIcon,
    Sun03Icon,
    Add01Icon,
    Logout01Icon,
    Calendar02Icon,
    BarChartIcon,
    Tick01Icon,
    Moon02Icon,
    Clock01Icon,
    Archive03Icon,
    Copy01Icon,
    Video01Icon,
} from '@hugeicons/core-free-icons';
import { useAuth } from '../stores/AuthContext';
import { useSocket } from '../stores/SocketContext';
import Kbd from '../shared/components/Kbd';
import ShortcutTooltip from '../shared/components/ShortcutTooltip';
import { publicMeetingSlug, isMeetingShortSlug } from '../utils/meetingSlug';

const _raw = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const SERVER_BASE = _raw.replace(/(\/api\/?)+$/, '');
const API_BASE = `${SERVER_BASE}/api`;

const SEARCH_DEBOUNCE_MS = 280;

interface TopBarProps {
    userName: string;
    onNewMeeting: () => void;
    theme?: string;
    onToggleTheme: () => void;
    sidebarCollapsed: boolean;
    onSidebarToggle: () => void;
    onLogout?: () => void;
    onOpenPoll?: (meetingId: string) => void;
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

function formatDate(dateStr: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="svg-icon sidebar-toggle-button-icon">
            <rect x="1" y="2" width="22" height="20" rx="4" />
            <rect x={collapsed ? "4.9" : "4"} y={collapsed ? "6" : "5"} width="2" height={collapsed ? "12" : "14"} rx="1" fill="currentColor" className={collapsed ? 'sidebar-toggle-icon-close' : 'sidebar-toggle-icon-open'} />
        </svg>
    );
}

/** Public URL slug for notifications — lowercase `xxxx-xxxx`; never Mongo ObjectId hex. */
function resolveMeetingSlug(notif: { meetingId?: unknown; inviteId?: string; meetingShortId?: string }): string | null {
    if (typeof notif.inviteId === 'string' && isMeetingShortSlug(notif.inviteId)) return notif.inviteId.trim();
    if (typeof notif.meetingShortId === 'string' && isMeetingShortSlug(notif.meetingShortId)) return notif.meetingShortId.trim();
    const m = notif.meetingId;
    if (m && typeof m === 'object' && m !== null) {
        const doc = m as { id?: string; shortId?: string; _id?: unknown };
        return publicMeetingSlug({
            id: doc.id,
            shortId: doc.shortId,
            _id: doc._id != null ? String(doc._id) : undefined,
        });
    }
    const raw = typeof m === 'string' ? m : '';
    return publicMeetingSlug({ id: raw || undefined });
}

function getNavMeetingMongoId(notif: { meetingId?: unknown }): string | null {
    const mid = notif.meetingId;
    if (mid && typeof mid === 'object' && '_id' in mid && mid._id != null) return String((mid as { _id: unknown })._id);
    if (typeof mid === 'string' || typeof mid === 'number') return String(mid);
    return null;
}

function appHref(path: string) {
    const basename = typeof import.meta.env.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';
    return `${typeof window !== 'undefined' ? window.location.origin : ''}${basename}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Scheduled start timestamp for join eligibility; uses populated meeting or realtime snapshot fields on the notification. */
function parseMeetingStartMs(notif: {
    meetingId?: unknown;
    meetingScheduledDate?: string | null;
    meetingScheduledTime?: string | null;
}): number | null {
    let dateStr: string | undefined | null;
    let timeStr: string | undefined | null;
    const m = notif.meetingId;
    if (m && typeof m === 'object') {
        const mt = m as { confirmedDate?: string; confirmedTime?: string; date?: string; time?: string };
        dateStr = mt.confirmedDate || mt.date;
        timeStr = mt.confirmedTime || mt.time;
    }
    dateStr = dateStr || notif.meetingScheduledDate || null;
    timeStr = timeStr || notif.meetingScheduledTime || null;
    if (!dateStr || !timeStr || String(timeStr).trim() === '') return null;
    const t = String(timeStr).trim();
    const timeNorm = /^\d{1,2}:\d{2}(:\d{2})?$/.test(t)
        ? (t.split(':').length === 2 ? `${t}:00` : t)
        : t;
    const iso = `${String(dateStr).trim()}T${timeNorm}`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
}

function notificationModality(notif: {
    meetingId?: unknown;
    meetingModality?: string;
}): string | undefined {
    const m = notif.meetingId;
    if (m && typeof m === 'object' && 'modality' in m) return (m as { modality?: string }).modality;
    return notif.meetingModality;
}

function notificationStatus(notif: { meetingId?: unknown; meetingStatus?: string }): string | undefined {
    const m = notif.meetingId;
    if (m && typeof m === 'object' && 'status' in m) return (m as { status?: string }).status;
    return notif.meetingStatus;
}

/** Show Join when the scheduled start time is within 15 minutes of now (either direction), or the meeting is in progress. Online/Hybrid only. */
function notificationJoinEligible(notif: {
    meetingId?: unknown;
    meetingScheduledDate?: string | null;
    meetingScheduledTime?: string | null;
    meetingModality?: string;
}) {
    const modality = notificationModality(notif);
    if (modality === 'Offline') return false;
    const st = notificationStatus(notif);
    if (st === 'completed' || st === 'cancelled') return false;
    if (st === 'in-progress') return true;
    const startMs = parseMeetingStartMs(notif);
    if (startMs == null) return false;
    return Math.abs(Date.now() - startMs) <= 15 * 60 * 1000;
}

function timeAgo(dateStr: string) {
    const now = new Date();
    const date = new Date(dateStr);
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export default function TopBar({ userName, onNewMeeting, theme = 'dark', onToggleTheme, sidebarCollapsed, onSidebarToggle, onLogout, onOpenPoll, searchInputRef }: TopBarProps) {
    const { user } = useAuth();
    const { socket } = useSocket();
    const navigate = useNavigate();
    const [showNotif, setShowNotif] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [notifToast, setNotifToast] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [searchSelectedIndex, setSearchSelectedIndex] = useState(-1);
    const notifRef = useRef<HTMLDivElement | null>(null);
    const userMenuRef = useRef<HTMLDivElement | null>(null);
    const searchBoxRef = useRef<HTMLDivElement | null>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const unreadCount = notifications.filter(n => !n.read).length;

    // #region agent log
    useEffect(() => {
        console.log('[DBG-119c19][TopBar][H1] avatar state', {SERVER_BASE, profileImage: user?.profileImage, constructedUrl: user?.profileImage ? `${SERVER_BASE}${user.profileImage}` : null, VITE_API_URL: import.meta.env.VITE_API_URL});
    }, [user?.profileImage]);
    // #endregion

    useEffect(() => {
        if (!notifToast) return;
        const t = setTimeout(() => setNotifToast(null), 2200);
        return () => clearTimeout(t);
    }, [notifToast]);

    const runSearch = useCallback(async (q: string) => {
        const trimmed = (q || '').trim();
        if (trimmed.length < 2) {
            setSearchResults([]);
            return;
        }
        setSearchLoading(true);
        try {
            const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(trimmed)}`, {
                headers: { Authorization: `Bearer ${user?.token}` },
            });
            if (res.ok) setSearchResults(await res.json());
            else setSearchResults([]);
        } catch {
            setSearchResults([]);
        }
        setSearchLoading(false);
    }, [user?.token]);

    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (!searchQuery.trim()) {
            setSearchResults([]);
            setShowSearchDropdown(false);
            setSearchSelectedIndex(-1);
            return;
        }
        setShowSearchDropdown(true);
        setSearchSelectedIndex(-1);
        searchDebounceRef.current = setTimeout(() => runSearch(searchQuery), SEARCH_DEBOUNCE_MS);
        return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
    }, [searchQuery, runSearch]);

    useEffect(() => {
        setSearchSelectedIndex(-1);
    }, [searchResults]);

    useEffect(() => {
        if (!user?.token) return;
        fetch(`${API_BASE}/notifications`, {
            headers: { Authorization: `Bearer ${user.token}` },
        })
            .then(r => r.ok ? r.json() : [])
            .then(setNotifications)
            .catch(() => {});
    }, [user?.token]);

    useEffect(() => {
        if (!socket) return;
        const handler = (notif: any) => {
            setNotifications(prev => [notif, ...prev]);
        };
        socket.on('notification', handler);
        return () => { socket.off('notification', handler); };
    }, [socket]);

    useEffect(() => {
        function handleNotifKeyDown(e: KeyboardEvent) {
            const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || (document.activeElement as HTMLElement)?.isContentEditable;
            if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !inInput) {
                e.preventDefault();
                setShowNotif(prev => !prev);
            }
            if (e.key === 'Escape') {
                setShowNotif(false);
            }
        }
        window.addEventListener('keydown', handleNotifKeyDown);
        return () => window.removeEventListener('keydown', handleNotifKeyDown);
    }, []);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
                setShowNotif(false);
            }
            if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
                setShowUserMenu(false);
            }
            if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
                setShowSearchDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const markAllRead = useCallback(async () => {
        try {
            await fetch(`${API_BASE}/notifications/read-all`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${user?.token}`, 'Content-Type': 'application/json' },
            });
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        } catch { /* ignore */ }
    }, [user?.token]);

    const markNotificationRead = useCallback(async (notif: any) => {
        if (!notif?._id || notif.read) return;
        try {
            await fetch(`${API_BASE}/notifications/${notif._id}/read`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${user?.token}`, 'Content-Type': 'application/json' },
            });
            setNotifications(prev => prev.map(n => n._id === notif._id ? { ...n, read: true } : n));
        } catch { /* ignore */ }
    }, [user?.token]);

    const getNotifIcon = (type: string) => {
        switch (type) {
            case 'poll_invite': return BarChartIcon;
            case 'meeting_confirmed': return Calendar02Icon;
            case 'meeting_summary_ready': return Archive03Icon;
            default: return Notification01Icon;
        }
    };

    const notificationRowIconModifier = (type: string) =>
        type === 'poll_invite' ? 'poll' : type === 'meeting_confirmed' ? 'confirmed' : type === 'meeting_summary_ready' ? 'archive' : '';

    const selectSearchResult = useCallback((m: any) => {
        const linkSlug = publicMeetingSlug(m);
        if (linkSlug) {
            const path = m.status === 'completed' ? `/archives/${linkSlug}` : `/meetings/${linkSlug}`;
            navigate(path);
        }
        setSearchQuery('');
        setShowSearchDropdown(false);
        setSearchSelectedIndex(-1);
    }, [navigate]);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setShowSearchDropdown(false);
            setSearchQuery('');
            setSearchSelectedIndex(-1);
            searchInputRef?.current?.blur();
            return;
        }
        if (!showSearchDropdown || searchLoading || searchResults.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSearchSelectedIndex(i => (i < searchResults.length - 1 ? i + 1 : i));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSearchSelectedIndex(i => (i <= 0 ? -1 : i - 1));
        } else if (e.key === 'Enter' && searchSelectedIndex >= 0 && searchResults[searchSelectedIndex]) {
            e.preventDefault();
            selectSearchResult(searchResults[searchSelectedIndex]);
        }
    }, [showSearchDropdown, searchLoading, searchResults, searchSelectedIndex, selectSearchResult]);

    return (
        <header className="topbar">
            <div className="topbar-left">
                <ShortcutTooltip keys={['mod', 'B']}>
                    <div className="sidebar-toggle" onClick={onSidebarToggle} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                        <SidebarToggleIcon collapsed={sidebarCollapsed} />
                    </div>
                </ShortcutTooltip>
                <div className="topbar-brand">
                    <span className="brand-name">Concord</span>
                </div>
            </div>

            <div className="topbar-center" ref={searchBoxRef} style={{ position: 'relative' }}>
                <div className="search-box">
                    <Icon icon={Search01Icon} size={16} />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search meetings and agendas..."
                        value={searchQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                        onFocus={() => searchQuery.trim().length >= 2 && setShowSearchDropdown(true)}
                        onKeyDown={handleSearchKeyDown}
                    />
                    <Kbd keys={['mod', 'K']} className="kbd-hint" />
                </div>
                {showSearchDropdown && searchQuery.trim() && (
                    <div className="search-dropdown glass-card">
                        {searchLoading ? (
                            <div className="search-dropdown-loading">Searching...</div>
                        ) : searchResults.length === 0 ? (
                            <div className="search-dropdown-empty">No meetings found</div>
                        ) : (
                            <div className="search-dropdown-results">
                                {searchResults.map((m, idx) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        className={`search-dropdown-item${searchSelectedIndex === idx ? ' selected' : ''}`}
                                        onClick={() => selectSearchResult(m)}
                                        onMouseEnter={() => setSearchSelectedIndex(idx)}
                                    >
                                        <div className="search-dropdown-item-title">{m.title}</div>
                                        <div className="search-dropdown-item-meta">
                                            {m.date && <span><Icon icon={Calendar02Icon} size={12} /> {formatDate(m.date)}</span>}
                                            {m.time && <span><Icon icon={Clock01Icon} size={12} /> {m.time}</span>}
                                            <span><Icon icon={UserIcon} size={12} /> {m.host}</span>
                                            {m.status && <span className={`chip ${m.status === 'completed' ? 'chip-emerald' : 'chip-amber'}`} style={{ fontSize: '0.5625rem' }}>{m.status}</span>}
                                        </div>
                                        {m.matchedTranscripts?.length > 0 && (
                                            <div className="search-dropdown-item-snippets">
                                                {m.matchedTranscripts.slice(0, 2).map((t, i) => (
                                                    <p key={i}><strong>{t.speaker}:</strong> {t.text.length > 80 ? t.text.slice(0, 80) + '…' : t.text}</p>
                                                ))}
                                            </div>
                                        )}
                                        {m.matchedAgendaItems?.length > 0 && m.matchedTranscripts?.length === 0 && (
                                            <div className="search-dropdown-item-snippets">
                                                <p>Agenda: {m.matchedAgendaItems.map(a => a.title).join(', ')}</p>
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="topbar-right">
                <ShortcutTooltip keys={['Shift', 'M']}>
                    <button className="btn btn-primary" onClick={onNewMeeting} id="btn-new-meeting">
                        <Icon icon={Add01Icon} size={16} /> New Meeting
                    </button>
                </ShortcutTooltip>

                <div ref={notifRef} style={{ position: 'relative' }}>
                    <ShortcutTooltip keys={['N']}>
                        <button
                            className={`btn-icon tooltip ${showNotif ? 'active' : ''}`}
                            data-tooltip="Notifications"
                            onClick={() => setShowNotif(!showNotif)}
                            id="btn-notifications"
                        >
                            <Icon icon={Notification01Icon} size={18} />
                            {unreadCount > 0 && <span className="notif-dot" aria-hidden />}
                        </button>
                    </ShortcutTooltip>

                    {showNotif && (
                        <div className="notification-dropdown">
                            <div className="notification-dropdown-header">
                                <span className="notification-dropdown-title">Notifications</span>
                                {unreadCount > 0 && (
                                    <button type="button" className="notification-mark-read" onClick={markAllRead}>
                                        <Icon icon={Tick01Icon} size={12} />
                                        Mark all read
                                    </button>
                                )}
                            </div>
                            {notifToast && (
                                <div className="notification-dropdown-toast" role="status">
                                    {notifToast}
                                </div>
                            )}
                            <div className="notification-dropdown-body">
                                {notifications.length === 0 ? (
                                    <div className="notification-empty">No notifications yet</div>
                                ) : (
                                    notifications.map((n, idx) => {
                                        const slug = resolveMeetingSlug(n);
                                        const pollMongoId = getNavMeetingMongoId(n);
                                        const iconMod = notificationRowIconModifier(n.type);
                                        const confirmedJoinEligible = notificationJoinEligible(n);

                                        const pollActions = n.type === 'poll_invite' && pollMongoId && onOpenPoll && (
                                            <button
                                                type="button"
                                                className="notification-item-action"
                                                onClick={() => {
                                                    markNotificationRead(n);
                                                    onOpenPoll(pollMongoId);
                                                    setShowNotif(false);
                                                }}
                                            >
                                                <Icon icon={BarChartIcon} size={12} />
                                                Vote on times
                                            </button>
                                        );

                                        const confirmedActions = n.type === 'meeting_confirmed' && slug && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="notification-item-action"
                                                    onClick={async () => {
                                                        try {
                                                            await navigator.clipboard.writeText(appHref(`/meetings/${slug}`));
                                                            setNotifToast('Meeting link copied');
                                                            markNotificationRead(n);
                                                        } catch {
                                                            /* ignore */
                                                        }
                                                    }}
                                                >
                                                    <Icon icon={Copy01Icon} size={12} />
                                                    Copy link
                                                </button>
                                                {confirmedJoinEligible && (
                                                    <button
                                                        type="button"
                                                        className="notification-item-action notification-item-action-primary"
                                                        onClick={() => {
                                                            markNotificationRead(n);
                                                            navigate(`/meetings/${slug}`);
                                                            setShowNotif(false);
                                                        }}
                                                    >
                                                        <Icon icon={Video01Icon} size={12} />
                                                        Join
                                                    </button>
                                                )}
                                            </>
                                        );

                                        const archiveActions = n.type === 'meeting_summary_ready' && slug && (
                                            <button
                                                type="button"
                                                className="notification-item-action"
                                                onClick={() => {
                                                    markNotificationRead(n);
                                                    navigate(`/archives/${slug}`);
                                                    setShowNotif(false);
                                                }}
                                            >
                                                <Icon icon={Archive03Icon} size={12} />
                                                Open archive
                                            </button>
                                        );

                                        const actionRow = pollActions || confirmedActions || archiveActions;

                                        return (
                                            <div
                                                key={n._id ?? `nid-${idx}-${String(n.createdAt)}`}
                                                className={`notification-item${n.read ? '' : ' unread'}`}
                                                role="listitem"
                                            >
                                                <div className="notification-item-row">
                                                    <div className={`notification-item-icon${iconMod ? ` ${iconMod}` : ''}`}>
                                                        <Icon icon={getNotifIcon(n.type)} size={14} />
                                                    </div>
                                                    <div className="notification-item-content">
                                                        <p className="notification-item-message">{n.message}</p>
                                                        <span className="notification-item-time">{timeAgo(n.createdAt)}</span>
                                                    </div>
                                                    {!n.read && <span className="notification-unread-dot" aria-hidden />}
                                                </div>
                                                {actionRow && (
                                                    <div className="notification-item-actions">{actionRow}</div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div ref={userMenuRef} className="user-profile" style={{ position: 'relative' }}>
                    <div
                        className="user-menu"
                        onClick={() => setShowUserMenu(!showUserMenu)}
                        style={{ cursor: 'pointer' }}
                    >
                        <div className="user-avatar">
                            {user?.profileImage
                                ? <img src={`${SERVER_BASE}${user.profileImage}`} alt="" className="user-avatar-img"
                                    onError={() => { /* #region agent log */ console.log('[DBG-119c19][TopBar:img.onError][H3] Avatar img FAILED to load', {src: `${SERVER_BASE}${user?.profileImage}`}); /* #endregion */ }}
                                  />
                                : <Icon icon={UserIcon} size={18} />
                            }
                        </div>
                    </div>

                    {showUserMenu && (
                        <div className="glass-card" style={{
                            position: 'absolute', right: 0, top: '3rem', width: '12.5rem',
                            padding: '0.5rem', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '0.25rem'
                        }}>
                            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '0.0625rem solid var(--border)', marginBottom: '0.25rem' }}>
                                <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{userName}</div>
                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Host Account</div>
                            </div>
                            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start', border: 'none' }} onClick={() => { navigate('/settings'); setShowUserMenu(false); }}>Profile Settings</button>
                            {onLogout && (
                                <button
                                    className="btn btn-secondary"
                                    style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--accent-rose)', border: 'none' }}
                                    onClick={onLogout}
                                >
                                    <Icon icon={Logout01Icon} size={16} />
                                    <span style={{ marginLeft: '0.5rem' }}>Logout</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <ShortcutTooltip keys={['D']}>
                    <button
                        type="button"
                        className={`theme-toggle tooltip ${theme === 'light' ? 'light' : 'dark'}`}
                        data-tooltip={theme === 'light' ? 'Toggle dark mode' : 'Toggle light mode'}
                        aria-label="Toggle color theme"
                        onClick={onToggleTheme}
                    >
                        <span className="theme-toggle-thumb">
                            {theme === 'light' ? <Icon icon={Sun03Icon} size={14} /> : <Icon icon={Moon02Icon} size={14} />}
                        </span>
                    </button>
                </ShortcutTooltip>
            </div>
        </header>
    );
}
