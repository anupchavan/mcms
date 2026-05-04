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
} from "@hugeicons/core-free-icons";
import { UserAvatar } from "../../../shared/components/UserAvatar";

export type TranscriptSpeakerOption = {
    value: string;
    label: string;
    profileImage?: string | null;
};

const STACK_MAX_VISIBLE_DISCS = 3;

function StackDisc({ opt }: { opt: TranscriptSpeakerOption }) {
    return (
        <span className="archive-filter-stack-disc" aria-hidden>
            <UserAvatar
                name={opt.label}
                profileImage={opt.profileImage}
                userId={opt.value}
                size={18}
                style={{ border: 'none', borderRadius: '50%' }}
            />
        </span>
    );
}

function RowAvatar({ opt }: { opt: TranscriptSpeakerOption }) {
    return <UserAvatar name={opt.label} profileImage={opt.profileImage} userId={opt.value} size={16} />;
}

/** Multi-select speaker checklist mirroring the People filter on archive search.
 * "All speakers" is rendered as a header-style row without a checkbox or avatar;
 * clicking it toggles between everything-selected and nothing-selected. */
export function TranscriptSpeakerSelect({
    options,
    value,
    onChange,
}: {
    options: TranscriptSpeakerOption[];
    value: string[];
    onChange: (next: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const [filterText, setFilterText] = useState("");
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelSearchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const highlightIndexRef = useRef(-1);

    const normalizedFilter = filterText.trim().toLowerCase();
    const filtered = useMemo(() => {
        if (!normalizedFilter) return options;
        return options.filter((o) => (o.label || "").toLowerCase().includes(normalizedFilter));
    }, [options, normalizedFilter]);

    const allSelected = options.length > 0 && value.length === options.length;
    const selectedSet = useMemo(() => new Set(value), [value]);

    const selectedOrdered = useMemo(
        () => options.filter((o) => selectedSet.has(o.value)),
        [options, selectedSet],
    );

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

    const toggleOne = useCallback(
        (v: string) => {
            if (selectedSet.has(v)) onChange(value.filter((x) => x !== v));
            else onChange([...value, v]);
        },
        [onChange, value, selectedSet],
    );

    const toggleAll = useCallback(() => {
        if (allSelected) onChange([]);
        else onChange(options.map((o) => o.value));
    }, [allSelected, onChange, options]);

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
                    toggleOne(filtered[i].value);
                }
            }
        },
        [filtered, toggleOne],
    );

    const stackVisible = selectedOrdered.slice(0, STACK_MAX_VISIBLE_DISCS);
    const stackOverflow = selectedOrdered.length - stackVisible.length;

    let triggerLabel: string;
    if (selectedOrdered.length === 0) triggerLabel = "All";
    else if (allSelected) triggerLabel = `All ${options.length}`;
    else if (selectedOrdered.length === 1) triggerLabel = selectedOrdered[0].label;
    else triggerLabel = `${selectedOrdered.length} selected`;

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
                    {selectedOrdered.length > 0 ? (
                        <div
                            className="archive-filter-stack archive-filter-stack--in-trigger"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {stackVisible.map((opt, idx) => (
                                <div
                                    key={opt.value}
                                    className={`archive-filter-stack-slot${idx > 0 ? " archive-filter-stack-slot--overlap" : ""}`}
                                    style={{ zIndex: idx + 1 }}
                                >
                                    <StackDisc opt={opt} />
                                </div>
                            ))}
                            {stackOverflow > 0 ? (
                                <div
                                    className="archive-filter-stack-slot archive-filter-stack-slot--overlap"
                                    style={{ zIndex: stackVisible.length + 1 }}
                                >
                                    <span className="archive-filter-stack-more" aria-label={`${stackOverflow} more selected`}>
                                        +{stackOverflow}
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    <span className="archive-transcript-speaker-trigger-label">{triggerLabel}</span>
                    <span className="archive-multi-select-trigger-spacer" aria-hidden />
                    <span className="archive-multi-select-trigger-chevron">
                        <Icon icon={open ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
                    </span>
                </button>
            </div>
            {open && (
                <div className="archive-multi-select-panel" role="listbox" aria-multiselectable="true">
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
                        {!normalizedFilter && options.length > 0 ? (
                            <button
                                type="button"
                                className={`archive-multi-select-row archive-multi-select-row--transcript-speaker-all${allSelected ? " is-selected" : ""}`}
                                onClick={(e) => {
                                    e.preventDefault();
                                    toggleAll();
                                }}
                            >
                                <span className="archive-multi-select-name archive-multi-select-name--all">
                                    All speakers
                                </span>
                            </button>
                        ) : null}
                        {options.length === 0 ? (
                            <div className="archive-multi-select-empty">No speakers</div>
                        ) : filtered.length === 0 ? (
                            <div className="archive-multi-select-empty">No results</div>
                        ) : (
                            filtered.map((opt, idx) => {
                                const sel = selectedSet.has(opt.value);
                                const kbdHi = highlightIndex === idx;
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
                                            toggleOne(opt.value);
                                        }}
                                    >
                                        <span className={`archive-multi-select-check${sel ? " is-checked" : ""}`}>
                                            <span className="archive-multi-select-check-mark" aria-hidden />
                                        </span>
                                        <RowAvatar opt={opt} />
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
