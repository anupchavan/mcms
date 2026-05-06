import { useEffect, useRef, useCallback } from 'react';

declare global {
	interface Window {
		webkitAudioContext: typeof AudioContext;
	}
}

/**
 * Live-meeting microphone capture for streaming STT.
 *
 * Why this hook was rewritten
 * ---------------------------
 * The old version used a ScriptProcessorNode (deprecated, main-thread) with a
 * 4096-sample buffer and an RMS gate that dropped the quiet onsets of words.
 * Combined with Sarvam's translate-stream model (which only emits a transcript
 * at end-of-utterance) it produced 5-20 second waits before captions appeared.
 *
 * This version:
 *   - Captures via AudioWorklet on the audio thread.
 *   - Posts ~100 ms chunks (configurable).
 *   - Removes the RMS gate; lets the STT provider's VAD decide.
 *   - Resamples to 16 kHz Int16 PCM and base64-encodes for the existing
 *     `audio_chunk` socket event (server is provider-agnostic now).
 *
 * Pair with server `STT_PROVIDER=deepgram` for Google-Meet-style live captions
 * with mutable interim transcripts.
 */

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_MS = 100; // 100 ms => 1600 samples @ 16 kHz

function resampleBuffer(input: Float32Array, fromRate: number, toRate: number): Float32Array {
	if (fromRate === toRate) return input;
	const ratio = fromRate / toRate;
	const newLength = Math.round(input.length / ratio);
	const out = new Float32Array(newLength);
	for (let i = 0; i < newLength; i++) {
		const srcIdx = i * ratio;
		const low = Math.floor(srcIdx);
		const high = Math.min(low + 1, input.length - 1);
		const frac = srcIdx - low;
		out[i] = input[low] * (1 - frac) + input[high] * frac;
	}
	return out;
}

function float32ToInt16(input: Float32Array): Int16Array {
	const out = new Int16Array(input.length);
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i]));
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return out;
}

function int16ToBase64(input: Int16Array): string {
	const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	// btoa(String.fromCharCode(...bytes)) blows the call stack on long inputs;
	// chunk through a small buffer instead.
	let bin = '';
	const STEP = 0x8000;
	for (let i = 0; i < bytes.length; i += STEP) {
		bin += String.fromCharCode.apply(
			null,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			bytes.subarray(i, i + STEP) as any,
		);
	}
	return btoa(bin);
}

export default function useTranscriptionCapture(
	socket: any,
	meetingId: string | null,
	localStream: MediaStream | null,
) {
	const audioContextRef = useRef<AudioContext | null>(null);
	const workletNodeRef = useRef<AudioWorkletNode | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const activeRef = useRef<boolean>(false);

	const stopCapture = useCallback(() => {
		if (!activeRef.current) return;
		activeRef.current = false;
		if (workletNodeRef.current) {
			try {
				workletNodeRef.current.port.onmessage = null;
				workletNodeRef.current.disconnect();
			} catch { }
			workletNodeRef.current = null;
		}
		if (sourceRef.current) {
			try {
				sourceRef.current.disconnect();
			} catch { }
			sourceRef.current = null;
		}
		if (audioContextRef.current) {
			audioContextRef.current.close().catch(() => { });
			audioContextRef.current = null;
		}
	}, []);

	const startCapture = useCallback(async () => {
		if (!socket || !meetingId || !localStream || activeRef.current) return;
		const audioTrack = localStream.getAudioTracks()[0];
		if (!audioTrack) return;
		activeRef.current = true;

		try {
			const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			audioContextRef.current = audioCtx;

			// Load the worklet processor. Files in /public/ are served at the
			// app's base path (e.g. `/mcms/` in production, `/` in dev).
			// Hardcoding `/transcription-worklet.js` 404s when the app is mounted
			// under a sub-path on the server.
			await audioCtx.audioWorklet.addModule(
				`${import.meta.env.BASE_URL}transcription-worklet.js`
			);

			const audioOnlyStream = new MediaStream([audioTrack]);
			const source = audioCtx.createMediaStreamSource(audioOnlyStream);
			sourceRef.current = source;

			const node = new AudioWorkletNode(audioCtx, 'transcription-processor', {
				numberOfInputs: 1,
				numberOfOutputs: 0,
				channelCount: 1,
				processorOptions: {
					inputRate: audioCtx.sampleRate,
					chunkMs: CHUNK_MS,
				},
			});
			workletNodeRef.current = node;

			node.port.onmessage = (ev: MessageEvent) => {
				if (!activeRef.current) return;
				const data = ev.data as { chunk: Float32Array; rate: number } | undefined;
				if (!data || !data.chunk) return;
				const resampled = resampleBuffer(data.chunk, data.rate, TARGET_SAMPLE_RATE);
				const int16 = float32ToInt16(resampled);
				const base64 = int16ToBase64(int16);
				socket.emit('audio_chunk', { meetingId, data: base64 });
			};

			source.connect(node);
			// No need to connect to destination — we don't want monitoring
			// playback, and AudioWorkletNode keeps running without it.
		} catch (err) {
			// Fall back gracefully if AudioWorklet is unavailable.
			// eslint-disable-next-line no-console
			console.error('Transcription capture failed to start:', err);
			activeRef.current = false;
			if (audioContextRef.current) {
				audioContextRef.current.close().catch(() => { });
				audioContextRef.current = null;
			}
		}
	}, [socket, meetingId, localStream]);

	useEffect(() => {
		if (!socket || !meetingId) return;
		const handleStarted = ({ meetingId: mid }: { meetingId: string }) => {
			if (mid === meetingId) {
				startCapture();
			}
		};
		const handleStopped = ({ meetingId: mid }: { meetingId: string }) => {
			if (mid === meetingId) stopCapture();
		};
		socket.on('transcription_started', handleStarted);
		socket.on('transcription_stopped', handleStopped);
		return () => {
			socket.off('transcription_started', handleStarted);
			socket.off('transcription_stopped', handleStopped);
			stopCapture();
		};
	}, [socket, meetingId, startCapture, stopCapture]);

	return { active: activeRef.current, stopCapture };
}
