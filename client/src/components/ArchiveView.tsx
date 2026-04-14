import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Icon from './Icon';
import ActionItems from './ActionItems';
import {
    Search01Icon, Calendar02Icon, UserIcon,
    ArrowDown01Icon, ArrowUp01Icon, Clock01Icon,
    FlashIcon, PinIcon, Notebook01Icon, PencilEdit02Icon, Location01Icon
} from '@hugeicons/core-free-icons';
import * as chrono from 'chrono-node';
import LocationMapModal from './LocationMapModal';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
}

/** Parse natural language date range from search input. Returns { textQuery, dateFrom, dateTo }. */
function parseArchiveSearchInput(input) {
    const trimmed = input.trim();
    const now = new Date();
    if (!trimmed) return { textQuery: '', dateFrom: null, dateTo: null };

    const parsed = chrono.parse(trimmed, now);
    let textQuery = trimmed;
    let dateFrom = null;
    let dateTo = null;

    for (const p of parsed) {
        textQuery = textQuery.replace(p.text, ' ');
    }
    textQuery = textQuery.replace(/\b(from|since|till|to|until)\b\s*/gi, '').replace(/\s+/g, ' ').trim();

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
        const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0);
        const endOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59);

        if (p.end) {
            dateFrom = startOfDay(p.start.date());
            dateTo = endOfDay(p.end.date());
        } else if (hasFrom && !hasTo) {
            dateFrom = startOfDay(d);
        } else if (hasTo && !hasFrom) {
            dateTo = endOfDay(d);
        } else {
            dateFrom = startOfDay(d);
            dateTo = endOfDay(d);
        }
    }

    return {
        textQuery,
        dateFrom: dateFrom ? dateFrom.toISOString().slice(0, 10) : null,
        dateTo: dateTo ? dateTo.toISOString().slice(0, 10) : null,
    };
}

interface ArchiveMeeting {
    id: string;
    title: string;
    date?: string;
    time?: string;
    host: string;
    location?: string;
    modality?: string;
    matchedTranscripts?: Array<{ speaker: string; text: string; timestamp?: string }>;
}

interface TranscriptSegment {
    id: string;
    speaker: string;
    timestamp: string;
    text: string;
    agendaItemId?: string | null;
    agendaKey?: string;
    createdAt?: string;
}

interface ArchiveDetail {
    meeting: { title: string; date?: string; time?: string; host: string; location?: string; modality?: string };
    agendaItems: Array<{ id: string; title: string; duration: number }>;
    transcriptsByAgenda: Record<string, Array<{ id: string; speaker: string; timestamp: string; text: string }>>;
    transcriptFlat?: TranscriptSegment[];
    actionItems: Array<{ id: string; title: string; status: string; assignee?: string; source?: string }>;
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

interface ArchiveViewProps {
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    initialMeetingId?: string | null;
    onInitialMeetingHandled?: () => void;
}

interface AgendaSectionProps {
    item: { id: string; title: string; duration: number };
    index: number;
    segments: Array<{ id: string; speaker: string; timestamp: string; text: string }>;
    summary?: string;
    meetingId: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const TRANSCRIPT_DEBOUNCE_MS = 350;

function flattenTranscripts(detail: ArchiveDetail): TranscriptSegment[] {
    if (detail.transcriptFlat?.length) return detail.transcriptFlat;
    const by = detail.transcriptsByAgenda || {};
    return Object.entries(by).flatMap(([key, segs]) =>
        (segs || []).map((s) => ({ ...s, agendaKey: key })),
    );
}

function ArchiveTranscriptExplorer({
    meetingId,
    detail,
    fetchWithAuth,
}: {
    meetingId: string;
    detail: ArchiveDetail;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
}) {
    const flat = useMemo(() => flattenTranscripts(detail), [detail]);

    const [contentQ, setContentQ] = useState('');
    const [speakerQ, setSpeakerQ] = useState('');
    const [debounced, setDebounced] = useState({ c: '', s: '' });
    const [serverSegments, setServerSegments] = useState<TranscriptSegment[]>([]);
    const [serverTotal, setServerTotal] = useState(0);
    const [serverSkip, setServerSkip] = useState(0);
    const [loading, setLoading] = useState(false);
    const [useServer, setUseServer] = useState(false);

    useEffect(() => {
        const t = setTimeout(
            () => setDebounced({ c: contentQ.trim(), s: speakerQ.trim() }),
            TRANSCRIPT_DEBOUNCE_MS,
        );
        return () => clearTimeout(t);
    }, [contentQ, speakerQ]);

    const needIndexedSearch = debounced.c.length >= 2 || debounced.s.length >= 1;
    const preferServer = flat.length > 200 || useServer;

    useEffect(() => {
        if (!needIndexedSearch || !preferServer) {
            setServerSegments([]);
            setServerTotal(0);
            setServerSkip(0);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setServerSegments([]);
        setServerTotal(0);
        setServerSkip(0);
        const params = new URLSearchParams();
        if (debounced.c) params.set('q', debounced.c);
        if (debounced.s) params.set('speaker', debounced.s);
        params.set('limit', '100');
        params.set('skip', '0');
        (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/transcript-query?${params}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled || !data) return;
                setServerSegments(data.segments || []);
                setServerTotal(typeof data.total === 'number' ? data.total : 0);
                setServerSkip((data.segments || []).length);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [debounced.c, debounced.s, meetingId, fetchWithAuth, needIndexedSearch, preferServer]);

    const loadMoreServer = useCallback(async () => {
        if (!needIndexedSearch || !preferServer || loading || serverSegments.length >= serverTotal) return;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (debounced.c) params.set('q', debounced.c);
            if (debounced.s) params.set('speaker', debounced.s);
            params.set('limit', '100');
            params.set('skip', String(serverSkip));
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
        const sp = debounced.s.toLowerCase();
        return flat.filter((seg) => {
            const okC =
                !c ||
                seg.text.toLowerCase().includes(c) ||
                String(seg.timestamp || '').toLowerCase().includes(c);
            const okS = !sp || String(seg.speaker || '').toLowerCase().includes(sp);
            return okC && okS;
        });
    }, [flat, debounced.c, debounced.s, needIndexedSearch, preferServer, serverSegments]);

    if (flat.length === 0) return null;

    const showLoadMore =
        needIndexedSearch &&
        preferServer &&
        serverSegments.length > 0 &&
        serverSegments.length < serverTotal;

    return (
        <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                <Icon icon={Search01Icon} size={14} /> Transcript search
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Filter by text, meeting time (e.g. 5:30 = 5 min 30 sec from start of recording), or speaker. Large meetings use indexed search automatically; you can force it below.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                    className="input-field"
                    style={{ flex: '1 1 12rem', minWidth: '10rem' }}
                    placeholder="Search content or time…"
                    value={contentQ}
                    onChange={(e) => setContentQ(e.target.value)}
                    aria-label="Search transcript content"
                />
                <input
                    className="input-field"
                    style={{ flex: '1 1 10rem', minWidth: '8rem' }}
                    placeholder="Speaker name…"
                    value={speakerQ}
                    onChange={(e) => setSpeakerQ(e.target.value)}
                    aria-label="Filter by speaker"
                />
            </div>
            {flat.length > 200 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', marginBottom: '0.5rem', cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={useServer}
                        onChange={(e) => setUseServer(e.target.checked)}
                    />
                    Always use indexed (MongoDB) search for this meeting
                </label>
            )}
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                {loading && 'Searching… '}
                Showing {displayed.length}
                {needIndexedSearch && preferServer && serverTotal > 0 ? ` of ${serverTotal} matches` : ` segment${displayed.length !== 1 ? 's' : ''}`}
            </div>
            <div
                className="glass-card"
                style={{
                    maxHeight: '22rem',
                    overflowY: 'auto',
                    padding: '0.5rem 0.75rem',
                }}
            >
                {displayed.map((seg) => (
                    <div
                        key={String(seg.id)}
                        style={{
                            padding: '0.5rem 0',
                            borderBottom: '1px solid var(--border)',
                            fontSize: '0.8125rem',
                            lineHeight: 1.45,
                            color: 'var(--text-secondary)',
                        }}
                    >
                        <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{seg.timestamp || '—'}</span>
                        <span style={{ color: 'var(--text-muted)' }}> · </span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{seg.speaker || 'Unknown'}</span>
                        <span style={{ color: 'var(--text-muted)' }}> · </span>
                        <span>{seg.text}</span>
                        {seg.agendaKey && seg.agendaKey !== '_unlinked' && (
                            <span className="chip" style={{ fontSize: '0.5rem', padding: '1px 6px', marginLeft: '6px' }}>agenda</span>
                        )}
                    </div>
                ))}
            </div>
            {showLoadMore && (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }} onClick={loadMoreServer}>
                    Load more results
                </button>
            )}
        </div>
    );
}

export default function ArchiveView({ fetchWithAuth, initialMeetingId = null, onInitialMeetingHandled }: ArchiveViewProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ArchiveMeeting[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
    const [detail, setDetail] = useState<ArchiveDetail | null>(null);
    const [summaries, setSummaries] = useState<Record<string, string>>({});
    const [loadingSummary, setLoadingSummary] = useState(false);
    const [finalSummary, setFinalSummary] = useState<ArchiveDetail['meetingSummary']>(null);
    const [loadingFinalSummary, setLoadingFinalSummary] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [locationModalAddress, setLocationModalAddress] = useState<string | null>(null);
    const initialMeetingLoadedRef = useRef<string | null>(null);

    const search = useCallback(async (searchInput: string) => {
        const { textQuery, dateFrom, dateTo } = parseArchiveSearchInput(searchInput);
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (textQuery.trim()) params.set('q', textQuery.trim());
            if (dateFrom) params.set('dateFrom', dateFrom);
            if (dateTo) params.set('dateTo', dateTo);

            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive?${params.toString()}`);
            if (res.ok) setResults(await res.json());
        } catch (err) {
            console.error('Archive search failed:', err);
        }
        setLoading(false);
    }, [fetchWithAuth]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => search(query), SEARCH_DEBOUNCE_MS);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, search]);

    useEffect(() => {
        if (!initialMeetingId) return;
        if (initialMeetingLoadedRef.current === initialMeetingId) return;
        initialMeetingLoadedRef.current = initialMeetingId;
        loadDetail(initialMeetingId);
        onInitialMeetingHandled?.();
    }, [initialMeetingId, onInitialMeetingHandled]);

    const loadDetail = async (meetingId: string) => {
        setSelectedMeeting(meetingId);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}`);
            if (res.ok) {
                const data = await res.json();
                setDetail(data);
                setFinalSummary(data.meetingSummary || null);
            }
        } catch (err) {
            console.error('Failed to load archive detail:', err);
        }
    };

    const loadFinalSummary = async (meetingId: string) => {
        setLoadingFinalSummary(true);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/final-summary`);
            if (res.ok) {
                const data = await res.json();
                const normalized = data.summary ? {
                    overview: data.summary.overview || '',
                    discussionPoints: data.summary.discussion_points || [],
                    completedItems: data.summary.completed_items || [],
                    pendingItems: data.summary.pending_items || [],
                    decisions: data.summary.decisions || [],
                    nextSteps: data.summary.next_steps || [],
                    model: data.summary.model,
                    generatedAt: data.summary.generated_at,
                } : null;
                setFinalSummary(normalized);
                setDetail((prev) => prev ? ({ ...prev, meetingSummary: normalized }) : prev);
            }
        } catch (err) {
            console.error('Failed to load final summary:', err);
        }
        setLoadingFinalSummary(false);
    };

    const loadSummary = async (meetingId: string) => {
        setLoadingSummary(true);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${meetingId}/summary`);
            if (res.ok) {
                const data = await res.json();
                setSummaries(data.summaries || {});
            }
        } catch (err) {
            console.error('Failed to load summary:', err);
        }
        setLoadingSummary(false);
    };

    if (selectedMeeting && detail) {
        return (
            <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setSelectedMeeting(null); setDetail(null); setSummaries({}); setFinalSummary(null); }}
                    style={{ marginBottom: '1rem' }}
                >
                    Back to Archives
                </button>

                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                    {detail.meeting.title}
                </h2>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    <Icon icon={Calendar02Icon} size={12} /> {formatDate(detail.meeting.date)}
                    {detail.meeting.time && <> &middot; <Icon icon={Clock01Icon} size={12} /> {detail.meeting.time}</>}
                    &middot; <Icon icon={UserIcon} size={12} /> {detail.meeting.host}
                    {detail.meeting.location && (
                        <>
                        &middot; 
                        <button
                            type="button"
                            onClick={() => setLocationModalAddress(detail.meeting.location!)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '3px', padding: 0, font: 'inherit', fontSize: '0.8125rem' }}
                        >
                            <Icon icon={Location01Icon} size={12} /> {detail.meeting.location}
                        </button>
                        </>
                    )}
                </p>

                <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        <Icon icon={Notebook01Icon} size={14} /> Meeting Summary
                    </h3>
                    {finalSummary ? (
                        <div className="glass-card" style={{ padding: '14px 16px' }}>
                            <p style={{ fontSize: '0.875rem', lineHeight: 1.55, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                                {finalSummary.overview || 'No overview available.'}
                            </p>
                            <SummaryList title="Discussion Points" items={finalSummary.discussionPoints} />
                            <SummaryList title="Completed" items={finalSummary.completedItems} />
                            <SummaryList title="Pending" items={finalSummary.pendingItems} />
                            <SummaryList title="Decisions" items={finalSummary.decisions} />
                            <SummaryList title="Next Steps" items={finalSummary.nextSteps} />
                            <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 }}>
                                Model: {finalSummary.model || 'unknown'}
                                {finalSummary.generatedAt ? ` · Generated ${new Date(finalSummary.generatedAt).toLocaleString()}` : ''}
                            </p>
                        </div>
                    ) : (
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={() => loadFinalSummary(selectedMeeting)}
                            disabled={loadingFinalSummary}
                        >
                            {loadingFinalSummary ? 'Generating...' : 'Generate Meeting Summary'}
                        </button>
                    )}
                </div>

                {!Object.keys(summaries).length && (
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => loadSummary(selectedMeeting)}
                        disabled={loadingSummary}
                        style={{ marginBottom: '1rem' }}
                    >
                        {loadingSummary ? 'Generating...' : 'Generate Key Point Summaries'}
                    </button>
                )}

                <ArchiveTranscriptExplorer meetingId={selectedMeeting} detail={detail} fetchWithAuth={fetchWithAuth} />

                {detail.agendaItems.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                            <Icon icon={Notebook01Icon} size={14} /> Agenda & Transcript
                        </h3>
                        {detail.agendaItems.map((item, idx) => {
                            const segments = detail.transcriptsByAgenda[item.id] || [];
                            const summary = summaries[item.id];
                            return (
                                <AgendaSection key={item.id} item={item} index={idx} segments={segments} summary={summary} meetingId={selectedMeeting} fetchWithAuth={fetchWithAuth} onRefresh={() => loadDetail(selectedMeeting)} />
                            );
                        })}

                        {detail.transcriptsByAgenda._unlinked?.length > 0 && (
                            <AgendaSection
                                item={{ id: '_unlinked', title: 'Unlinked Segments', duration: 0 }}
                                index={-1}
                                segments={detail.transcriptsByAgenda._unlinked}
                                meetingId={selectedMeeting}
                                fetchWithAuth={fetchWithAuth}
                                onRefresh={() => loadDetail(selectedMeeting)}
                            />
                        )}
                    </div>
                )}

                {detail.actionItems.length > 0 && (
                    <div style={{ marginBottom: '1.5rem', marginTop: '-0.5rem' }}>
                        <ActionItems 
                            items={detail.actionItems as any}
                            meetingId={selectedMeeting}
                            fetchWithAuth={fetchWithAuth}
                            onRefresh={() => loadDetail(selectedMeeting)}
                        />
                    </div>
                )}

                {detail.pins.length > 0 && (
                    <div>
                        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                            <Icon icon={PinIcon} size={14} /> Resource Pins
                        </h3>
                        {detail.pins.map(pin => (
                            <div key={pin.id} className="glass-card" style={{ padding: '8px 12px', marginBottom: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem' }}>
                                    <span className="chip chip-cyan" style={{ fontSize: '0.5625rem' }}>{pin.type}</span>
                                    <a href={pin.url || '#'} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500, color: 'var(--primary)' }}>
                                        {pin.label || pin.url || 'Code snippet'}
                                    </a>
                                    <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: '0.6875rem' }}>
                                        at {pin.transcriptTimestamp || '—'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <>
        <div className="archive-container">
            <div className="page-header">
                <h2 style={{ fontSize: 'var(--font-size-title3)', fontWeight: 600, marginBottom: 'var(--lk-size-2xs)', letterSpacing: '-0.022em' }}>Meeting Archives</h2>
                <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', marginBottom: 'calc(var(--lk-size-sm) * var(--font-size-title3)/1rem)' }}>Search and browse past meeting transcripts, summaries, and action items.</p>
            </div>

            <div className="archive-search-bar">
                <div className="archive-search-input-wrap">
                    <Icon icon={Search01Icon} size={14} className="archive-search-icon" />
                    <input
                        className="input-field"
                        placeholder="Search transcripts, keywords... or filter by date: from last week, since yesterday, till last friday, from last wed to this sat..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
            </div>

            {loading ? (
				<div className="meeting-list">
                <p style={{ color: 'var(--text-muted)' }}>Searching...</p>
				</div>

            ) : (
                <div className="meeting-list">
                    {results.map(meeting => (
                        <div
                            key={meeting.id}
                            className="meeting-card glass-card"
                            style={{ cursor: 'pointer' }}
                            onClick={() => loadDetail(meeting.id)}
                        >
                            <div className="meeting-card-title">{meeting.title}</div>
                            <div className="meeting-card-meta">
                                {meeting.date && <span><Icon icon={Calendar02Icon} size={14} /> {formatDate(meeting.date)}</span>}
                                <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                                {meeting.location && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setLocationModalAddress(meeting.location!); }}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                                            padding: '1px 8px', borderRadius: '999px',
                                            border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                                            cursor: 'pointer', color: 'var(--text-secondary)',
                                            fontSize: '0.75rem', fontWeight: 500, lineHeight: 1.6,
                                        }}
                                        title={meeting.location}
                                    >
                                        <Icon icon={Location01Icon} size={12} /> Location
                                    </button>
                                )}
                                <span className="chip chip-emerald">Completed</span>
                            </div>
                            {meeting.matchedTranscripts?.length > 0 && (
                                <div style={{ marginTop: '6px' }}>
                                    {meeting.matchedTranscripts.map((t, i) => (
                                        <p key={i} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '2px 0', lineHeight: 1.4 }}>
                                            {t.timestamp ? `${t.timestamp} · ` : ''}{t.speaker} · {t.text.length > 120 ? t.text.slice(0, 120) + '...' : t.text}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    {results.length === 0 && !loading && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No completed meetings found.</p>
                    )}
                </div>
            )}
        </div>
        {locationModalAddress && (
            <LocationMapModal address={locationModalAddress} onClose={() => setLocationModalAddress(null)} />
        )}
        </>
    );
}

function SummaryList({ title, items }: { title: string; items?: string[] }) {
    if (!items || items.length === 0) return null;
    return (
        <div style={{ marginTop: '0.75rem' }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {title}
            </h4>
            <ul style={{ margin: 0, paddingLeft: '1rem', color: 'var(--text-secondary)', fontSize: '0.8125rem', lineHeight: 1.5 }}>
                {items.map((item, idx) => (
                    <li key={`${title}-${idx}`}>{item}</li>
                ))}
            </ul>
        </div>
    );
}

function AgendaSection({ item, index, segments, summary, meetingId, fetchWithAuth, onRefresh }: AgendaSectionProps) {
    const [expanded, setExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({ title: item.title, duration: item.duration });

    const handleSave = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!meetingId || item.id === '_unlinked') {
            setIsEditing(false);
            return;
        }
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/agenda/${meetingId}/items/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editData),
            });
            if (res.ok) {
                setIsEditing(false);
                onRefresh();
            }
        } catch (err) {
            console.error('Failed to update agenda item:', err);
        }
    };

    return (
        <div className="glass-card" style={{ padding: '10px 14px', marginBottom: '8px' }}>
            <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                onClick={() => { if (!isEditing) setExpanded(e => !e); }}
            >
                {index >= 0 && <span style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{index + 1}.</span>}
                
                {isEditing ? (
                    <div style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                            className="input-field"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.8125rem' }}
                            value={editData.title}
                            onChange={e => setEditData(prev => ({ ...prev, title: e.target.value }))}
                        />
                        <input
                            type="number"
                            className="input-field"
                            style={{ width: '60px', padding: '4px 8px', fontSize: '0.8125rem' }}
                            value={editData.duration}
                            onChange={e => setEditData(prev => ({ ...prev, duration: Number(e.target.value) }))}
                        />
                        <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
                        <button className="btn btn-sm btn-secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                    </div>
                ) : (
                    <>
                        <span style={{ fontWeight: 500, fontSize: '0.8125rem', flex: 1 }}>{item.title}</span>
                        {item.duration > 0 && <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{item.duration}m</span>}
                        <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>{segments.length} segment{segments.length !== 1 ? 's' : ''}</span>
                        
                        {meetingId && item.id !== '_unlinked' && (
                            <button
                                className="btn-icon btn-icon-sm"
                                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                title="Edit agenda item"
                            >
                                <Icon icon={PencilEdit02Icon} size={12} />
                            </button>
                        )}
                        <Icon icon={expanded ? ArrowUp01Icon : ArrowDown01Icon} size={12} />
                    </>
                )}
            </div>

            {summary && (
                <p style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', marginTop: '6px', fontStyle: 'italic' }}>
                    {summary}
                </p>
            )}

            {expanded && segments.length > 0 && (
                <div style={{ marginTop: '8px', paddingLeft: '12px', borderLeft: '2px solid var(--border)' }}>
                    {segments.map(seg => (
                        <p key={seg.id} style={{ fontSize: '0.75rem', margin: '0 0 6px', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{seg.timestamp || '—'}</span>
                            <span style={{ color: 'var(--text-muted)' }}> · </span>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{seg.speaker}</span>
                            <span style={{ color: 'var(--text-muted)' }}> · </span>
                            {seg.text}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
