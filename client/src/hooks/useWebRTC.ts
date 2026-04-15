import { useEffect, useRef, useState, useCallback } from 'react';

const METERED_API_KEY = import.meta.env.VITE_METERED_API_KEY;
const METERED_APP = import.meta.env.VITE_METERED_APP;

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' },
];

async function getIceServers(): Promise<RTCIceServer[]> {
	if (METERED_API_KEY && METERED_APP) {
		try {
			const res = await fetch(
				`https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
			);
			if (res.ok) return await res.json();
		} catch { }
	}
	return FALLBACK_ICE_SERVERS;
}

export interface PeerInfo {
	userId: string | null;
	name: string;
	profileImage: string | null;
}

export interface PeerEntry {
	pc: RTCPeerConnection;
	info: PeerInfo;
	stream: MediaStream;
}

interface PeerState {
	socketId: string;
	userId: string | null;
	name: string;
	profileImage: string | null;
	stream: MediaStream;
}

export default function useWebRTC(
	socket: any,
	meetingId: string | null,
	currentUser: { _id?: string; name?: string; profileImage?: string | null } | null
) {
	const [peers, setPeers] = useState<PeerState[]>([]);
	const [localStream, setLocalStream] = useState<MediaStream | null>(null);
	const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
	const [videoEnabled, setVideoEnabled] = useState<boolean>(true);
	const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
	const [mediaError, setMediaError] = useState<string | null>(null);

	const peersRef = useRef<Map<string, PeerEntry>>(new Map());
	const iceServersRef = useRef<RTCIceServer[] | null>(null);
	const candidateBufferRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
	const localStreamRef = useRef<MediaStream | null>(null);
	const screenStreamRef = useRef<MediaStream | null>(null);
	const joinedRef = useRef<boolean>(false);

	const updatePeerState = useCallback((remoteSocketId: string, remoteInfo: PeerInfo, remoteStream: MediaStream) => {
		setPeers(prev => {
			const filtered = prev.filter(p => p.socketId !== remoteSocketId);
			return [...filtered, {
				socketId: remoteSocketId,
				userId: remoteInfo.userId,
				name: remoteInfo.name,
				profileImage: remoteInfo.profileImage,
				stream: remoteStream,
			}];
		});
	}, []);

	const createPeerConnection = useCallback((remoteSocketId: string, remoteInfo: PeerInfo, initiator: boolean) => {
		if (peersRef.current.has(remoteSocketId)) {
			const existing = peersRef.current.get(remoteSocketId)!;
			if (remoteInfo.userId && (!existing.info.userId || existing.info.name === 'User')) {
				existing.info = remoteInfo;
				updatePeerState(remoteSocketId, remoteInfo, existing.stream);
			}
			return existing.pc;
		}

		const pc = new RTCPeerConnection({
			iceServers: iceServersRef.current || FALLBACK_ICE_SERVERS,
		});

		if (localStreamRef.current) {
			for (const track of localStreamRef.current.getTracks()) {
				pc.addTrack(track, localStreamRef.current);
			}
		}

		pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
			if (e.candidate && socket) {
				socket.emit('signal', {
					to: remoteSocketId,
					signal: { type: 'candidate', candidate: e.candidate },
				});
			}
		};

		const remoteStream = new MediaStream();
		pc.ontrack = (e: RTCTrackEvent) => {
			for (const track of e.streams[0]?.getTracks() ?? []) {
				if (!remoteStream.getTracks().find(t => t.id === track.id)) {
					remoteStream.addTrack(track);
				}
			}
			const currentInfo = peersRef.current.get(remoteSocketId)?.info || remoteInfo;
			updatePeerState(remoteSocketId, currentInfo, remoteStream);
		};

		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed') {
				removePeer(remoteSocketId);
			}
		};

		peersRef.current.set(remoteSocketId, { pc, info: remoteInfo, stream: remoteStream });
		candidateBufferRef.current.set(remoteSocketId, []);

		updatePeerState(remoteSocketId, remoteInfo, remoteStream);

		if (initiator) {
			pc.createOffer()
				.then(offer => pc.setLocalDescription(offer))
				.then(() => {
					socket.emit('signal', {
						to: remoteSocketId,
						signal: { type: 'offer', sdp: pc.localDescription!.sdp },
					});
				})
				.catch(err => console.error('Offer creation failed:', err));
		}

		return pc;
	}, [socket, updatePeerState, removePeer]);

	const removePeer = useCallback((socketId: string) => {
		const entry = peersRef.current.get(socketId);
		if (entry) {
			entry.pc.close();
			peersRef.current.delete(socketId);
		}
		candidateBufferRef.current.delete(socketId);
		setPeers(prev => prev.filter(p => p.socketId !== socketId));
	}, []);

	const joinRoom = useCallback(async (): Promise<boolean> => {
		if (joinedRef.current) return true;
		setMediaError(null);
		if (!socket) {
			setMediaError('Not connected to server — check your internet connection and reload.');
			return false;
		}
		if (!meetingId) return false;

		iceServersRef.current = await getIceServers();

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
				video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
			});
			localStreamRef.current = stream;
			setLocalStream(stream);
			joinedRef.current = true;

			socket.emit('join_room', {
				meetingId,
				name: currentUser?.name || 'User',
				profileImage: currentUser?.profileImage || null,
			});
			return true;
		} catch (err) {
			const errObj = err as Error;
			console.warn('Camera failed, trying audio-only:', errObj.name, errObj.message);
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: { echoCancellation: true, noiseSuppression: true },
					video: false,
				});
				localStreamRef.current = stream;
				setLocalStream(stream);
				setVideoEnabled(false);
				setMediaError('Camera unavailable — joined with audio only');
				joinedRef.current = true;

				socket.emit('join_room', {
					meetingId,
					name: currentUser?.name || 'User',
					profileImage: currentUser?.profileImage || null,
				});
				return true;
			} catch (audioErr) {
				const audioErrObj = audioErr as Error;
				console.error('Cannot access media devices:', audioErrObj);
				setMediaError(`Cannot access camera or microphone: ${audioErrObj.message}`);
				return false;
			}
		}
	}, [socket, meetingId, currentUser]);

	const leaveRoom = useCallback(() => {
		if (!joinedRef.current) return;
		if (socket && meetingId) socket.emit('leave_room', { meetingId });
		for (const [sid] of peersRef.current) {
			removePeer(sid);
		}
		setPeers([]);
		if (localStreamRef.current) {
			localStreamRef.current.getTracks().forEach(t => t.stop());
			localStreamRef.current = null;
			setLocalStream(null);
		}
		if (screenStreamRef.current) {
			screenStreamRef.current.getTracks().forEach(t => t.stop());
			screenStreamRef.current = null;
			setScreenStream(null);
		}
		joinedRef.current = false;
	}, [socket, meetingId, removePeer]);

	const toggleAudio = useCallback(() => {
		if (!localStreamRef.current) return;
		const audioTrack = localStreamRef.current.getAudioTracks()[0];
		if (audioTrack) {
			audioTrack.enabled = !audioTrack.enabled;
			setAudioEnabled(audioTrack.enabled);
		}
	}, []);

	const toggleVideo = useCallback(() => {
		if (!localStreamRef.current) return;
		const videoTrack = localStreamRef.current.getVideoTracks()[0];
		if (videoTrack) {
			videoTrack.enabled = !videoTrack.enabled;
			setVideoEnabled(videoTrack.enabled);
		}
	}, []);

	const toggleScreenShare = useCallback(async () => {
		if (screenStreamRef.current) {
			screenStreamRef.current.getTracks().forEach(t => t.stop());
			screenStreamRef.current = null;
			setScreenStream(null);
			const camTrack = localStreamRef.current?.getVideoTracks()[0];
			if (camTrack) {
				for (const [, { pc }] of peersRef.current) {
					const sender = pc.getSenders().find(s => s.track?.kind === 'video');
					if (sender) sender.replaceTrack(camTrack);
				}
			}
			return;
		}
		try {
			const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
			screenStreamRef.current = screen;
			setScreenStream(screen);
			const screenTrack = screen.getVideoTracks()[0];
			for (const [, { pc }] of peersRef.current) {
				const sender = pc.getSenders().find(s => s.track?.kind === 'video');
				if (sender) sender.replaceTrack(screenTrack);
			}
			screenTrack.onended = () => {
				screenStreamRef.current = null;
				setScreenStream(null);
				const camTrack = localStreamRef.current?.getVideoTracks()[0];
				if (camTrack) {
					for (const [, { pc }] of peersRef.current) {
						const sender = pc.getSenders().find(s => s.track?.kind === 'video');
						if (sender) sender.replaceTrack(camTrack);
					}
				}
			};
		} catch (err) {
			console.error('Screen share failed:', err);
		}
	}, []);

	useEffect(() => {
		if (!socket) return;
		const handleRoomPeers = async ({ peers: existingPeers }: { peers: (PeerInfo & { socketId: string })[] }) => {
			if (!iceServersRef.current) iceServersRef.current = await getIceServers();
			for (const peer of existingPeers) createPeerConnection(peer.socketId, peer, true);
		};
		const handlePeerJoined = async ({ socketId, userId, name, profileImage }: { socketId: string; userId: string | null; name: string; profileImage: string | null }) => {
			if (!iceServersRef.current) iceServersRef.current = await getIceServers();
			createPeerConnection(socketId, { userId, name, profileImage }, false);
		};
		const handleSignal = async ({ from, signal }: { from: string; signal: { type: string; sdp?: string; candidate?: RTCIceCandidateInit } }) => {
			let entry = peersRef.current.get(from);
			if (!entry) {
				if (!iceServersRef.current) iceServersRef.current = await getIceServers();
				createPeerConnection(from, { userId: null, name: 'User', profileImage: null }, false);
				entry = peersRef.current.get(from);
			}
			if (!entry) return;
			const { pc } = entry;
			try {
				if (signal.type === 'offer' && signal.sdp) {
					if (pc.signalingState !== 'stable') {
						await Promise.all([pc.setLocalDescription({ type: 'rollback' })]).catch(() => { });
					}
					await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
					const buffered = candidateBufferRef.current.get(from) || [];
					candidateBufferRef.current.set(from, []);
					for (const c of buffered) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => { });
					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);
					socket.emit('signal', { to: from, signal: { type: 'answer', sdp: pc.localDescription!.sdp } });
				} else if (signal.type === 'answer' && signal.sdp) {
					if (pc.signalingState === 'have-local-offer') {
						await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
						const buffered = candidateBufferRef.current.get(from) || [];
						candidateBufferRef.current.set(from, []);
						for (const c of buffered) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => { });
					}
				} else if (signal.type === 'candidate' && signal.candidate) {
					if (pc.remoteDescription && pc.remoteDescription.type) {
						await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => { });
					} else {
						const buf = candidateBufferRef.current.get(from) || [];
						buf.push(signal.candidate);
						candidateBufferRef.current.set(from, buf);
					}
				}
			} catch (err) {
				console.error('Signal handling error:', err);
			}
		};
		const handlePeerLeft = ({ socketId }: { socketId: string }) => removePeer(socketId);
		socket.on('room_peers', handleRoomPeers);
		socket.on('peer_joined', handlePeerJoined);
		socket.on('signal', handleSignal);
		socket.on('peer_left', handlePeerLeft);
		return () => {
			socket.off('room_peers', handleRoomPeers);
			socket.off('peer_joined', handlePeerJoined);
			socket.off('signal', handleSignal);
			socket.off('peer_left', handlePeerLeft);
		};
	}, [socket, createPeerConnection, removePeer]);

	useEffect(() => { return () => { leaveRoom(); }; }, [leaveRoom]);

	return {
		localStream, peers, audioEnabled, videoEnabled, screenStream, mediaError,
		joinRoom, leaveRoom, toggleAudio, toggleVideo, toggleScreenShare,
		joined: joinedRef.current,
	};
}
