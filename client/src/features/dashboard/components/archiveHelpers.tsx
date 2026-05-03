import * as chrono from "chrono-node";

export const SEARCH_DEBOUNCE_MS = 300;
export const TRANSCRIPT_DEBOUNCE_MS = 350;

export interface ArchiveMeeting {
    id: string;
    /** Short URL-friendly identifier returned by the archive list endpoint. */
    shortId?: string;
    title: string;
    date?: string;
    time?: string;
    host: string;
    matchedTranscripts?: Array<{ speaker: string; text: string; timestamp?: string }>;
    matchedAgendaItems?: Array<{ title: string }>;
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

export interface ArchiveDetail {
    meeting: { title: string; date?: string; time?: string; host: string };
    agendaItems: Array<{ id: string; title: string; duration: number }>;
    transcriptsByAgenda: Record<string, Array<{ id: string; speaker: string; timestamp: string; text: string }>>;
    transcriptFlat?: TranscriptSegment[];
    actionItems: Array<{ id: string; title: string; status: string; assignee?: string; source?: string; agendaItemId?: string | null }>;
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

export function groupActionItemsByAgenda(detail: ArchiveDetail) {
    const groups = detail.agendaItems.map((agendaItem) => ({
        key: agendaItem.id,
        title: agendaItem.title,
        items: detail.actionItems.filter((item) => item.agendaItemId === agendaItem.id),
    })).filter((group) => group.items.length > 0);

    const agendaIds = new Set(detail.agendaItems.map((item) => item.id));
    const unlinkedItems = detail.actionItems.filter((item) => !item.agendaItemId || !agendaIds.has(String(item.agendaItemId)));
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
