/**
 * Meeting-relative transcription clock (pauses when recording stops).
 * Paragraph aggregation for fewer transcript rows: speaker turns + long monologue splits.
 */

export const MAX_PARAGRAPH_CHARS = 420;
export const MIN_CHARS_FOR_SENTENCE_END_FLUSH = 80;

export type RecordingClock = { accumulatedMs: number; epochStart: number | null };

export function getOrCreateClock(
	map: Map<string, RecordingClock>,
	meetingId: string,
): RecordingClock {
	if (!map.has(meetingId)) {
		map.set(meetingId, { accumulatedMs: 0, epochStart: null });
	}
	return map.get(meetingId)!;
}

export function resumeClock(map: Map<string, RecordingClock>, meetingId: string) {
	const c = getOrCreateClock(map, meetingId);
	if (c.epochStart == null) c.epochStart = Date.now();
}

export function pauseClock(map: Map<string, RecordingClock>, meetingId: string) {
	const c = map.get(meetingId);
	if (!c) return;
	if (c.epochStart != null) {
		c.accumulatedMs += Date.now() - c.epochStart;
		c.epochStart = null;
	}
}

export function clearMeetingClock(map: Map<string, RecordingClock>, meetingId: string) {
	map.delete(meetingId);
}

export function getElapsedMs(map: Map<string, RecordingClock>, meetingId: string): number {
	const c = map.get(meetingId);
	if (!c) return 0;
	return c.accumulatedMs + (c.epochStart != null ? Date.now() - c.epochStart : 0);
}

/** Display label: m:ss under 1h, else h:mm:ss */
export function formatMeetingElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/** Merge streaming STT: growing utterance vs new tokens. */
export function mergeStreamingUtterance(prev: string, incoming: string): string {
	const p = (prev || '').trimEnd();
	const i = incoming.trim();
	if (!i) return p;
	if (!p) return i;
	if (i.startsWith(p)) return i;
	if (p.startsWith(i)) return p;
	if (p.endsWith(i)) return p;
	return `${p} ${i}`.replace(/\s+/g, ' ').trim();
}

export type TranscriptAgg = {
	speaker: string;
	speakerImage: string | null;
	text: string;
	segmentStartElapsedMs: number;
	agendaItemId: string | null;
	languageCode: string | null;
};

export function shouldFlushOnSentenceEnd(text: string): boolean {
	const t = text.trim();
	if (t.length < MIN_CHARS_FOR_SENTENCE_END_FLUSH) return false;
	return /[.!?…]["'»\])]?\s*$/.test(t);
}

/** Returns text before cut (flush) and remainder to keep, or null if no split. */
export function splitAtParagraphBoundary(text: string, maxChars: number): { flush: string; rest: string } | null {
	if (text.length < maxChars) return null;
	const window = text.slice(0, maxChars + 1);
	const re = /[.!?…]["'»\])]?\s+/g;
	let m: RegExpExecArray | null;
	let lastEnd = -1;
	while ((m = re.exec(window)) !== null) {
		lastEnd = m.index + m[0].length;
	}
	if (lastEnd > 40) {
		return {
			flush: text.slice(0, lastEnd).trim(),
			rest: text.slice(lastEnd).trim(),
		};
	}
	// No sentence break: split at last space before maxChars
	const hard = text.slice(0, maxChars);
	const sp = hard.lastIndexOf(' ');
	if (sp > 40) {
		return { flush: text.slice(0, sp).trim(), rest: text.slice(sp).trim() };
	}
	return { flush: hard.trim(), rest: text.slice(maxChars).trim() };
}
