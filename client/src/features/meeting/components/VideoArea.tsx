import { useCallback, useState, useEffect, useRef, useMemo, type MutableRefObject, type CSSProperties } from "react";
import HostControls, { type HostControlsRef } from "./HostControls";
import useKeyboardShortcuts from "../../../hooks/useKeyboardShortcuts";
import useElementSize from "../../../hooks/useElementSize";
import { computeGalleryLayout, computeStageLayout } from "../utils/videoGridLayout";
import Icon from "../../../shared/components/Icon";
import { useTheme } from "../../../hooks/useTheme";
import { getAvatarHue, getAvatarCssVars, getInitials } from "../../../shared/utils/avatarColor";
import { UserAvatar } from "../../../shared/components/UserAvatar";
import {
  UserGroupIcon,
  FullScreenIcon,
  ArrowShrink02Icon,
  Clock01Icon,
  Note01Icon,
  ArrowRight01Icon,
  PlayIcon,
  PauseIcon,
  Tick01Icon,
  FolderFavouriteIcon,
  CheckmarkCircle01Icon,
  AlertCircleIcon,
  FlashIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import ShortcutTooltip from "../../../shared/components/ShortcutTooltip";
import Kbd from "../../../shared/components/Kbd";
import useWebRTC from "../../../hooks/useWebRTC";
import useTranscriptionCapture from "../../../hooks/useTranscriptionCapture";
import { useSocket } from "../../../stores/SocketContext";

const _raw = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
const SERVER_BASE = _raw.replace(/(\/api\/?)+$/, "");
const API_BASE = `${SERVER_BASE}/api`;

interface VideoTileProps {
  tileId: string;
  stream: MediaStream | null;
  name?: string;
  profileImage?: string | null;
  /** Stable user id used for deterministic avatar colour. */
  userId?: string | null;
  muted: boolean;
  /** When true the participant has their mic muted — shows the muted icon. */
  audioMuted?: boolean;
  /**
   * Directly controls whether the camera is on for this tile.
   * Use for the local tile: track.enabled=false doesn't fire the mute event,
   * so stream-based hasVideo detection misses the state change.
   */
  cameraOn?: boolean;
  isSelf: boolean;
  /** When true, skip horizontal mirror (screen share must stay left–right correct). */
  isScreenShare?: boolean;
  pinned?: boolean;
  onTogglePin?: (tileId: string) => void;
  speaking?: boolean;
  /** True when the remote participant's camera track is muted (signalled by LiveKit). */
  videoMuted?: boolean;
  /** Camera tiles use `cover` to reduce letterboxing; screen share uses `contain`. */
  videoObjectFit?: "contain" | "cover";
  /** Layout slot: gallery grid, main stage (screen share), or sidebar filmstrip. */
  layoutVariant?: "gallery" | "stage" | "filmstrip";
  /** Reports native (intrinsic) video aspect ratio when known. Used by the stage
   *  layout to size around the screen-share without cropping it. */
  onAspectRatioChange?: (tileId: string, aspectRatio: number) => void;
}

interface VideoAreaProps {
  meetingId?: string;
  meetingTitle?: string;
  meetingUrl?: string;
  /** Public invite slug for links copied from meeting controls (`xxxx-xxxx`). */
  inviteId?: string | null;
  participants?: Array<{ _id?: string; id?: string; name?: string; profileImage?: string | null }>;
  modality?: string;
  currentUser?: { _id?: string; id?: string; name?: string; profileImage?: string | null } | null;
  fullscreenRef?: React.RefObject<HTMLDivElement | null>;
  /** @deprecated Panel toggling lives in MeetingDock now. Kept optional for back-compat. */
  agendaPanelOpen?: boolean;
  /** @deprecated Panel toggling lives in MeetingDock now. Kept optional for back-compat. */
  rightPanelOpen?: boolean;
  /** @deprecated Panel toggling lives in MeetingDock now. Kept optional for back-compat. */
  onToggleAgendaPanel?: () => void;
  /** @deprecated Panel toggling lives in MeetingDock now. Kept optional for back-compat. */
  onToggleRightPanel?: () => void;
  onMeetingEnded?: () => void;
  onTriggerAddTask?: () => void;
  onTriggerAddAgendaItem?: () => void;
  agendaItems?: any[];
  minutesItems?: any[];
  tasks?: any[];
  onAgendaChange?: (items: any[]) => void;
  onMinutesChange?: (items: any[]) => void;
  onRefreshTasks?: () => void;
  onParticipantsUpdate?: (participants: any[]) => void;
  /** Whether the current user is the meeting host */
  isHost?: boolean;
  /** Whether the meeting can be joined right now */
  canJoin?: boolean;
  chatOpen?: boolean;
  onToggleChat?: () => void;
  /** Fires when the user enters/leaves the call (Online/Hybrid). Offline is ignored — parent may treat offline as always in-session for chat. */
  onCallJoinedChange?: (joined: boolean) => void;
  /** Assign `current` to a function that starts the same join flow as the prejoin button. */
  joinMeetingActionRef?: MutableRefObject<(() => Promise<void>) | null>;
}

/** Inline SVG mic-off icon used in the muted badge. */
function MicOffIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function VideoTile({
  tileId,
  stream,
  name,
  profileImage,
  userId,
  muted,
  audioMuted,
  cameraOn,
  videoMuted,
  isSelf,
  isScreenShare,
  pinned,
  onTogglePin,
  speaking,
  videoObjectFit: videoObjectFitProp,
  layoutVariant = "gallery",
  onAspectRatioChange,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoBackdropRef = useRef<HTMLVideoElement | null>(null);
  const [hasVideo, setHasVideo] = useState<boolean>(false);

  // Theme-aware avatar colours
  const isDark = useTheme() !== 'light';
  const hue = getAvatarHue(userId || name || 'user');
  const { bg: colorBg, border: colorBorder, text: colorText } = getAvatarCssVars(hue, isDark);
  const initials = getInitials(name || '');
  const profileImageUrl = profileImage ? `${SERVER_BASE}${profileImage}` : null;

  useEffect(() => {
    if (!stream) { setHasVideo(false); return; }

    const videoTracks = stream.getVideoTracks();
    setHasVideo(videoTracks.some((t) => t.enabled && t.readyState === 'live'));

    const onTrackChange = () => {
      setHasVideo(stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live'));
    };

    for (const track of videoTracks) {
      track.addEventListener('unmute', onTrackChange);
      track.addEventListener('mute', onTrackChange);
      track.addEventListener('ended', onTrackChange);
    }
    stream.addEventListener('addtrack', onTrackChange);
    stream.addEventListener('removetrack', onTrackChange);

    return () => {
      for (const track of videoTracks) {
        track.removeEventListener('unmute', onTrackChange);
        track.removeEventListener('mute', onTrackChange);
        track.removeEventListener('ended', onTrackChange);
      }
      stream.removeEventListener('addtrack', onTrackChange);
      stream.removeEventListener('removetrack', onTrackChange);
    };
  }, [stream]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
    if (videoBackdropRef.current && stream && !isScreenShare) {
      videoBackdropRef.current.srcObject = stream;
    }
  }, [stream, isScreenShare]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onAspectRatioChange) return;
    const report = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) onAspectRatioChange(tileId, w / h);
    };
    report();
    video.addEventListener('loadedmetadata', report);
    video.addEventListener('resize', report);
    return () => {
      video.removeEventListener('loadedmetadata', report);
      video.removeEventListener('resize', report);
    };
  }, [tileId, onAspectRatioChange, stream, hasVideo]);

  const videoObjectFit = videoObjectFitProp ?? (isScreenShare ? "contain" : "contain");
  // Self tile: use explicit cameraOn prop (track.enabled=false doesn't fire mute events).
  // Remote tile: use videoMuted from LiveKit signaling, OR fall back to hasVideo.
  const noVideo = !isScreenShare && (cameraOn !== undefined ? !cameraOn : (videoMuted || !hasVideo));

  // When a video element transitions from hidden (noVideo) to visible, the browser
  // may leave it paused. Call play() to resume rendering.
  useEffect(() => {
    if (!noVideo && videoRef.current?.paused) {
      videoRef.current.play().catch(() => {/* autoplay policy: ignored, LiveKit handles audio */});
    }
  });
  return (
    <div
      className={[
        'video-tile',
        `video-tile--${layoutVariant}`,
        pinned    ? 'pinned'      : '',
        isScreenShare ? 'screen-share' : '',
        noVideo   ? 'no-video'    : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--vt-color-bg':     colorBg,
        '--vt-color-border': colorBorder,
        '--vt-color-text':   colorText,
        // Tile background: flexoki colour when camera off + no profile image
        background: noVideo && !profileImageUrl ? colorBg : undefined,
      } as CSSProperties}
    >
      <button
        type="button"
        className={`video-tile-pin ${pinned ? "active" : ""}`}
        onClick={() => onTogglePin?.(tileId)}
      >
        {pinned ? "Unpin" : "Pin"}
      </button>

      {/* ── Blurred backdrops ── */}
      {!isScreenShare && (
        <video
          ref={videoBackdropRef}
          autoPlay playsInline muted aria-hidden
          className="video-tile-video-backdrop"
          style={isSelf
            ? { transform: "scaleX(-1)", display: noVideo ? "none" : undefined, objectFit: "cover" as const }
            : { display: noVideo ? "none" : undefined, objectFit: "cover" as const }
          }
        />
      )}
      {/* Blurred profile image as background when camera off */}
      {noVideo && profileImageUrl && (
        <img
          src={profileImageUrl}
          alt=""
          aria-hidden
          className="video-tile-bg-img"
        />
      )}

      {/* ── Live video ── */}
      <video
        ref={videoRef}
        autoPlay playsInline
        muted={muted}
        className="video-tile-video"
        style={isSelf && !isScreenShare
          ? { transform: "scaleX(-1)", display: noVideo ? "none" : undefined, objectFit: videoObjectFit }
          : { display: noVideo ? "none" : undefined, objectFit: videoObjectFit }
        }
      />

      {/* ── No-video avatar ── */}
      {noVideo && (
        <div className="video-tile-avatar-wrap">
          <div
            className="video-tile-avatar"
            style={profileImageUrl ? undefined : {
              background: 'rgba(0,0,0,0.22)',
              border: `2px solid ${colorBorder}`,
              color: colorText,
            }}
          >
            {profileImageUrl
              ? <img src={profileImageUrl} alt="" className="video-tile-avatar-img" />
              : <span>{initials}</span>
            }
          </div>
        </div>
      )}

      {/* ── Mic-muted badge (top-right) ── */}
      {audioMuted && !isScreenShare && (
        <div className="video-tile-muted-badge" style={{ color: colorText }}>
          <MicOffIcon size={13} />
        </div>
      )}

      {/* ── Name label ── */}
      <div className="video-tile-name">
        {name || "User"}
        {isSelf && " (You)"}
      </div>
      {isSelf && <div className="self-badge">YOU</div>}
    </div>
  );
}

export default function VideoArea({
  meetingId,
  meetingTitle,
  meetingUrl,
  inviteId,
  participants,
  modality,
  currentUser,
  fullscreenRef,
  // Panel toggles are owned by MeetingDock now; props are kept optional only
  // to preserve the historical interface in case anything else imports this.
  agendaPanelOpen: _agendaPanelOpen,
  rightPanelOpen: _rightPanelOpen,
  onToggleAgendaPanel: _onToggleAgendaPanel,
  onToggleRightPanel: _onToggleRightPanel,
  onMeetingEnded,
  onTriggerAddTask,
  onTriggerAddAgendaItem,
  agendaItems = [],
  minutesItems = [],
  tasks = [],
  onAgendaChange,
  onMinutesChange,
  onRefreshTasks,
  onParticipantsUpdate,
  isHost = false,
  canJoin = true,
  chatOpen = false,
  onToggleChat,
  onCallJoinedChange,
  joinMeetingActionRef,
}: VideoAreaProps) {
  const { socket, connected } = useSocket();
  const [elapsedTime, setElapsedTime] = useState(0);
  const [activeNote, setActiveNote] = useState("");
  const [parkingLotItems, setParkingLotItems] = useState<string[]>([]);
  const [showToast, setShowToast] = useState<string | null>(null);


  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h.toString().padStart(2, '0') + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleAddTask = async (type: string) => {
    if (!meetingId || !isHost) return;
    const title = activeNote.trim() || `Task: ${type}`;
    const activeAgendaItem = agendaItems.find((item) => ['active', 'in-progress'].includes(String(item.status || '').toLowerCase()));
    try {
      const res = await (fetch as any)(`${API_BASE}/tasks/${meetingId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JSON.parse(localStorage.getItem('mcms_userInfo') || '{}').token}`
        },
        body: JSON.stringify({ title, category: type, agendaItemId: activeAgendaItem?.id || null }),
      });
      if (res.ok) {
        onRefreshTasks?.();
        setActiveNote("");
        triggerToast("Task saved");
      }
    } catch (err) {
      console.error("Failed to save task:", err);
    }
  };

  const handleAddNote = () => {
    if (!activeNote.trim()) return;
    const newItem = {
      id: Math.random().toString(36).substr(2, 9),
      title: activeNote.trim(),
      status: 'pending' as const,
      duration: 0
    };
    onMinutesChange?.([...minutesItems, newItem]);
    setActiveNote("");
    triggerToast("Note captured");
  };

  const handleAddParkingLot = () => {
    if (!activeNote.trim()) return;
    setParkingLotItems(prev => [...prev, activeNote.trim()]);
    setActiveNote("");
    triggerToast("Added to parking lot");
  };

  const triggerToast = (msg: string) => {
    setShowToast(msg);
    setTimeout(() => setShowToast(null), 3000);
  };

  const advanceAgenda = () => {
    const activeIdx = agendaItems.findIndex(item => item.status === 'active');
    if (activeIdx === -1) {
      // If none active, make first pending active
      const firstPendingIdx = agendaItems.findIndex(item => item.status === 'pending');
      if (firstPendingIdx !== -1) {
        const newItems = [...agendaItems];
        newItems[firstPendingIdx] = { ...newItems[firstPendingIdx], status: 'active' };
        onAgendaChange?.(newItems);
      }
    } else {
      // Complete current, move to next
      const newItems = [...agendaItems];
      newItems[activeIdx] = { ...newItems[activeIdx], status: 'completed' };
      const nextPendingIdx = newItems.findIndex((item, idx) => idx > activeIdx && item.status === 'pending');
      if (nextPendingIdx !== -1) {
        newItems[nextPendingIdx] = { ...newItems[nextPendingIdx], status: 'active' };
      }
      onAgendaChange?.(newItems);
      triggerToast(nextPendingIdx === -1 ? "Agenda complete!" : "Advanced to next item");
    }
  };
  const {
    localStream,
    peers,
    audioEnabled,
    videoEnabled,
    screenStream,
    mediaError,
    joinRoom,
    leaveRoom,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    screenShareSystemAudio,
    setScreenShareSystemAudioPref,
    localSpeaking,
    activeSpeakerIds,
    startRoomAudio,
  } = useWebRTC(socket, meetingId, currentUser);

  useTranscriptionCapture(socket, meetingId || null, localStream);

  useEffect(() => {
    const list = [];
    if (currentUser) {
      list.push({ _id: (currentUser as any).id || (currentUser as any)._id, name: currentUser.name || "You" });
    }
    const seenPeer = new Set<string>();
    peers.forEach((p) => {
      const uid = p.userId || "";
      if (!uid || seenPeer.has(uid)) return;
      if (p.userId !== (currentUser as any)?.id && p.userId !== (currentUser as any)?._id) {
        seenPeer.add(uid);
        list.push({ _id: p.userId, name: p.name });
      }
    });
    onParticipantsUpdate?.(list);
  }, [currentUser, peers, onParticipantsUpdate]);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);
  const hostControlsRef = useRef<HostControlsRef | null>(null);

  const handleJoin = useCallback(async () => {
    if (!canJoin) return;
    // Unlock the browser's AudioContext NOW, while the user gesture is active.
    // LiveKit needs this to play remote audio tracks via its own <audio> elements.
    try {
      const tmpCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      tmpCtx.resume().then(() => tmpCtx.close()).catch(() => {});
    } catch { /* unsupported */ }
    startRoomAudio();
    const success = await joinRoom();
    if (success) setHasJoined(true);
  }, [joinRoom, canJoin, startRoomAudio]);

  useEffect(() => {
    if (!joinMeetingActionRef) return;
    joinMeetingActionRef.current = async () => {
      await handleJoin();
    };
    return () => {
      joinMeetingActionRef.current = null;
    };
  }, [joinMeetingActionRef, handleJoin]);

  useEffect(() => {
    if (modality === "Offline") return;
    onCallJoinedChange?.(hasJoined);
  }, [modality, hasJoined, onCallJoinedChange]);

  const handleLeave = useCallback(() => {
    leaveRoom();
    setHasJoined(false);
  }, [leaveRoom]);

  const meetingShortcuts = useMemo(() => [
    { key: 'm', handler: () => hasJoined && toggleAudio(), allowInInput: false },
    { key: 'r', handler: () => isHost && hasJoined && hostControlsRef.current?.toggleRecording(), allowInInput: false },
    { key: 'c', handler: () => hasJoined && toggleVideo(), allowInInput: false },
    { key: 'a', handler: () => isHost && onTriggerAddAgendaItem?.(), allowInInput: false },
    { key: 'a', shift: true, handler: () => isHost && onTriggerAddTask?.(), allowInInput: false },
    { key: 'Enter', handler: () => !hasJoined && canJoin && handleJoin(), allowInInput: false },
    { key: 'l', mod: true, shift: true, handler: () => hasJoined && handleLeave(), allowInInput: false },
    // End meeting shortcut only fires for the host
    { key: 'e', mod: true, shift: true, handler: () => isHost && hasJoined && hostControlsRef.current?.endMeeting(), allowInInput: false },
  ], [hasJoined, isHost, canJoin, toggleAudio, toggleVideo, handleJoin, handleLeave, onTriggerAddTask, onTriggerAddAgendaItem]);

  useKeyboardShortcuts(meetingShortcuts);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    if (!socket || !meetingId) return;
    const handleMeetingEnded = ({ meetingId: mid }: { meetingId: string }) => {
      if (mid === meetingId && hasJoined) {
        leaveRoom();
        setHasJoined(false);
      }
    };
    socket.on('meeting_ended', handleMeetingEnded);
    return () => { socket.off('meeting_ended', handleMeetingEnded); };
  }, [socket, meetingId, hasJoined, leaveRoom]);

  useEffect(() => {
    setHasJoined(false);
  }, [meetingId]);

  const toggleFullscreen = useCallback(() => {
    const target = fullscreenRef?.current;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      target.requestFullscreen().catch(() => { });
    }
  }, [fullscreenRef]);

  const liveParticipants = useMemo(() => {
    const list = [];
    if (currentUser) {
      list.push({ _id: (currentUser as any).id || (currentUser as any)._id, name: currentUser.name || "You" });
    }
    const seenPeer = new Set<string>();
    peers.forEach((p) => {
      const uid = p.userId || "";
      if (!uid || seenPeer.has(uid)) return;
      if (p.userId !== (currentUser as any)?.id && p.userId !== (currentUser as any)?._id) {
        seenPeer.add(uid);
        list.push({ _id: p.userId, name: p.name });
      }
    });
    return list;
  }, [currentUser, peers]);

  const totalParticipants = useMemo(() => {
    const peerUserIds = new Set(peers.map((p) => p.userId).filter(Boolean));
    return 1 + peerUserIds.size;
  }, [peers]);

  const connectedUserIds = useMemo(() => {
    const ids = new Set<string>();
    const selfId = (currentUser as any)?.id || (currentUser as any)?._id;
    if (selfId) ids.add(String(selfId));
    peers.forEach(p => { if (p.userId) ids.add(String(p.userId)); });
    return ids;
  }, [currentUser, peers]);
  const [pinnedTileIds, setPinnedTileIds] = useState<Set<string>>(new Set());

  const togglePin = useCallback((tileId: string) => {
    setPinnedTileIds((prev) => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId);
      else next.add(tileId);
      return next;
    });
  }, []);

  const selfUserId = (currentUser as any)?.id || (currentUser as any)?._id || '';

  const meetingTiles = useMemo(() => {
    const selfTiles = screenStream
      ? [
          {
            id: "self-screen-share",
            stream: screenStream,
            name: currentUser?.name,
            userId: selfUserId,
            profileImage: currentUser?.profileImage || null,
            muted: true,
            audioMuted: false,
            cameraOn: undefined as boolean | undefined,
            videoMuted: undefined as boolean | undefined,
            isSelf: true,
            isScreenShare: true,
            speaking: localSpeaking,
          },
          {
            id: "self-camera",
            stream: localStream,
            name: currentUser?.name,
            userId: selfUserId,
            profileImage: currentUser?.profileImage || null,
            muted: true,
            audioMuted: !audioEnabled,
            cameraOn: videoEnabled,
            videoMuted: undefined as boolean | undefined,
            isSelf: true,
            isScreenShare: false,
            speaking: localSpeaking,
          },
        ]
      : [
          {
            id: "self-camera",
            stream: localStream,
            name: currentUser?.name,
            userId: selfUserId,
            profileImage: currentUser?.profileImage || null,
            muted: true,
            audioMuted: !audioEnabled,
            cameraOn: videoEnabled,
            videoMuted: undefined as boolean | undefined,
            isSelf: true,
            isScreenShare: false,
            speaking: localSpeaking,
          },
        ];
    const peerTiles = peers.map((peer) => ({
      id: `peer-${peer.socketId}`,
      stream: peer.stream,
      name: peer.name,
      userId: peer.userId,
      profileImage: peer.profileImage,
      muted: peer.playRemoteAudio === false,
      audioMuted: peer.audioMuted ?? false,
      videoMuted: peer.videoMuted ?? false,
      cameraOn: undefined as boolean | undefined,
      isSelf: false,
      isScreenShare: peer.isScreenShare,
      // speaking computed here from activeSpeakerIds — not from peers — so VAD
      // events never trigger stream reconstruction in getParticipantVideoTiles
      speaking: activeSpeakerIds.has(peer.userId ?? ''),
    }));
    const allTiles = [...selfTiles, ...peerTiles];
    return allTiles.sort((a, b) => {
      const aPinned = pinnedTileIds.has(a.id);
      const bPinned = pinnedTileIds.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      if (a.isScreenShare !== b.isScreenShare) return a.isScreenShare ? -1 : 1;
      return 0;
    });
  }, [screenStream, localStream, currentUser?.name, currentUser?.profileImage, selfUserId, peers, pinnedTileIds, localSpeaking, activeSpeakerIds, audioEnabled, videoEnabled]);

  const { screenTiles, cameraTiles, hasAnyScreenShare } = useMemo(() => {
    const screen = meetingTiles.filter((t) => t.isScreenShare);
    const cameras = meetingTiles.filter((t) => !t.isScreenShare);
    return {
      screenTiles: screen,
      cameraTiles: cameras,
      hasAnyScreenShare: screen.length > 0,
    };
  }, [meetingTiles]);

  // Live size of the video region — drives the dynamic grid math below.
  // ResizeObserver fires whenever the dock toggles a side panel or the window
  // resizes, so layouts adapt without us listening to those events directly.
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const layoutSize = useElementSize(layoutRef);

  // Screen-share intrinsic aspect, indexed by tile id. Lets the stage layout
  // contain (not crop) the actual share regardless of the source's aspect.
  const [screenAspects, setScreenAspects] = useState<Record<string, number>>({});
  const handleScreenAspect = useCallback((tileId: string, ratio: number) => {
    setScreenAspects((prev) => {
      const existing = prev[tileId];
      // 0.5% epsilon so 16:9 streams don't churn state every frame.
      if (existing && Math.abs(existing - ratio) / ratio < 0.005) return prev;
      return { ...prev, [tileId]: ratio };
    });
  }, []);
  // Garbage-collect aspect ratios for tiles that have left the call.
  useEffect(() => {
    setScreenAspects((prev) => {
      const validIds = new Set(screenTiles.map((t) => t.id));
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, val] of Object.entries(prev)) {
        if (validIds.has(id)) next[id] = val;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [screenTiles]);

  // Pick the screen aspect to drive layout math: the first known aspect for
  // the primary screen share. Defaults to 16:9 until metadata loads.
  const primaryScreenAspect = useMemo(() => {
    for (const tile of screenTiles) {
      const a = screenAspects[tile.id];
      if (a && Number.isFinite(a) && a > 0) return a;
    }
    return 16 / 9;
  }, [screenTiles, screenAspects]);

  // Compute the actual grid layout for the current container size + tile mix.
  const galleryLayout = useMemo(() => {
    if (hasAnyScreenShare) return null;
    return computeGalleryLayout(layoutSize.width, layoutSize.height, meetingTiles.length);
  }, [hasAnyScreenShare, layoutSize.width, layoutSize.height, meetingTiles.length]);

  // Sqrt fallback used while the ResizeObserver hasn't reported a size yet —
  // ensures the very first render of a freshly opened meeting already shows
  // a sensible grid (e.g. 1×2 for two people) instead of a 1×1 stack.
  const galleryFallbackCols = Math.max(1, Math.ceil(Math.sqrt(meetingTiles.length)));
  const galleryFallbackRows = Math.max(
    1,
    Math.ceil(meetingTiles.length / galleryFallbackCols),
  );

  const stageLayout = useMemo(() => {
    if (!hasAnyScreenShare) return null;
    const layout = computeStageLayout(
      layoutSize.width,
      layoutSize.height,
      cameraTiles.length,
      primaryScreenAspect,
    );
    return layout;
  }, [hasAnyScreenShare, layoutSize.width, layoutSize.height, cameraTiles.length, primaryScreenAspect]);

  return (
    <div className="video-area">
      {showToast && <div className={`focus-toast show`}>{showToast}</div>}
      <div className="video-header">
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="video-meeting-title">{meetingTitle || "No Active Meeting"}</h2>
            <div className="video-meeting-meta">
              <span className={`offline-dot ${connected ? 'connected' : ''}`} />
              <Icon icon={UserGroupIcon} size={14} />
              <span>
                {modality === "Offline"
                  ? `${participants?.length || 0} attendees`
                  : hasJoined ? `${totalParticipants} in call` : `${participants?.length || 0} participants`
                }
              </span>
              {modality === "Offline" && <span className="chip chip-emerald" style={{ fontSize: '0.625rem' }}>Offline Focus</span>}
            </div>
          </div>
          {modality === "Offline" && (
            <div className="focus-header-meta">
              {/* <span className="badge badge-rec"><span className="rec-dot"></span> Recording</span> */}
              <span className="timer-val">{formatTime(elapsedTime)}</span>
            </div>
          )}
        </div>
        <ShortcutTooltip keys={["F"]}>
          <button
            className="btn-icon"
            id="btn-fullscreen"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            <Icon icon={isFullscreen ? ArrowShrink02Icon : FullScreenIcon} size={16} />
          </button>
        </ShortcutTooltip>
      </div>

      <div className="video-container">
        <div className="video-placeholder">
          {modality === "Offline" ? (
            <div className="focus-mode-shell">
              <div className="focus-main">
                <div className="focus-left">
                  <div className="focus-section">
                    <div className="focus-section-label">Agenda</div>
                    <div className="focus-agenda-card">
                      {agendaItems.length === 0 ? (
                        <div className="focus-empty-state">No agenda items defined</div>
                      ) : (
                        agendaItems.slice(0, 4).map((item, idx) => (
                          <div key={item.id} className={`focus-agenda-item ${item.status}`}>
                            <div className={`focus-ai-num ${item.status}`}>
                              {item.status === 'completed' ? <Icon icon={Tick01Icon} size={12} /> : idx + 1}
                            </div>
                            <div className="focus-ai-content">
                              <div className="focus-ai-name">{item.title}</div>
                              <div className="focus-ai-time">{item.duration} min · {item.status}</div>
                            </div>
                            <span className={`focus-ai-status st-${item.status}`}>{item.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="focus-progress-wrap">
                    <div className="focus-pb-label">
                      <span>Progress</span>
                      <span>{Math.round((agendaItems.filter(i => i.status === 'completed').length / (agendaItems.length || 1)) * 100)}%</span>
                    </div>
                    <div className="focus-pb-track">
                      <div
                        className="focus-pb-fill"
                        style={{ width: `${(agendaItems.filter(i => i.status === 'completed').length / (agendaItems.length || 1)) * 100}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="focus-section">
                    <div className="focus-section-label">Quick Capture</div>
                    <div className="focus-note-card">
                      <textarea
                        className="focus-note-input"
                        placeholder={isHost ? "Type a note, decision, or task..." : "Type a note or parking-lot item..."}
                        value={activeNote}
                        onChange={(e) => setActiveNote(e.target.value)}
                      ></textarea>
                      <div className="focus-note-actions">
                        {isHost && <button className="focus-note-btn" onClick={() => handleAddTask('Technical')}>+ Technical</button>}
                        {isHost && <button className="focus-note-btn" onClick={() => handleAddTask('Decision')}>+ Decision</button>}
                        {isHost && <button className="focus-note-btn" onClick={() => handleAddTask('Follow-up')}>+ Follow-up</button>}
                        <button className="focus-note-btn" onClick={handleAddParkingLot}>+ Parking</button>
                        <button className="focus-note-btn primary" onClick={handleAddNote}>Save Note</button>
                      </div>
                    </div>
                  </div>

                  <div className="focus-ctrl-row">
                    <button className="focus-ctrl-btn" onClick={() => triggerToast("Agenda paused")}>
                      <Icon icon={PauseIcon} size={14} /> Pause Item
                    </button>
                    <button className="focus-ctrl-btn next" onClick={advanceAgenda}>
                      Next Item <Icon icon={ArrowRight01Icon} size={14} />
                    </button>
                  </div>
                </div>

                <div className="focus-right">
                  <div className="focus-section">
                    <div className="focus-section-label">Attendees</div>
                    <div className="focus-attendee-row">
                      {participants?.map((p, idx) => (
                        <div key={p.id || idx} className="focus-av-chip">
                          <div className="focus-av-dot">{p.name?.charAt(0) || "U"}</div>
                          <span className="focus-av-name">{p.name || "User"}</span>
                        </div>
                      ))}
                      {participants?.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No attendees listed</span>}
                    </div>
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div className="focus-section-label">Tasks · {tasks.length}</div>
                    <div className="focus-action-feed">
                      {tasks.length === 0 ? (
                        <div className="focus-empty-state">No tasks captured yet</div>
                      ) : (
                        tasks.map((ai, idx) => (
                          <div key={ai.id || idx} className={`focus-action-card ${ai.category?.toLowerCase()}`}>
                            <div className="focus-ac-top">
                              <span className={`focus-ac-type ${ai.category?.toLowerCase()}`}>{ai.category}</span>
                              <span className="focus-ac-assignee">→ {ai.assignee || 'Unassigned'}</span>
                            </div>
                            <div className="focus-ac-text">{ai.title}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="focus-section">
                    <div className="focus-section-label">Parking Lot</div>
                    <div className="focus-parking-lot">
                      <div className="focus-pl-title">Off-topic items</div>
                      {parkingLotItems.length === 0 ? (
                        <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>Empty</div>
                      ) : (
                        parkingLotItems.map((item, i) => (
                          <div key={i} className="focus-pl-item">{item}</div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="focus-sync-banner">
                    <div className="focus-sync-text">Changes synced to server</div>
                    <Icon icon={CheckmarkCircle01Icon} size={12} style={{ color: 'var(--accent-emerald)' }} />
                  </div>
                </div>
              </div>
            </div>
          ) : !hasJoined ? (
            <div className="video-prejoin">
              <div className="prejoin-card">
                {mediaError && (
                  <p style={{ color: "var(--danger)", fontSize: "0.875rem", textAlign: "center", marginBottom: "0.5rem" }}>{mediaError}</p>
                )}
                <UserAvatar
                  name={currentUser?.name || ''}
                  profileImage={currentUser?.profileImage}
                  userId={(currentUser as any)?.id || (currentUser as any)?._id}
                  size={80}
                  className="prejoin-avatar"
                />
                <h3 className="prejoin-title">{meetingTitle}</h3>
                <p className="prejoin-subtitle">
                  {mediaError
                    ? 'Allow camera/mic access and try again.'
                    : canJoin
                      ? 'Ready to join?'
                      : 'You can join this meeting 15 minutes before start.'}
                </p>
                <button className="btn btn-primary prejoin-btn" onClick={handleJoin} disabled={!canJoin}>
                  {mediaError ? 'Try Again' : <>Join Meeting <Kbd keys={['↵']} className="prejoin-enter" /></>}
                </button>
              </div>
            </div>
          ) : (
            <>
              {mediaError && (
                <div style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", color: "var(--flexoki-yellow-600)", background: "rgba(var(--flexoki-yellow-400-rgb), 0.1)", borderRadius: "0.375rem", marginBottom: "0.375rem", textAlign: "center" }}>
                  {mediaError}
                </div>
              )}
              <div
                ref={layoutRef}
                className={
                  hasAnyScreenShare
                    ? `video-layout video-layout--stage video-layout--filmstrip-${stageLayout?.filmstripPlacement ?? "right"}`
                    : "video-layout video-layout--gallery"
                }
                style={
                  hasAnyScreenShare
                    ? ({
                        // Lay out stage + filmstrip with explicit pixel sizes
                        // so the screen share gets every pixel it can while
                        // the filmstrip stays exactly large enough.
                        "--filmstrip-size":
                          stageLayout?.filmstripPlacement === "none"
                            ? "0px"
                            : `${Math.round(stageLayout?.filmstripSize ?? 0)}px`,
                      } as CSSProperties)
                    : ({
                        // Explicit grid built from the area-maximising layout
                        // math — tiles fill the cell so no whitespace bands.
                        // Falls back to a sqrt-shaped grid if measurement is
                        // not in yet (so no first-frame 1×1 stacking).
                        "--video-gallery-cols": String(
                          galleryLayout?.cols ?? galleryFallbackCols,
                        ),
                        "--video-gallery-rows": String(
                          galleryLayout?.rows ?? galleryFallbackRows,
                        ),
                      } as CSSProperties)
                }
              >
                {hasAnyScreenShare ? (
                  <>
                    <div className="video-layout-main">
                      {screenTiles.map((tile) => (
                        <VideoTile
                          key={tile.id}
                          tileId={tile.id}
                          stream={tile.stream}
                          name={tile.name}
                          userId={tile.userId}
                          profileImage={tile.profileImage}
                          muted={tile.muted}
                          audioMuted={tile.audioMuted}
                          videoMuted={tile.videoMuted}
                          cameraOn={tile.cameraOn}
                          isSelf={tile.isSelf}
                          isScreenShare={tile.isScreenShare}
                          speaking={tile.speaking}
                          pinned={pinnedTileIds.has(tile.id)}
                          onTogglePin={togglePin}
                          videoObjectFit="contain"
                          layoutVariant="stage"
                          onAspectRatioChange={handleScreenAspect}
                        />
                      ))}
                    </div>
                    {cameraTiles.length > 0 && stageLayout?.filmstripPlacement !== "none" ? (
                      <div className="video-layout-filmstrip">
                        {cameraTiles.map((tile) => (
                          <VideoTile
                            key={tile.id}
                            tileId={tile.id}
                            stream={tile.stream}
                            name={tile.name}
                            userId={tile.userId}
                            profileImage={tile.profileImage}
                            muted={tile.muted}
                            audioMuted={tile.audioMuted}
                            videoMuted={tile.videoMuted}
                            cameraOn={tile.cameraOn}
                            isSelf={tile.isSelf}
                            isScreenShare={tile.isScreenShare}
                            speaking={tile.speaking}
                            pinned={pinnedTileIds.has(tile.id)}
                            onTogglePin={togglePin}
                            videoObjectFit="cover"
                            layoutVariant="filmstrip"
                          />
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  meetingTiles.map((tile) => (
                    <VideoTile
                      key={tile.id}
                      tileId={tile.id}
                      stream={tile.stream}
                      name={tile.name}
                      userId={tile.userId}
                      profileImage={tile.profileImage}
                      muted={tile.muted}
                      audioMuted={tile.audioMuted}
                      videoMuted={tile.videoMuted}
                      cameraOn={tile.cameraOn}
                      isSelf={tile.isSelf}
                      isScreenShare={tile.isScreenShare}
                      speaking={tile.speaking}
                      pinned={pinnedTileIds.has(tile.id)}
                      onTogglePin={togglePin}
                      videoObjectFit="cover"
                      layoutVariant="gallery"
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <HostControls
        ref={hostControlsRef}
        meetingId={meetingId}
        meetingTitle={meetingTitle}
        meetingUrl={meetingUrl}
        inviteId={inviteId ?? undefined}
        modality={modality}
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        screenSharing={!!screenStream}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
        screenShareSystemAudio={screenShareSystemAudio}
        onScreenShareSystemAudioChange={setScreenShareSystemAudioPref}
        onLeave={handleLeave}
        hasJoined={hasJoined}
        onMeetingEnded={onMeetingEnded}
        isHost={isHost}
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
        participants={participants}
        connectedUserIds={connectedUserIds}
      />

      <style>{`

        .video-panel-toggle {
          flex-shrink: 0;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-card);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          cursor: pointer;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
          padding: 0;
        }
        .video-panel-toggle:hover {
          background: var(--bg-hover);
          color: var(--primary);
          border-color: var(--border-hover);
        }
        .video-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1.25rem;
          border-bottom: 0.0625rem solid var(--border);
        }
        .video-meeting-title {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 0.125rem;
        }
        .video-meeting-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .video-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.75rem;
          overflow: hidden;
        }
        .video-placeholder {
          width: 100%;
          height: 100%;
          border-radius: var(--radius-lg);
          overflow: hidden;
        }
        .video-offline-message {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-muted);
        }

        /* Pre-join screen */
        .video-prejoin {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          background: var(--bg-elevated);
          border-radius: var(--radius-lg);
          border: 0.0625rem solid var(--border);
        }
        .prejoin-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          padding: 3rem 4rem;
        }
        .prejoin-avatar {
          /* UserAvatar sets its own bg/border/size inline — just ensure it's centred */
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .prejoin-title {
          font-size: 1.125rem;
          font-weight: 600;
          text-align: center;
        }
        .prejoin-subtitle {
          font-size: 0.8125rem;
          color: var(--text-muted);
        }
        .prejoin-btn {
          margin-top: 0.5rem;
          padding: 0.625rem 2rem;
          font-size: 0.875rem;
        }
        .prejoin-btn .prejoin-enter {
          margin-left: 0.375rem;
        }
        .prejoin-btn .prejoin-enter .kbd {
          font-size: 0.5625rem;
          min-width: 1rem;
          height: 1rem;
          padding: 0 0.25rem;
          background: color-mix(in srgb, var(--color-bg-secondary) 25%, rgba(var(--flexoki-paper-rgb), 0.25));
          border: 0.0625rem solid color-mix(in srgb, var(--primary-dark) 70%, rgba(var(--flexoki-paper-rgb), 0.5));
          color: rgba(var(--flexoki-paper-rgb), 0.95);
          box-shadow: 0 0.0625rem 0 rgba(var(--flexoki-black-rgb), 0.15);
        }

        /* Dynamic, area-maximising layout. Cell sizes are computed at runtime
           by computeGalleryLayout / computeStageLayout (videoGridLayout.ts) and
           applied via CSS custom properties + grid-template-* inline styles. */
        .video-layout {
          width: 100%;
          height: 100%;
          min-height: 0;
          box-sizing: border-box;
          gap: 0.5rem;
          display: grid;
        }
        /* Gallery: explicit rows × cols from the layout solver. Tiles stretch
           to fill the cell, so cameras (object-fit: cover) crop to fit
           — the trade-off the user signed off on for max area. */
        .video-layout--gallery {
          grid-template-columns: repeat(var(--video-gallery-cols, 1), minmax(0, 1fr));
          grid-template-rows: repeat(var(--video-gallery-rows, 1), minmax(0, 1fr));
          padding: 0;
        }
        .video-tile--gallery {
          width: 100%;
          height: 100%;
          min-height: 0;
        }
        /* Stage: filmstrip on right or bottom, sized via --filmstrip-size. */
        .video-layout--stage {
          padding: 0;
        }
        .video-layout--filmstrip-right {
          grid-template-columns: minmax(0, 1fr) var(--filmstrip-size, 0px);
          grid-template-rows: minmax(0, 1fr);
        }
        .video-layout--filmstrip-bottom {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: minmax(0, 1fr) var(--filmstrip-size, 0px);
        }
        .video-layout--filmstrip-none {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: minmax(0, 1fr);
        }
        .video-layout-main {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          overflow: hidden;
        }
        /* Filmstrip uses flexbox so each tile can keep its own 16:9 aspect.
           Tiles stack along the long axis and scroll if they overflow — they
           never get stretched into 96×800 strips just to "fill" the slot. */
        .video-layout-filmstrip {
          min-width: 0;
          min-height: 0;
          display: flex;
          gap: 0.5rem;
        }
        .video-layout--filmstrip-right .video-layout-filmstrip {
          flex-direction: column;
          align-items: stretch;
          overflow-x: hidden;
          overflow-y: auto;
        }
        .video-layout--filmstrip-bottom .video-layout-filmstrip {
          flex-direction: row;
          align-items: stretch;
          justify-content: center;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .video-tile--stage {
          flex: 1 1 0;
          min-height: 0;
          width: 100%;
          max-height: 100%;
        }
        /* Each filmstrip tile keeps a 16:9 frame regardless of how many cameras
           are in the call — the tile sizes itself to the cross dimension of the
           filmstrip and lets aspect-ratio do the rest. */
        .video-layout--filmstrip-right .video-tile--filmstrip {
          width: 100%;
          aspect-ratio: 16 / 9;
          flex: 0 0 auto;
        }
        .video-layout--filmstrip-bottom .video-tile--filmstrip {
          height: 100%;
          aspect-ratio: 16 / 9;
          flex: 0 0 auto;
        }

        .video-tile {
          position: relative;
          background: var(--bg-elevated);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-md);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          animation: slideUp 0.4s ease both;
          width: 100%;
          min-height: 0;
        }
        .video-tile-pin {
          position: absolute;
          top: 0.5rem;
          left: 0.5rem;
          z-index: 5;
          padding: 0.1875rem 0.45rem;
          border: 0.0625rem solid rgba(var(--flexoki-paper-rgb), 0.25);
          border-radius: 999px;
          background: rgba(var(--flexoki-black-rgb), 0.55);
          color: var(--flexoki-paper);
          font-size: 0.625rem;
          line-height: 1;
          cursor: pointer;
        }
        .video-tile-pin.active {
          border-color: var(--primary);
          color: var(--primary);
        }
        .video-tile:hover {
          border-color: var(--border-hover);
        }

        .video-tile-video {
          width: 100%;
          height: 100%;
          border-radius: inherit;
          position: relative;
          z-index: 2;
        }
        .video-tile-video-backdrop {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: blur(24px) brightness(0.55);
          transform: scale(1.05);
          opacity: 0.9;
          z-index: 1;
        }
        /* Blurred profile image fills the tile when camera is off */
        .video-tile-bg-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: blur(96px) brightness(0.35) saturate(1.4);
          transform: scale(1.1);
          z-index: 1;
          pointer-events: none;
        }
        /* Screen-share tiles use a flat, dark letterbox */
        .video-tile.screen-share {
          background: #0a0a0b;
        }

        /* Avatar wrapper (centred in tile when no video) */
        .video-tile-avatar-wrap {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .video-tile-avatar {
          width: 4rem;
          height: 4rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: 700;
          overflow: hidden;
          flex-shrink: 0;
        }
        .video-tile-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        /* Mic-muted indicator — top-right, no layout impact */
        .video-tile-muted-badge {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          z-index: 5;
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 50%;
          background: rgba(var(--flexoki-black-rgb), 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .video-tile-name {
          position: absolute;
          bottom: 0.5rem;
          left: 0.5rem;
          padding: 0.1875rem 0.5rem;
          background: rgba(var(--flexoki-black-rgb), 0.6);
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--flexoki-paper);
          backdrop-filter: blur(4px);
          z-index: 3;
        }
        .self-badge {
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          padding: 0.125rem 0.375rem;
          background: var(--primary);
          border-radius: 6.25rem;
          font-size: 0.5625rem;
          font-weight: 700;
          color: var(--flexoki-paper);
          letter-spacing: 0.03125rem;
          z-index: 3;
        }
        .host-badge {
          position: absolute;
          top: 0.625rem;
          right: 0.625rem;
          padding: 0.1875rem 0.5rem;
          background: var(--primary);
          border-radius: 6.25rem;
          font-size: 0.625rem;
          font-weight: 700;
          color: var(--flexoki-paper);
          letter-spacing: 0.03125rem;
          z-index: 3;
        }

        /* Offline Focus Mode Styles */
        .focus-mode-shell {
          width: 100%;
          height: 100%;
          background: var(--bg-secondary);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .offline-dot {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          background: var(--danger);
          transition: background 0.3s;
        }
        .offline-dot.connected {
          background: var(--accent-emerald);
          box-shadow: 0 0 10px var(--accent-emerald);
          animation: pulse 2s infinite;
        }

        .focus-header-meta {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .badge-rec {
          background: rgba(var(--flexoki-red-400-rgb), 0.1);
          color: var(--danger);
          font-size: 0.625rem;
          padding: 0.125rem 0.5rem;
          border-radius: 1rem;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }
        .rec-dot {
          width: 0.25rem;
          height: 0.25rem;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 1s infinite;
        }
        .timer-val {
          font-family: monospace;
          font-size: 0.8125rem;
          color: var(--text-secondary);
        }

        .focus-main {
          flex: 1;
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 0;
          height: 100%;
          border-top: 1px solid var(--border);
        }

        .focus-left {
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          border-right: 1px solid var(--border);
          overflow-y: auto;
          background: var(--bg-primary);
        }

        .focus-right {
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          background: var(--bg-secondary);
          overflow-y: auto;
          min-height: 0;
        }

        .focus-section-label {
          font-size: 0.625rem;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.5rem;
        }

        .focus-agenda-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .focus-agenda-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 1rem;
          border-bottom: 1px solid var(--border);
          transition: background 0.2s;
        }
        .focus-agenda-item:last-child { border-bottom: none; }
        .focus-agenda-item.active { background: var(--primary-muted); }
        .focus-agenda-item.completed { opacity: 0.6; }

        .focus-ai-num {
          width: 1.25rem;
          height: 1.25rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.625rem;
          font-weight: 700;
          background: var(--bg-elevated);
          color: var(--text-muted);
          border: 1px solid var(--border);
        }
        .focus-ai-num.active { background: var(--primary); color: var(--flexoki-paper); border-color: var(--primary); }
        .focus-ai-num.completed { background: var(--accent-emerald); color: var(--flexoki-paper); border-color: var(--accent-emerald); }

        .focus-ai-name { font-size: 0.8125rem; font-weight: 500; }
        .focus-ai-time { font-size: 0.6875rem; color: var(--text-muted); }

        .focus-ai-status {
          margin-left: auto;
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          border-radius: 1rem;
          text-transform: capitalize;
        }
        .st-active { background: var(--primary-muted); color: var(--primary); }
        .st-completed { background: var(--accent-emerald-muted); color: var(--accent-emerald); }
        .st-pending { background: var(--bg-elevated); color: var(--text-muted); }

        .focus-progress-wrap {
          background: var(--bg-card);
          border: 1px solid var(--border);
          padding: 0.875rem 1rem;
          border-radius: var(--radius-md);
        }
        .focus-pb-label {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          margin-bottom: 0.5rem;
          color: var(--text-secondary);
        }
        .focus-pb-track { height: 0.375rem; background: var(--bg-elevated); border-radius: 1rem; overflow: hidden; }
        .focus-pb-fill { height: 100%; background: var(--primary); transition: width 0.5s ease-out; }

        .focus-note-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 0.75rem;
        }
        .focus-note-input {
          width: 100%;
          min-height: 4rem;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 0.8125rem;
          resize: none;
        }
        .focus-note-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin-top: 0.5rem;
        }
        .focus-note-btn {
          font-size: 0.6875rem;
          padding: 0.25rem 0.625rem;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s;
        }
        .focus-note-btn:hover { background: var(--bg-hover); }
        .focus-note-btn.primary { background: var(--primary); color: var(--flexoki-paper); border-color: var(--primary); }

        .focus-ctrl-row { display: flex; gap: 0.75rem; }
        .focus-ctrl-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.625rem;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
          background: var(--bg-card);
          color: var(--text-primary);
          font-weight: 500;
          font-size: 0.8125rem;
          cursor: pointer;
        }
        .focus-ctrl-btn.next { background: var(--primary); color: var(--flexoki-paper); border-color: var(--primary); }

        .focus-attendee-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .focus-av-chip {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          background: var(--bg-elevated);
          padding: 0.25rem 0.5rem 0.25rem 0.25rem;
          border-radius: 2rem;
          border: 1px solid var(--border);
        }
        .focus-av-dot {
          width: 1.25rem;
          height: 1.25rem;
          border-radius: 50%;
          background: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.625rem;
          color: var(--flexoki-paper);
          font-weight: 700;
        }
        .focus-av-name { font-size: 0.75rem; color: var(--text-primary); }

        .focus-action-feed {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
          min-height: 0;
        }
        .focus-action-card {
          background: var(--bg-card);
          padding: 0.75rem;
          border-radius: var(--radius-md);
          border-left: 3px solid var(--border);
        }
        .focus-action-card.technical { border-left-color: var(--flexoki-blue-500); }
        .focus-action-card.decision { border-left-color: var(--accent-emerald); }
        .focus-action-card.follow-up { border-left-color: var(--flexoki-magenta-500); }

        .focus-ac-top { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; margin-bottom: 0.375rem; }
        .focus-ac-type { font-size: 0.5625rem; font-weight: 700; text-transform: uppercase; }
        .focus-ac-type.technical { color: var(--flexoki-blue-500); }
        .focus-ac-type.decision { color: var(--accent-emerald); }
        .focus-ac-assignee { font-size: 0.6875rem; color: var(--text-muted); }
        .focus-ac-text { font-size: 0.75rem; line-height: 1.4; color: var(--text-primary); }

        .focus-parking-lot {
          background: rgba(var(--flexoki-orange-400-rgb), 0.05);
          border: 1px solid rgba(var(--flexoki-orange-400-rgb), 0.2);
          border-radius: var(--radius-md);
          padding: 0.75rem;
        }
        .focus-pl-title { font-size: 0.75rem; font-weight: 600; color: var(--flexoki-orange-400); margin-bottom: 0.25rem; }
        .focus-pl-item { font-size: 0.75rem; padding: 0.25rem 0; border-bottom: 1px solid rgba(var(--flexoki-orange-400-rgb), 0.1); }
        .focus-pl-item:last-child { border-bottom: none; }

        .focus-sync-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-elevated);
          padding: 0.5rem 0.75rem;
          border-radius: var(--radius-md);
          margin-top: auto;
        }
        .focus-sync-text { font-size: 0.6875rem; color: var(--text-muted); }

        .focus-toast {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          color: var(--text-primary);
          padding: 0.625rem 1rem;
          border-radius: var(--radius-md);
          font-size: 0.8125rem;
          box-shadow: var(--shadow-lg);
          z-index: 1000;
          opacity: 0;
          transform: translateY(1rem);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .focus-toast.show { opacity: 1; transform: translateY(0); }

        .focus-empty-state {
          padding: 1.5rem;
          text-align: center;
          font-size: 0.75rem;
          color: var(--text-muted);
          background: var(--bg-elevated);
          border-radius: var(--radius-sm);
        }
      `}</style>
    </div>
  );
}
