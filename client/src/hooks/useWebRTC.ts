import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    Room,
    RoomEvent,
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    Participant,
    Track,
    LocalTrack,
    ConnectionState,
    createLocalTracks,
} from 'livekit-client';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
// `VITE_API_URL` already includes `/api` in dev (.env.local). Normalise so
// the base always ends in `/api`, matching the convention used in
// `MeetingCreation.tsx`. Without this, building paths as `${SERVER_BASE}/api/...`
// would produce `/api/api/...` and 404 — see debug-4a1cc5.log H2.
const _rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const API_BASE = _rawApiUrl.endsWith('/api') ? _rawApiUrl : `${_rawApiUrl}/api`;

export interface PeerState {
    socketId: string; // for backward compatibility, will use identity
    userId: string | null;
    name: string;
    profileImage: string | null;
    stream: MediaStream;
}

export default function useWebRTC(
    socket: any, // not strictly needed for LiveKit media, but kept for interface compatibility
    meetingId: string | null,
    currentUser: { _id?: string; name?: string; profileImage?: string | null } | null
) {
    const [room, setRoom] = useState<Room | null>(null);
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [isJoined, setIsJoined] = useState(false);
    const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);

    const roomRef = useRef<Room | null>(null);
    // Mirror of `localTracks` for use inside cleanups / async paths where the
    // captured state would otherwise be stale (e.g. the initial-mount cleanup
    // closure captures the empty array, never stopping the tracks created
    // afterwards — that left the camera light on after Leave/End).
    const localTracksRef = useRef<LocalTrack[]>([]);
    useEffect(() => { localTracksRef.current = localTracks; }, [localTracks]);

    // Acquire camera + mic in a SINGLE getUserMedia call so the browser shows
    // ONE combined permission prompt instead of one prompt per device — same
    // behaviour as Google Meet. (LiveKit's `createLocalTracks` is documented
    // to merge constraints; calling `createLocalVideoTrack` + `createLocalAudioTrack`
    // separately produces two prompts.)
    //
    // Note: this is intentionally NOT called on mount. We defer the
    // permission prompt until the user clicks "Join" (see `joinRoom` below)
    // so simply opening the meeting page never asks for camera/mic.
    const acquireLocalTracks = useCallback(async () => {
        const tracks = await createLocalTracks({
            video: { resolution: { width: 1280, height: 720 } },
            audio: { echoCancellation: true, noiseSuppression: true },
        });
        setLocalTracks(tracks);
        localTracksRef.current = tracks;
        return tracks;
    }, []);

    // Map LiveKit participants to PeerState for VideoArea compatibility
    const peers = useMemo(() => {
        return Array.from(participants).map((p) => {
            const videoTrack = (p as any).getTrackPublication(Track.Source.Camera)?.track;
            const audioTrack = (p as any).getTrackPublication(Track.Source.Microphone)?.track;
            
            const stream = new MediaStream();
            if (videoTrack?.mediaStreamTrack) stream.addTrack(videoTrack.mediaStreamTrack);
            if (audioTrack?.mediaStreamTrack) stream.addTrack(audioTrack.mediaStreamTrack);

            return {
                socketId: p.identity,
                userId: p.identity,
                name: p.name || 'User',
                profileImage: null,
                stream,
            };
        });
    }, [participants]);

    const localStream = useMemo(() => {
        const stream = new MediaStream();
        localTracks.forEach(t => {
            if (t.mediaStreamTrack) stream.addTrack(t.mediaStreamTrack);
        });
        return stream;
    }, [localTracks]);

    // Screen share is exposed as state (not useMemo) because publishing /
    // unpublishing a screen-share track does NOT change the `Room` object
    // reference — so a memo with `[room]` deps would never re-run after
    // the user toggles share. Instead we listen for the room's local
    // track publish/unpublish events and recompute on each.
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    useEffect(() => {
        if (!room) { setScreenStream(null); return; }
        const recompute = () => {
            const pub = (room.localParticipant as any).getTrackPublication(Track.Source.ScreenShare);
            const mst = pub?.track?.mediaStreamTrack;
            if (mst) {
                const s = new MediaStream();
                s.addTrack(mst);
                setScreenStream(s);
            } else {
                setScreenStream(null);
            }
        };
        recompute();
        room.on(RoomEvent.LocalTrackPublished, recompute);
        room.on(RoomEvent.LocalTrackUnpublished, recompute);
        return () => {
            room.off(RoomEvent.LocalTrackPublished, recompute);
            room.off(RoomEvent.LocalTrackUnpublished, recompute);
        };
    }, [room]);

    const joinRoom = useCallback(async (): Promise<boolean> => {
        if (!meetingId || isJoined) return false;
        setMediaError(null);

        // 1) Prompt for camera + mic FIRST so the browser permission dialog
        //    appears immediately on the user's Join click — not after a
        //    token fetch / LiveKit handshake. If they deny, we never enter
        //    the meeting; the prejoin screen shows the error + a Try Again
        //    button (see `mediaError` rendering in VideoArea).
        let tracksToPublish = localTracksRef.current;
        if (tracksToPublish.length === 0) {
            try {
                tracksToPublish = await acquireLocalTracks();
            } catch (err: any) {
                console.warn('Failed to acquire local tracks at join:', err);
                setMediaError(err.message || 'Camera/mic access denied');
                return false;
            }
        }

        try {
            const userStr = localStorage.getItem('mcms_userInfo');
            const tokenHeader = userStr ? JSON.parse(userStr).token : '';
            
            const res = await fetch(`${API_BASE}/meetings/${meetingId}/token`, {
                headers: { 'Authorization': `Bearer ${tokenHeader}` }
            });
            
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || 'Failed to get LiveKit token');
            }
            
            const { token } = await res.json();

            const newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
            });
            
            roomRef.current = newRoom;
            setRoom(newRoom);

            await newRoom.connect(LIVEKIT_URL, token);
            setIsJoined(true);

            for (const track of tracksToPublish) {
                await newRoom.localParticipant.publishTrack(track);
            }

            const updateParticipants = () => {
                setParticipants(Array.from(newRoom.remoteParticipants.values()));
            };

            newRoom
                .on(RoomEvent.ParticipantConnected, updateParticipants)
                .on(RoomEvent.ParticipantDisconnected, updateParticipants)
                .on(RoomEvent.TrackSubscribed, updateParticipants)
                .on(RoomEvent.TrackUnsubscribed, updateParticipants);

            updateParticipants();
            return true;
        } catch (err: any) {
            console.error('LiveKit join error:', err);
            setMediaError(err.message || 'Failed to join meeting');
            // Connection failed after we acquired media — release the
            // camera/mic so the macOS green dot doesn't linger.
            tracksToPublish.forEach(t => { try { t.stop(); } catch { /* ignore */ } });
            localTracksRef.current = [];
            setLocalTracks([]);
            return false;
        }
    }, [meetingId, isJoined, acquireLocalTracks]);

    const leaveRoom = useCallback(async () => {
        // 1) Stop our locally-created camera + mic tracks IMMEDIATELY so the
        //    green macOS camera dot / mic indicator turn off without waiting
        //    on the LiveKit disconnect handshake. `LocalTrack.stop()` ends the
        //    underlying MediaStreamTrack we own.
        localTracksRef.current.forEach(t => { try { t.stop(); } catch { /* ignore */ } });
        localTracksRef.current = [];

        const r = roomRef.current;
        if (r) {
            // 2) Disable screen share so the browser's screen-share capture
            //    indicator (and OS recording icon) is released. Safe to call
            //    even if not currently sharing.
            try { await r.localParticipant.setScreenShareEnabled(false); }
            catch { /* ignore — may already be off / disconnected */ }

            // 3) Disconnect from the room — this also unpublishes everything.
            try { await r.disconnect(); } catch { /* ignore */ }
            roomRef.current = null;
        }

        setLocalTracks([]);
        setRoom(null);
        setIsJoined(false);
        setParticipants([]);
        setScreenStream(null);
        setAudioEnabled(true);
        setVideoEnabled(true);
    }, []);

    const toggleAudio = useCallback(async () => {
        const enabled = !audioEnabled;
        localTracks.forEach(t => {
            if (t.kind === Track.Kind.Audio) (t as any).mediaStreamTrack.enabled = enabled;
        });
        setAudioEnabled(enabled);
    }, [localTracks, audioEnabled]);

    const toggleVideo = useCallback(async () => {
        const enabled = !videoEnabled;
        localTracks.forEach(t => {
            if (t.kind === Track.Kind.Video) (t as any).mediaStreamTrack.enabled = enabled;
        });
        setVideoEnabled(enabled);
    }, [localTracks, videoEnabled]);

    const toggleScreenShare = useCallback(async () => {
        if (!room) return;
        const isSharing = !!(room.localParticipant as any).getTrackPublication(Track.Source.ScreenShare);
        await room.localParticipant.setScreenShareEnabled(!isSharing);
    }, [room]);

    useEffect(() => {
        return () => { leaveRoom(); };
    }, [leaveRoom]);

    return {
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
        joined: isJoined,
    };
}
