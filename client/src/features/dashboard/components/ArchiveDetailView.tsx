import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../../../shared/components/Icon";
import {
    Add01Icon,
    ArrowDown01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    ArrowUp01Icon,
    Calendar02Icon,
    Clock01Icon,
    Search01Icon,
} from "@hugeicons/core-free-icons";
import {
    ArchiveDetail, ArchiveParticipant, TranscriptSegment, flattenTranscripts,
    formatArchiveDate, groupActionItemsByAgenda, TRANSCRIPT_DEBOUNCE_MS,
} from "./archiveHelpers";
import { UserAvatar } from "../../../shared/components/UserAvatar";
import { useAuth } from "../../../stores/AuthContext";
import { TranscriptSpeakerSelect } from "./TranscriptSpeakerSelect";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
const PARTICIPANTS_VISIBLE = 5;

/** Meetings completed on or after this date get auto-summary (server generates on end_meeting). */
const SUMMARY_AUTO_CUTOFF_DATE = new Date("2026-05-04");

/** Flexoki colour palette for tag chips. */
const FLEXOKI_TAG_COLORS: { label: string; value: string }[] = [
    { label: "Red",     value: "#D14D41" },
    { label: "Orange",  value: "#DA702C" },
    { label: "Yellow",  value: "#D0A215" },
    { label: "Green",   value: "#879A39" },
    { label: "Cyan",    value: "#3AA99F" },
    { label: "Blue",    value: "#4385BE" },
    { label: "Purple",  value: "#8B7EC8" },
    { label: "Magenta", value: "#CE5D97" },
];

/** Colour menu options (Flexoki + default / no custom colour). */
const TAG_COLOUR_MENU: { label: string; value: string | null }[] = [
    ...FLEXOKI_TAG_COLORS.map(c => ({ label: c.label, value: c.value })),
    { label: "Default", value: null },
];

function hueFromTagLabel(s: string) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h % 360);
}

/** Tag ring in add-tag dropdown (matches archive search tag rows). */
function TagPickRing({ name, catalogColor }: { name: string; catalogColor?: string }) {
    const hue = hueFromTagLabel(name || "?");
    const ringColor = catalogColor ? `${catalogColor}cc` : `hsla(${hue}, 48%, 50%, 0.78)`;
    const bgColor = catalogColor ? `${catalogColor}22` : undefined;
    return (
        <span
            className="archive-multi-select-avatar archive-multi-select-avatar--tag-ring"
            style={{ borderColor: ringColor, background: bgColor }}
            aria-hidden
        />
    );
}

/** CSS `color` for tag accent (stored hex or deterministic hue). */
function accentCssForTag(tag: string, meetingColors: Record<string, string>, catalogColors: Record<string, string>): string {
    const hex = meetingColors[tag] || catalogColors[tag];
    if (hex && /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) return hex;
    const h = hueFromTagLabel(tag);
    return `hsl(${h} 52% 44%)`;
}

interface ArchiveDetailViewProps {
    meetingId: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
}

export default function ArchiveDetailView({ meetingId, fetchWithAuth }: ArchiveDetailViewProps) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [detail, setDetail] = useState<ArchiveDetail | null>(null);
    const [summaries, setSummaries] = useState<Record<string, string>>({});
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [finalSummary, setFinalSummary] = useState<ArchiveDetail["meetingSummary"]>(null);
    const [loadingFinalSummary, setLoadingFinalSummary] = useState(false);
    const [extractingActions, setExtractingActions] = useState(false);
    const [notFound, setNotFound] = useState(false);

    // sidebar modals
    const [participantsModalOpen, setParticipantsModalOpen] = useState(false);
    const [participantSearch, setParticipantSearch] = useState("");
    const [savingTags, setSavingTags] = useState(false);
    const [catalogTags, setCatalogTags] = useState<string[]>([]);
    const [catalogTagColors, setCatalogTagColors] = useState<Record<string, string>>({});
    const [tagAddOpen, setTagAddOpen] = useState(false);
    const [tagAddSearch, setTagAddSearch] = useState("");
    const [tagAddHlIdx, setTagAddHlIdx] = useState(0);
    const [newTagAwaitingColor, setNewTagAwaitingColor] = useState<string | null>(null);
    const [tagColorSearch, setTagColorSearch] = useState("");
    const [tagColorHlIdx, setTagColorHlIdx] = useState(0);
    const tagAddRootRef = useRef<HTMLDivElement>(null);
    const tagAddSearchInputRef = useRef<HTMLInputElement>(null);
    const tagColorSearchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setNotFound(false);
            setDetail(null);
            try {
                const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}`);
                if (cancelled) return;
                if (!res.ok) { setNotFound(true); return; }
                const data = await res.json();
                setDetail(data);
                setFinalSummary(data.meetingSummary || null);
            } catch (err) {
                console.error("Failed to load archive detail:", err);
                if (!cancelled) setNotFound(true);
            }
        })();
        return () => { cancelled = true; };
    }, [meetingId, fetchWithAuth]);

    const loadFinalSummary = useCallback(async () => {
        setLoadingFinalSummary(true);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/final-summary`);
            if (res.ok) {
                const data = await res.json();
                const normalized = data.summary ? {
                    overview: data.summary.overview || "",
                    discussionPoints: data.summary.discussion_points || [],
                    completedItems: data.summary.completed_items || [],
                    pendingItems: data.summary.pending_items || [],
                    decisions: data.summary.decisions || [],
                    nextSteps: data.summary.next_steps || [],
                    model: data.summary.model,
                    generatedAt: data.summary.generated_at,
                } : null;
                setFinalSummary(normalized);
                setDetail(prev => prev ? ({ ...prev, meetingSummary: normalized }) : prev);
            }
        } catch (err) { console.error("Failed to load final summary:", err); }
        setLoadingFinalSummary(false);
    }, [meetingId, fetchWithAuth]);

    const extractActionItems = useCallback(async () => {
        setExtractingActions(true);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/extract-actions`, { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setDetail(prev => prev ? ({ ...prev, actionItems: data.actions || [] }) : prev);
            }
        } catch (err) { console.error("Failed to extract action items:", err); }
        setExtractingActions(false);
    }, [meetingId, fetchWithAuth]);

    const loadSummary = useCallback(async () => {
        setLoadingSummary(true);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/summary`);
            if (res.ok) {
                const data = await res.json();
                setSummaries(data.summaries || {});
            }
        } catch (err) { console.error("Failed to load summary:", err); }
        setLoadingSummary(false);
    }, [meetingId, fetchWithAuth]);

    const isHost = useMemo(() => {
        if (!detail || !user) return false;
        const hostId = detail.meeting.hostId;
        const uid = user._id || user.id;
        if (!hostId || !uid) return false;
        const hid = typeof hostId === "object" ? hostId._id : hostId;
        return String(hid) === String(uid);
    }, [detail, user]);

    const patchMeetingTags = useCallback(async (tags: string[], tagColors: Record<string, string>) => {
        if (!detail) return;
        setSavingTags(true);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/tags`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tags, tagColors }),
            });
            if (res.ok) {
                const data = await res.json();
                setDetail(prev => prev ? ({
                    ...prev,
                    meeting: { ...prev.meeting, tags: data.tags, tagColors: data.tagColors },
                }) : prev);
            }
        } catch (err) { console.error("Failed to save tags:", err); }
        setSavingTags(false);
    }, [detail, meetingId, fetchWithAuth]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/filters`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                setCatalogTags(data.tags || []);
                setCatalogTagColors(data.tagColors || {});
            } catch (e) { console.error("Failed to load tag catalog:", e); }
        })();
        return () => { cancelled = true; };
    }, [fetchWithAuth]);

    useEffect(() => {
        if (!tagAddOpen) return;
        const onDoc = (ev: MouseEvent) => {
            const el = tagAddRootRef.current;
            if (el && ev.target instanceof Node && !el.contains(ev.target)) {
                setTagAddOpen(false);
                setTagAddSearch("");
                setNewTagAwaitingColor(null);
                setTagColorSearch("");
                setTagColorHlIdx(0);
            }
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [tagAddOpen]);

    const removeMeetingTag = useCallback((tag: string) => {
        if (!detail || !isHost) return;
        const curTags = detail.meeting.tags || [];
        const nextTags = curTags.filter(t => t !== tag);
        const nextColors = { ...(detail.meeting.tagColors || {}) };
        delete nextColors[tag];
        void patchMeetingTags(nextTags, nextColors);
    }, [detail, isHost, patchMeetingTags]);

    const addMeetingTag = useCallback((tag: string, color?: string | null) => {
        if (!detail || !isHost) return;
        const trimmed = tag.trim().replace(/,/g, "");
        if (!trimmed) return;
        const curTags = detail.meeting.tags || [];
        if (curTags.includes(trimmed)) return;
        const nextTags = [...curTags, trimmed];
        const nextColors = { ...(detail.meeting.tagColors || {}) };
        const fromCatalog = catalogTagColors[trimmed];
        if (color) nextColors[trimmed] = color;
        else if (fromCatalog) nextColors[trimmed] = fromCatalog;
        void patchMeetingTags(nextTags, nextColors);
    }, [detail, isHost, patchMeetingTags, catalogTagColors]);

    const openTagAddDropdown = useCallback(() => {
        setTagAddOpen(true);
        setTagAddSearch("");
        setNewTagAwaitingColor(null);
        setTagColorSearch("");
        setTagColorHlIdx(0);
        setTagAddHlIdx(0);
    }, []);

    const tagAddFiltered = useMemo(() => {
        if (!detail) return [];
        const current = new Set(detail.meeting.tags || []);
        const q = tagAddSearch.trim().toLowerCase();
        return catalogTags
            .filter((t) => !current.has(t) && (!q || t.toLowerCase().includes(q)))
            .sort((a, b) => a.localeCompare(b));
    }, [detail, catalogTags, tagAddSearch]);

    const tagAddShowCreateRow = useMemo(() => {
        const q = tagAddSearch.trim();
        if (!q || !detail) return false;
        const onMeeting = (detail.meeting.tags || []).some(t => t.toLowerCase() === q.toLowerCase());
        if (onMeeting) return false;
        return tagAddFiltered.length === 0;
    }, [tagAddSearch, detail, tagAddFiltered]);

    const tagAddRowsLen = tagAddFiltered.length + (tagAddShowCreateRow ? 1 : 0);

    const applyNewTagColor = useCallback((hex: string | null) => {
        if (!newTagAwaitingColor || !detail || !isHost) return;
        const t = newTagAwaitingColor.trim().replace(/,/g, "");
        if (!t) return;
        const curTags = detail.meeting.tags || [];
        const nextTags = curTags.includes(t) ? curTags : [...curTags, t];
        const nextColors = { ...(detail.meeting.tagColors || {}) };
        if (hex) nextColors[t] = hex;
        else delete nextColors[t];
        void patchMeetingTags(nextTags, nextColors);
        setTagAddOpen(false);
        setTagAddSearch("");
        setNewTagAwaitingColor(null);
        setTagColorSearch("");
        setTagColorHlIdx(0);
    }, [newTagAwaitingColor, detail, isHost, patchMeetingTags]);

    const exitColorPickerToTags = useCallback(() => {
        setNewTagAwaitingColor(null);
        setTagColorSearch("");
        setTagColorHlIdx(0);
        setTagAddHlIdx(0);
        queueMicrotask(() => {
            const el = tagAddSearchInputRef.current;
            el?.focus();
            el?.select();
        });
    }, []);

    const tagColorFiltered = useMemo(() => {
        const q = tagColorSearch.trim().toLowerCase();
        if (!q) return TAG_COLOUR_MENU;
        return TAG_COLOUR_MENU.filter(({ label }) => label.toLowerCase().includes(q));
    }, [tagColorSearch]);

    useEffect(() => {
        setTagAddHlIdx(0);
    }, [tagAddSearch, newTagAwaitingColor, tagAddOpen]);

    useEffect(() => {
        if (!tagAddOpen || newTagAwaitingColor) return;
        setTagAddHlIdx(i => {
            if (tagAddRowsLen <= 0) return 0;
            return Math.min(Math.max(i, 0), tagAddRowsLen - 1);
        });
    }, [tagAddOpen, newTagAwaitingColor, tagAddRowsLen]);

    useEffect(() => {
        if (!newTagAwaitingColor) return;
        setTagColorHlIdx(h => {
            if (tagColorFiltered.length === 0) return 0;
            return Math.min(Math.max(h, 0), tagColorFiltered.length - 1);
        });
    }, [newTagAwaitingColor, tagColorFiltered.length]);

    useEffect(() => {
        if (!newTagAwaitingColor) return;
        const id = window.requestAnimationFrame(() => tagColorSearchInputRef.current?.focus());
        return () => window.cancelAnimationFrame(id);
    }, [newTagAwaitingColor]);

    useEffect(() => {
        if (!tagAddOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            if (newTagAwaitingColor) exitColorPickerToTags();
            else {
                setTagAddOpen(false);
                setTagAddSearch("");
                setTagColorSearch("");
                setTagColorHlIdx(0);
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [tagAddOpen, newTagAwaitingColor, exitColorPickerToTags]);

    // Determine if this meeting is recent enough for auto-summary generation
    const isAutoGenMeeting = useMemo(() => {
        if (!detail?.meeting?.date) return false;
        return new Date(detail.meeting.date) >= SUMMARY_AUTO_CUTOFF_DATE;
    }, [detail]);

    // Auto-fetch meeting summary for new meetings (server generates on end_meeting)
    const summaryFetchedRef = useRef(false);
    useEffect(() => {
        if (!isAutoGenMeeting || finalSummary !== null || summaryFetchedRef.current) return;
        summaryFetchedRef.current = true;
        loadFinalSummary();
    }, [isAutoGenMeeting, finalSummary, loadFinalSummary]);

    // Auto-fetch per-agenda summaries for new meetings that have agenda items
    const agendaSummaryFetchedRef = useRef(false);
    useEffect(() => {
        if (!detail || !isAutoGenMeeting || Object.keys(summaries).length > 0 || agendaSummaryFetchedRef.current) return;
        if (detail.agendaItems.length === 0) return;
        agendaSummaryFetchedRef.current = true;
        loadSummary();
    }, [detail, isAutoGenMeeting, summaries, loadSummary]);

    // Build allParticipants: host first (deduplicated), then other participants
    // Must be before early returns (rules of hooks)
    const allParticipants = useMemo<ArchiveParticipant[]>(() => {
        if (!detail) return [];
        const rawParticipants = (detail.meeting.participants || []) as ArchiveParticipant[];
        const hostId = detail.meeting.hostId;
        const hostParticipant: ArchiveParticipant | null =
            hostId && typeof hostId === "object"
                ? hostId as ArchiveParticipant
                : null;
        const others = rawParticipants.filter(p =>
            !hostParticipant || p._id !== hostParticipant._id
        );
        return hostParticipant ? [hostParticipant, ...others] : rawParticipants;
    }, [detail]);

    // Speaking time per speaker (from flat transcripts)
    const speakingData = useMemo(() => {
        if (!detail) return { counts: {} as Record<string, number>, total: 0, totalSecs: 0 };
        const flat = flattenTranscripts(detail);
        const counts: Record<string, number> = {};
        for (const seg of flat) {
            const sp = (seg.speaker || "").trim();
            if (sp) counts[sp] = (counts[sp] || 0) + 1;
        }
        // Estimate total duration from last segment timestamp (format "HH:MM:SS" or "MM:SS")
        let totalSecs = 0;
        if (flat.length > 0) {
            const lastTs = flat[flat.length - 1].timestamp || "";
            const parts = lastTs.split(":").map(Number);
            if (parts.length === 3) totalSecs = parts[0] * 3600 + parts[1] * 60 + parts[2];
            else if (parts.length === 2) totalSecs = parts[0] * 60 + parts[1];
        }
        return { counts, total: flat.length, totalSecs };
    }, [detail]);

    // Map participant name → speaking % (fuzzy match speaker field to participant name)
    const getSpeakingPct = useCallback((participant: ArchiveParticipant) => {
        if (speakingData.total === 0) return null;
        const name = (participant.name || "").trim().toLowerCase();
        if (!name) return null;
        let count = 0;
        for (const [sp, c] of Object.entries(speakingData.counts)) {
            if (sp.toLowerCase().includes(name) || name.includes(sp.toLowerCase())) count += c;
        }
        if (count === 0) return null;
        return Math.round((count / speakingData.total) * 100);
    }, [speakingData]);

    const CrumbHeader = ({ title }: { title: string }) => (
        <header className="page-header">
            <nav aria-label="Archive navigation">
                <h2 className="page-header-title archive-detail-page-title">
                    <span className="archive-detail-title-row">
                        <Link to="/archives" className="archive-detail-crumb-link">Archives</Link>
                        <span className="archive-detail-crumb-sep" aria-hidden> / </span>
                        <span className="archive-detail-title-meeting">{title}</span>
                    </span>
                </h2>
            </nav>
        </header>
    );

    if (notFound) {
        return (
            <div className="page-shell">
                <CrumbHeader title="Not found" />
                <div className="page-body-gutter-x" style={{ paddingBottom: "1.5rem" }}>
                    <div role="status" style={{ color: "var(--text-muted)" }}>Archive not found or not available yet.</div>
                </div>
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="page-shell">
                <CrumbHeader title="…" />
                <div className="page-body-gutter-x" style={{ paddingBottom: "1.5rem" }}>
                    <div role="status" style={{ color: "var(--text-muted)" }}>Loading archive…</div>
                </div>
            </div>
        );
    }

    const tags: string[] = detail.meeting.tags || [];
    const meetingTagColors: Record<string, string> = detail.meeting.tagColors || {};
    const filteredParticipants = participantSearch.trim()
        ? allParticipants.filter(p => (p.name || p.email || "").toLowerCase().includes(participantSearch.toLowerCase()))
        : allParticipants;

    return (
        <div className="page-shell">
            <CrumbHeader title={detail.meeting.title} />

            <div className="archive-detail-body page-body-gutter-x">
                {/* ── main column ── */}
                <div className="archive-detail-main">
                    <ArchiveSection title="Summary">
                        {finalSummary ? (
                            <div>
                                <p>
                                    {finalSummary.overview || "No overview available."}
                                </p>
                                <SummaryList title="Discussion Points" items={finalSummary.discussionPoints} />
                                <SummaryList title="Completed" items={finalSummary.completedItems} />
                                <SummaryList title="Pending" items={finalSummary.pendingItems} />
                                <SummaryList title="Decisions" items={finalSummary.decisions} />
                                <SummaryList title="Next Steps" items={finalSummary.nextSteps} />
                                <p style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "0.75rem", marginBottom: 0 }}>
                                    Model: {finalSummary.model || "unknown"}
                                    {finalSummary.generatedAt ? ` · Generated ${new Date(finalSummary.generatedAt).toLocaleString()}` : ""}
                                </p>
                            </div>
                        ) : loadingFinalSummary ? (
                            <div className="archive-detail-summary-loading" role="status">
                                <span className="archive-searching-loading-spinner" aria-hidden />
                                <span className="archive-searching-loading-text">Generating summary</span>
                            </div>
                        ) : null}
                    </ArchiveSection>

                    <ArchiveTranscriptExplorer meetingId={meetingId} detail={detail} fetchWithAuth={fetchWithAuth} />

                    {detail.agendaItems.length > 0 && (
                        <ArchiveSection title="Agenda & Transcript">
                            {detail.agendaItems.map((item, idx) => {
                                const segments = detail.transcriptsByAgenda[item.id] || [];
                                const summary = summaries[item.id];
                                return (
                                    <AgendaSection key={item.id} item={item} index={idx} segments={segments} summary={summary} />
                                );
                            })}
                            {detail.transcriptsByAgenda._unlinked?.length > 0 && (
                                <AgendaSection
                                    item={{ id: "_unlinked", title: "Unlinked Segments", duration: 0 }}
                                    index={-1}
                                    segments={detail.transcriptsByAgenda._unlinked}
                                />
                            )}
                        </ArchiveSection>
                    )}

                    {detail.actionItems.length > 0 ? (
                        <ArchiveSection title="Action Items">
                            {groupActionItemsByAgenda(detail).map((group) => (
                                <div key={group.key} style={{ marginBottom: "0.9rem" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.4rem" }}>
                                        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)" }}>{group.title}</span>
                                        <span className="chip chip-blue" style={{ fontSize: "0.5625rem" }}>{group.items.length}</span>
                                    </div>
                                    {group.items.map(item => (
                                        <div key={item.id} className="glass-card" style={{ padding: "8px 12px", marginBottom: "6px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8125rem" }}>
                                                <span className={`chip ${item.status === "verified" ? "chip-emerald" : "chip-amber"}`} style={{ fontSize: "0.5625rem" }}>
                                                    {item.status}
                                                </span>
                                                <span style={{ fontWeight: 500 }}>{item.title}</span>
                                                <span style={{ color: "var(--text-muted)", marginLeft: "auto", fontSize: "0.75rem" }}>{item.assignee}</span>
                                                {item.source === "ai-extracted" && (
                                                    <span className="chip chip-purple" style={{ fontSize: "0.5rem" }}>AI</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </ArchiveSection>
                    ) : (Object.keys(detail.transcriptsByAgenda).length > 0 && (
                        <ArchiveSection title="Action Items">
                            <button className="btn btn-sm btn-primary" onClick={extractActionItems} disabled={extractingActions}>
                                {extractingActions ? "Extracting..." : "Extract Action Items from Transcript"}
                            </button>
                        </ArchiveSection>
                    ))}

                    {detail.pins.length > 0 && (
                        <ArchiveSection title="Resource Pins">
                            {detail.pins.map(pin => (
                                <div key={pin.id} className="glass-card" style={{ padding: "8px 12px", marginBottom: "6px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8125rem" }}>
                                        <span className="chip chip-cyan" style={{ fontSize: "0.5625rem" }}>{pin.type}</span>
                                        <a href={pin.url || "#"} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500, color: "var(--primary)" }}>
                                            {pin.label || pin.url || "Code snippet"}
                                        </a>
                                        <span style={{ color: "var(--text-muted)", marginLeft: "auto", fontSize: "0.6875rem" }}>
                                            at {pin.transcriptTimestamp || "—"}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </ArchiveSection>
                    )}
                </div>

                {/* ── sidebar ── */}
                <aside className="archive-detail-sidebar">
                    {/* Description */}
                    <div className="archive-detail-sidebar-section">
                        <span className="archive-detail-sidebar-label">About</span>
                        {detail.meeting.description
                            ? <p className="archive-detail-sidebar-desc">{detail.meeting.description}</p>
                            : <p className="archive-detail-sidebar-desc archive-detail-sidebar-desc--empty">No description</p>
                        }
                    </div>

                    {/* Date & Time */}
                    <div className="archive-detail-sidebar-section">
                        <span className="archive-detail-sidebar-label">When</span>
                        <div className="archive-detail-sidebar-row">
                            <Icon icon={Calendar02Icon} size={13} className="archive-detail-sidebar-icon" />
                            <span className="archive-detail-sidebar-value">
                                {formatArchiveDate(detail.meeting.date) || "—"}
                            </span>
                        </div>
                        {detail.meeting.time && (
                            <div className="archive-detail-sidebar-row">
                                <Icon icon={Clock01Icon} size={13} className="archive-detail-sidebar-icon" />
                                <span className="archive-detail-sidebar-value">{detail.meeting.time}</span>
                            </div>
                        )}
                    </div>

                    {/* Participants */}
                    {allParticipants.length > 0 && (
                        <div className="archive-detail-sidebar-section">
                            <span className="archive-detail-sidebar-label">
                                Participants <span className="archive-detail-sidebar-count">{allParticipants.length}</span>
                            </span>
                            <div className="archive-detail-participants-list">
                                {allParticipants.slice(0, PARTICIPANTS_VISIBLE).map(p => {
                                    const hostId = detail.meeting.hostId;
                                    const hid = hostId && typeof hostId === "object" ? (hostId as ArchiveParticipant)._id : hostId;
                                    const isParticipantHost = hid && String(hid) === String(p._id);
                                    return (
                                        <div key={p._id} className="archive-detail-participant-list-row">
                                            <ParticipantAvatar participant={p} size={26} />
                                            <span className="archive-detail-participant-list-name">
                                                {p.name || p.email || "Participant"}
                                                {isParticipantHost && <span className="archive-detail-modal-host-chip">host</span>}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            {allParticipants.length > PARTICIPANTS_VISIBLE && (
                                <button
                                    type="button"
                                    className="archive-detail-sidebar-text-btn"
                                    onClick={() => { setParticipantSearch(""); setParticipantsModalOpen(true); }}
                                >
                                    +{allParticipants.length - PARTICIPANTS_VISIBLE} more
                                </button>
                            )}
                            {allParticipants.length <= PARTICIPANTS_VISIBLE && (
                                <button
                                    type="button"
                                    className="archive-detail-sidebar-text-btn"
                                    onClick={() => { setParticipantSearch(""); setParticipantsModalOpen(true); }}
                                >
                                    View details
                                </button>
                            )}
                        </div>
                    )}

                    {/* Tags */}
                    <div className="archive-detail-sidebar-section">
                        <div className="archive-detail-sidebar-label-row">
                            <span className="archive-detail-sidebar-label">Tags</span>
                        </div>
                        {!isHost && tags.length === 0 && (
                            <p className="archive-detail-sidebar-desc archive-detail-sidebar-desc--empty">No tags</p>
                        )}
                        {(isHost || tags.length > 0) && (
                            <div className="archive-detail-sidebar-tags">
                                {tags.map(tag => (
                                    <span
                                        key={tag}
                                        className="archive-detail-sidebar-tag-pill"
                                        data-tag-accent=""
                                        style={{ ["--tag-accent" as string]: accentCssForTag(tag, meetingTagColors, catalogTagColors) }}
                                    >
                                        <button
                                            type="button"
                                            className="archive-detail-sidebar-tag-pill-label"
                                            onClick={() => navigate("/archives", { state: { tags: [tag] } })}
                                            title={`View all meetings tagged "${tag}"`}
                                        >
                                            {tag}
                                        </button>
                                        {isHost && (
                                            <button
                                                type="button"
                                                className="archive-detail-sidebar-tag-pill-remove"
                                                onClick={(e) => { e.stopPropagation(); void removeMeetingTag(tag); }}
                                                disabled={savingTags}
                                                aria-label={`Remove tag ${tag}`}
                                            >
                                                <span aria-hidden className="archive-detail-sidebar-tag-x">×</span>
                                            </button>
                                        )}
                                    </span>
                                ))}
                            </div>
                        )}
                        {isHost && (
                            <div className="archive-detail-tag-add-wrap" ref={tagAddRootRef}>
                                <div className="archive-multi-select archive-detail-tag-add-multi">
                                    <div className="archive-multi-select-pill">
                                        <button
                                            type="button"
                                            className="archive-multi-select-trigger"
                                            onClick={() => {
                                                if (tagAddOpen) {
                                                    setTagAddOpen(false);
                                                    setTagAddSearch("");
                                                    setNewTagAwaitingColor(null);
                                                    setTagColorSearch("");
                                                    setTagColorHlIdx(0);
                                                } else {
                                                    openTagAddDropdown();
                                                }
                                            }}
                                            aria-expanded={tagAddOpen}
                                            aria-haspopup="listbox"
                                            disabled={savingTags}
                                        >
                                            <span className="archive-multi-select-trigger-title">
                                                <Icon icon={Add01Icon} size={14} aria-hidden className="archive-detail-tag-add-trigger-icon" />
                                                Add tag
                                            </span>
                                            <span className="archive-multi-select-trigger-spacer" aria-hidden />
                                            <span className="archive-multi-select-trigger-chevron">
                                                <Icon icon={tagAddOpen ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
                                            </span>
                                        </button>
                                    </div>
                                    {tagAddOpen && (
                                        <div className="archive-multi-select-panel archive-detail-tag-add-panel" role="listbox">
                                            {newTagAwaitingColor ? (
                                                <div className="archive-detail-tag-add-color-step">
                                                    <div className="archive-multi-select-search-wrap archive-detail-tag-colour-search-strip">
                                                        <button
                                                            type="button"
                                                            className="archive-detail-tag-colour-back"
                                                            onClick={exitColorPickerToTags}
                                                            aria-label="Back to tag search"
                                                        >
                                                            <Icon icon={ArrowLeft01Icon} size={16} />
                                                        </button>
                                                        <input
                                                            ref={tagColorSearchInputRef}
                                                            className="archive-multi-select-search archive-detail-tag-colour-search-input"
                                                            placeholder="Search colours…"
                                                            value={tagColorSearch}
                                                            onChange={e => setTagColorSearch(e.target.value)}
                                                            aria-label="Search colours"
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Backspace" && tagColorSearch === "") {
                                                                    e.preventDefault();
                                                                    exitColorPickerToTags();
                                                                    return;
                                                                }
                                                                if (e.key === "ArrowDown") {
                                                                    e.preventDefault();
                                                                    if (tagColorFiltered.length === 0) return;
                                                                    setTagColorHlIdx(i => Math.min(tagColorFiltered.length - 1, i + 1));
                                                                    return;
                                                                }
                                                                if (e.key === "ArrowUp") {
                                                                    e.preventDefault();
                                                                    setTagColorHlIdx(i => Math.max(0, i - 1));
                                                                    return;
                                                                }
                                                                if (e.key === "Enter") {
                                                                    e.preventDefault();
                                                                    if (tagColorFiltered.length === 0) return;
                                                                    const ri = Math.min(tagColorHlIdx, tagColorFiltered.length - 1);
                                                                    const row = tagColorFiltered[ri];
                                                                    if (row) applyNewTagColor(row.value);
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="archive-multi-select-list archive-detail-tag-colour-menu-list">
                                                        {tagColorFiltered.length === 0 ? (
                                                            <div className="archive-multi-select-empty">No colours match</div>
                                                        ) : (
                                                            tagColorFiltered.map((row, idx) => {
                                                                const kbd = tagColorHlIdx === idx;
                                                                return (
                                                                    <button
                                                                        key={row.label + (row.value ?? "default")}
                                                                        type="button"
                                                                        role="option"
                                                                        className={`archive-detail-tag-colour-menu-row${kbd ? " is-keyboard-highlight" : ""}`}
                                                                        onMouseEnter={() => setTagColorHlIdx(idx)}
                                                                        onClick={() => applyNewTagColor(row.value)}
                                                                    >
                                                                        <span
                                                                            className={`archive-detail-tag-colour-swatch-dot${row.value == null ? " archive-detail-tag-colour-swatch-dot--default" : ""}`}
                                                                            style={row.value ? { background: row.value } : undefined}
                                                                            aria-hidden
                                                                        />
                                                                        <span className="archive-detail-tag-colour-menu-label">{row.label}</span>
                                                                    </button>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="archive-multi-select-search-wrap">
                                                        <Icon icon={Search01Icon} size={14} className="archive-multi-select-search-icon" />
                                                        <input
                                                            ref={tagAddSearchInputRef}
                                                            className="archive-multi-select-search"
                                                            placeholder="Search tags…"
                                                            value={tagAddSearch}
                                                            onChange={e => setTagAddSearch(e.target.value)}
                                                            autoFocus
                                                            aria-label="Search tags to add"
                                                            onKeyDown={(e) => {
                                                                if (newTagAwaitingColor) return;
                                                                if (e.key === "ArrowDown") {
                                                                    e.preventDefault();
                                                                    if (tagAddRowsLen === 0) return;
                                                                    setTagAddHlIdx(i => Math.min(tagAddRowsLen - 1, i < 0 ? 0 : i + 1));
                                                                } else if (e.key === "ArrowUp") {
                                                                    e.preventDefault();
                                                                    setTagAddHlIdx(i => Math.max(0, i - 1));
                                                                } else if (e.key === "Enter") {
                                                                    e.preventDefault();
                                                                    if (tagAddRowsLen === 0) return;
                                                                    const hi = Math.min(tagAddHlIdx, tagAddRowsLen - 1);
                                                                    if (tagAddShowCreateRow && hi === tagAddFiltered.length) {
                                                                        setNewTagAwaitingColor(tagAddSearch.trim());
                                                                    } else if (hi >= 0 && hi < tagAddFiltered.length) {
                                                                        addMeetingTag(tagAddFiltered[hi]);
                                                                        setTagAddOpen(false);
                                                                        setTagAddSearch("");
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="archive-multi-select-list">
                                                        {tagAddFiltered.map((t, idx) => {
                                                            const cc = catalogTagColors[t];
                                                            const kbd = tagAddHlIdx === idx;
                                                            return (
                                                                <button
                                                                    key={t}
                                                                    type="button"
                                                                    role="option"
                                                                    className={`archive-multi-select-row archive-multi-select-row--tags archive-multi-select-row--tags-no-check${kbd ? " is-keyboard-highlight" : ""}`}
                                                                    onMouseEnter={() => setTagAddHlIdx(idx)}
                                                                    onClick={() => {
                                                                        addMeetingTag(t);
                                                                        setTagAddOpen(false);
                                                                        setTagAddSearch("");
                                                                    }}
                                                                >
                                                                    <TagPickRing name={t} catalogColor={cc} />
                                                                    <span className="archive-multi-select-name">{t}</span>
                                                                </button>
                                                            );
                                                        })}
                                                        {tagAddShowCreateRow && (
                                                            <button
                                                                type="button"
                                                                role="option"
                                                                className={`archive-detail-tag-add-create-row${tagAddHlIdx === tagAddFiltered.length ? " is-keyboard-highlight" : ""}`}
                                                                onMouseEnter={() => setTagAddHlIdx(tagAddFiltered.length)}
                                                                onClick={() => setNewTagAwaitingColor(tagAddSearch.trim())}
                                                            >
                                                                + Create tag &quot;{tagAddSearch.trim()}&quot;
                                                            </button>
                                                        )}
                                                        {tagAddFiltered.length === 0 && !tagAddShowCreateRow && (
                                                            (() => {
                                                                const trimmed = tagAddSearch.trim();
                                                                const dup = trimmed && (detail!.meeting.tags || []).some(
                                                                    tg => tg.toLowerCase() === trimmed.toLowerCase(),
                                                                );
                                                                const exhausted = !trimmed
                                                                    && catalogTags.filter((t) => !(detail!.meeting.tags || []).includes(t)).length === 0;
                                                                const msg = dup
                                                                    ? "That tag is already on this meeting"
                                                                    : exhausted
                                                                        ? "Every workspace tag is already on this meeting"
                                                                        : null;
                                                                return msg ? <div className="archive-multi-select-empty">{msg}</div> : null;
                                                            })()
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {/* Participants modal */}
            {participantsModalOpen && (
                <ArchiveModal title="Participants" onClose={() => setParticipantsModalOpen(false)}>
                    <div className="archive-detail-modal-search">
                        <Icon icon={Search01Icon} size={14} className="archive-detail-modal-search-icon" />
                        <input
                            autoFocus
                            className="archive-detail-modal-search-input"
                            placeholder="Search participants…"
                            value={participantSearch}
                            onChange={e => setParticipantSearch(e.target.value)}
                        />
                    </div>
                    <div className="archive-detail-modal-list">
                        {filteredParticipants.length === 0
                            ? <div className="archive-detail-modal-empty">No participants found</div>
                            : filteredParticipants.map(p => {
                                const pct = getSpeakingPct(p);
                                const hostId = detail.meeting.hostId;
                                const hid = hostId && typeof hostId === "object" ? (hostId as ArchiveParticipant)._id : hostId;
                                const isParticipantHost = hid && String(hid) === String(p._id);
                                return (
                                    <div key={p._id} className="archive-detail-modal-participant-row">
                                        <ParticipantAvatar participant={p} size={28} />
                                        <div className="archive-detail-modal-participant-info">
                                            <span className="archive-detail-modal-participant-name">
                                                {p.name || "Unknown"}
                                                {isParticipantHost && <span className="archive-detail-modal-host-chip">host</span>}
                                            </span>
                                            {p.email && <span className="archive-detail-modal-participant-email">{p.email}</span>}
                                        </div>
                                        {pct !== null && (
                                            <SpeakingBar pct={pct} estimatedSecs={speakingData.totalSecs} />
                                        )}
                                    </div>
                                );
                            })
                        }
                    </div>
                </ArchiveModal>
            )}

        </div>
    );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ParticipantAvatar({ participant, size = 24 }: { participant: ArchiveParticipant; size?: number }) {
    return (
        <UserAvatar
            name={participant.name || participant.email || "?"}
            profileImage={participant.profileImage}
            userId={participant._id}
            size={size}
            style={{ flexShrink: 0 }}
        />
    );
}

function SpeakingBar({ pct, estimatedSecs }: { pct: number; estimatedSecs?: number }) {
    const tooltip = estimatedSecs != null && estimatedSecs > 0
        ? (() => {
            const secs = Math.round(estimatedSecs * pct / 100);
            const h = Math.floor(secs / 3600);
            const m = Math.floor((secs % 3600) / 60);
            const s = secs % 60;
            const dur = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
            return `${pct}% speaking time (~${dur})`;
        })()
        : `${pct}% of transcript segments`;
    return (
        <div className="archive-detail-speaking-bar-wrap" title={tooltip}>
            <div className="archive-detail-speaking-bar-track">
                <div className="archive-detail-speaking-bar-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className="archive-detail-speaking-pct">{pct}%</span>
        </div>
    );
}

function ArchiveModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    const overlayRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);
    return (
        <div
            className="archive-detail-modal-overlay"
            ref={overlayRef}
            onClick={e => { if (e.target === overlayRef.current) onClose(); }}
        >
            <div className="archive-detail-modal" role="dialog" aria-modal aria-label={title}>
                <div className="archive-detail-modal-header">
                    <span className="archive-detail-modal-title">{title}</span>
                    <button type="button" className="archive-detail-modal-close" onClick={onClose} aria-label="Close">×</button>
                </div>
                <div className="archive-detail-modal-body">
                    {children}
                </div>
            </div>
        </div>
    );
}

function ArchiveSection({ title, defaultOpen = true, children }: {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="archive-detail-section">
            <button
                type="button"
                className={`archive-detail-section-title archive-detail-section-toggle${open ? "" : " is-closed"}`}
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
            >
                <span className="archive-detail-section-chevron" aria-hidden>
                    <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={16} />
                </span>
                {title}
            </button>
            {open && children}
        </div>
    );
}

interface AgendaSectionProps {
    item: { id: string; title: string; duration: number };
    index: number;
    segments: Array<{ id: string; speaker: string; timestamp: string; text: string }>;
    summary?: string;
}

function AgendaSection({ item, index, segments, summary }: AgendaSectionProps) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="glass-card" style={{ padding: "10px 14px", marginBottom: "8px" }}>
            <div
                style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
                onClick={() => setExpanded(e => !e)}
            >
                {index >= 0 && <span style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--text-muted)" }}>{index + 1}.</span>}
                <span style={{ fontWeight: 500, fontSize: "0.8125rem", flex: 1 }}>{item.title}</span>
                {item.duration > 0 && <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>{item.duration}m</span>}
                <span style={{ fontSize: "0.625rem", color: "var(--text-muted)" }}>{segments.length} segment{segments.length !== 1 ? "s" : ""}</span>
                <Icon icon={expanded ? ArrowUp01Icon : ArrowDown01Icon} size={16} />
            </div>

            {summary && (
                <p style={{ fontSize: "0.75rem", color: "var(--accent-emerald)", marginTop: "6px", fontStyle: "italic" }}>
                    {summary}
                </p>
            )}

            {expanded && segments.length > 0 && (
                <div style={{ marginTop: "8px", paddingLeft: "12px", borderLeft: "2px solid var(--border)" }}>
                    {segments.map(seg => (
                        <p key={seg.id} style={{ fontSize: "0.75rem", margin: "0 0 6px", lineHeight: 1.45, color: "var(--text-secondary)" }}>
                            <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{seg.timestamp || "—"}</span>
                            <span style={{ color: "var(--text-muted)" }}> · </span>
                            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{seg.speaker}</span>
                            <span style={{ color: "var(--text-muted)" }}> · </span>
                            {seg.text}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

function profileImageForTranscriptSpeaker(detail: ArchiveDetail, speakerName: string): string | null {
    const want = speakerName.trim().toLowerCase();
    if (!want) return null;
    const pool: ArchiveParticipant[] = [];
    const host = detail.meeting.hostId;
    if (host && typeof host === "object") pool.push(host as ArchiveParticipant);
    for (const p of detail.meeting.participants || []) pool.push(p);
    for (const p of pool) {
        const nm = (p.name || "").trim().toLowerCase();
        if (nm === want) return p.profileImage ?? null;
    }
    return null;
}

function SummaryList({ title, items }: { title: string; items?: string[] }) {
    if (!items || items.length === 0) return null;
    return (
        <div style={{ marginTop: "0.75rem" }}>
            <h4 className="archive-detail-summary-list-title">
                {title}
            </h4>
            <ul className="archive-detail-summary-list-items">
                {items.map((item, idx) => (
                    <li key={`${title}-${idx}`}>{item}</li>
                ))}
            </ul>
        </div>
    );
}

function ArchiveTranscriptExplorer({
    meetingId, detail, fetchWithAuth,
}: {
    meetingId: string;
    detail: ArchiveDetail;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
}) {
    const flat = useMemo(() => flattenTranscripts(detail), [detail]);

    const [contentQ, setContentQ] = useState("");
    const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
    const [debounced, setDebounced] = useState<{ c: string; s: string[] }>({ c: "", s: [] });
    const [serverSegments, setServerSegments] = useState<TranscriptSegment[]>([]);
    const [serverTotal, setServerTotal] = useState(0);
    const [serverSkip, setServerSkip] = useState(0);
    const [loading, setLoading] = useState(false);
    const [useServer, setUseServer] = useState(false);
    const [sectionOpen, setSectionOpen] = useState(true);

    useEffect(() => {
        const t = setTimeout(
            () => setDebounced({
                c: contentQ.trim(),
                s: selectedSpeakers.map((x) => x.trim()).filter(Boolean),
            }),
            TRANSCRIPT_DEBOUNCE_MS,
        );
        return () => clearTimeout(t);
    }, [contentQ, selectedSpeakers]);

    const transcriptSpeakerOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const seg of flat) {
            const raw = (seg.speaker || "").trim();
            if (!raw) continue;
            const key = raw.toLowerCase();
            if (!seen.has(key)) seen.set(key, raw);
        }
        return [...seen.values()]
            .sort((a, b) => a.localeCompare(b))
            .map((label) => ({
                value: label,
                label,
                profileImage: profileImageForTranscriptSpeaker(detail, label),
            }));
    }, [flat, detail]);

    const needIndexedSearch = debounced.c.length >= 2 || debounced.s.length >= 1;
    const speakersKey = debounced.s.join("\u0001");
    const preferServer = flat.length > 200 || useServer;

    useEffect(() => {
        if (!needIndexedSearch || !preferServer) {
            setServerSegments([]); setServerTotal(0); setServerSkip(0);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setServerSegments([]); setServerTotal(0); setServerSkip(0);
        const params = new URLSearchParams();
        if (debounced.c) params.set("q", debounced.c);
        for (const sp of debounced.s) params.append("speaker", sp);
        params.set("limit", "100");
        params.set("skip", "0");
        (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/transcript-query?${params}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled || !data) return;
                setServerSegments(data.segments || []);
                setServerTotal(typeof data.total === "number" ? data.total : 0);
                setServerSkip((data.segments || []).length);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // speakersKey collapses the array dependency into a stable string so the effect doesn't refetch on identity changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced.c, speakersKey, meetingId, fetchWithAuth, needIndexedSearch, preferServer]);

    const loadMoreServer = useCallback(async () => {
        if (!needIndexedSearch || !preferServer || loading || serverSegments.length >= serverTotal) return;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (debounced.c) params.set("q", debounced.c);
            for (const sp of debounced.s) params.append("speaker", sp);
            params.set("limit", "100");
            params.set("skip", String(serverSkip));
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/transcript-query?${params}`);
            if (!res.ok) return;
            const data = await res.json();
            const next = data.segments || [];
            setServerSegments((prev) => [...prev, ...next]);
            setServerSkip((prev) => prev + next.length);
        } finally {
            setLoading(false);
        }
    }, [needIndexedSearch, preferServer, loading, serverSegments.length, serverTotal, serverSkip, debounced, meetingId, fetchWithAuth]);

    const displayed = useMemo(() => {
        if (needIndexedSearch && preferServer) return serverSegments;
        const c = debounced.c.toLowerCase();
        const speakerSet = new Set(debounced.s.map((x) => x.toLowerCase()));
        const speakerFilterActive = speakerSet.size > 0;
        return flat.filter((seg) => {
            const okC = !c
                || seg.text.toLowerCase().includes(c)
                || String(seg.timestamp || "").toLowerCase().includes(c);
            const segSp = String(seg.speaker || "").trim().toLowerCase();
            const okS = !speakerFilterActive || speakerSet.has(segSp);
            return okC && okS;
        });
    }, [flat, debounced.c, debounced.s, needIndexedSearch, preferServer, serverSegments]);

    if (flat.length === 0) return null;

    const showLoadMore = needIndexedSearch && preferServer && serverSegments.length > 0 && serverSegments.length < serverTotal;

    return (
        <div className="archive-detail-section" style={{ marginBottom: "1.5rem" }}>
            <button
                type="button"
                className={`archive-detail-section-title archive-detail-section-toggle${sectionOpen ? "" : " is-closed"}`}
                onClick={() => setSectionOpen(o => !o)}
                aria-expanded={sectionOpen}
            >
                <span className="archive-detail-section-chevron" aria-hidden>
                    <Icon icon={sectionOpen ? ArrowDown01Icon : ArrowRight01Icon} size={16} />
                </span>
                Transcript
            </button>
            {sectionOpen && <><p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                Filter by text, meeting time (e.g. 5:30 = 5 min 30 sec from start of recording), or speaker. Large meetings use indexed search automatically; you can force it below.
            </p>
            <div className="archive-detail-transcript-filters">
                <input
                    className="input-field archive-detail-transcript-search-input"
                    placeholder="Search content or time…"
                    value={contentQ}
                    onChange={(e) => setContentQ(e.target.value)}
                    aria-label="Search transcript content"
                />
                <TranscriptSpeakerSelect
                    options={transcriptSpeakerOptions}
                    value={selectedSpeakers}
                    onChange={setSelectedSpeakers}
                />
            </div>
            {flat.length > 200 && (
                <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", marginBottom: "0.5rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={useServer} onChange={(e) => setUseServer(e.target.checked)} />
                    Always use indexed (MongoDB) search for this meeting
                </label>
            )}
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                {loading && "Searching… "}
                Showing {displayed.length}
                {needIndexedSearch && preferServer && serverTotal > 0 ? ` of ${serverTotal} matches` : ` segment${displayed.length !== 1 ? "s" : ""}`}
            </div>
            <div className="glass-card archive-detail-transcript-list" >
                {displayed.map((seg) => (
                    <div
                        key={String(seg.id)}
                        style={{ padding: "0.25rem 0", fontSize: "0.8125rem", lineHeight: 1.45, color: "var(--text-secondary)" }}
                    >
                        <span style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{seg.timestamp || "—"}</span>
                        <span style={{ color: "var(--text-muted)" }}> · </span>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{seg.speaker || "Unknown"}</span>
                        <span style={{ color: "var(--text-muted)" }}> · </span>
                        <span>{seg.text}</span>
                        {seg.agendaKey && seg.agendaKey !== "_unlinked" && (
                            <span className="chip" style={{ fontSize: "0.5rem", padding: "1px 6px", marginLeft: "6px" }}>agenda</span>
                        )}
                    </div>
                ))}
            </div>
            {showLoadMore && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: "0.5rem" }} onClick={loadMoreServer}>
                    Load more results
                </button>
            )}</>}
        </div>
    );
}
