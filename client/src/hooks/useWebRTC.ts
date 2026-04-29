import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    Room,
    RoomEvent,
    RemoteParticipant,
    Track,
    LocalVideoTrack,
    LocalAudioTrack,
    createLocalVideoTrack,
    createLocalAudioTrack,
} from 'livekit-client';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

export interface PeerState {
    socketId: string; // for backward compatibility, will use identity
    userId: string | null;
    name: string;
    profileImage: string | null;
    stream: MediaStream;
    isScreenShare: boolean;
}

export default function useWebRTC(
    socket: any, // not strictly needed for LiveKit media, but kept for interface compatibility
    meetingId: string | null,
    currentUser: { _id?: string; name?: string; profileImage?: string | null } | null
) {
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [isJoined, setIsJoined] = useState(false);
    const [localTracks, setLocalTracks] = useState<(LocalVideoTrack | LocalAudioTrack)[]>([]);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

    const roomRef = useRef<Room | null>(null);

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

    // Initialize local tracks for preview
    useEffect(() => {
        let createdTracks: (LocalVideoTrack | LocalAudioTrack)[] = [];
        let disposed = false;

        async function initLocal() {
            try {
                const tracks = await Promise.all([
                    createLocalVideoTrack({ resolution: { width: 1280, height: 720 } }),
                    createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true })
                ]);
                createdTracks = tracks;
                if (disposed) {
                    tracks.forEach((track) => track.stop());
                    return;
                }
                setLocalTracks(tracks);
            } catch (err: any) {
                console.warn('Failed to get local tracks for preview:', err);
                setMediaError(err.message || 'Media access failed');
            }
        }
        initLocal();
        return () => {
            disposed = true;
            createdTracks.forEach((track) => track.stop());
        };
    }, []);

    // Map LiveKit participants to PeerState for VideoArea compatibility
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

            // Publish existing local tracks
            for (const track of localTracks) {
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
            setMediaError(err.message || 'Failed to join meeting');
            return false;
        }
    }, [meetingId, isJoined, localTracks, syncLocalScreenShare]);

    const leaveRoom = useCallback(() => {
        if (roomRef.current) {
            try {
                roomRef.current.localParticipant.setScreenShareEnabled(false).catch(() => {});
            } catch (e) {}
            roomRef.current.disconnect(false);
            roomRef.current = null;
            setIsJoined(false);
            setParticipants([]);
            setScreenStream(null);
        }
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
            await activeRoom.localParticipant.setScreenShareEnabled(!isSharing);
            syncLocalScreenShare(activeRoom);
        } catch (err: any) {
            console.error('Screen share toggle failed:', err);
            setMediaError(err?.message || 'Screen sharing failed');
        }
    }, [syncLocalScreenShare]);

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
