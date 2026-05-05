import * as chrono from "chrono-node";

export const SEARCH_DEBOUNCE_MS = 400;
export const TRANSCRIPT_DEBOUNCE_MS = 350;

/**
 * Spinner / “Searching…” stays visible at least this long after the request fires
 * (after debounce) so fast responses don’t flash the list.
 */
export const ARCHIVE_SEARCH_MIN_LOADING_MS = 450;

/** Optional extra dwell on the Searching overlay while tuning CSS. Keep `0` in normal use. */
export const ARCHIVE_SEARCH_LOADING_UI_HOLD_MS = 0;

export function archiveLoadingMinVisibleMs(): number {
	return ARCHIVE_SEARCH_MIN_LOADING_MS + ARCHIVE_SEARCH_LOADING_UI_HOLD_MS;
}

export interface ArchiveMeeting {
    _id?: string;
    /** Public invite segment from the listings API when present (legacy payloads may omit). */
    id?: string;
    title: string;
    date?: string;
    time?: string;
    host: string;
    hostId?: string | { _id?: string };
    modality?: string;
    matchedTranscripts?: Array<{ speaker: string; text: string; timestamp?: string }>;
    matchedAgendaItems?: Array<{ title: string }>;
}

/** Chip class for archived meeting modality (Online / Offline / Hybrid). */
export function archiveModalityChipClass(modality: string | undefined | null): string {
    const m = (modality || "").trim().toLowerCase();
    if (m === "online") return "chip chip-blue";
    if (m === "offline") return "chip chip-amber";
    if (m === "hybrid") return "chip chip-purple";
    return "chip";
}

export function archiveModalityLabel(modality: string | undefined | null): string | null {
    const raw = (modality || "").trim();
    if (!raw) return null;
    return raw;
}

/** GET /archive list response (paginated). */
export interface ArchiveListResponse {
    meetings: ArchiveMeeting[];
    total: number;
    page: number;
    limit: number;
}

export interface TranscriptSegment {
    id: string;
    speaker: string;
    timestamp: string;
    text: string;
    agendaItemId?: string | null;
    agendaKey?: string;
    createdAt?: string;
}

export interface ArchiveParticipant {
    _id: string;
    name?: string;
    email?: string;
    profileImage?: string | null;
}

export interface ArchiveTaskAssignee {
    id: string;
    name?: string | null;
    email?: string | null;
    profileImage?: string | null;
}

export interface ArchiveTask {
    id: string;
    title: string;
    status: string;
    /** Canonical multi-assignee list. Empty array = unassigned. */
    assignees?: ArchiveTaskAssignee[];
    /** Legacy single-assignee display name (kept so older data still renders). */
    assignee?: string;
    source?: string;
    agendaItemId?: string | null;
}

export interface ArchiveDetail {
    meeting: {
        _id?: string;
        title: string;
        date?: string;
        time?: string;
        host: string;
        hostId?: string | ArchiveParticipant;
        description?: string;
        tags?: string[];
        tagColors?: Record<string, string>;
        participants?: ArchiveParticipant[];
    };
    agendaItems: Array<{ id: string; title: string; duration: number }>;
    transcriptsByAgenda: Record<string, Array<{ id: string; speaker: string; timestamp: string; text: string }>>;
    transcriptFlat?: TranscriptSegment[];
    tasks: ArchiveTask[];
    /** Legacy alias kept for components that still consume the old field name. */
    actionItems?: ArchiveTask[];
    pins: Array<{ id: string; type: string; url?: string; label?: string; transcriptTimestamp?: string }>;
    meetingSummary?: {
        overview: string;
        discussionPoints: string[];
        completedItems: string[];
        pendingItems: string[];
        decisions: string[];
        nextSteps: string[];
        model?: string;
        generatedAt?: string;
    } | null;
}

export function formatArchiveDate(dateStr?: string): string {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

/** Local calendar start-of-day for YYYY-MM-DD archive dates; `null` if missing/invalid. */
export function parseArchiveDateToLocalDay(dateStr?: string | null): Date | null {
    if (dateStr == null) return null;
    const iso = String(dateStr).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export type ArchiveRecencyGroupId = "today" | "yesterday" | "thisMonth" | "older";

const ARCHIVE_RECENCY_ORDER: ArchiveRecencyGroupId[] = ["today", "yesterday", "thisMonth", "older"];
const ARCHIVE_RECENCY_LABEL: Record<ArchiveRecencyGroupId, string> = {
    today: "Today",
    yesterday: "Yesterday",
    thisMonth: "This month",
    older: "Older",
};

export function archiveMeetingRecencyGroup(dateStr: string | undefined | null, now = new Date()): ArchiveRecencyGroupId {
    const day = parseArchiveDateToLocalDay(dateStr);
    if (!day) return "older";

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const t = day.getTime();
    if (t === todayStart.getTime()) return "today";
    if (t === yesterdayStart.getTime()) return "yesterday";
    if (t >= monthStart.getTime() && t < todayStart.getTime()) return "thisMonth";
    return "older";
}

export function groupArchiveMeetingsByRecency(
    meetings: ArchiveMeeting[],
    now = new Date(),
): Array<{ id: ArchiveRecencyGroupId; label: string; meetings: ArchiveMeeting[] }> {
    const buckets: Record<ArchiveRecencyGroupId, ArchiveMeeting[]> = {
        today: [],
        yesterday: [],
        thisMonth: [],
        older: [],
    };
    for (const m of meetings) {
        buckets[archiveMeetingRecencyGroup(m.date, now)].push(m);
    }
    return ARCHIVE_RECENCY_ORDER
        .filter((id) => buckets[id].length > 0)
        .map((id) => ({ id, label: ARCHIVE_RECENCY_LABEL[id], meetings: buckets[id] }));
}

/** Parse natural language date range from search input. Returns { textQuery, dateFrom, dateTo }. */
export function parseArchiveSearchInput(input: string) {
    const trimmed = input.trim();
    const now = new Date();
    if (!trimmed) return { textQuery: "", dateFrom: null as string | null, dateTo: null as string | null };

    const parsed = chrono.parse(trimmed, now);
    let textQuery = trimmed;
    let dateFrom: Date | null = null;
    let dateTo: Date | null = null;

    for (const p of parsed) textQuery = textQuery.replace(p.text, " ");
    textQuery = textQuery.replace(/\b(from|since|till|to|until)\b\s*/gi, "").replace(/\s+/g, " ").trim();

    const lower = trimmed.toLowerCase();
    const hasFrom = /\b(from|since)\b/.test(lower);
    const hasTo = /\b(till|to|until)\b/.test(lower);

    if (parsed.length >= 2) {
        dateFrom = parsed[0].start.date();
        dateTo = parsed[1].start.date();
        if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
    } else if (parsed.length === 1) {
        const p = parsed[0];
        const d = p.start.date();
        const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0);
        const endOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59);
        if (p.end) { dateFrom = startOfDay(p.start.date()); dateTo = endOfDay(p.end.date()); }
        else if (hasFrom && !hasTo) dateFrom = startOfDay(d);
        else if (hasTo && !hasFrom) dateTo = endOfDay(d);
        else { dateFrom = startOfDay(d); dateTo = endOfDay(d); }
    }

    return {
        textQuery,
        dateFrom: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
        dateTo: dateTo ? dateTo.toISOString().slice(0, 10) : null,
    };
}

export function groupTasksByAgenda(detail: ArchiveDetail) {
    const tasks = detail.tasks || detail.actionItems || [];
    const groups = detail.agendaItems.map((agendaItem) => ({
        key: agendaItem.id,
        title: agendaItem.title,
        items: tasks.filter((item) => item.agendaItemId === agendaItem.id),
    })).filter((group) => group.items.length > 0);

    const agendaIds = new Set(detail.agendaItems.map((item) => item.id));
    const unlinkedItems = tasks.filter((item) => !item.agendaItemId || !agendaIds.has(String(item.agendaItemId)));
    if (unlinkedItems.length > 0) {
        groups.push({ key: "_unlinked", title: "General / Unlinked", items: unlinkedItems });
    }

    return groups;
}

export function flattenTranscripts(detail: ArchiveDetail): TranscriptSegment[] {
    if (detail.transcriptFlat?.length) return detail.transcriptFlat;
    const by = detail.transcriptsByAgenda || {};
    return Object.entries(by).flatMap(([key, segs]) =>
        (segs || []).map((s) => ({ ...s, agendaKey: key })),
    );
}
