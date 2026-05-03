import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    Room,
    RoomEvent,
    RemoteParticipant,
    Track,
    LocalTrack,
    createLocalTracks,
} from 'livekit-client';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
// `VITE_API_URL` already includes `/api` in dev (.env.local). Normalise so
// the base always ends in `/api`. Without this, building paths as
// `${API_BASE}/meetings/...` could land on `/api/api/...` and 404.
const _rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const API_BASE = _rawApiUrl.endsWith('/api') ? _rawApiUrl : `${_rawApiUrl}/api`;

export interface PeerState {
    socketId: string;
    userId: string | null;
    name: string;
    profileImage: string | null;
    stream: MediaStream;
    isScreenShare: boolean;
}

export default function useWebRTC(
    socket: any,
    meetingId: string | null,
    currentUser: { _id?: string; name?: string; profileImage?: string | null } | null
) {
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [isJoined, setIsJoined] = useState(false);
    const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
    /** When starting screen share, pass through to `getDisplayMedia` / LiveKit (`audio: …`). */
    const [screenShareSystemAudio, setScreenShareSystemAudio] = useState(false);

    const roomRef = useRef<Room | null>(null);
    // Mirror of `localTracks` for use inside cleanups / async paths where the
    // captured state would otherwise be stale (e.g. the unmount cleanup
    // closure capturing an empty array, never stopping the tracks created
    // afterwards — that left the camera light on after Leave/End).
    const localTracksRef = useRef<LocalTrack[]>([]);
    useEffect(() => { localTracksRef.current = localTracks; }, [localTracks]);

    const getParticipantStream = useCallback((participant: RemoteParticipant) => {
        const screenVideoTrack = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
        const cameraVideoTrack = participant.getTrackPublication(Track.Source.Camera)?.track;
        const screenAudioTrack = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
        const microphoneTrack = participant.getTrackPublication(Track.Source.Microphone)?.track;

        const stream = new MediaStream();
        const activeVideoTrack = screenVideoTrack ?? cameraVideoTrack;
        const activeAudioTrack = screenVideoTrack ? (screenAudioTrack ?? microphoneTrack) : microphoneTrack;

        if (activeVideoTrack?.mediaStreamTrack) stream.addTrack(activeVideoTrack.mediaStreamTrack);
        if (activeAudioTrack?.mediaStreamTrack) stream.addTrack(activeAudioTrack.mediaStreamTrack);

        return {
            stream,
            isScreenShare: !!screenVideoTrack,
        };
    }, []);

    const syncLocalScreenShare = useCallback((activeRoom: Room | null) => {
        if (!activeRoom) {
            setScreenStream(null);
            return;
        }

        const screenVideoTrack = activeRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
        const screenAudioTrack = activeRoom.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;

        if (!screenVideoTrack?.mediaStreamTrack) {
            setScreenStream(null);
            return;
        }

        const stream = new MediaStream();
        stream.addTrack(screenVideoTrack.mediaStreamTrack);
        if (screenAudioTrack?.mediaStreamTrack) stream.addTrack(screenAudioTrack.mediaStreamTrack);
        setScreenStream(stream);
    }, []);

    // Acquire camera + mic in a SINGLE getUserMedia call so the browser shows
    // ONE combined permission prompt instead of one per device — same
    // behaviour as Google Meet. (LiveKit's `createLocalTracks` merges
    // constraints; calling `createLocalVideoTrack` + `createLocalAudioTrack`
    // separately produces two prompts.)
    //
    // Intentionally NOT called on mount. The prompt is deferred until the
    // user clicks "Join" (see `joinRoom` below), so opening the meeting
    // page never asks for camera/mic.
    const acquireLocalTracks = useCallback(async () => {
        const tracks = await createLocalTracks({
            video: { resolution: { width: 1280, height: 720 } },
            audio: { echoCancellation: true, noiseSuppression: true },
        });
        setLocalTracks(tracks);
        localTracksRef.current = tracks;
        return tracks;
    }, []);

    const peers = useMemo(() => {
        return Array.from(participants).map((p) => {
            const { stream, isScreenShare } = getParticipantStream(p);

            return {
                socketId: p.identity,
                userId: p.identity,
                name: p.name || 'User',
                profileImage: null,
                stream,
                isScreenShare,
            };
        });
    }, [getParticipantStream, participants]);

    const localStream = useMemo(() => {
        const stream = new MediaStream();
        localTracks.forEach(t => {
            if (t.mediaStreamTrack) stream.addTrack(t.mediaStreamTrack);
        });
        return stream;
    }, [localTracks]);

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
                setMediaError(err?.message || 'Camera/mic access denied');
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

            await newRoom.connect(LIVEKIT_URL, token);
            setIsJoined(true);

            for (const track of tracksToPublish) {
                await newRoom.localParticipant.publishTrack(track);
            }

            const syncRoomState = () => {
                setParticipants(Array.from(newRoom.remoteParticipants.values()));
                syncLocalScreenShare(newRoom);
            };

            newRoom
                .on(RoomEvent.ParticipantConnected, syncRoomState)
                .on(RoomEvent.ParticipantDisconnected, syncRoomState)
                .on(RoomEvent.TrackSubscribed, syncRoomState)
                .on(RoomEvent.TrackUnsubscribed, syncRoomState)
                .on(RoomEvent.TrackPublished, syncRoomState)
                .on(RoomEvent.TrackUnpublished, syncRoomState)
                .on(RoomEvent.LocalTrackPublished, syncRoomState)
                .on(RoomEvent.LocalTrackUnpublished, syncRoomState);

            syncRoomState();
            return true;
        } catch (err: any) {
            console.error('LiveKit join error:', err);
            setMediaError(err?.message || 'Failed to join meeting');
            // Connection failed after we acquired media — release the
            // camera/mic so the macOS green dot doesn't linger.
            tracksToPublish.forEach(t => { try { t.stop(); } catch { /* ignore */ } });
            localTracksRef.current = [];
            setLocalTracks([]);
            roomRef.current = null;
            return false;
        }
    }, [meetingId, isJoined, acquireLocalTracks, syncLocalScreenShare]);

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
            //    indicator (and OS recording icon) is released. Safe even if
            //    not currently sharing.
            try { await r.localParticipant.setScreenShareEnabled(false); }
            catch { /* may already be off / disconnected */ }

            // 3) Disconnect from the room — this also unpublishes everything.
            try { await r.disconnect(); } catch { /* ignore */ }
            roomRef.current = null;
        }

        setLocalTracks([]);
        setIsJoined(false);
        setParticipants([]);
        setScreenStream(null);
        setScreenShareSystemAudio(false);
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
        const activeRoom = roomRef.current;
        if (!activeRoom) return;

        setMediaError(null);

        try {
            const isSharing = activeRoom.localParticipant.isScreenShareEnabled;
            if (!isSharing) {
                await activeRoom.localParticipant.setScreenShareEnabled(true, {
                    audio: screenShareSystemAudio,
                });
            } else {
                await activeRoom.localParticipant.setScreenShareEnabled(false);
            }
            syncLocalScreenShare(activeRoom);
        } catch (err: any) {
            console.error('Screen share toggle failed:', err);
            setMediaError(err?.message || 'Screen sharing failed');
        }
    }, [syncLocalScreenShare, screenShareSystemAudio]);

    /** Updates preference; if already presenting, restarts capture so audio tracks match. */
    const setScreenShareSystemAudioPref = useCallback(
        (wantAudio: boolean) => {
            setScreenShareSystemAudio(wantAudio);
            const activeRoom = roomRef.current;
            if (!activeRoom?.localParticipant.isScreenShareEnabled) return;
            void (async () => {
                try {
                    await activeRoom.localParticipant.setScreenShareEnabled(false);
                    await activeRoom.localParticipant.setScreenShareEnabled(true, {
                        audio: wantAudio,
                    });
                    syncLocalScreenShare(activeRoom);
                } catch (err: any) {
                    console.error('Screen share audio preference failed:', err);
                    setMediaError(err?.message || 'Could not update presentation audio');
                }
            })();
        },
        [syncLocalScreenShare],
    );

    useEffect(() => {
        return () => { leaveRoom(); };
    }, [leaveRoom]);

    return {
        localStream,
        peers,
        audioEnabled,
        videoEnabled,
        screenStream,
        screenShareSystemAudio,
        setScreenShareSystemAudioPref,
        mediaError,
        joinRoom,
        leaveRoom,
        toggleAudio,
        toggleVideo,
        toggleScreenShare,
        joined: isJoined,
    };
}
