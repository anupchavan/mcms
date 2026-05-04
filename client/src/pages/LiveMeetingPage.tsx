import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { VideoArea, MeetingDock, type DockPanelId, type ChatMessage } from "../features/meeting";
import Icon from "../shared/components/Icon";
import { Calendar02Icon, Clock01Icon, Location01Icon, UserIcon } from "@hugeicons/core-free-icons";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useDashboardContext from "../hooks/useDashboardContext";
import { useAuth } from "../stores/AuthContext";
import { useSocket } from "../stores/SocketContext";
import { publicMeetingSlug, resolvedInternalMeetingId } from "../utils/meetingSlug";

const VITE_API_URL = import.meta.env.VITE_API_URL;
const API_BASE = VITE_API_URL || "http://localhost:5001/api";

const MEETING_COMPLETION_BUFFER_MINUTES = 10;
const DEFAULT_MEETING_DURATION_MINUTES = 30;

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

function parseMeetingStart(meeting: any): Date | null {
    const dateStr = meeting.confirmedDate || meeting.date;
    const timeStr = meeting.confirmedTime || meeting.time || "00:00";
    if (!dateStr) return null;
    const [year, month, day] = String(dateStr).split("-").map(Number);
    const [hours, minutes] = String(timeStr).split(":").map(Number);
    if (![year, month, day].every(Number.isFinite)) return null;
    return new Date(year, (month || 1) - 1, day || 1,
        Number.isFinite(hours) ? hours : 0,
        Number.isFinite(minutes) ? minutes : 0, 0, 0);
}

function getMeetingDurationMinutes(meeting: any): number {
    const duration = Number(meeting.durationMinutes);
    return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_MEETING_DURATION_MINUTES;
}

function isMeetingCompletedByTime(meeting: any, nowTs: number): boolean {
    if (meeting.status === "completed" || meeting.status === "cancelled" || meeting.status === "pending_poll") {
        return meeting.status === "completed";
    }
    const start = parseMeetingStart(meeting);
    if (!start) return false;
    const endTimeWithBuffer = start.getTime()
        + getMeetingDurationMinutes(meeting) * 60 * 1000
        + MEETING_COMPLETION_BUFFER_MINUTES * 60 * 1000;
    return nowTs >= endTimeWithBuffer;
}

function sortMeetingsBySchedule(a: any, b: any): number {
    const aStart = parseMeetingStart(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bStart = parseMeetingStart(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aStart - bStart;
}

function shouldShowMeetingLocation(meeting: any): boolean {
    return (meeting.modality === "Offline" || meeting.modality === "Hybrid") && Boolean(String(meeting.location || "").trim());
}

interface LiveMeetingPageProps {
    /** When true, the `:roomId` route param is the personal-room id and we use the personal-room API. */
    isPersonalRoom?: boolean;
}

export default function LiveMeetingPage({ isPersonalRoom = false }: LiveMeetingPageProps) {
    const params = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const userId = user?.id || user?._id || null;
    const userName = user?.name || null;
    const userImage = user?.profileImage || null;
    const { socket } = useSocket();
    const {
        fetchWithAuth, meetings, refreshMeetings, openLocationModal, openPoll,
    } = useDashboardContext();

    const meetingId = params.id;
    const roomId = params.roomId;

    const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
    const [agendaItems, setAgendaItems] = useState<any[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [pinnedChatMessage, setPinnedChatMessage] = useState<ChatMessage | null>(null);
    const [transcripts, setTranscripts] = useState<any[]>([]);
    const [actionItems, setActionItems] = useState<any[]>([]);
    const [liveParticipants, setLiveParticipants] = useState<any[]>([]);
    const [dockOpen, setDockOpen] = useState(true);
    const [dockActivePanelId, setDockActivePanelId] = useState<DockPanelId>("agenda");
    const [addActionItemTrigger, setAddActionItemTrigger] = useState(0);
    const [nowTs, setNowTs] = useState(() => Date.now());
    const meetingLayoutRef = useRef<HTMLDivElement | null>(null);
    const chatFetchMeetingRef = useRef<string | null>(null);

    // Refresh `nowTs` once a minute so the placeholder list filters stay fresh.
    useEffect(() => {
        const intervalId = window.setInterval(() => setNowTs(Date.now()), 60 * 1000);
        return () => window.clearInterval(intervalId);
    }, []);

    // Resolve the meeting from URL: when no id, show placeholder list.
    useEffect(() => {
        if (isPersonalRoom && roomId) {
            // Personal room route: always fetch the personal-room virtual meeting.
            fetchWithAuth(`${API_BASE}/meetings/personal-room/${roomId}`)
                .then(res => res.ok ? res.json() : null)
                .then(data => { if (data && (data._id || data.id)) setSelectedMeeting(data); })
                .catch(err => console.error("Failed to fetch personal room:", err));
            return;
        }

        if (!meetingId) {
            setSelectedMeeting(null);
            return;
        }

        // First match dashboard list entries (invite slug or internal id), then
        // fall back to API fetch (for shared links from emails/etc.).
        const found = meetings.find(m =>
            publicMeetingSlug(m) === meetingId.toString()
            || resolvedInternalMeetingId(m) === meetingId.toString(),
        );
        if (found) {
            setSelectedMeeting(found);
            return;
        }
        fetchWithAuth(`${API_BASE}/meetings/${meetingId}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && (data._id || data.id)) {
                    setSelectedMeeting(data);
                    refreshMeetings();
                }
            })
            .catch(err => console.error("Failed to fetch meeting by link:", err));
    }, [meetingId, roomId, isPersonalRoom, meetings, fetchWithAuth, refreshMeetings]);

    // Keep the selected-meeting reference in sync with the latest list version.
    useEffect(() => {
        if (!selectedMeeting) return;
        const id = resolvedInternalMeetingId(selectedMeeting);
        if (!id) return;
        const refreshed = meetings.find(m => resolvedInternalMeetingId(m) === id);
        if (refreshed && refreshed !== selectedMeeting) setSelectedMeeting(refreshed);
    }, [meetings, selectedMeeting]);

    const isHost = String(selectedMeeting?.hostId || "") === String(user?.id || user?._id || "");
    const isOffline = selectedMeeting?.modality === "Offline";
    const [callJoined, setCallJoined] = useState(false);
    const chatSessionActive = Boolean(selectedMeeting && (isOffline || callJoined));
    const internalMeetingId = selectedMeeting
        ? resolvedInternalMeetingId(selectedMeeting)
        : undefined;

    useLayoutEffect(() => {
        setCallJoined(false);
    }, [internalMeetingId]);

    const fetchAgenda = useCallback(async (id: string) => {
        try { const res = await fetchWithAuth(`${API_BASE}/agenda/${id}`); if (res.ok) setAgendaItems(await res.json()); }
        catch (err) { console.error("Failed to fetch agenda:", err); }
    }, [fetchWithAuth]);

    const fetchTranscript = useCallback(async (id: string) => {
        try { const res = await fetchWithAuth(`${API_BASE}/transcript/${id}`); if (res.ok) setTranscripts(await res.json()); }
        catch (err) { console.error("Failed to fetch transcript:", err); }
    }, [fetchWithAuth]);

    const fetchActionItems = useCallback(async (id: string) => {
        try { const res = await fetchWithAuth(`${API_BASE}/action-items/${id}`); if (res.ok) setActionItems(await res.json()); }
        catch (err) { console.error("Failed to fetch action items:", err); }
    }, [fetchWithAuth]);

    const fetchChat = useCallback(async (id: string) => {
        chatFetchMeetingRef.current = id;
        const currentUserIdStr = (user?.id || user?._id)?.toString() || "";
        try {
            const res = await fetchWithAuth(`${API_BASE}/chat/${id}`);
            if (!res.ok) return;
            const raw = await res.json();
            if (chatFetchMeetingRef.current !== id) return;

            const normalizeMsg = (msg: any): ChatMessage => {
                const sys =
                    msg.system === "join" || msg.system === "leave"
                        ? msg.system
                        : msg.kind === "join" || msg.kind === "leave"
                          ? msg.kind
                          : undefined;
                return {
                    id: String(msg.id),
                    meetingId: String(msg.meetingId),
                    senderId: String(msg.senderId),
                    senderName: String(msg.senderName ?? "User"),
                    senderImage: msg.senderImage ?? null,
                    text: String(msg.text ?? ""),
                    timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
                    ...(sys
                        ? {
                              system: sys,
                              presenceIsSelf: String(msg.senderId) === currentUserIdStr,
                          }
                        : {}),
                };
            };

            const history: ChatMessage[] = Array.isArray(raw)
                ? raw.map(normalizeMsg)
                : (raw.messages ?? []).map(normalizeMsg);
            const pinnedRaw = Array.isArray(raw) ? null : (raw.pinned ?? null);

            setPinnedChatMessage(pinnedRaw ? normalizeMsg(pinnedRaw) : null);

            setChatMessages(prev => {
                if (chatFetchMeetingRef.current !== id) return prev;
                const byId = new Map<string, ChatMessage>(history.map(m => [m.id, m]));
                for (const m of prev) {
                    if (m.system === "join" || m.system === "leave") {
                        if (m.id.startsWith("presence-")) continue;
                        byId.set(m.id, m);
                    } else if (!byId.has(m.id)) {
                        byId.set(m.id, m);
                    }
                }
                return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
            });
        } catch (err) { console.error("Failed to fetch chat:", err); }
    }, [fetchWithAuth, user?.id, user?._id]);

    useEffect(() => {
        if (!internalMeetingId) return;
        setChatMessages([]);
        setPinnedChatMessage(null);
        fetchAgenda(internalMeetingId);
        fetchTranscript(internalMeetingId);
        fetchActionItems(internalMeetingId);
    }, [selectedMeeting, fetchAgenda, fetchTranscript, fetchActionItems, internalMeetingId]);

    useEffect(() => {
        if (!internalMeetingId || !chatSessionActive) return;
        fetchChat(internalMeetingId);
    }, [internalMeetingId, chatSessionActive, fetchChat]);

    useEffect(() => {
        if (!internalMeetingId) return;
        if (selectedMeeting.modality === "Offline") return;
        if (!chatSessionActive) {
            setChatMessages([]);
            setPinnedChatMessage(null);
        }
    }, [internalMeetingId, selectedMeeting?.modality, chatSessionActive]);

    // Subscribe to live updates for the active meeting only (chat socket room after joining the call, or offline).
    useEffect(() => {
        if (!socket || !selectedMeeting || !chatSessionActive) return;
        const meetingIdStr = internalMeetingId;
        if (!meetingIdStr) return;

        const currentUserIdStr = (user?.id || user?._id)?.toString() || "";

        socket.emit("join_meeting", { meetingId: meetingIdStr, name: user?.name, profileImage: user?.profileImage });

        const handleTranscriptUpdate = (segment: any) => {
            if (segment.meetingId !== meetingIdStr) return;
            setTranscripts(prev => {
                const i = prev.findIndex((t: any) => t.id === segment.id);
                if (i >= 0) {
                    const next = [...prev];
                    next[i] = { ...next[i], ...segment };
                    return next;
                }
                return [...prev, segment];
            });
        };
        const handleAgendaSync = ({ meetingId: mid, items }: { meetingId: string; items: any[] }) => {
            if (mid?.toString() === meetingIdStr) setAgendaItems(items);
        };
        const handleActionItemsSync = ({ meetingId: mid, items }: { meetingId: string; items: any[] }) => {
            if (mid?.toString() === meetingIdStr) setActionItems(items);
        };
        const normalizeMsg = (msg: any): ChatMessage => ({
            id: String(msg.id),
            meetingId: String(msg.meetingId),
            senderId: String(msg.senderId),
            senderName: String(msg.senderName ?? "User"),
            senderImage: msg.senderImage ?? null,
            text: String(msg.text ?? ""),
            timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        });

        const handleChatMessage = (msg: any) => {
            if (meetingIdStr !== msg.meetingId?.toString()) return;
            const incoming = normalizeMsg(msg);
            const clientMsgId = msg.clientMsgId != null ? String(msg.clientMsgId) : null;
            setChatMessages(prev => {
                if (clientMsgId) {
                    const i = prev.findIndex(m => m.id === clientMsgId);
                    if (i >= 0) {
                        const next = [...prev];
                        next[i] = incoming;
                        return next;
                    }
                }
                if (prev.some(m => m.id === incoming.id)) return prev;
                return [...prev, incoming];
            });
        };

        const handleChatPresence = (payload: any) => {
            if (payload?.meetingId?.toString() !== meetingIdStr) return;
            if (payload.type !== "join" && payload.type !== "leave") return;
            const id = payload.messageId != null
                ? String(payload.messageId)
                : `presence-${payload.type}-${payload.userId}-${Date.now()}`;
            const ts = typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
            const isSelfPresence = String(payload.userId ?? "") === currentUserIdStr;
            const row: ChatMessage = {
                id,
                meetingId: meetingIdStr,
                senderId: String(payload.userId ?? ""),
                senderName: isSelfPresence ? "You" : String(payload.name ?? "User"),
                senderImage: payload.profileImage ?? null,
                text: "",
                timestamp: ts,
                system: payload.type,
                presenceIsSelf: isSelfPresence,
            };
            setChatMessages(prev =>
                prev.some(m => m.id === id) ? prev : [...prev, row],
            );
        };

        const handleChatPinUpdated = ({ meetingId: mid, pinned }: { meetingId: string; pinned: any | null }) => {
            if (mid?.toString() !== meetingIdStr) return;
            setPinnedChatMessage(pinned ? normalizeMsg(pinned) : null);
        };
        const handleMeetingEndedSync = ({ meetingId: mid }: { meetingId: string }) => {
            if (mid?.toString() === meetingIdStr) {
                setSelectedMeeting(null);
                navigate("/");
            }
        };

        socket.on("transcript_update", handleTranscriptUpdate);
        socket.on("agenda_sync", handleAgendaSync);
        socket.on("action_items_sync", handleActionItemsSync);
        socket.on("chat_message", handleChatMessage);
        socket.on("chat_presence", handleChatPresence);
        socket.on("chat_pin_updated", handleChatPinUpdated);
        socket.on("meeting_ended", handleMeetingEndedSync);

        return () => {
            socket.emit("leave_meeting", { meetingId: meetingIdStr });
            socket.off("transcript_update", handleTranscriptUpdate);
            socket.off("agenda_sync", handleAgendaSync);
            socket.off("action_items_sync", handleActionItemsSync);
            socket.off("chat_message", handleChatMessage);
            socket.off("chat_presence", handleChatPresence);
            socket.off("chat_pin_updated", handleChatPinUpdated);
            socket.off("meeting_ended", handleMeetingEndedSync);
        };
    }, [socket, selectedMeeting, chatSessionActive, internalMeetingId, navigate, user?.name, user?.profileImage, user?.id, user?._id]);

    // Dock interactions
    const triggerAddActionItem = useCallback(() => {
        setDockActivePanelId("actions");
        setDockOpen(true);
        setAddActionItemTrigger(t => t + 1);
    }, []);
    const triggerAddAgendaItem = useCallback(() => {
        setDockActivePanelId("agenda");
        setDockOpen(true);
    }, []);
    const toggleDockOpen = useCallback(() => setDockOpen(prev => !prev), []);
    const selectDockPanel = useCallback((id: DockPanelId) => {
        setDockActivePanelId(id);
        setDockOpen(true);
    }, []);
    const toggleChat = useCallback(() => {
        setDockActivePanelId("chat");
        setDockOpen(true);
    }, []);
    const chatOpen = dockOpen && dockActivePanelId === "chat";

    // Dock keyboard shortcuts (active only when on the live meeting page).
    const dockShortcuts = useMemo(() => [
        { key: "]", mod: true, allowInInput: true, handler: () => setDockOpen(prev => !prev) },
        { key: "[", mod: true, allowInInput: true, handler: () => { setDockActivePanelId("agenda"); setDockOpen(true); } },
        { key: "g", handler: () => selectDockPanel("agenda") },
        { key: "h", handler: () => selectDockPanel("chat") },
        { key: "t", handler: () => selectDockPanel("transcript") },
        { key: "n", handler: () => selectDockPanel("minutes") },
    ], [selectDockPanel]);
    useKeyboardShortcuts(dockShortcuts);

    const joinMeetingActionRef = useRef<(() => Promise<void>) | null>(null);

    const handleRequestJoinFromChat = useCallback(async () => {
        await joinMeetingActionRef.current?.();
    }, []);

    const handleSendMessage = useCallback((text: string) => {
        if (!socket || !selectedMeeting || !chatSessionActive || !internalMeetingId) return;
        const msgId = Math.random().toString(36).slice(2, 11);
        const msg: ChatMessage = {
            id: msgId,
            meetingId: internalMeetingId,
            senderId: `${userId || "unknown"}`,
            senderName: userName || "User",
            senderImage: userImage || null,
            text,
            timestamp: Date.now(),
        };
        socket.emit("send_chat_message", msg);
        setChatMessages(prev => [...prev, msg]);
    }, [socket, selectedMeeting, userId, userName, userImage, chatSessionActive, internalMeetingId]);

    const handlePinChatMessage = useCallback((messageId: string) => {
        if (!socket || !selectedMeeting || !isHost || !chatSessionActive || !internalMeetingId) return;
        socket.emit("pin_chat_message", { meetingId: internalMeetingId, messageId });
    }, [socket, selectedMeeting, isHost, chatSessionActive, internalMeetingId]);

    const handleUnpinChatMessage = useCallback(() => {
        if (!socket || !selectedMeeting || !isHost || !chatSessionActive || !internalMeetingId) return;
        socket.emit("unpin_chat_message", { meetingId: internalMeetingId });
    }, [socket, selectedMeeting, isHost, chatSessionActive, internalMeetingId]);

    const handleAgendaChange = useCallback(async (items: any[]) => {
        if (!selectedMeeting || !isHost) return;
        setAgendaItems(items);
        const id = resolvedInternalMeetingId(selectedMeeting);
        if (!id) return;
        try {
            await fetchWithAuth(`${API_BASE}/agenda/${id}`, { method: "POST", body: JSON.stringify({ items }) });
        } catch (err) { console.error("Failed to save agenda:", err); }
    }, [selectedMeeting, isHost, fetchWithAuth]);

    const handleMeetingEnded = useCallback(() => {
        setSelectedMeeting(null);
        refreshMeetings();
        navigate("/");
    }, [refreshMeetings, navigate]);

    const upcomingMeetings = useMemo(
        () => meetings.filter(m => !isMeetingCompletedByTime(m, nowTs)).sort(sortMeetingsBySchedule),
        [meetings, nowTs],
    );

    if (!selectedMeeting) {
        return (
            <div className="page-shell">
                <header className="page-header">
                    <h2 className="page-header-title">Live Meeting</h2>
                    <p className="page-header-description">
                        Select an upcoming meeting to join the call, agenda, transcript, chat, and action items.
                    </p>
                </header>
                <div className="meeting-list">
                    {upcomingMeetings.map(meeting => (
                        <div
                            key={resolvedInternalMeetingId(meeting) ?? meeting.id}
                            className="meeting-card glass-card"
                            onClick={() => {
                                const slug = publicMeetingSlug(meeting);
                                if (slug) navigate(`/meetings/${slug}`);
                            }}
                        >
                            {meeting.status === "pending_poll" && meeting.pollId && (
                                <button
                                    className="btn btn-sm btn-primary"
                                    style={{ position: "absolute", top: "var(--lk-size-md)", right: "var(--lk-size-md)" }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const pm = resolvedInternalMeetingId(meeting);
                                        if (pm) openPoll(pm);
                                    }}
                                >
                                    Vote
                                </button>
                            )}
                            <div className="meeting-card-title">{meeting.title}</div>
                            <div className="meeting-card-meta">
                                <span className={`chip ${meeting.modality === "Online" ? "chip-blue" : meeting.modality === "Hybrid" ? "chip-purple" : "chip-emerald"}`}>{meeting.modality}</span>
                                <span className={`chip ${meeting.status === "completed" ? "chip-emerald" : meeting.status === "pending_poll" ? "chip-blue" : "chip-amber"}`}>
                                    {meeting.status === "pending_poll" ? "Poll Open" : meeting.status}
                                </span>
                                {(meeting.confirmedDate || meeting.date) && <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.confirmedDate || meeting.date!)}</span>}
                                {(meeting.confirmedTime || meeting.time) && <span><Icon icon={Clock01Icon} size={14} /> {meeting.confirmedTime || meeting.time}</span>}
                                {shouldShowMeetingLocation(meeting) && (
                                    <span
                                        style={{ cursor: "pointer", textDecoration: "underline" }}
                                        onClick={(e) => { e.stopPropagation(); openLocationModal(meeting.location!); }}
                                    >
                                        <Icon icon={Location01Icon} size={14} /> {meeting.location}
                                    </span>
                                )}
                                <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                            </div>
                        </div>
                    ))}
                    {upcomingMeetings.length === 0 && (
                        <p className="page-muted-note">No live or upcoming meetings.</p>
                    )}
                </div>
            </div>
        );
    }

    const liveParticipantsList = liveParticipants.length > 0 ? liveParticipants : (selectedMeeting?.participants || []);
    return (
        <div ref={meetingLayoutRef} className={`meeting-layout ${isOffline ? "offline-mode" : ""} ${!dockOpen ? "dock-collapsed" : ""}`}>
            <VideoArea
                meetingId={internalMeetingId}
                meetingTitle={selectedMeeting?.title || "Select a Meeting"}
                meetingUrl={selectedMeeting?.meetingUrl}
                inviteId={publicMeetingSlug(selectedMeeting) ?? undefined}
                participants={selectedMeeting?.participants || []}
                modality={selectedMeeting?.modality}
                currentUser={user}
                isHost={isHost}
                fullscreenRef={meetingLayoutRef}
                onMeetingEnded={handleMeetingEnded}
                onTriggerAddActionItem={triggerAddActionItem}
                onTriggerAddAgendaItem={triggerAddAgendaItem}
                agendaItems={agendaItems}
                actionItems={actionItems}
                onAgendaChange={handleAgendaChange}
                onRefreshActionItems={() => internalMeetingId && fetchActionItems(internalMeetingId)}
                onParticipantsUpdate={setLiveParticipants}
                chatOpen={chatOpen}
                onToggleChat={toggleChat}
                onCallJoinedChange={setCallJoined}
                joinMeetingActionRef={joinMeetingActionRef}
            />
            <MeetingDock
                meetingId={internalMeetingId}
                meetingHostId={selectedMeeting?.hostId}
                isHost={isHost}
                activePanelId={dockActivePanelId}
                isOpen={dockOpen}
                onSelectPanel={selectDockPanel}
                onToggleOpen={toggleDockOpen}
                agendaItems={agendaItems}
                actionItems={actionItems}
                transcripts={transcripts}
                participants={liveParticipantsList}
                addActionItemTrigger={addActionItemTrigger}
                chatMessages={chatMessages}
                currentUserId={(user?.id || user?._id)?.toString() || ""}
                onSendChatMessage={handleSendMessage}
                pinnedChatMessage={pinnedChatMessage}
                onPinChatMessage={handlePinChatMessage}
                onUnpinChatMessage={handleUnpinChatMessage}
                chatSessionActive={chatSessionActive}
                onRequestJoinMeeting={handleRequestJoinFromChat}
                onAgendaChange={handleAgendaChange}
                onAddActionItemConsumed={() => setAddActionItemTrigger(0)}
                onRefreshActionItems={() => internalMeetingId && fetchActionItems(internalMeetingId)}
                fetchWithAuth={fetchWithAuth}
            />
        </div>
    );
}
