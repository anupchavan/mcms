import React, { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../shared/components/Icon';
import {
    Search01Icon,
    Notification01Icon,
    FireIcon,
    UserIcon,
    Sun03Icon,
    Add01Icon,
    Logout01Icon,
    Calendar02Icon,
    BarChartIcon,
    Tick01Icon,
    Moon02Icon,
    Clock01Icon,
} from '@hugeicons/core-free-icons';
import { useAuth } from '../stores/AuthContext';
import { useSocket } from '../stores/SocketContext';
import Kbd from '../shared/components/Kbd';
import ShortcutTooltip from '../shared/components/ShortcutTooltip';

const _raw = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const SERVER_BASE = _raw.replace(/(\/api\/?)+$/, '');
const API_BASE = `${SERVER_BASE}/api`;

const SEARCH_DEBOUNCE_MS = 280;

interface TopBarProps {
    streak: number;
    userName: string;
    onNewMeeting: () => void;
    theme?: string;
    onToggleTheme: () => void;
    sidebarCollapsed: boolean;
    onSidebarToggle: () => void;
    onLogout?: () => void;
    onOpenPoll?: (meetingId: string) => void;
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
    onViewChange?: (view: string) => void;
    onSearchResultSelect?: (meeting: any) => void;
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

export default function TopBar({ streak, userName, onNewMeeting, theme = 'dark', onToggleTheme, sidebarCollapsed, onSidebarToggle, onLogout, onOpenPoll, searchInputRef, onViewChange, onSearchResultSelect }: TopBarProps) {
    const { user } = useAuth();
    const { socket } = useSocket();
    const [showNotif, setShowNotif] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [notifications, setNotifications] = useState<any[]>([]);
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

    const markAllRead = async () => {
        try {
            await fetch(`${API_BASE}/notifications/read-all`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${user?.token}`, 'Content-Type': 'application/json' },
            });
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        } catch { /* ignore */ }
    };

    const handleNotifClick = async (notif: any) => {
        if (!notif.read) {
            try {
                await fetch(`${API_BASE}/notifications/${notif._id}/read`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${user?.token}`, 'Content-Type': 'application/json' },
                });
                setNotifications(prev => prev.map(n => n._id === notif._id ? { ...n, read: true } : n));
            } catch { /* ignore */ }
        }

        if (notif.type === 'poll_invite' && onOpenPoll) {
            onOpenPoll(notif.meetingId?._id || notif.meetingId);
            setShowNotif(false);
        }
    };

    const getNotifIcon = (type: string) => {
        switch (type) {
            case 'poll_invite': return BarChartIcon;
            case 'meeting_confirmed': return Calendar02Icon;
            default: return Notification01Icon;
        }
    };

    const selectSearchResult = useCallback((m: any) => {
        onSearchResultSelect?.({ id: m.id, title: m.title, modality: m.modality, date: m.date, time: m.time, host: m.host, hostId: m.hostId, status: m.status, participants: m.participants });
        setSearchQuery('');
        setShowSearchDropdown(false);
        setSearchSelectedIndex(-1);
    }, [onSearchResultSelect]);

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

                <div className="streak-badge tooltip" data-tooltip={`${streak} meeting streak!`}>
                    <Icon icon={FireIcon} size={16} className="streak-icon" />
                    <span>{streak}</span>
                </div>

                <div ref={notifRef} style={{ position: 'relative' }}>
                    <ShortcutTooltip keys={['N']}>
                        <button
                            className={`btn-icon tooltip ${showNotif ? 'active' : ''}`}
                            data-tooltip="Notifications"
                            onClick={() => setShowNotif(!showNotif)}
                            id="btn-notifications"
                        >
                            <Icon icon={Notification01Icon} size={18} />
                            {unreadCount > 0 && <span className="notif-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                        </button>
                    </ShortcutTooltip>

                    {showNotif && (
                        <div className="notification-dropdown">
                            <div className="notification-dropdown-header">
                                <span className="notification-dropdown-title">Notifications</span>
                                {unreadCount > 0 && (
                                    <button className="notification-mark-read" onClick={markAllRead}>
                                        <Icon icon={Tick01Icon} size={12} />
                                        Mark all read
                                    </button>
                                )}
                            </div>
                            <div className="notification-dropdown-body">
                                {notifications.length === 0 ? (
                                    <div className="notification-empty">No notifications yet</div>
                                ) : (
                                    notifications.map(n => (
                                        <button
                                            key={n._id}
                                            className={`notification-item${n.read ? '' : ' unread'}`}
                                            onClick={() => handleNotifClick(n)}
                                        >
                                            <div className={`notification-item-icon ${n.type === 'poll_invite' ? 'poll' : n.type === 'meeting_confirmed' ? 'confirmed' : ''}`}>
                                                <Icon icon={getNotifIcon(n.type)} size={14} />
                                            </div>
                                            <div className="notification-item-content">
                                                <p className="notification-item-message">{n.message}</p>
                                                <span className="notification-item-time">{timeAgo(n.createdAt)}</span>
                                            </div>
                                            {!n.read && <span className="notification-unread-dot" />}
                                        </button>
                                    ))
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
                                ? <img src={`${SERVER_BASE}${user.profileImage}`} alt="" className="user-avatar-img" />
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
                            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start', border: 'none' }} onClick={() => { onViewChange?.('profile'); setShowUserMenu(false); }}>Profile Settings</button>
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
