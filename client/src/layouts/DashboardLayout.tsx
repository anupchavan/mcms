import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import MeetingCreation from "../modules/meeting/microFrontends/createMeeting/components/MeetingCreation";
import { PollVoting } from "../features/polls";
import { LocationMapModal } from "../features/meeting";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import { useAuth } from "../stores/AuthContext";
import { useSocket } from "../stores/SocketContext";
import {
    publicMeetingSlug,
    resolvedInternalMeetingId,
} from "../utils/meetingSlug";

const VITE_API_URL = import.meta.env.VITE_API_URL;
const API_BASE = VITE_API_URL || "http://localhost:5001/api";

const VIEW_PATHS = [
    "/",
    "/tasks",
    "/meeting",
    "/scheduled",
    "/archives",
    "/preferences",
    "/settings",
];

export interface AppMeeting {
    /** Mongo document id or primary in-memory meeting key — use for `/api/*` and sockets (not public links). */
    _id?: string;
    /** Public invite segment (`xxxx-xxxx`) used in `/meetings/:slug` URLs when present. */
    id?: string;
    title: string;
    modality?: "Online" | "Offline" | "Hybrid";
    date?: string;
    confirmedDate?: string;
    time?: string;
    confirmedTime?: string;
    durationMinutes?: number;
    location?: string;
    host?: string;
    hostId?: string;
    participants?: any[];
    status?: string;
    meetingUrl?: string | null;
    pollId?: string | null;
    isPersonalRoom?: boolean;
    personalRoomId?: string;
    [key: string]: unknown;
}

export interface DashboardStats {
    streak?: number;
    user?: string;
    [key: string]: unknown;
}

export interface MyTasks {
    assignedToMe: any[];
    assignedByMe: any[];
}

export interface DashboardLayoutContext {
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
    meetings: AppMeeting[];
    refreshMeetings: () => Promise<void>;
    dashboardStats: DashboardStats | null;
    refreshDashboardStats: () => Promise<void>;
    myTasks: MyTasks;
    refreshMyTasks: () => Promise<void>;
    openCreateMeetingModal: () => void;
    openLocationModal: (address: string) => void;
    openPoll: (meetingId: string) => void;
    handleCreateMeeting: (data: any) => Promise<AppMeeting | null>;
}

export default function DashboardLayout() {
    const { user, logout } = useAuth();
    const { socket } = useSocket();
    const navigate = useNavigate();
    const location = useLocation();

    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [showCreateMeeting, setShowCreateMeeting] = useState(false);
    const [pollMeetingId, setPollMeetingId] = useState<string | null>(null);
    const [locationModalAddress, setLocationModalAddress] = useState<
        string | null
    >(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const [theme, setTheme] = useState(() => {
        if (typeof window === "undefined") return "dark";
        return window.localStorage.getItem("theme") === "light"
            ? "light"
            : "dark";
    });

    const [meetings, setMeetings] = useState<AppMeeting[]>([]);
    const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(
        null,
    );
    const [myTasks, setMyTasks] = useState<MyTasks>({
        assignedToMe: [],
        assignedByMe: [],
    });

    const fetchWithAuth = useCallback(
        async (url: string, options: RequestInit = {}): Promise<Response> => {
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                ...(options.headers as Record<string, string>),
            };
            if (user?.token) headers.Authorization = `Bearer ${user.token}`;
            return fetch(url, { ...options, headers });
        },
        [user?.token],
    );

    const refreshMeetings = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE}/meetings`);
            if (res.ok) setMeetings(await res.json());
        } catch (err) {
            console.error("Failed to fetch meetings:", err);
        }
    }, [fetchWithAuth]);

    const refreshDashboardStats = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE}/dashboard/stats`);
            if (res.ok) setDashboardStats(await res.json());
        } catch (err) {
            console.error("Failed to fetch dashboard stats:", err);
        }
    }, [fetchWithAuth]);

    const refreshMyTasks = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE}/tasks/mine/overview`);
            if (res.ok) {
                const data = await res.json();
                setMyTasks({
                    assignedToMe: Array.isArray(data.assignedToMe)
                        ? data.assignedToMe
                        : [],
                    assignedByMe: Array.isArray(data.assignedByMe)
                        ? data.assignedByMe
                        : [],
                });
            }
        } catch (err) {
            console.error("Failed to fetch my tasks:", err);
        }
    }, [fetchWithAuth]);

    useEffect(() => {
        refreshMeetings();
        refreshDashboardStats();
        refreshMyTasks();
    }, [refreshMeetings, refreshDashboardStats, refreshMyTasks]);

    useEffect(() => {
        if (typeof document !== "undefined")
            document.documentElement.setAttribute("data-theme", theme);
        if (typeof window !== "undefined")
            window.localStorage.setItem("theme", theme);
    }, [theme]);

    // Listen for task notifications globally so the tasks page stays fresh.
    useEffect(() => {
        if (!socket) return;
        const handler = (notif: any) => {
            if (
                [
                    "task_assigned",
                    "task_completion_submitted",
                    "task_verified",
                    "task_rejected",
                    "task_feedback",
                    // Legacy notification types — kept so older notifications still trigger a refresh.
                    "action_item_assigned",
                    "action_item_completion_submitted",
                    "action_item_verified",
                    "action_item_rejected",
                    "action_item_feedback",
                ].includes(notif.type)
            ) {
                refreshMyTasks();
            }
        };
        socket.on("notification", handler);
        return () => {
            socket.off("notification", handler);
        };
    }, [socket, refreshMyTasks]);

    // When a meeting ends server-side and we get notified, refresh the list.
    useEffect(() => {
        if (!socket) return;
        const handler = ({ meetingId }: { meetingId: string }) => {
            setMeetings((prev) =>
                prev.map((m) =>
                    resolvedInternalMeetingId(m) === String(meetingId)
                        ? { ...m, status: "completed" }
                        : m,
                ),
            );
            refreshMeetings();
        };
        socket.on("meeting_ended", handler);
        return () => {
            socket.off("meeting_ended", handler);
        };
    }, [socket, refreshMeetings]);

    const openCreateMeetingModal = useCallback(
        () => setShowCreateMeeting(true),
        [],
    );
    const openLocationModal = useCallback(
        (address: string) => setLocationModalAddress(address),
        [],
    );
    const openPoll = useCallback(
        (meetingId: string) => setPollMeetingId(meetingId),
        [],
    );

    const handleCreateMeeting = useCallback(
        async (meetingData: any): Promise<AppMeeting | null> => {
            try {
                const res = await fetchWithAuth(`${API_BASE}/meetings`, {
                    method: "POST",
                    body: JSON.stringify(meetingData),
                });
                if (res.ok) {
                    const newMeeting = await res.json();
                    setMeetings((prev) => [newMeeting, ...prev]);
                    const linkSlug = publicMeetingSlug(newMeeting);
                    if (linkSlug) navigate(`/meetings/${linkSlug}`);
                    return newMeeting;
                }
            } catch (err) {
                console.error("Failed to create meeting:", err);
            }
            return null;
        },
        [fetchWithAuth, navigate],
    );

    const toggleTheme = useCallback(
        () => setTheme((prev) => (prev === "dark" ? "light" : "dark")),
        [],
    );
    const toggleSidebar = useCallback(
        () => setSidebarCollapsed((prev) => !prev),
        [],
    );

    const toggleFullscreen = useCallback(() => {
        const target = document.querySelector(".meeting-layout");
        if (!target) return;
        if (document.fullscreenElement) document.exitFullscreen();
        else (target as HTMLElement).requestFullscreen?.().catch(() => {});
    }, []);

    const shortcuts = useMemo(
        () => [
            {
                key: "k",
                mod: true,
                allowInInput: true,
                handler: () => {
                    const el = searchInputRef.current;
                    if (document.activeElement === el) el?.blur();
                    else el?.focus();
                },
            },
            { key: "b", mod: true, allowInInput: true, handler: toggleSidebar },
            {
                key: "M",
                shift: true,
                handler: () => setShowCreateMeeting(true),
            },
            { key: "d", handler: toggleTheme },
            { key: "f", handler: toggleFullscreen },
            {
                key: "Escape",
                allowInInput: true,
                handler: () => {
                    if (pollMeetingId) setPollMeetingId(null);
                },
            },
            ...VIEW_PATHS.map((path, i) => ({
                key: String(i + 1),
                handler: () => navigate(path),
            })),
        ],
        [pollMeetingId, toggleSidebar, toggleTheme, toggleFullscreen, navigate],
    );

    useKeyboardShortcuts(shortcuts);

    // Set the document title based on the current path.
    useEffect(() => {
        const labels: Record<string, string> = {
            "/": "Dashboard",
            "/tasks": "My Tasks",
            "/meeting": "Live Meeting",
            "/scheduled": "Scheduled Meetings",
            "/archives": "Meeting Archives",
            "/preferences": "Preferences",
            "/settings": "Settings",
        };
        let label = labels[location.pathname];
        if (!label) {
            if (
                location.pathname.startsWith("/meetings/") ||
                location.pathname.startsWith("/rooms/")
            )
                label = "Live Meeting";
            else if (location.pathname.startsWith("/archives/"))
                label = "Archive";
            else label = "Concord";
        }
        document.title = `${label} — Concord`;
    }, [location.pathname]);

    const context = useMemo<DashboardLayoutContext>(
        () => ({
            fetchWithAuth,
            meetings,
            refreshMeetings,
            dashboardStats,
            refreshDashboardStats,
            myTasks,
            refreshMyTasks,
            openCreateMeetingModal,
            openLocationModal,
            openPoll,
            handleCreateMeeting,
        }),
        [
            fetchWithAuth,
            meetings,
            refreshMeetings,
            dashboardStats,
            refreshDashboardStats,
            myTasks,
            refreshMyTasks,
            openCreateMeetingModal,
            openLocationModal,
            openPoll,
            handleCreateMeeting,
        ],
    );

    return (
        <div className="app-container">
            <TopBar
                userName={user?.name || dashboardStats?.user || "User"}
                onNewMeeting={openCreateMeetingModal}
                theme={theme}
                onToggleTheme={toggleTheme}
                sidebarCollapsed={sidebarCollapsed}
                onSidebarToggle={toggleSidebar}
                onLogout={logout}
                onOpenPoll={openPoll}
                searchInputRef={searchInputRef}
            />

            <div className="main-area">
                <Sidebar collapsed={sidebarCollapsed} />
                <div className="content-area">
                    <Outlet context={context} />
                </div>
            </div>

            {showCreateMeeting && (
                <MeetingCreation
                    onClose={() => setShowCreateMeeting(false)}
                    onSubmit={handleCreateMeeting}
                />
            )}

            {pollMeetingId && (
                <PollVoting
                    meetingId={pollMeetingId}
                    onClose={() => setPollMeetingId(null)}
                />
            )}

            {locationModalAddress && (
                <LocationMapModal
                    address={locationModalAddress}
                    onClose={() => setLocationModalAddress(null)}
                />
            )}
        </div>
    );
}
