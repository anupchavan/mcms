import {
    useState,
    useEffect,
    useCallback,
    useRef,
    forwardRef,
    useImperativeHandle,
    useMemo,
} from "react";
import { createPortal } from "react-dom";
import Icon from "../../../shared/components/Icon";
import {
    Mic01Icon,
    MicOff01Icon,
    Video01Icon,
    VideoOffIcon,
    ComputerScreenShareIcon,
    QrCodeIcon,
    UserGroupIcon,
    RecordIcon,
    Cancel01Icon,
    StopIcon,
    Link01Icon,
    Message01Icon,
    UserAdd01Icon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import { UserAvatar } from "../../../shared/components/UserAvatar";
import QROverlay from "./QROverlay";
import ShortcutTooltip from "../../../shared/components/ShortcutTooltip";
import { useSocket } from "../../../stores/SocketContext";
import { useAuth } from "../../../stores/AuthContext";
import {
    pathnameHasMongoMeetingSegment,
    isMeetingShortSlug,
} from "../../../utils/meetingSlug";
import { archiveLoadingMinVisibleMs } from "../../dashboard/components/archiveHelpers";

export interface HostControlsProps {
    meetingId?: string;
    meetingTitle?: string;
    meetingUrl?: string;
    /** Public invite segment `abcd-efgh` — used for clipboard when present (preferred over stale meetingUrl). */
    inviteId?: string;
    modality?: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
    screenSharing: boolean;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
    onToggleScreenShare: () => void;
    /** When sharing a screen, include system/tab audio in the capture (browser / OS permitting). */
    screenShareSystemAudio?: boolean;
    onScreenShareSystemAudioChange?: (enabled: boolean) => void;
    onLeave: () => void;
    hasJoined: boolean;
    onMeetingEnded?: () => void;
    /** When true the current user is the meeting host and may end the meeting for all */
    isHost?: boolean;
    chatOpen?: boolean;
    onToggleChat?: () => void;
    /** Meeting participants passed from parent for the participants panel */
    participants?: Array<{
        _id?: string;
        id?: string;
        name?: string;
        email?: string;
        profileImage?: string | null;
    }>;
    /** Set of user IDs currently connected to the room via WebRTC */
    connectedUserIds?: Set<string>;
}

export interface HostControlsRef {
    toggleRecording: () => void;
    showAttendance: () => void;
    endMeeting: () => void;
}

const API_BASE_HC = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const HostControls = forwardRef<HostControlsRef, HostControlsProps>(
    function HostControls(
        {
            meetingId,
            meetingTitle,
            meetingUrl,
            inviteId,
            modality,
            audioEnabled,
            videoEnabled,
            screenSharing,
            onToggleAudio,
            onToggleVideo,
            onToggleScreenShare,
            screenShareSystemAudio = false,
            onScreenShareSystemAudioChange,
            onLeave,
            hasJoined,
            onMeetingEnded,
            isHost = false,
            chatOpen = false,
            onToggleChat,
            participants = [],
            connectedUserIds = new Set<string>(),
        },
        ref,
    ) {
        const { socket } = useSocket();
        const { user } = useAuth();
        const [recording, setRecording] = useState(false);
        /** true while we wait for the server to ack transcription_started */
        const [recordingPending, setRecordingPending] = useState(false);
        /** non-null while an error banner is visible */
        const [recordingError, setRecordingError] = useState<string | null>(
            null,
        );
        const [showQR, setShowQR] = useState(false);
        const [copied, setCopied] = useState(false);
        const ackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
            null,
        );
        const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
            null,
        );

        const showError = useCallback((msg: string) => {
            setRecordingError(msg);
            setRecordingPending(false);
            if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
            errorTimeoutRef.current = setTimeout(
                () => setRecordingError(null),
                6_000,
            );
        }, []);

        const isOffline = modality === "Offline";

        useImperativeHandle(
            ref,
            () => ({
                toggleRecording: () => {
                    if (!socket || !meetingId || !isHost) return;
                    if (recording)
                        socket.emit("stop_transcription", { meetingId });
                    else socket.emit("start_transcription", { meetingId });
                },
                showAttendance: () => setShowQR(true),
                endMeeting: () => {
                    if (!socket || !meetingId || !isHost) return;
                    if (recording)
                        socket.emit("stop_transcription", { meetingId });
                    socket.emit("end_meeting", { meetingId });
                    onMeetingEnded?.();
                },
            }),
            [socket, meetingId, recording, onMeetingEnded, isHost],
        );

        useEffect(() => {
            if (!socket) return;
            const onStarted = ({ meetingId: mid }: { meetingId?: string }) => {
                if (mid !== meetingId) return;
                if (ackTimeoutRef.current) clearTimeout(ackTimeoutRef.current);
                setRecordingPending(false);
                setRecording(true);
            };
            const onStopped = ({ meetingId: mid }: { meetingId?: string }) => {
                if (mid === meetingId) setRecording(false);
            };
            const onError = ({
                meetingId: mid,
                message,
            }: {
                meetingId?: string;
                message?: string;
            }) => {
                if (mid !== meetingId) return;
                if (ackTimeoutRef.current) clearTimeout(ackTimeoutRef.current);
                showError(message || "Recording failed. Please try again.");
            };
            socket.on("transcription_started", onStarted);
            socket.on("transcription_stopped", onStopped);
            socket.on("transcription_error", onError);
            return () => {
                socket.off("transcription_started", onStarted);
                socket.off("transcription_stopped", onStopped);
                socket.off("transcription_error", onError);
            };
        }, [socket, meetingId, showError]);

        const toggleRecording = useCallback(() => {
            if (!socket || !meetingId || !isHost || recordingPending) return;
            if (recording) {
                socket.emit("stop_transcription", { meetingId });
            } else {
                setRecordingPending(true);
                setRecordingError(null);
                socket.emit("start_transcription", { meetingId });
                // If no ack arrives within 10 s, show an error
                if (ackTimeoutRef.current) clearTimeout(ackTimeoutRef.current);
                ackTimeoutRef.current = setTimeout(() => {
                    setRecordingPending(false);
                    showError(
                        "No response from server. Recording may have failed — please try again.",
                    );
                }, 10_000);
            }
        }, [socket, meetingId, recording, isHost, recordingPending, showError]);

        const handleEndMeeting = useCallback(() => {
            if (!socket || !meetingId) return;
            if (recording) socket.emit("stop_transcription", { meetingId });
            socket.emit("end_meeting", { meetingId });
            onMeetingEnded?.();
        }, [socket, meetingId, recording, onMeetingEnded]);

        const handleCopyLink = useCallback(() => {
            const basename =
                typeof import.meta.env.BASE_URL === "string"
                    ? import.meta.env.BASE_URL.replace(/\/$/, "")
                    : "";
            const originPrefix = `${window.location.origin}${basename}`;

            const slug = typeof inviteId === "string" ? inviteId.trim() : "";
            let link = "";
            if (slug && isMeetingShortSlug(slug)) {
                link = `${originPrefix}/meetings/${slug}`;
            } else if (
                meetingUrl &&
                !pathnameHasMongoMeetingSegment(meetingUrl)
            ) {
                link = /^https?:\/\//i.test(meetingUrl)
                    ? meetingUrl
                    : `${originPrefix}${meetingUrl.startsWith("/") ? meetingUrl : `/meetings/${meetingUrl}`}`;
            } else if (meetingId?.startsWith("personal-")) {
                link = `${originPrefix}/rooms/${meetingId.replace(/^personal-/, "")}`;
            }

            if (!link) return;
            navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            });
        }, [meetingId, meetingUrl, inviteId]);

        // ── Participants panel ────────────────────────────────────────────────────
        const [showParticipants, setShowParticipants] = useState(false);
        const [participantSearch, setParticipantSearch] = useState("");
        const [searchResults, setSearchResults] = useState<any[]>([]);
        const [searchLoading, setSearchLoading] = useState(false);
        const [inviting, setInviting] = useState<string | null>(null);
        const [highlightIndex, setHighlightIndex] = useState(-1);
        /** Locally-added user IDs this session (so UI updates immediately after invite) */
        const [locallyAdded, setLocallyAdded] = useState<Set<string>>(
            new Set(),
        );
        const participantsBtnRef = useRef<HTMLButtonElement>(null);
        const participantsPanelRef = useRef<HTMLDivElement>(null);
        const listRef = useRef<HTMLDivElement>(null);
        const [panelPos, setPanelPos] = useState<{
            bottom: number;
            left: number;
        } | null>(null);

        const participantIds = useMemo(() => {
            const s = new Set(
                participants
                    .map((p) => String(p._id || p.id || ""))
                    .filter(Boolean),
            );
            locallyAdded.forEach((id) => s.add(id));
            return s;
        }, [participants, locallyAdded]);

        // Search users as they type
        useEffect(() => {
            if (
                !participantSearch.trim() ||
                participantSearch.trim().length < 1
            ) {
                setSearchResults([]);
                setSearchLoading(false);
                return;
            }
            const q = participantSearch.trim();
            const controller = new AbortController();
            let cancelled = false;
            const startedMs =
                typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();
            setSearchLoading(true);
            (async () => {
                try {
                    const res = await fetch(
                        `${API_BASE_HC}/users/search?q=${encodeURIComponent(q)}`,
                        {
                            headers: { Authorization: `Bearer ${user?.token}` },
                            signal: controller.signal,
                        },
                    );
                    const data = res.ok ? await res.json() : [];
                    const elapsed =
                        (typeof performance !== "undefined"
                            ? performance.now()
                            : Date.now()) - startedMs;
                    await new Promise<void>((resolve) => {
                        setTimeout(
                            resolve,
                            Math.max(0, archiveLoadingMinVisibleMs() - elapsed),
                        );
                    });
                    if (!cancelled) setSearchResults(data);
                } catch (err: any) {
                    if (err?.name !== "AbortError")
                        console.error("[ParticipantSearch] fetch error:", err);
                } finally {
                    if (!cancelled) setSearchLoading(false);
                }
            })();
            return () => {
                cancelled = true;
                controller.abort();
            };
        }, [participantSearch, user?.token]);

        // Reset highlight when results change
        useEffect(() => {
            setHighlightIndex(-1);
        }, [searchResults]);

        const handleOpenParticipants = useCallback(() => {
            if (participantsBtnRef.current) {
                const rect = participantsBtnRef.current.getBoundingClientRect();
                setPanelPos({
                    bottom: window.innerHeight - rect.top + 8,
                    left: rect.left,
                });
            }
            setShowParticipants((o) => !o);
            setParticipantSearch("");
            setSearchResults([]);
            setSearchLoading(false);
            setHighlightIndex(-1);
        }, []);

        const handleInvite = useCallback(
            async (userId: string) => {
                if (!meetingId || !isHost || inviting) return;
                setInviting(userId);
                try {
                    const res = await fetch(
                        `${API_BASE_HC}/meetings/${meetingId}/participants`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${user?.token}`,
                            },
                            body: JSON.stringify({ userId }),
                        },
                    );
                    if (res.ok) {
                        setLocallyAdded((prev) => new Set([...prev, userId]));
                    } else {
                        console.error(
                            "[Participants] invite failed",
                            res.status,
                            await res.text(),
                        );
                    }
                } catch (err) {
                    console.error("[Participants] invite error", err);
                }
                setInviting(null);
            },
            [meetingId, isHost, user?.token, inviting],
        );

        // Merge meeting participants + search results for display
        const displayList = useMemo(() => {
            if (!participantSearch.trim()) return [];
            return searchResults.map((u) => ({
                ...u,
                isAlreadyIn: participantIds.has(String(u._id)),
            }));
        }, [searchResults, participantIds, participantSearch]);

        const handleSearchKeyDown = useCallback(
            (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (displayList.length === 0) return;
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    listRef.current?.setAttribute("data-kbd-nav", "");
                    setHighlightIndex((i) =>
                        Math.min(i + 1, displayList.length - 1),
                    );
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    listRef.current?.setAttribute("data-kbd-nav", "");
                    setHighlightIndex((i) => Math.max(-1, i - 1));
                } else if (e.key === "Enter") {
                    const item = displayList[highlightIndex];
                    if (
                        item &&
                        !item.isAlreadyIn &&
                        !connectedUserIds.has(String(item._id))
                    ) {
                        e.preventDefault();
                        handleInvite(String(item._id));
                    }
                }
            },
            [displayList, highlightIndex, handleInvite, connectedUserIds],
        );

        // Scroll highlighted row into view
        useEffect(() => {
            if (highlightIndex < 0 || !listRef.current) return;
            const rows = listRef.current.querySelectorAll<HTMLElement>(
                ".archive-multi-select-row",
            );
            rows[highlightIndex]?.scrollIntoView({ block: "nearest" });
        }, [highlightIndex]);

        // Close participants panel on outside click / Escape
        useEffect(() => {
            if (!showParticipants) return;
            const onDoc = (e: MouseEvent) => {
                const btn = participantsBtnRef.current;
                const panel = participantsPanelRef.current;
                if (
                    btn?.contains(e.target as Node) ||
                    panel?.contains(e.target as Node)
                )
                    return;
                setShowParticipants(false);
            };
            const onKey = (e: KeyboardEvent) => {
                if (e.key === "Escape") setShowParticipants(false);
            };
            document.addEventListener("mousedown", onDoc);
            document.addEventListener("keydown", onKey);
            return () => {
                document.removeEventListener("mousedown", onDoc);
                document.removeEventListener("keydown", onKey);
            };
        }, [showParticipants]);

        return (
            <>
                <div className="host-controls">
                    <div className="controls-group">
                        {!isOffline && (
                            <>
                                <ShortcutTooltip
                                    label={audioEnabled ? "Mute" : "Unmute"}
                                    keys={["M"]}
                                    position="top"
                                >
                                    <button
                                        className={`btn-icon ${audioEnabled ? "active" : ""}`}
                                        onClick={onToggleAudio}
                                        disabled={!hasJoined}
                                    >
                                        <Icon
                                            icon={
                                                audioEnabled
                                                    ? Mic01Icon
                                                    : MicOff01Icon
                                            }
                                            size={18}
                                        />
                                    </button>
                                </ShortcutTooltip>

                                <ShortcutTooltip
                                    label={
                                        videoEnabled
                                            ? "Turn off camera"
                                            : "Turn on camera"
                                    }
                                    keys={["C"]}
                                    position="top"
                                >
                                    <button
                                        className={`btn-icon ${videoEnabled ? "active" : ""}`}
                                        onClick={onToggleVideo}
                                        disabled={!hasJoined}
                                    >
                                        <Icon
                                            icon={
                                                videoEnabled
                                                    ? Video01Icon
                                                    : VideoOffIcon
                                            }
                                            size={18}
                                        />
                                    </button>
                                </ShortcutTooltip>

                                <ShortcutTooltip
                                    label={
                                        screenSharing
                                            ? "Stop sharing"
                                            : "Share screen"
                                    }
                                    position="top"
                                >
                                    <button
                                        className={`btn-icon ${screenSharing ? "active" : ""}`}
                                        onClick={onToggleScreenShare}
                                        disabled={!hasJoined}
                                    >
                                        <Icon
                                            icon={ComputerScreenShareIcon}
                                            size={18}
                                        />
                                    </button>
                                </ShortcutTooltip>

                                {screenSharing && (
                                    <div
                                        className="screen-audio-toggle screen-audio-toggle--live"
                                        title="Include computer audio when you share your screen (browser and OS support required)"
                                    >
                                        <span className="screen-audio-toggle-label">
                                            System audio
                                        </span>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={
                                                screenShareSystemAudio
                                            }
                                            className={`screen-audio-switch ${screenShareSystemAudio ? "on" : ""}`}
                                            disabled={!hasJoined}
                                            onClick={() =>
                                                onScreenShareSystemAudioChange?.(
                                                    !screenShareSystemAudio,
                                                )
                                            }
                                        >
                                            <span className="screen-audio-switch-thumb" />
                                        </button>
                                    </div>
                                )}

                                <div className="controls-divider"></div>

                                {isHost && (
                                    <ShortcutTooltip
                                        label={
                                            recording
                                                ? "Stop transcription"
                                                : recordingPending
                                                  ? "Connecting…"
                                                  : "Transcribe"
                                        }
                                        keys={["R"]}
                                        position="top"
                                    >
                                        <button
                                            className={`control-btn ${recording ? "recording" : ""} ${recordingPending ? "pending" : ""}`}
                                            onClick={toggleRecording}
                                            disabled={
                                                !hasJoined || recordingPending
                                            }
                                            aria-busy={recordingPending}
                                            aria-label={
                                                recordingPending
                                                    ? "Starting transcription…"
                                                    : recording
                                                      ? "Stop transcription"
                                                      : "Start transcription"
                                            }
                                        >
                                            <Icon icon={RecordIcon} size={16} />
                                            <span>
                                                {recordingPending
                                                    ? "Starting…"
                                                    : recording
                                                      ? "Transcribing"
                                                      : "Transcribe"}
                                            </span>
                                            {recording && (
                                                <div className="rec-dot"></div>
                                            )}
                                        </button>
                                    </ShortcutTooltip>
                                )}
                            </>
                        )}

                        <ShortcutTooltip label="Attendance" position="top">
                            <button
                                className="control-btn"
                                onClick={() => setShowQR(true)}
                            >
                                <Icon icon={QrCodeIcon} size={16} />
                                <span>Attendance</span>
                            </button>
                        </ShortcutTooltip>

                        <ShortcutTooltip label="Chat" position="top">
                            <button
                                className={`control-btn ${chatOpen ? "active" : ""}`}
                                onClick={onToggleChat}
                            >
                                <Icon icon={Message01Icon} size={16} />
                                <span>Chat</span>
                            </button>
                        </ShortcutTooltip>

                        {!isOffline && (
                            <button
                                ref={participantsBtnRef}
                                className={`control-btn ${showParticipants ? "active" : ""}`}
                                onClick={handleOpenParticipants}
                            >
                                <Icon icon={UserGroupIcon} size={16} />
                                <span>
                                    Participants{" "}
                                    {participants.length > 0
                                        ? `(${participants.length})`
                                        : ""}
                                </span>
                            </button>
                        )}

                        <button
                            type="button"
                            className="control-btn"
                            onClick={handleCopyLink}
                        >
                            <Icon icon={Link01Icon} size={16} />
                            <span>{copied ? "Copied!" : "Copy Link"}</span>
                        </button>
                    </div>

                    <div className="hc-end-actions">
                        {(hasJoined || isOffline) && (
                            <>
                                {isHost && (
                                    <ShortcutTooltip
                                        label="End meeting for all"
                                        keys={["mod", "Shift", "E"]}
                                        position="top"
                                    >
                                        <button
                                            className="btn btn-danger hc-action-btn"
                                            onClick={handleEndMeeting}
                                            title="End meeting for all participants (host only)"
                                        >
                                            <Icon icon={StopIcon} size={14} />
                                            <span className="hc-btn-label">
                                                End
                                            </span>
                                        </button>
                                    </ShortcutTooltip>
                                )}
                                <ShortcutTooltip
                                    label="Leave"
                                    keys={["mod", "Shift", "L"]}
                                    position="top"
                                >
                                    <button
                                        className="btn btn-secondary hc-action-btn"
                                        onClick={onLeave}
                                    >
                                        <Icon icon={Cancel01Icon} size={14} />
                                        <span className="hc-btn-label">
                                            Leave
                                        </span>
                                    </button>
                                </ShortcutTooltip>
                            </>
                        )}
                    </div>
                </div>

                {recordingError && (
                    <div role="alert" className="hc-recording-error">
                        ⚠️ {recordingError}
                    </div>
                )}

                {showQR && (
                    <QROverlay
                        onClose={() => setShowQR(false)}
                        meetingTitle={meetingTitle}
                        meetingId={meetingId}
                    />
                )}

                {showParticipants &&
                    panelPos &&
                    createPortal(
                        <div
                            ref={participantsPanelRef}
                            className="archive-multi-select-panel participants-panel-portal"
                            style={{
                                bottom: panelPos.bottom,
                                left: panelPos.left,
                            }}
                        >
                            <div className="hc-list-relative">
                                <div
                                    ref={listRef}
                                    className="archive-multi-select-list participants-list"
                                >
                                    {!participantSearch.trim() ? (
                                        /* Show current participants when search is empty */
                                        participants.length === 0 ? (
                                            <div className="archive-multi-select-empty participants-empty">
                                                No participants yet
                                            </div>
                                        ) : (
                                            participants.map((p) => {
                                                const pid = String(
                                                    p._id || p.id || "",
                                                );
                                                return (
                                                    <div
                                                        key={pid}
                                                        className="archive-multi-select-row archive-multi-select-row--transcript-speaker participants-row"
                                                    >
                                                        <div className="participants-row-user">
                                                            <UserAvatar
                                                                name={
                                                                    p.name ||
                                                                    p.email ||
                                                                    ""
                                                                }
                                                                userId={pid}
                                                                profileImage={
                                                                    p.profileImage
                                                                }
                                                                size={24}
                                                            />
                                                            <div className="participants-name-col">
                                                                <div className="archive-multi-select-name">
                                                                    {p.name ||
                                                                        p.email ||
                                                                        "User"}
                                                                </div>
                                                                {p.name &&
                                                                    p.email && (
                                                                        <div className="participants-email">
                                                                            {
                                                                                p.email
                                                                            }
                                                                        </div>
                                                                    )}
                                                            </div>
                                                        </div>
                                                        <span className="participants-status">
                                                            {connectedUserIds.has(
                                                                pid,
                                                            )
                                                                ? "In meeting"
                                                                : "Invited"}
                                                        </span>
                                                    </div>
                                                );
                                            })
                                        )
                                    ) : displayList.length === 0 ? (
                                        <div className="archive-multi-select-empty participants-empty">
                                            No users found
                                        </div>
                                    ) : (
                                        displayList.map((u, idx) => {
                                            const uid = String(u._id);
                                            const isIn = u.isAlreadyIn;
                                            const isConnected =
                                                connectedUserIds.has(uid);
                                            const canInvite =
                                                isHost && !isIn && !isConnected;
                                            return (
                                                <div
                                                    key={uid}
                                                    className={`archive-multi-select-row archive-multi-select-row--transcript-speaker participants-row${idx === highlightIndex ? " is-keyboard-highlight" : ""}`}
                                                    style={{
                                                        cursor: canInvite
                                                            ? "pointer"
                                                            : "default",
                                                    }}
                                                    onMouseEnter={() =>
                                                        setHighlightIndex(idx)
                                                    }
                                                    onMouseLeave={() =>
                                                        setHighlightIndex(-1)
                                                    }
                                                    onClick={() => {
                                                        if (canInvite)
                                                            handleInvite(uid);
                                                    }}
                                                >
                                                    <div className="participants-row-user">
                                                        <UserAvatar
                                                            name={
                                                                u.name ||
                                                                u.email ||
                                                                ""
                                                            }
                                                            userId={uid}
                                                            profileImage={
                                                                u.profileImage
                                                            }
                                                            size={24}
                                                        />
                                                        <div className="participants-name-col">
                                                            <div className="archive-multi-select-name">
                                                                {u.name ||
                                                                    u.email ||
                                                                    "User"}
                                                            </div>
                                                            {u.name &&
                                                                u.email && (
                                                                    <div className="participants-email">
                                                                        {
                                                                            u.email
                                                                        }
                                                                    </div>
                                                                )}
                                                        </div>
                                                    </div>
                                                    {isConnected ? (
                                                        <span className="participants-status">
                                                            In meeting
                                                        </span>
                                                    ) : isIn ? (
                                                        <span className="participants-status">
                                                            Invited
                                                        </span>
                                                    ) : isHost ? (
                                                        <button
                                                            type="button"
                                                            className="btn-icon btn-icon-sm participants-invite-btn"
                                                            title="Add to meeting"
                                                            disabled={
                                                                inviting === uid
                                                            }
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleInvite(
                                                                    uid,
                                                                );
                                                            }}
                                                        >
                                                            <Icon
                                                                icon={
                                                                    UserAdd01Icon
                                                                }
                                                                size={13}
                                                            />
                                                        </button>
                                                    ) : null}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                                {searchLoading && participantSearch.trim() && (
                                    <div
                                        className="archive-results-loading-overlay"
                                        aria-busy="true"
                                    >
                                        <div
                                            className="archive-searching-loading"
                                            role="status"
                                        >
                                            <span
                                                className="archive-searching-loading-spinner"
                                                aria-hidden
                                            />
                                            <span className="archive-searching-loading-text">
                                                Searching
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Search input — bottom */}
                            <div className="archive-multi-select-search-wrap participants-search-bottom">
                                <Icon
                                    icon={Search01Icon}
                                    size={14}
                                    className="archive-multi-select-search-icon"
                                />
                                <input
                                    type="text"
                                    className="archive-multi-select-search"
                                    placeholder="Search to add…"
                                    autoFocus
                                    value={participantSearch}
                                    onChange={(e) =>
                                        setParticipantSearch(e.target.value)
                                    }
                                    onKeyDown={handleSearchKeyDown}
                                />
                            </div>
                        </div>,
                        document.body,
                    )}
            </>
        );
    },
);

export default HostControls;
