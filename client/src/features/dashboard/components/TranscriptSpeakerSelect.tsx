import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import Icon from "../../../shared/components/Icon";
import {
    ArrowDown01Icon,
    ArrowUp01Icon,
    Search01Icon,
    UserIcon,
} from "@hugeicons/core-free-icons";
import { avatarUrlFromPath } from "../../../shared/avatarUrl";

export type TranscriptSpeakerOption = {
    value: string;
    label: string;
    profileImage?: string | null;
};

function StackDisc({ opt }: { opt: TranscriptSpeakerOption | null }) {
    const [broken, setBroken] = useState(false);
    const url = opt ? avatarUrlFromPath(opt.profileImage ?? null) : null;
    if (opt && url && !broken) {
        return (
            <span className="archive-filter-stack-disc archive-filter-stack-disc--photo">
                <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
            </span>
        );
    }
    return (
        <span className="archive-filter-stack-disc archive-filter-stack-disc--person-fallback" aria-hidden>
            <Icon icon={UserIcon} size={11} className="archive-filter-stack-disc-user-icon" />
        </span>
    );
}

function RowAvatar({ imgUrl, label }: { imgUrl: string | null; label: string }) {
    const [photoBroken, setPhotoBroken] = useState(false);
    useEffect(() => {
        setPhotoBroken(false);
    }, [imgUrl]);
    const showPhoto = imgUrl && !photoBroken;
    if (showPhoto) {
        return (
            <span className="archive-multi-select-avatar archive-multi-select-avatar--photo">
                <img
                    src={imgUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setPhotoBroken(true)}
                />
            </span>
        );
    }
    return (
        <span className="archive-multi-select-avatar archive-multi-select-avatar--person-fallback" aria-hidden>
            <Icon icon={UserIcon} size={12} className="archive-multi-select-avatar-user-icon" />
        </span>
    );
}

/** Single-select speaker control; same visual language as archive search People multi-select, narrower. */
export function TranscriptSpeakerSelect({
    options,
    value,
    onChange,
}: {
    options: TranscriptSpeakerOption[];
    value: string;
    onChange: (next: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [filterText, setFilterText] = useState("");
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelSearchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const highlightIndexRef = useRef(-1);

    const rows = useMemo(
        () => [{ value: "", label: "All speakers", profileImage: null as string | null }, ...options],
        [options],
    );

    const normalizedFilter = filterText.trim().toLowerCase();
    const filtered = useMemo(() => {
        if (!normalizedFilter) return rows;
        return rows.filter((o) => (o.label || "").toLowerCase().includes(normalizedFilter));
    }, [rows, normalizedFilter]);

    const selectedMeta = useMemo(() => {
        if (!value) return null;
        return options.find((o) => o.value === value) ?? { value, label: value, profileImage: null };
    }, [options, value]);

    const close = useCallback(() => {
        setOpen(false);
    }, []);

    const activate = useCallback(() => {
        setOpen(true);
        setFilterText("");
    }, []);

    useLayoutEffect(() => {
        highlightIndexRef.current = highlightIndex;
    }, [highlightIndex]);

    useEffect(() => {
        if (!open) return;
        if (!normalizedFilter) {
            setHighlightIndex(-1);
            return;
        }
        setHighlightIndex(filtered.length > 0 ? 0 : -1);
    }, [open, normalizedFilter, filtered.length]);

    useLayoutEffect(() => {
        if (!open || highlightIndex < 0) return;
        const el = listRef.current?.querySelector(`[data-transcript-speaker-idx="${highlightIndex}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [highlightIndex, open, filtered]);

    useEffect(() => {
        if (!open) return;
        const t = requestAnimationFrame(() => {
            panelSearchRef.current?.focus();
            panelSearchRef.current?.select();
        });
        return () => cancelAnimationFrame(t);
    }, [open]);

    useEffect(() => {
        if (!open) setFilterText("");
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (ev: MouseEvent) => {
            const el = rootRef.current;
            if (el && ev.target instanceof Node && !el.contains(ev.target)) close();
        };
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") close();
        };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, close]);

    const pick = useCallback(
        (v: string) => {
            onChange(v);
            close();
        },
        [onChange, close],
    );

    const onPanelSearchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (filtered.length === 0) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightIndex((i) => (i < 0 ? 0 : Math.min(i + 1, filtered.length - 1)));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightIndex((i) => Math.max(-1, i - 1));
            } else if (e.key === "Enter") {
                const i = highlightIndexRef.current;
                if (i >= 0 && i < filtered.length) {
                    e.preventDefault();
                    pick(filtered[i].value);
                }
            }
        },
        [filtered, pick],
    );

    return (
        <div className="archive-multi-select archive-multi-select--transcript-speaker" ref={rootRef}>
            <div className="archive-multi-select-pill">
                <button
                    type="button"
                    className="archive-multi-select-trigger"
                    onClick={() => (open ? close() : activate())}
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-label="Speaker filter"
                >
                    <span className="archive-multi-select-trigger-title">Speaker</span>
                    <div
                        className="archive-filter-stack archive-filter-stack--in-trigger"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {selectedMeta ? (
                            <div className="archive-filter-stack-slot">
                                <StackDisc opt={selectedMeta} />
                            </div>
                        ) : null}
                        <span className="archive-transcript-speaker-trigger-label">
                            {selectedMeta ? selectedMeta.label : "All"}
                        </span>
                    </div>
                    <span className="archive-multi-select-trigger-spacer" aria-hidden />
                    <span className="archive-multi-select-trigger-chevron">
                        <Icon icon={open ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
                    </span>
                </button>
            </div>
            {open && (
                <div className="archive-multi-select-panel" role="listbox">
                    <div className="archive-multi-select-search-wrap">
                        <Icon icon={Search01Icon} size={14} className="archive-multi-select-search-icon" />
                        <input
                            ref={panelSearchRef}
                            className="archive-multi-select-search"
                            placeholder="Search…"
                            value={filterText}
                            onChange={(e) => setFilterText(e.target.value)}
                            onKeyDown={onPanelSearchKeyDown}
                            aria-label="Search speakers"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            autoComplete="off"
                        />
                    </div>
                    <div ref={listRef} className="archive-multi-select-list">
                        {filtered.length === 0 ? (
                            <div className="archive-multi-select-empty">No results</div>
                        ) : (
                            filtered.map((opt, idx) => {
                                const sel = opt.value === value;
                                const kbdHi = highlightIndex === idx;
                                const imgUrl = opt.value
                                    ? avatarUrlFromPath(opt.profileImage ?? null)
                                    : null;
                                return (
                                    <button
                                        key={`${opt.value}-${opt.label}`}
                                        type="button"
                                        role="option"
                                        aria-selected={sel}
                                        data-transcript-speaker-idx={idx}
                                        className={`archive-multi-select-row archive-multi-select-row--people archive-multi-select-row--transcript-speaker${sel ? " is-selected" : ""}${kbdHi ? " is-keyboard-highlight" : ""}`}
                                        onMouseEnter={() => setHighlightIndex(idx)}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            pick(opt.value);
                                        }}
                                    >
                                        <RowAvatar imgUrl={imgUrl} label={opt.label} />
                                        <span className="archive-multi-select-name">{opt.label}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
