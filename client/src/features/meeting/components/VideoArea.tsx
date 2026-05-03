import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import HostControls, { type HostControlsRef } from "./HostControls";
import useKeyboardShortcuts from "../../../hooks/useKeyboardShortcuts";
import Icon from "../../../shared/components/Icon";
import {
  UserGroupIcon,
  FullScreenIcon,
  MinimizeScreenIcon,
  Clock01Icon,
  Note01Icon,
  Task01Icon,
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
  muted: boolean;
  isSelf: boolean;
  /** When true, skip horizontal mirror (screen share must stay left–right correct). */
  isScreenShare?: boolean;
  pinned?: boolean;
  onTogglePin?: (tileId: string) => void;
  speaking?: boolean;
}

interface VideoAreaProps {
  meetingId?: string;
  meetingTitle?: string;
  meetingUrl?: string;
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
  onTriggerAddActionItem?: () => void;
  onTriggerAddAgendaItem?: () => void;
  agendaItems?: any[];
  minutesItems?: any[];
  actionItems?: any[];
  onAgendaChange?: (items: any[]) => void;
  onMinutesChange?: (items: any[]) => void;
  onRefreshActionItems?: () => void;
  onParticipantsUpdate?: (participants: any[]) => void;
  /** Whether the current user is the meeting host */
  isHost?: boolean;
  /** Whether the meeting can be joined right now */
  canJoin?: boolean;
  chatOpen?: boolean;
  onToggleChat?: () => void;
}

function VideoTile({
  tileId,
  stream,
  name,
  profileImage,
  muted,
  isSelf,
  isScreenShare,
  pinned,
  onTogglePin,
  speaking,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoBackdropRef = useRef<HTMLVideoElement | null>(null);
  const [hasVideo, setHasVideo] = useState<boolean>(false);

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
    if (videoBackdropRef.current && stream) {
      videoBackdropRef.current.srcObject = stream;
    }
  }, [stream]);

  const initial: string = name?.charAt(0)?.toUpperCase() || "?";

  return (
    <div
      className={`video-tile ${speaking ? "speaking" : ""} ${pinned ? "pinned" : ""} ${isScreenShare ? "screen-share" : ""}`}
    >
      <button
        type="button"
        className={`video-tile-pin ${pinned ? "active" : ""}`}
        onClick={() => onTogglePin?.(tileId)}
      >
        {pinned ? "Unpin" : "Pin"}
      </button>
      <video
        ref={videoBackdropRef}
        autoPlay
        playsInline
        muted={true}
        aria-hidden
        className="video-tile-video-backdrop"
        style={isSelf && !isScreenShare
          ? { transform: "scaleX(-1)", display: hasVideo ? undefined : "none" }
          : { display: hasVideo ? undefined : "none" }
        }
      />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="video-tile-video"
        style={isSelf && !isScreenShare
          ? { transform: "scaleX(-1)", display: hasVideo ? undefined : "none" }
          : { display: hasVideo ? undefined : "none" }
        }
      />
      {!hasVideo && (
        <div className="video-tile-avatar">
          {profileImage ? (
            <img
              src={`${SERVER_BASE}${profileImage}`}
              alt=""
              className="video-tile-avatar-img"
            />
          ) : (
            <span>{initial}</span>
          )}
        </div>
      )}
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
  onTriggerAddActionItem,
  onTriggerAddAgendaItem,
  agendaItems = [],
  minutesItems = [],
  actionItems = [],
  onAgendaChange,
  onMinutesChange,
  onRefreshActionItems,
  onParticipantsUpdate,
  isHost = false,
  canJoin = true,
  chatOpen = false,
  onToggleChat,
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

  const handleAddActionItem = async (type: string) => {
    if (!meetingId || !isHost) return;
    const title = activeNote.trim() || `Action item: ${type}`;
    const activeAgendaItem = agendaItems.find((item) => ['active', 'in-progress'].includes(String(item.status || '').toLowerCase()));
    try {
      const res = await (fetch as any)(`${API_BASE}/action-items/${meetingId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JSON.parse(localStorage.getItem('mcms_userInfo') || '{}').token}`
        },
        body: JSON.stringify({ title, category: type, agendaItemId: activeAgendaItem?.id || null }),
      });
      if (res.ok) {
        onRefreshActionItems?.();
        setActiveNote("");
        triggerToast("Action item saved");
      }
    } catch (err) {
      console.error("Failed to save action item:", err);
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
  } = useWebRTC(socket, meetingId, currentUser);

  useTranscriptionCapture(socket, meetingId || null, localStream);

  useEffect(() => {
    const list = [];
    if (currentUser) {
      list.push({ _id: (currentUser as any).id || (currentUser as any)._id, name: currentUser.name || "You" });
    }
    peers.forEach(p => {
      if (p.userId !== (currentUser as any)?.id && p.userId !== (currentUser as any)?._id) {
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
    const success = await joinRoom();
    if (success) setHasJoined(true);
  }, [joinRoom, canJoin]);

  const handleLeave = useCallback(() => {
    leaveRoom();
    setHasJoined(false);
  }, [leaveRoom]);

  const meetingShortcuts = useMemo(() => [
    { key: 'm', handler: () => hasJoined && toggleAudio(), allowInInput: false },
    { key: 'r', handler: () => isHost && hasJoined && hostControlsRef.current?.toggleRecording(), allowInInput: false },
    { key: 'c', handler: () => hasJoined && toggleVideo(), allowInInput: false },
    { key: 'a', handler: () => isHost && onTriggerAddAgendaItem?.(), allowInInput: false },
    { key: 'a', shift: true, handler: () => isHost && onTriggerAddActionItem?.(), allowInInput: false },
    { key: 'Enter', handler: () => !hasJoined && canJoin && handleJoin(), allowInInput: false },
    { key: 'l', mod: true, shift: true, handler: () => hasJoined && handleLeave(), allowInInput: false },
    // End meeting shortcut only fires for the host
    { key: 'e', mod: true, shift: true, handler: () => isHost && hasJoined && hostControlsRef.current?.endMeeting(), allowInInput: false },
  ], [hasJoined, isHost, canJoin, toggleAudio, toggleVideo, handleJoin, handleLeave, onTriggerAddActionItem, onTriggerAddAgendaItem]);

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
    peers.forEach(p => {
      // Avoid duplicates if currentUser is also in peers for some reason
      if (p.userId !== (currentUser as any)?.id && p.userId !== (currentUser as any)?._id) {
        list.push({ _id: p.userId, name: p.name });
      }
    });
    return list;
  }, [currentUser, peers]);

  const totalParticipants = 1 + peers.length;
  const [pinnedTileIds, setPinnedTileIds] = useState<Set<string>>(new Set());

  const togglePin = useCallback((tileId: string) => {
    setPinnedTileIds((prev) => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId);
      else next.add(tileId);
      return next;
    });
  }, []);

  const meetingTiles = useMemo(() => {
    const selfTile = {
      id: screenStream ? "self-screen-share" : "self-camera",
      stream: screenStream || localStream,
      name: currentUser?.name,
      profileImage: currentUser?.profileImage || null,
      muted: true,
      isSelf: true,
      isScreenShare: !!screenStream,
      speaking: false,
    };
    const peerTiles = peers.map((peer) => ({
      id: `peer-${peer.socketId}`,
      stream: peer.stream,
      name: peer.name,
      profileImage: peer.profileImage,
      muted: false,
      isSelf: false,
      isScreenShare: peer.isScreenShare,
      speaking: false,
    }));
    const allTiles = [selfTile, ...peerTiles];
    return allTiles.sort((a, b) => {
      const aPinned = pinnedTileIds.has(a.id);
      const bPinned = pinnedTileIds.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      if (a.isScreenShare !== b.isScreenShare) return a.isScreenShare ? -1 : 1;
      return 0;
    });
  }, [screenStream, localStream, currentUser?.name, currentUser?.profileImage, peers, pinnedTileIds]);

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
            <Icon icon={isFullscreen ? MinimizeScreenIcon : FullScreenIcon} size={16} />
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
                        placeholder={isHost ? "Type a note, decision, or action item..." : "Type a note or parking-lot item..."}
                        value={activeNote}
                        onChange={(e) => setActiveNote(e.target.value)}
                      ></textarea>
                      <div className="focus-note-actions">
                        {isHost && <button className="focus-note-btn" onClick={() => handleAddActionItem('Technical')}>+ Technical</button>}
                        {isHost && <button className="focus-note-btn" onClick={() => handleAddActionItem('Decision')}>+ Decision</button>}
                        {isHost && <button className="focus-note-btn" onClick={() => handleAddActionItem('Follow-up')}>+ Follow-up</button>}
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
                    <div className="focus-section-label">Action Items · {actionItems.length}</div>
                    <div className="focus-action-feed">
                      {actionItems.length === 0 ? (
                        <div className="focus-empty-state">No action items captured yet</div>
                      ) : (
                        actionItems.map((ai, idx) => (
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
                  <p style={{ color: 'var(--danger, #ef4444)', fontSize: '0.875rem', textAlign: 'center', marginBottom: '0.5rem' }}>{mediaError}</p>
                )}
                <div className="prejoin-avatar">
                  {currentUser?.profileImage ? (
                    <img
                      src={`${SERVER_BASE}${currentUser.profileImage}`}
                      alt=""
                      className="prejoin-avatar-img"
                    />
                  ) : (
                    <span>{currentUser?.name?.charAt(0)?.toUpperCase() || "U"}</span>
                  )}
                </div>
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
                <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', borderRadius: '0.375rem', marginBottom: '0.375rem', textAlign: 'center' }}>
                  {mediaError}
                </div>
              )}
              <div className="video-grid">
                {meetingTiles.map((tile) => (
                  <VideoTile
                    key={tile.id}
                    tileId={tile.id}
                    stream={tile.stream}
                    name={tile.name}
                    profileImage={tile.profileImage}
                    muted={tile.muted}
                    isSelf={tile.isSelf}
                    isScreenShare={tile.isScreenShare}
                    speaking={tile.speaking}
                    pinned={pinnedTileIds.has(tile.id)}
                    onTogglePin={togglePin}
                  />
                ))}
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
        modality={modality}
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        screenSharing={!!screenStream}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
        onLeave={handleLeave}
        hasJoined={hasJoined}
        onMeetingEnded={onMeetingEnded}
        isHost={isHost}
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
      />

      <style>{`
        .video-area {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary);
          border: 0.0625rem solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
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
          width: 5rem;
          height: 5rem;
          border-radius: 50%;
          background: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          font-weight: 700;
          color: white;
          overflow: hidden;
        }
        .prejoin-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
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
          background: color-mix(in srgb, var(--primary) 25%, rgba(255,255,255,0.25));
          border: 0.0625rem solid color-mix(in srgb, var(--primary) 70%, rgba(255,255,255,0.5));
          color: rgba(255,255,255,0.95);
          box-shadow: 0 0.0625rem 0 rgba(0,0,0,0.15);
        }

        /* Video grid */
        .video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
          grid-template-rows: minmax(0, 1fr);
          grid-auto-rows: minmax(0, 1fr);
          grid-auto-flow: dense;
          gap: 0.5rem;
          width: 100%;
          height: 100%;
          align-content: start;
          overflow-y: auto;
          padding-right: 0.125rem;
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
          transition: border-color 0.3s;
          width: 100%;
          min-height: 0;
        }
        .video-tile.pinned,
        .video-tile.screen-share {
          grid-column: span 2;
          grid-row: span 2;
        }
        .video-tile.screen-share {
          min-height: 20rem;
        }
        .video-tile-pin {
          position: absolute;
          top: 0.5rem;
          left: 0.5rem;
          z-index: 3;
          padding: 0.1875rem 0.45rem;
          border: 0.0625rem solid rgba(255, 255, 255, 0.25);
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.55);
          color: #fff;
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
        .video-tile.speaking {
          border-color: var(--primary);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent);
        }
        .video-tile-video {
          width: 100%;
          height: 100%;
          object-fit: contain;
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
        .video-tile-avatar {
          width: 3.5rem;
          height: 3.5rem;
          border-radius: 50%;
          background: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.375rem;
          font-weight: 700;
          color: white;
          overflow: hidden;
        }
        .video-tile-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .video-tile-name {
          position: absolute;
          bottom: 0.5rem;
          left: 0.5rem;
          padding: 0.1875rem 0.5rem;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: #fff;
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
          color: white;
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
          color: white;
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
          background: #ef4444;
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
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
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
        .focus-ai-num.active { background: var(--primary); color: white; border-color: var(--primary); }
        .focus-ai-num.completed { background: var(--accent-emerald); color: white; border-color: var(--accent-emerald); }

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
        .focus-note-btn.primary { background: var(--primary); color: white; border-color: var(--primary); }

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
        .focus-ctrl-btn.next { background: var(--primary); color: white; border-color: var(--primary); }

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
          color: white;
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
          background: rgba(239, 159, 39, 0.05);
          border: 1px solid rgba(239, 159, 39, 0.2);
          border-radius: var(--radius-md);
          padding: 0.75rem;
        }
        .focus-pl-title { font-size: 0.75rem; font-weight: 600; color: #ef9f27; margin-bottom: 0.25rem; }
        .focus-pl-item { font-size: 0.75rem; padding: 0.25rem 0; border-bottom: 1px solid rgba(239, 159, 39, 0.1); }
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
