import { useEffect, useRef, useCallback } from 'react';

// for older Safari browsers
declare global {
	interface Window {
		webkitAudioContext: typeof AudioContext;
	}
}

const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;
const RMS_GATE_THRESHOLD = 0.012;
const VOICE_HOLD_FRAMES = 8;
/** Batch client VAD speaking time to the server (no Sarvam required). */
const SPEAKING_FLUSH_INTERVAL_MS = 20_000;
const MIN_SPEAKING_FLUSH_MS = 800;

// resample buffer using linear interpolation
function resampleBuffer(inputBuffer: Float32Array, fromRate: number, toRate: number): Float32Array {
	if (fromRate === toRate) return inputBuffer;
	const ratio = fromRate / toRate;
	const newLength = Math.round(inputBuffer.length / ratio);
	const result = new Float32Array(newLength);
	for (let i = 0; i < newLength; i++) {
		const srcIdx = i * ratio;
		const low = Math.floor(srcIdx);
		const high = Math.min(low + 1, inputBuffer.length - 1);
		const frac = srcIdx - low;
		result[i] = inputBuffer[low] * (1 - frac) + inputBuffer[high] * frac;
	}
	return result;
}

function float32ToInt16(float32Array: Float32Array): Int16Array {
	const int16 = new Int16Array(float32Array.length);
	for (let i = 0; i < float32Array.length; i++) {
		const s = Math.max(-1, Math.min(1, float32Array[i])); // hard clip to -1 to 1
		int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; // convert to 16-bit integer
	}
	return int16;
}

function int16ToBase64(int16Array: Int16Array): string {
	const bytes = new Uint8Array(int16Array.buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

// compute loudness of the buffer
function computeRMS(buffer: Float32Array): number {
	let sum = 0;
	for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
	return Math.sqrt(sum / buffer.length);
}

/**
 * Local mic processing: (1) optional Sarvam audio chunks when host starts transcription,
 * (2) voice-activity speaking time reported over Socket.IO — works even when transcription is off.
 */
export default function useTranscriptionCapture(
	socket: any,
	meetingId: string | null,
	localStream: MediaStream | null,
	micUnmuted: boolean,
	enabled: boolean = true,
) {
	const audioContextRef = useRef<AudioContext | null>(null);
	const processorRef = useRef<ScriptProcessorNode | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const activeRef = useRef<boolean>(false);
	const holdCounterRef = useRef<number>(0);
	const transcriptionActiveRef = useRef(false);
	const pendingVadMsRef = useRef(0);
	const meetingIdRef = useRef<string | null>(null);
	const micUnmutedRef = useRef(micUnmuted);
	const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	meetingIdRef.current = meetingId;
	micUnmutedRef.current = micUnmuted;

	useEffect(() => {
		micUnmutedRef.current = micUnmuted;
	}, [micUnmuted]);

	// flush pending VAD time to the server
	const flushPendingVad = useCallback(() => {
		const mid = meetingIdRef.current;
		const pending = pendingVadMsRef.current;
		pendingVadMsRef.current = 0;
		if (pending < MIN_SPEAKING_FLUSH_MS || !mid || !socket?.connected) return;
		socket.emit('speaking_vad_report', { meetingId: mid, deltaMs: pending });
	}, [socket]);

	const stopCapture = useCallback(() => {
		if (!activeRef.current) return;
		activeRef.current = false;
		if (flushTimerRef.current) {
			clearInterval(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		flushPendingVad();
		if (processorRef.current) {
			processorRef.current.disconnect();
			processorRef.current.onaudioprocess = null;
			processorRef.current = null;
		}
		if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
		if (audioContextRef.current) { audioContextRef.current.close().catch(() => { }); audioContextRef.current = null; }
	}, [flushPendingVad]);

	const startCapture = useCallback(() => {
		if (!enabled || !socket || !meetingId || !localStream || activeRef.current) return;
		const audioTrack = localStream.getAudioTracks()[0];
		if (!audioTrack) return;
		activeRef.current = true;
		holdCounterRef.current = 0;
		pendingVadMsRef.current = 0;

		const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		audioContextRef.current = audioCtx;
		const audioOnlyStream = new MediaStream([audioTrack]);
		const source = audioCtx.createMediaStreamSource(audioOnlyStream);
		sourceRef.current = source;
		const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
		processorRef.current = processor;

		const frameMs = (BUFFER_SIZE / audioCtx.sampleRate) * 1000;

		processor.onaudioprocess = (e: AudioProcessingEvent) => {
			if (!activeRef.current) return;
			const inputData = e.inputBuffer.getChannelData(0);
			const rms = computeRMS(inputData);
			if (rms >= RMS_GATE_THRESHOLD) {
				holdCounterRef.current = VOICE_HOLD_FRAMES;
			} else if (holdCounterRef.current > 0) {
				holdCounterRef.current--;
			}
			const voiceActive = holdCounterRef.current > 0;
			const mid = meetingIdRef.current;

			if (transcriptionActiveRef.current && voiceActive && mid) {
				const resampled = resampleBuffer(inputData, audioCtx.sampleRate, TARGET_SAMPLE_RATE);
				const int16 = float32ToInt16(resampled);
				const base64 = int16ToBase64(int16);
				socket.emit('audio_chunk', { meetingId: mid, data: base64 });
			}

			const unmuted = micUnmutedRef.current && audioTrack.enabled;
			if (unmuted && voiceActive) {
				pendingVadMsRef.current += frameMs;
			}
		};

		source.connect(processor);
		processor.connect(audioCtx.destination);

		flushTimerRef.current = setInterval(() => {
			flushPendingVad();
		}, SPEAKING_FLUSH_INTERVAL_MS);
	}, [enabled, socket, meetingId, localStream, flushPendingVad]);

	useEffect(() => {
		if (!enabled) {
			stopCapture();
			return;
		}
		if (!socket || !meetingId || !localStream) return;
		startCapture();
		return () => stopCapture();
	}, [enabled, socket, meetingId, localStream, startCapture, stopCapture]);

	useEffect(() => {
		if (!socket || !meetingId) return;
		const handleStarted = ({ meetingId: mid }: { meetingId: string }) => {
			if (mid === meetingId) transcriptionActiveRef.current = true;
		};
		const handleStopped = ({ meetingId: mid }: { meetingId: string }) => {
			if (mid === meetingId) transcriptionActiveRef.current = false;
		};
		socket.on('transcription_started', handleStarted);
		socket.on('transcription_stopped', handleStopped);
		return () => {
			socket.off('transcription_started', handleStarted);
			socket.off('transcription_stopped', handleStopped);
			transcriptionActiveRef.current = false;
		};
	}, [socket, meetingId]);

	return { active: activeRef.current, stopCapture };
}
