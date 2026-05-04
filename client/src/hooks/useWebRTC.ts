import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    Room,
    RoomEvent,
    RemoteParticipant,
    Track,
    LocalTrack,
    createLocalTracks,
    VideoPresets,
    ScreenSharePresets,
    type LocalVideoTrack,
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
    /** When false, mute this `<video>` so mic/system audio is not played twice (camera + screen tiles). */
    playRemoteAudio?: boolean;
    /** True when the participant's microphone is muted (as signalled by LiveKit). */
    audioMuted?: boolean;
    /** True when LiveKit's VAD reports this participant is actively speaking. */
    speaking?: boolean;
    /** True when the participant's camera track is muted (as signalled by LiveKit). */
    videoMuted?: boolean;
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
    /** Set of participant identities currently speaking (VAD from LiveKit). */
    const [activeSpeakerIds, setActiveSpeakerIds] = useState<Set<string>>(new Set());
    /** Identity of the local participant once connected. */
    const [localIdentity, setLocalIdentity] = useState<string | null>(null);

    const roomRef = useRef<Room | null>(null);
    // Mirror of `localTracks` for use inside cleanups / async paths where the
    // captured state would otherwise be stale (e.g. the unmount cleanup
    // closure capturing an empty array, never stopping the tracks created
    // afterwards — that left the camera light on after Leave/End).
    const localTracksRef = useRef<LocalTrack[]>([]);
    useEffect(() => { localTracksRef.current = localTracks; }, [localTracks]);

    /** One or two tiles per remote participant when they present screen + camera. */
    const getParticipantVideoTiles = useCallback((participant: RemoteParticipant): PeerState[] => {
        const screenVideoTrack = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
        const cameraVideoTrack = participant.getTrackPublication(Track.Source.Camera)?.track;
        const screenAudioTrack = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
        const microphoneTrack = participant.getTrackPublication(Track.Source.Microphone)?.track;

        const identity = participant.identity;
        const name = participant.name || 'User';
        const hasScreen = !!screenVideoTrack?.mediaStreamTrack;
        const hasCamera = !!cameraVideoTrack?.mediaStreamTrack;
        const camPub = participant.getTrackPublication(Track.Source.Camera);
        const camMuted = camPub?.isMuted ?? false;
        // #region agent log
        console.log('[dbg:getParticipantVideoTiles] new streams for', identity, 'hasCamera:', hasCamera, 'hasScreen:', hasScreen);
        // #endregion
        const tiles: PeerState[] = [];

        if (hasScreen) {
            const stream = new MediaStream();
            stream.addTrack(screenVideoTrack!.mediaStreamTrack!);
            const audio = screenAudioTrack?.mediaStreamTrack ?? microphoneTrack?.mediaStreamTrack;
            if (audio) stream.addTrack(audio);
            tiles.push({
                socketId: `${identity}__screen`,
                userId: identity,
                name,
                profileImage: null,
                stream,
                isScreenShare: true,
                playRemoteAudio: true,
            });
        }

        if (hasCamera) {
            const stream = new MediaStream();
            stream.addTrack(cameraVideoTrack!.mediaStreamTrack!);
            if (!hasScreen && microphoneTrack?.mediaStreamTrack) {
                stream.addTrack(microphoneTrack.mediaStreamTrack);
            }
            tiles.push({
                socketId: `${identity}__camera`,
                userId: identity,
                name,
                profileImage: null,
                stream,
                isScreenShare: false,
                playRemoteAudio: !hasScreen,
                videoMuted: camMuted,
            });
        }

        if (!hasScreen && !hasCamera && microphoneTrack?.mediaStreamTrack) {
            const stream = new MediaStream();
            stream.addTrack(microphoneTrack.mediaStreamTrack);
            tiles.push({
                socketId: `${identity}__camera`,
                userId: identity,
                name,
                profileImage: null,
                stream,
                isScreenShare: false,
                playRemoteAudio: true,
                videoMuted: true,
            });
        }

        return tiles;
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
    //
    // Capture 1080p when the camera supports it. The publish path simulcasts
    // down so receivers on poor uplinks still see a track — adaptiveStream +
    // dynacast (in `joinRoom`) drop the high layer when nobody is rendering
    // at a size that needs it, so requesting 1080p costs nothing for small
    // tile use-cases. If the device caps out below 1080p the browser
    // negotiates the next-best resolution automatically (the
    // `min`/`ideal` form below); we don't want a hard 1080p constraint to
    // make `getUserMedia` reject on low-end webcams.
    const acquireLocalTracks = useCallback(async () => {
        const tracks = await createLocalTracks({
            video: {
                resolution: VideoPresets.h1080.resolution,
                // Mild constraint hints: ideal 1080p, fall back gracefully.
                // Most modern webcams report 1080p@30. If a device only
                // exposes 720p, we still get the best it can give.
                facingMode: 'user',
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                // 48 kHz mono is what WebRTC's Opus encoder targets anyway;
                // making it explicit avoids drivers picking 16 kHz.
                sampleRate: 48000,
                channelCount: 1,
            },
        });
        setLocalTracks(tracks);
        localTracksRef.current = tracks;
        return tracks;
    }, []);

    const peers = useMemo(() => {
        // #region agent log
        console.log('[dbg:peers-memo POST-FIX] rebuilding — participants:', participants.length);
        // #endregion
        return Array.from(participants).flatMap((p) => {
            const tiles = getParticipantVideoTiles(p);
            const micPub = p.getTrackPublication(Track.Source.Microphone);
            const isAudioMuted = micPub ? micPub.isMuted : true;
            // speaking is intentionally NOT computed here — activeSpeakerIds must
            // not be a dependency of this memo or every VAD event rebuilds streams
            return tiles.map((tile) => ({ ...tile, audioMuted: isAudioMuted }));
        });
    }, [getParticipantVideoTiles, participants]);

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

            // ── Quality-tuned room options ──────────────────────────────
            // - adaptiveStream: SFU sends the lowest simulcast layer that
            //   matches the rendered <video> size, so we can ship 1080p
            //   without burning CPU/bandwidth on hidden tiles.
            // - dynacast: when nobody is subscribing to a layer (e.g. all
            //   viewers are in a small filmstrip), pause encoding it.
            // - publishDefaults: the *real* lever for visible quality.
            //     • videoCodec 'vp9' delivers ~30-50% better quality at the
            //       same bitrate vs vp8 and works in Chrome / Edge / Firefox
            //       / Safari 16+. We keep VP8 as a backupCodec so any
            //       receiver that can't decode VP9 still gets a stream.
            //     • videoEncoding bumps the camera ceiling to ~3 Mbps@1080p
            //       (LiveKit's default for 720p is ~1.7 Mbps).
            //     • screenShareEncoding uses the 1080p@30 preset — text
            //       and UI scrolling stay sharp instead of the 5–15 fps
            //       you'd get from defaults.
            //     • simulcastVideo layers: one extra 360p rung so
            //       small filmstrip tiles can fall back without us
            //       sending a single fat 1080p stream to everyone.
            const newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
                videoCaptureDefaults: {
                    resolution: VideoPresets.h1080.resolution,
                },
                publishDefaults: {
                    videoCodec: 'vp9',
                    backupCodec: { codec: 'vp8', encoding: VideoPresets.h720.encoding },
                    videoEncoding: VideoPresets.h1080.encoding,
                    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
                    simulcast: true,
                    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
                    // Opus extras — meaningful audio quality bump for free:
                    //   red:  packet redundancy → resilient to packet loss
                    //   dtx:  discontinuous transmission → silence isn't sent
                    red: true,
                    dtx: true,
                    stopMicTrackOnMute: false,
                },
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
                setActiveSpeakerIds(new Set(newRoom.activeSpeakers.map((s) => s.identity)));
            };

            setLocalIdentity(newRoom.localParticipant.identity);

            newRoom
                .on(RoomEvent.ParticipantConnected, syncRoomState)
                .on(RoomEvent.ParticipantDisconnected, syncRoomState)
                .on(RoomEvent.TrackSubscribed, syncRoomState)
                .on(RoomEvent.TrackUnsubscribed, syncRoomState)
                .on(RoomEvent.TrackPublished, syncRoomState)
                .on(RoomEvent.TrackUnpublished, syncRoomState)
                .on(RoomEvent.LocalTrackPublished, syncRoomState)
                .on(RoomEvent.LocalTrackUnpublished, syncRoomState)
                .on(RoomEvent.TrackMuted, (_pub, _participant) => { syncRoomState(); })
                .on(RoomEvent.TrackUnmuted, (_pub, _participant) => { syncRoomState(); })
                .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
                    // #region agent log
                    console.log('[dbg:ActiveSpeakersChanged]', speakers.length, 'speakers:', speakers.map(s=>s.identity));
                    // #endregion
                    setActiveSpeakerIds(new Set(speakers.map((s) => s.identity)));
                });

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
        setActiveSpeakerIds(new Set());
        setLocalIdentity(null);
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
        await Promise.all(localTracks.map(async (t) => {
            if (t.kind === Track.Kind.Video) {
                if (enabled) await t.unmute();
                else await t.mute();
            }
        }));
        setVideoEnabled(enabled);
    }, [localTracks, videoEnabled]);

    /**
     * Hint the encoder/SFU that this is a UI/text source so it preserves
     * spatial detail at the cost of frame rate when bandwidth is tight.
     * Without this, screen shares of code/docs go soft when the encoder
     * decides to spend the bit budget on motion smoothness instead.
     * Use 'detail' (rather than 'text') because Chromium maps 'detail' to
     * the same path while remaining standardised across browsers.
     */
    const applyScreenShareContentHint = useCallback((activeRoom: Room) => {
        const pub = activeRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        const track = pub?.track as LocalVideoTrack | undefined;
        const mst = track?.mediaStreamTrack;
        if (mst && 'contentHint' in mst) {
            try { (mst as any).contentHint = 'detail'; } catch { /* ignore */ }
        }
    }, []);

    const toggleScreenShare = useCallback(async () => {
        const activeRoom = roomRef.current;
        if (!activeRoom) return;

        setMediaError(null);

        try {
            const isSharing = activeRoom.localParticipant.isScreenShareEnabled;
            if (!isSharing) {
                await activeRoom.localParticipant.setScreenShareEnabled(true, {
                    audio: screenShareSystemAudio,
                    // Capture the full source resolution; the publish-side
                    // encoder (set in `publishDefaults.screenShareEncoding`)
                    // is what actually controls bitrate / frame rate.
                    resolution: ScreenSharePresets.h1080fps30.resolution,
                    // contentHint is also passed in capture options so the
                    // browser's screen-share permission picker / capturer
                    // knows it's UI content.
                    contentHint: 'detail',
                });
                applyScreenShareContentHint(activeRoom);
            } else {
                await activeRoom.localParticipant.setScreenShareEnabled(false);
            }
            syncLocalScreenShare(activeRoom);
        } catch (err: any) {
            console.error('Screen share toggle failed:', err);
            setMediaError(err?.message || 'Screen sharing failed');
        }
    }, [syncLocalScreenShare, screenShareSystemAudio, applyScreenShareContentHint]);

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
                        resolution: ScreenSharePresets.h1080fps30.resolution,
                        contentHint: 'detail',
                    });
                    applyScreenShareContentHint(activeRoom);
                    syncLocalScreenShare(activeRoom);
                } catch (err: any) {
                    console.error('Screen share audio preference failed:', err);
                    setMediaError(err?.message || 'Could not update presentation audio');
                }
            })();
        },
        [syncLocalScreenShare, applyScreenShareContentHint],
    );

    useEffect(() => {
        return () => { leaveRoom(); };
    }, [leaveRoom]);

    /** True when LiveKit's VAD detects the local user is currently speaking. */
    const localSpeaking = localIdentity ? activeSpeakerIds.has(localIdentity) : false;

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
        localSpeaking,
        activeSpeakerIds,
    };
}
