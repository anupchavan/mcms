import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
    Room,
    RoomEvent,
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    Participant,
    Track,
    LocalVideoTrack,
    LocalAudioTrack,
    ConnectionState,
    createLocalVideoTrack,
    createLocalAudioTrack,
} from 'livekit-client';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
const SERVER_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5001');

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
    const [localTracks, setLocalTracks] = useState<(LocalVideoTrack | LocalAudioTrack)[]>([]);

    const roomRef = useRef<Room | null>(null);

    // Initialize local tracks for preview
    useEffect(() => {
        async function initLocal() {
            try {
                const tracks = await Promise.all([
                    createLocalVideoTrack({ resolution: { width: 1280, height: 720 } }),
                    createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true })
                ]);
                setLocalTracks(tracks);
            } catch (err: any) {
                console.warn('Failed to get local tracks for preview:', err);
                setMediaError(err.message || 'Media access failed');
            }
        }
        initLocal();
        return () => {
            localTracks.forEach(t => t.stop());
        };
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

    const screenStream = useMemo(() => {
        if (!room) return null;
        const v = (room.localParticipant as any).getTrackPublication(Track.Source.ScreenShare)?.track;
        if (v?.mediaStreamTrack) {
            const s = new MediaStream();
            s.addTrack(v.mediaStreamTrack);
            return s;
        }
        return null;
    }, [room]);

    const joinRoom = useCallback(async (): Promise<boolean> => {
        if (!meetingId || isJoined) return false;
        setMediaError(null);

        try {
            const userStr = localStorage.getItem('mcms_userInfo');
            const tokenHeader = userStr ? JSON.parse(userStr).token : '';
            
            const res = await fetch(`${SERVER_BASE}/api/meetings/${meetingId}/token`, {
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

            // Publish existing local tracks
            for (const track of localTracks) {
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
            return false;
        }
    }, [meetingId, isJoined, localTracks]);

    const leaveRoom = useCallback(() => {
        if (roomRef.current) {
            roomRef.current.disconnect();
            roomRef.current = null;
            setRoom(null);
            setIsJoined(false);
            setParticipants([]);
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
