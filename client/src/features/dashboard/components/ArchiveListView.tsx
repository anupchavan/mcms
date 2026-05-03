import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../../../shared/components/Icon";
import { Search01Icon, Calendar02Icon, UserIcon } from "@hugeicons/core-free-icons";
import {
    ArchiveMeeting, formatArchiveDate, parseArchiveSearchInput, SEARCH_DEBOUNCE_MS,
} from "./archiveHelpers";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

interface ArchiveListViewProps {
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onSelectMeeting: (meetingId: string) => void;
}

export default function ArchiveListView({ fetchWithAuth, onSelectMeeting }: ArchiveListViewProps) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<ArchiveMeeting[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewAll, setViewAll] = useState(false);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availablePeople, setAvailablePeople] = useState<{ _id: string; name: string; email: string }[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const fetchFilters = async () => {
            try {
                const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/filters`);
                if (res.ok) {
                    const data = await res.json();
                    setAvailableTags(data.tags || []);
                    setAvailablePeople(data.people || []);
                }
            } catch (err) { console.error("Failed to load archive filters:", err); }
        };
        fetchFilters();
    }, [fetchWithAuth]);

    const search = useCallback(async (searchInput: string, tags: string[], people: string[], fetchAll: boolean) => {
        const { textQuery, dateFrom, dateTo } = parseArchiveSearchInput(searchInput);
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (textQuery.trim()) params.set("q", textQuery.trim());
            if (dateFrom) params.set("dateFrom", dateFrom);
            if (dateTo) params.set("dateTo", dateTo);
            if (tags.length > 0) params.set("tags", tags.join(","));
            if (people.length > 0) params.set("people", people.join(","));

            if (!textQuery.trim() && !dateFrom && !dateTo && tags.length === 0 && people.length === 0 && !fetchAll) {
                params.set("limit", "5");
            }

            const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive?${params.toString()}`);
            if (res.ok) setResults(await res.json());
        } catch (err) { console.error("Archive search failed:", err); }
        setLoading(false);
    }, [fetchWithAuth]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const isSearchEmpty = parseArchiveSearchInput(query).textQuery.trim() === "" && !parseArchiveSearchInput(query).dateFrom;
        if (!isSearchEmpty && viewAll) setViewAll(false);
        debounceRef.current = setTimeout(() => search(query, selectedTags, selectedPeople, viewAll), SEARCH_DEBOUNCE_MS);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, selectedTags, selectedPeople, viewAll, search]);

    return (
        <div className="archive-container">
            <div className="page-header">
                <h2 style={{ fontSize: "var(--font-size-title3)", fontWeight: 600, marginBottom: "var(--lk-size-2xs)", letterSpacing: "-0.022em" }}>
                    Meeting Archives
                </h2>
                <p style={{ fontSize: "var(--font-size-body)", color: "var(--text-secondary)", marginBottom: "calc(var(--lk-size-sm) * var(--font-size-title3)/1rem)" }}>
                    Search and browse past meeting transcripts, summaries, and action items.
                </p>
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
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem" }}>
                    <div style={{ flex: 1 }}>
                        <MultiSelectDropdown
                            options={availableTags.map(t => ({ value: t, label: t }))}
                            selected={selectedTags}
                            onChange={setSelectedTags}
                            placeholder="Filter by tags"
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <MultiSelectDropdown
                            options={availablePeople.map(p => ({ value: p._id, label: `${p.name} (${p.email})` }))}
                            selected={selectedPeople}
                            onChange={setSelectedPeople}
                            placeholder="Filter by people"
                        />
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="meeting-list">
                    <p style={{ color: "var(--text-muted)" }}>Searching...</p>
                </div>
            ) : (
                <div className="meeting-list">
                    {results.map(meeting => (
                        <div
                            key={meeting.id}
                            className="meeting-card glass-card"
                            style={{ cursor: "pointer" }}
                            onClick={() => onSelectMeeting(meeting.shortId || meeting.id)}
                        >
                            <div className="meeting-card-title">{meeting.title}</div>
                            <div className="meeting-card-meta">
                                {meeting.date && <span><Icon icon={Calendar02Icon} size={14} /> {formatArchiveDate(meeting.date)}</span>}
                                <span><Icon icon={UserIcon} size={14} /> {meeting.host}</span>
                                <span className="chip chip-emerald">Completed</span>
                            </div>
                            {meeting.matchedTranscripts && meeting.matchedTranscripts.length > 0 && (
                                <div style={{ marginTop: "6px" }}>
                                    {meeting.matchedTranscripts.map((t, i) => (
                                        <p key={i} style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: "2px 0", lineHeight: 1.4 }}>
                                            {t.timestamp ? `${t.timestamp} · ` : ""}{t.speaker} · {t.text.length > 120 ? t.text.slice(0, 120) + "..." : t.text}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    {results.length === 0 && !loading && (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No completed meetings found.</p>
                    )}

                    {!loading && !query.trim() && selectedTags.length === 0 && selectedPeople.length === 0 && !viewAll && results.length > 0 && (
                        <div style={{ textAlign: "center", marginTop: "1.5rem", marginBottom: "1rem" }}>
                            <button className="btn btn-secondary" onClick={() => setViewAll(true)}>
                                Load Full History
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function MultiSelectDropdown({ options, selected, onChange, placeholder }: any) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ position: "relative", width: "100%" }}>
            <div
                className="input-field"
                onClick={() => setOpen(!open)}
                style={{ cursor: "pointer", display: "flex", flexWrap: "wrap", gap: "4px", minHeight: "38px", alignItems: "center", padding: "6px 12px" }}
            >
                {selected.length === 0 ? <span style={{ color: "var(--text-muted)" }}>{placeholder}</span> : null}
                {selected.map((val: string) => {
                    const opt = options.find((o: any) => o.value === val);
                    return <span key={val} className="chip chip-emerald" style={{ fontSize: "0.75rem", padding: "2px 6px", margin: 0 }}>{opt ? opt.label : val}</span>;
                })}
            </div>
            {open && (
                <div className="glass-card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, maxHeight: "200px", overflowY: "auto", padding: "4px", marginTop: "4px" }}>
                    {options.length === 0 ? <div style={{ padding: "8px", color: "var(--text-muted)", fontSize: "0.875rem" }}>No options available</div> : null}
                    {options.map((opt: any) => (
                        <div
                            key={opt.value}
                            onClick={() => {
                                if (selected.includes(opt.value)) onChange(selected.filter((v: string) => v !== opt.value));
                                else onChange([...selected, opt.value]);
                            }}
                            style={{ padding: "6px 10px", fontSize: "0.875rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", borderRadius: "4px", backgroundColor: selected.includes(opt.value) ? "var(--bg-hover)" : "transparent" }}
                        >
                            <input type="checkbox" checked={selected.includes(opt.value)} readOnly style={{ margin: 0 }} />
                            {opt.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
