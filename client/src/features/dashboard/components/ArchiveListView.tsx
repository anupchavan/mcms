import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ForwardedRef,
    type RefObject,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "../../../shared/components/Icon";
import {
    Search01Icon,
    Calendar02Icon,
    UserIcon,
    ArrowDown01Icon,
    ArrowUp01Icon,
    PinIcon,
    Pen01Icon,
    Delete01Icon,
} from "@hugeicons/core-free-icons";
import {
    ArchiveMeeting,
    ArchiveListResponse,
    archiveModalityChipClass,
    archiveModalityLabel,
    formatArchiveDate,
    groupArchiveMeetingsByRecency,
    parseArchiveSearchInput,
    SEARCH_DEBOUNCE_MS,
    archiveLoadingMinVisibleMs,
} from "./archiveHelpers";
import { avatarUrlFromPath } from "../../../shared/avatarUrl";
import { UserAvatar } from "../../../shared/components/UserAvatar";
import {
    publicMeetingSlug,
    resolvedInternalMeetingId,
} from "../../../utils/meetingSlug";
import { useAuth } from "../../../stores/AuthContext";
import ShortcutTooltip from "../../../shared/components/ShortcutTooltip";
import Kbd from "../../../shared/components/Kbd";
import useKeyboardShortcuts from "../../../hooks/useKeyboardShortcuts";

const STACK_MAX_VISIBLE_DISCS = 3;

/** Allowed `limit` query values for GET /archive (must stay in sync with server). */
const ARCHIVE_PAGE_SIZES = [5, 10, 15, 20] as const;
type ArchivePageSize = (typeof ARCHIVE_PAGE_SIZES)[number];

/** Page indices plus gaps for ellipsis (1-based pages). */
function archivePaginationSlots(
    currentPage: number,
    totalPages: number,
): (number | "gap")[] {
    if (totalPages <= 0) return [];
    if (totalPages === 1) return [1];
    if (totalPages <= 9)
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    const wins = new Set<number>();
    wins.add(1);
    wins.add(totalPages);
    for (let p = currentPage - 2; p <= currentPage + 2; p++) {
        if (p >= 1 && p <= totalPages) wins.add(p);
    }
    const sorted = [...wins].sort((a, b) => a - b);
    const out: (number | "gap")[] = [];
    let prev = 0;
    for (const p of sorted) {
        if (prev && p - prev > 1) out.push("gap");
        out.push(p);
        prev = p;
    }
    return out;
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const IS_MAC =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function meetingApiSegment(m: ArchiveMeeting): string {
    return publicMeetingSlug(m) ?? resolvedInternalMeetingId(m) ?? "";
}

function isArchiveMeetingHost(
    m: ArchiveMeeting,
    uid: string | null | undefined,
): boolean {
    if (uid == null || uid === "") return false;
    const h = m.hostId as unknown;
    if (h && typeof h === "object" && "_id" in (h as object))
        return String((h as { _id?: unknown })._id) === String(uid);
    return String(h ?? "") === String(uid);
}

type ArchiveResultRowProps = {
    meeting: ArchiveMeeting;
    selected: boolean;
    menuOpen: boolean;
    pinned: boolean;
    isHost: boolean;
    navigateSlug: string | null;
    onSelect: () => void;
    registerRow: (el: HTMLDivElement | null) => void;
    registerMoreBtn: (el: HTMLButtonElement | null) => void;
    menuContainerRefProp: RefObject<HTMLDivElement | null>;
    onToggleMenu: () => void;
    onRename: () => void;
    onDelete: () => void;
    onPin: () => void;
    onHoverSelectFlat: () => void;
};

function ArchiveResultRow({
    meeting,
    selected,
    menuOpen,
    pinned,
    isHost,
    navigateSlug,
    onSelect,
    registerRow,
    registerMoreBtn,
    menuContainerRefProp,
    onToggleMenu,
    onRename,
    onDelete,
    onPin,
    onHoverSelectFlat,
}: ArchiveResultRowProps) {
    const deleteKbdKeys = IS_MAC
        ? (["ctrlmac", "backspace"] as const)
        : (["mod", "forwarddel"] as const);
    /** ⌃⌥R / Ctrl+Alt+R — avoids Safari’s ⌘⌥R shortcuts. */
    const renameKbdKeys = IS_MAC
        ? (["ctrlmac", "altmac", "R"] as const)
        : (["mod", "altmac", "R"] as const);

    return (
        <div
            ref={registerRow}
            className={`meeting-card glass-card archive-meeting-card-row${
                selected ? " archive-meeting-card-row--selected" : ""
            }`}
            onMouseEnter={onHoverSelectFlat}
        >
            <button
                type="button"
                className="archive-meeting-card-hit"
                onClick={onSelect}
                disabled={!navigateSlug}
            >
                <div className="meeting-card-title">{meeting.title}</div>
                <div className="meeting-card-meta">
                    {meeting.date && (
                        <span>
                            <Icon icon={Calendar02Icon} size={14} />{" "}
                            {formatArchiveDate(meeting.date)}
                        </span>
                    )}
                    <span>
                        <Icon icon={UserIcon} size={14} /> {meeting.host}
                    </span>
                    {(() => {
                        const modLabel = archiveModalityLabel(meeting.modality);
                        return modLabel ? (
                            <span
                                className={archiveModalityChipClass(
                                    meeting.modality,
                                )}
                            >
                                {modLabel}
                            </span>
                        ) : null;
                    })()}
                </div>
                {meeting.matchedTranscripts &&
                    meeting.matchedTranscripts.length > 0 && (
                        <div className="archive-snippet-block">
                            {meeting.matchedTranscripts.map((t, i) => (
                                <p key={i} className="archive-search-snippet">
                                    {t.timestamp ? `${t.timestamp} · ` : ""}
                                    {t.speaker} ·{" "}
                                    {t.text.length > 120
                                        ? `${t.text.slice(0, 120)}...`
                                        : t.text}
                                </p>
                            ))}
                        </div>
                    )}
            </button>
            <div className="archive-meeting-card-actions">
                <ShortcutTooltip
                    keys={["mod", "shift", ","]}
                    label="Meeting actions"
                    disabled={menuOpen}
                    position="bottom"
                >
                    <button
                        ref={registerMoreBtn}
                        type="button"
                        className={`archive-meeting-more-btn${menuOpen ? " archive-meeting-more-btn--menu-open" : ""}`}
                        aria-label="Meeting actions"
                        aria-expanded={menuOpen}
                        aria-haspopup="menu"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleMenu();
                        }}
                    >
                        <svg
                            width={16}
                            height={16}
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden
                        >
                            <circle cx={12} cy={6} r={2} />
                            <circle cx={12} cy={12} r={2} />
                            <circle cx={12} cy={18} r={2} />
                        </svg>
                    </button>
                </ShortcutTooltip>
                {menuOpen ? (
                    <div
                        ref={menuContainerRefProp}
                        className="archive-meeting-actions-menu"
                        role="menu"
                        onMouseMove={() => {
                            menuContainerRefProp.current?.removeAttribute(
                                "data-kbd-nav",
                            );
                            const ae =
                                document.activeElement as HTMLElement | null;
                            if (
                                ae &&
                                menuContainerRefProp.current?.contains(ae)
                            )
                                ae.blur();
                        }}
                    >
                        {isHost ? (
                            <button
                                type="button"
                                role="menuitem"
                                className="archive-meeting-actions-menu-item"
                                onClick={onRename}
                            >
                                <Icon
                                    icon={Pen01Icon}
                                    size={14}
                                    className="archive-meeting-actions-menu-icon-hi"
                                    aria-hidden
                                />
                                <span className="archive-meeting-actions-menu-label">
                                    Rename
                                </span>
                                <span className="archive-meeting-actions-menu-kbd">
                                    <Kbd keys={[...renameKbdKeys]} />
                                </span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            role="menuitem"
                            className="archive-meeting-actions-menu-item"
                            onClick={onPin}
                        >
                            <Icon
                                icon={PinIcon}
                                size={14}
                                className="archive-meeting-actions-menu-icon-hi"
                            />
                            <span className="archive-meeting-actions-menu-label">
                                {pinned ? "Unpin" : "Pin"}
                            </span>
                            <span className="archive-meeting-actions-menu-kbd">
                                <Kbd keys={["mod", "shift", "P"]} />
                            </span>
                        </button>
                        {isHost ? (
                            <button
                                type="button"
                                role="menuitem"
                                className="archive-meeting-actions-menu-item archive-meeting-actions-menu-item--danger"
                                onClick={onDelete}
                            >
                                <Icon
                                    icon={Delete01Icon}
                                    size={14}
                                    className="archive-meeting-actions-menu-icon-hi"
                                    aria-hidden
                                />
                                <span className="archive-meeting-actions-menu-label">
                                    Delete
                                </span>
                                <span className="archive-meeting-actions-menu-kbd">
                                    <Kbd keys={[...deleteKbdKeys]} />
                                </span>
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

interface ArchiveListViewProps {
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onSelectMeeting: (meetingId: string) => void;
}

export default function ArchiveListView({
    fetchWithAuth,
    onSelectMeeting,
}: ArchiveListViewProps) {
    const { user, updateUser } = useAuth();
    const locationState = useLocation().state as { tags?: string[] } | null;
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<ArchiveMeeting[]>([]);
    const [loading, setLoading] = useState(false);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<ArchivePageSize>(10);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [availableTagColors, setAvailableTagColors] = useState<
        Record<string, string>
    >({});
    const [availablePeople, setAvailablePeople] = useState<
        Array<{
            _id: string;
            name: string;
            email: string;
            profileImage?: string | null;
        }>
    >([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tagsDropdownRef = useRef<ArchiveMultiSelectHandle | null>(null);
    const peopleDropdownRef = useRef<ArchiveMultiSelectHandle | null>(null);
    const archiveMainSearchRef = useRef<HTMLInputElement>(null);
    const archivePaginationSelectRef = useRef<HTMLSelectElement>(null);
    const [selectedFlatIndex, setSelectedFlatIndex] = useState(-1);
    const [menuOpenForInternalId, setMenuOpenForInternalId] = useState<
        string | null
    >(null);
    /** True while the user is navigating with arrow keys; suppresses hover-select on scroll. */
    const keyboardNavRef = useRef(false);
    const [renameTarget, setRenameTarget] = useState<ArchiveMeeting | null>(
        null,
    );
    const [renameDraft, setRenameDraft] = useState("");
    const menuContainerRef = useRef<HTMLDivElement | null>(null);
    const moreBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const focusMainArchiveSearch = useCallback(() => {
        requestAnimationFrame(() => {
            archiveMainSearchRef.current?.focus();
            archiveMainSearchRef.current?.select();
        });
    }, []);

    const openTagsPanelKeyboard = useCallback(() => {
        requestAnimationFrame(() =>
            tagsDropdownRef.current?.activateAndFocusSearch(),
        );
    }, []);

    const openPeoplePanelKeyboard = useCallback(() => {
        requestAnimationFrame(() =>
            peopleDropdownRef.current?.activateAndFocusSearch(),
        );
    }, []);

    const focusPaginationOrMainSearchKeyboard = useCallback(() => {
        requestAnimationFrame(() => {
            if (totalCount > 0 && archivePaginationSelectRef.current) {
                archivePaginationSelectRef.current.focus();
                return;
            }
            archiveMainSearchRef.current?.focus();
            archiveMainSearchRef.current?.select();
        });
    }, [totalCount]);

    const onArchiveMainSearchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key !== "Tab" || e.shiftKey) return;
            e.preventDefault();
            tagsDropdownRef.current?.activateAndFocusSearch();
        },
        [],
    );

    useEffect(() => {
        const fetchFilters = async () => {
            try {
                const res = await (fetchWithAuth || fetch)(
                    `${API_BASE}/archive/filters`,
                );
                if (res.ok) {
                    const data = await res.json();
                    setAvailableTags(data.tags || []);
                    setAvailableTagColors(data.tagColors || {});
                    setAvailablePeople(data.people || []);
                }
            } catch (err) {
                console.error("Failed to load archive filters:", err);
            }
        };
        fetchFilters();
    }, [fetchWithAuth]);

    // Apply tags pre-filter from navigation state (e.g. tag chip click on archive detail page).
    useEffect(() => {
        if (locationState?.tags?.length) {
            setSelectedTags(locationState.tags);
            navigate(".", { replace: true, state: {} });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!fetchWithAuth) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchWithAuth(`${API_BASE}/auth/me`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (Array.isArray(data.archivePinnedMeetingIds)) {
                    updateUser({
                        archivePinnedMeetingIds:
                            data.archivePinnedMeetingIds.map(String),
                    });
                }
            } catch {
                /* ignore */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [fetchWithAuth, updateUser]);

    const archivePinOrder = useMemo((): string[] => {
        const raw = user?.archivePinnedMeetingIds;
        if (!Array.isArray(raw)) return [];
        return raw.map(String).filter(Boolean);
    }, [user?.archivePinnedMeetingIds]);

    const archivePeopleForFilter = useMemo(() => {
        const uid =
            user?._id != null
                ? String(user._id)
                : user?.id != null
                  ? String(user.id)
                  : null;
        const sessionPic = user?.profileImage ?? null;
        if (!uid || !sessionPic) return availablePeople;
        return availablePeople.map((p) => {
            const pid = String(p._id ?? "");
            if (pid !== uid) return p;
            return { ...p, profileImage: sessionPic };
        });
    }, [availablePeople, user?._id, user?.id, user?.profileImage]);

    const tagsOptions = useMemo(
        () =>
            availableTags.map((t) => ({
                value: t,
                label: t,
                color: availableTagColors[t],
            })),
        [availableTags, availableTagColors],
    );

    const peopleOptions = useMemo(
        () =>
            archivePeopleForFilter.map((p) => ({
                value: p._id,
                label: p.name || p.email || "Participant",
                email: p.email,
                profileImage: p.profileImage ?? null,
            })),
        [archivePeopleForFilter],
    );

    const search = useCallback(
        async (
            searchInput: string,
            tags: string[],
            people: string[],
            pageNum: number,
            perPage: ArchivePageSize,
        ) => {
            const { textQuery, dateFrom, dateTo } =
                parseArchiveSearchInput(searchInput);
            const startedMs =
                typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();
            setLoading(true);
            let nextMeetings: ArchiveMeeting[] | null = null;
            let nextTotal: number | null = null;
            try {
                const params = new URLSearchParams();
                if (textQuery.trim()) params.set("q", textQuery.trim());
                if (dateFrom) params.set("dateFrom", dateFrom);
                if (dateTo) params.set("dateTo", dateTo);
                if (tags.length > 0) params.set("tags", tags.join(","));
                if (people.length > 0) params.set("people", people.join(","));
                params.set("limit", String(perPage));
                params.set("page", String(pageNum));

                const res = await (fetchWithAuth || fetch)(
                    `${API_BASE}/archive?${params.toString()}`,
                );
                if (res.ok) {
                    const data: ArchiveListResponse = await res.json();
                    nextMeetings = data.meetings ?? [];
                    nextTotal = Number.isFinite(data.total) ? data.total : 0;
                }
            } catch (err) {
                console.error("Archive search failed:", err);
            }
            const elapsed =
                (typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now()) - startedMs;
            await new Promise<void>((resolve) => {
                setTimeout(
                    resolve,
                    Math.max(0, archiveLoadingMinVisibleMs() - elapsed),
                );
            });
            if (nextMeetings !== null && nextTotal !== null) {
                setResults(nextMeetings);
                setTotalCount(nextTotal);
            }
            setLoading(false);
        },
        [fetchWithAuth],
    );

    const rerunArchiveSearch = useCallback(() => {
        search(query, selectedTags, selectedPeople, page, pageSize);
    }, [page, pageSize, query, search, selectedPeople, selectedTags]);

    const persistArchivePins = useCallback(
        async (meetingIds: string[]) => {
            const res = await (fetchWithAuth || fetch)(
                `${API_BASE}/profile/archive-pins`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ meetingIds }),
                },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(
                    (err as { message?: string }).message || res.statusText,
                );
            }
            const data = await res.json();
            updateUser({
                archivePinnedMeetingIds: Array.isArray(
                    data.archivePinnedMeetingIds,
                )
                    ? data.archivePinnedMeetingIds.map(String)
                    : meetingIds,
            });
        },
        [fetchWithAuth, updateUser],
    );

    useEffect(() => {
        setPage(1);
    }, [query, selectedTags, selectedPeople]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1);
        if (page > totalPages) setPage(totalPages);
    }, [totalCount, pageSize, page]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(
            () => search(query, selectedTags, selectedPeople, page, pageSize),
            SEARCH_DEBOUNCE_MS,
        );
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, selectedTags, selectedPeople, page, pageSize, search]);

    useKeyboardShortcuts(
        useMemo(
            () => [
                {
                    key: "/",
                    allowInInput: false,
                    handler: () => {
                        archiveMainSearchRef.current?.focus();
                        archiveMainSearchRef.current?.select();
                    },
                },
                {
                    key: "g",
                    mod: true,
                    shift: true,
                    allowInInput: true,
                    handler: () => {
                        const tags = tagsDropdownRef.current;
                        if (tags?.isOpen()) {
                            tags.close();
                            return;
                        }
                        peopleDropdownRef.current?.close();
                        tags?.activateAndFocusSearch();
                    },
                },
                {
                    key: "u",
                    mod: true,
                    shift: true,
                    allowInInput: true,
                    handler: () => {
                        const people = peopleDropdownRef.current;
                        if (people?.isOpen()) {
                            people.close();
                            return;
                        }
                        tagsDropdownRef.current?.close();
                        people?.activateAndFocusSearch();
                    },
                },
            ],
            [],
        ),
    );

    const totalPages = useMemo(
        () => Math.max(0, Math.ceil(totalCount / pageSize)),
        [totalCount, pageSize],
    );

    const paginationSlots = useMemo(
        () => archivePaginationSlots(page, Math.max(totalPages, 1)),
        [page, totalPages],
    );

    const rangeFrom = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
    const rangeTo = Math.min(page * pageSize, totalCount);

    const sessionUserId =
        user?._id != null
            ? String(user._id)
            : user?.id != null
              ? String(user.id)
              : null;

    const { pinnedMeetings, groupedUnpinned } = useMemo(() => {
        const pinSet = new Set(archivePinOrder);
        const pinned: ArchiveMeeting[] = [];
        for (const pid of archivePinOrder) {
            const m = results.find((x) => resolvedInternalMeetingId(x) === pid);
            if (m) pinned.push(m);
        }
        const unpinned = results.filter((x) => {
            const id = resolvedInternalMeetingId(x);
            return !!(id && !pinSet.has(id));
        });
        return {
            pinnedMeetings: pinned,
            groupedUnpinned: groupArchiveMeetingsByRecency(unpinned),
        };
    }, [archivePinOrder, results]);

    const flatMeetingList = useMemo(() => {
        const out: ArchiveMeeting[] = [];
        if (pinnedMeetings.length) out.push(...pinnedMeetings);
        for (const g of groupedUnpinned) out.push(...g.meetings);
        return out;
    }, [groupedUnpinned, pinnedMeetings]);

    const flatIndexById = useMemo(() => {
        const m = new Map<string, number>();
        flatMeetingList.forEach((meet, idx) => {
            const id = resolvedInternalMeetingId(meet);
            if (id) m.set(id, idx);
        });
        return m;
    }, [flatMeetingList]);

    useEffect(() => {
        if (flatMeetingList.length === 0) return;
        setSelectedFlatIndex((prev) =>
            prev >= flatMeetingList.length ? flatMeetingList.length - 1 : prev,
        );
    }, [flatMeetingList.length]);

    useLayoutEffect(() => {
        if (
            selectedFlatIndex < 0 ||
            selectedFlatIndex >= flatMeetingList.length
        )
            return;
        const id = resolvedInternalMeetingId(
            flatMeetingList[selectedFlatIndex],
        );
        if (!id) return;
        rowRefs.current
            .get(id)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [flatMeetingList, selectedFlatIndex]);

    useEffect(() => {
        if (!menuOpenForInternalId) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (menuContainerRef.current?.contains(t)) return;
            if ([...moreBtnRefs.current.values()].some((b) => b?.contains(t)))
                return;
            setMenuOpenForInternalId(null);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [menuOpenForInternalId]);

    /* When a row menu opens, focus its first item after React has rendered it. */
    useEffect(() => {
        if (!menuOpenForInternalId) return;
        const raf = requestAnimationFrame(() => {
            menuContainerRef.current
                ?.querySelector<HTMLElement>('[role="menuitem"]')
                ?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(raf);
    }, [menuOpenForInternalId]);

    /* Real pointer movement ends keyboard-nav mode. */
    useEffect(() => {
        const onMove = () => {
            keyboardNavRef.current = false;
        };
        window.addEventListener("mousemove", onMove, { passive: true });
        return () => window.removeEventListener("mousemove", onMove);
    }, []);

    const closeArchiveRowMenu = useCallback(() => {
        setMenuOpenForInternalId(null);
    }, []);

    const togglePinForMeeting = useCallback(
        async (meeting: ArchiveMeeting) => {
            const internal = resolvedInternalMeetingId(meeting);
            if (!internal) return;
            const cur = [...archivePinOrder];
            const i = cur.indexOf(internal);
            if (i >= 0) cur.splice(i, 1);
            else cur.unshift(internal);
            try {
                await persistArchivePins(cur);
                closeArchiveRowMenu();
            } catch (e) {
                console.error(e);
                window.alert(
                    e instanceof Error ? e.message : "Could not update pins",
                );
            }
        },
        [archivePinOrder, closeArchiveRowMenu, persistArchivePins],
    );

    const openRenameMeeting = useCallback(
        (meeting: ArchiveMeeting) => {
            closeArchiveRowMenu();
            setRenameTarget(meeting);
            setRenameDraft(meeting.title ?? "");
        },
        [closeArchiveRowMenu],
    );

    const deleteMeetingConfirmed = useCallback(
        async (meeting: ArchiveMeeting) => {
            const seg = meetingApiSegment(meeting);
            if (!seg) return;
            if (!fetchWithAuth) return;
            closeArchiveRowMenu();
            try {
                const res = await fetchWithAuth(
                    `${API_BASE}/archive/meeting/${encodeURIComponent(seg)}`,
                    {
                        method: "DELETE",
                    },
                );
                const errBody = await res.json().catch(() => ({}));
                if (!res.ok)
                    throw new Error(
                        (errBody as { message?: string }).message ||
                            res.statusText,
                    );
                rerunArchiveSearch();
                setSelectedFlatIndex(-1);
            } catch (e) {
                console.error(e);
                window.alert(e instanceof Error ? e.message : "Delete failed");
            }
        },
        [closeArchiveRowMenu, fetchWithAuth, rerunArchiveSearch],
    );

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (renameTarget || loading) return;

            const isArrowDown = e.key === "ArrowDown" || e.code === "ArrowDown";
            const isArrowUp = e.key === "ArrowUp" || e.code === "ArrowUp";
            if (isArrowDown || isArrowUp) keyboardNavRef.current = true;

            const filtersOpen = !!(
                tagsDropdownRef.current?.isOpen() ||
                peopleDropdownRef.current?.isOpen()
            );
            const ae = document.activeElement;
            const tn = ae?.tagName ?? "";

            const editable = !!(ae as HTMLElement)?.isContentEditable;
            const inField =
                filtersOpen ||
                tn === "TEXTAREA" ||
                tn === "SELECT" ||
                editable ||
                tn === "INPUT";

            const modPrimary = IS_MAC ? e.metaKey : e.ctrlKey;
            const menuChord =
                modPrimary && e.shiftKey && !e.altKey && e.key === ",";
            const pinChord =
                modPrimary &&
                e.shiftKey &&
                !e.altKey &&
                e.key.toLowerCase() === "p";
            const renameChord =
                e.ctrlKey &&
                e.altKey &&
                !e.shiftKey &&
                !e.metaKey &&
                e.key.toLowerCase() === "r";
            const deleteChord =
                !e.altKey &&
                !e.shiftKey &&
                e.ctrlKey &&
                !e.metaKey &&
                (e.key === "Delete" || e.key === "Backspace");

            const selectedMeeting =
                selectedFlatIndex >= 0 &&
                selectedFlatIndex < flatMeetingList.length
                    ? flatMeetingList[selectedFlatIndex]
                    : null;

            if (menuChord) {
                e.preventDefault();
                if (!selectedMeeting) return;
                const sid = resolvedInternalMeetingId(selectedMeeting);
                if (sid)
                    setMenuOpenForInternalId((prev) =>
                        prev === sid ? null : sid,
                    );
                return;
            }
            if (pinChord) {
                e.preventDefault();
                if (selectedMeeting) void togglePinForMeeting(selectedMeeting);
                return;
            }
            if (renameChord) {
                if (inField) return;
                if (
                    !selectedMeeting ||
                    !isArchiveMeetingHost(selectedMeeting, sessionUserId)
                )
                    return;
                e.preventDefault();
                openRenameMeeting(selectedMeeting);
                return;
            }
            if (
                deleteChord &&
                selectedMeeting &&
                isArchiveMeetingHost(selectedMeeting, sessionUserId)
            ) {
                if (inField) return;
                e.preventDefault();
                window.confirm(
                    `Delete archived meeting "${selectedMeeting.title}"?`,
                )
                    ? void deleteMeetingConfirmed(selectedMeeting)
                    : undefined;
                return;
            }

            if (menuOpenForInternalId && !filtersOpen) {
                const items = Array.from(
                    menuContainerRef.current?.querySelectorAll<HTMLElement>(
                        '[role="menuitem"]',
                    ) ?? [],
                );
                if (isArrowDown) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (items.length === 0) return;
                    menuContainerRef.current?.setAttribute("data-kbd-nav", "");
                    const cur = items.indexOf(
                        document.activeElement as HTMLElement,
                    );
                    items[cur < 0 ? 0 : (cur + 1) % items.length].focus({
                        preventScroll: true,
                    });
                    return;
                }
                if (isArrowUp) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (items.length === 0) return;
                    menuContainerRef.current?.setAttribute("data-kbd-nav", "");
                    const cur = items.indexOf(
                        document.activeElement as HTMLElement,
                    );
                    items[cur <= 0 ? items.length - 1 : cur - 1].focus({
                        preventScroll: true,
                    });
                    return;
                }
                if (e.key === "Escape") {
                    e.preventDefault();
                    closeArchiveRowMenu();
                    return;
                }
                return;
            }
            if (filtersOpen) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    closeArchiveRowMenu();
                }
                return;
            }

            if (inField) return;

            if (isArrowDown) {
                if (flatMeetingList.length === 0) return;
                e.preventDefault();
                setSelectedFlatIndex((i) =>
                    Math.min(flatMeetingList.length - 1, i < 0 ? 0 : i + 1),
                );
                return;
            }
            if (isArrowUp) {
                if (flatMeetingList.length === 0) return;
                e.preventDefault();
                setSelectedFlatIndex((i) => (i <= 0 ? 0 : i - 1));
                return;
            }
            if (e.key === "Escape") {
                closeArchiveRowMenu();
                setSelectedFlatIndex(-1);
            }
            if (e.key === "Enter") {
                if (inField) return;
                if (!selectedMeeting) return;
                const slug = publicMeetingSlug(selectedMeeting);
                if (!slug) return;
                e.preventDefault();
                setMenuOpenForInternalId(null);
                onSelectMeeting(slug);
            }
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [
        closeArchiveRowMenu,
        deleteMeetingConfirmed,
        flatMeetingList,
        loading,
        menuOpenForInternalId,
        onSelectMeeting,
        openRenameMeeting,
        selectedFlatIndex,
        sessionUserId,
        togglePinForMeeting,
        keyboardNavRef,
    ]);

    useEffect(() => {
        if (!renameTarget) return;
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setRenameTarget(null);
                setRenameDraft("");
            }
        };
        window.addEventListener("keydown", esc);
        return () => window.removeEventListener("keydown", esc);
    }, [renameTarget]);

    const canGoBack = totalPages > 1 && page > 1;
    const canGoForward = totalPages > 1 && page < totalPages;

    const saveRenameMeeting = useCallback(async () => {
        if (!renameTarget) return;
        const title = renameDraft.trim();
        if (!title || title.length > 100) return;
        const seg = meetingApiSegment(renameTarget);
        if (!seg) return;
        try {
            const res = await (fetchWithAuth || fetch)(
                `${API_BASE}/archive/meeting/${encodeURIComponent(seg)}/title`,
                {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title }),
                },
            );
            const errBody = await res.json().catch(() => ({}));
            if (!res.ok)
                throw new Error(
                    (errBody as { message?: string }).message || res.statusText,
                );
            setRenameTarget(null);
            setRenameDraft("");
            rerunArchiveSearch();
        } catch (e) {
            console.error(e);
            window.alert(e instanceof Error ? e.message : "Rename failed");
        }
    }, [fetchWithAuth, renameDraft, renameTarget, rerunArchiveSearch]);

    const renderMeetingRow = (meeting: ArchiveMeeting, rowPinned: boolean) => {
        const internal = resolvedInternalMeetingId(meeting) ?? "";
        const slug = publicMeetingSlug(meeting);
        const sel = flatIndexById.get(internal) === selectedFlatIndex;
        const mo = menuOpenForInternalId === internal;
        return (
            <ArchiveResultRow
                key={`${internal}-${slug ?? ""}`}
                meeting={meeting}
                selected={sel}
                menuOpen={mo}
                pinned={rowPinned}
                isHost={isArchiveMeetingHost(meeting, sessionUserId)}
                navigateSlug={slug}
                onSelect={() => {
                    const fi = flatIndexById.get(internal);
                    setSelectedFlatIndex(fi ?? -1);
                    setMenuOpenForInternalId(null);
                    if (slug) onSelectMeeting(slug);
                }}
                registerRow={(el) => {
                    if (internal) {
                        if (el) rowRefs.current.set(internal, el);
                        else rowRefs.current.delete(internal);
                    }
                }}
                registerMoreBtn={(el) => {
                    if (internal) {
                        if (el) moreBtnRefs.current.set(internal, el);
                        else moreBtnRefs.current.delete(internal);
                    }
                }}
                menuContainerRefProp={menuContainerRef}
                onToggleMenu={() =>
                    setMenuOpenForInternalId((prev) =>
                        prev === internal ? null : internal,
                    )
                }
                onRename={() => openRenameMeeting(meeting)}
                onDelete={() =>
                    window.confirm(
                        `Delete archived meeting "${meeting.title}"?`,
                    )
                        ? void deleteMeetingConfirmed(meeting)
                        : undefined
                }
                onPin={() => void togglePinForMeeting(meeting)}
                onHoverSelectFlat={() => {
                    if (keyboardNavRef.current) return;
                    const fi = flatIndexById.get(internal);
                    if (fi === undefined) return;
                    setSelectedFlatIndex(fi);
                    setMenuOpenForInternalId((prev) =>
                        prev != null && prev !== internal ? null : prev,
                    );
                }}
            />
        );
    };

    return (
        <div className="archive-container page-shell">
            <header className="page-header">
                <h2 className="page-header-title">Archives</h2>
                <p className="page-header-description">
                    Search and browse past meeting transcripts, summaries, and
                    tasks.
                </p>
            </header>

            <div className="archive-search-bar">
                <div
                    className={`archive-search-input-wrap archive-search-box${
                        query.trim() !== ""
                            ? " archive-search-box--has-value"
                            : ""
                    }`}
                >
                    <Icon
                        icon={Search01Icon}
                        size={14}
                        className="archive-search-box-icon"
                    />
                    <input
                        ref={archiveMainSearchRef}
                        type="search"
                        enterKeyHint="search"
                        className="archive-search-main-input"
                        placeholder="Search transcripts, keywords... or filter by date: from last week, since yesterday, till last friday, from last wed to this sat..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onArchiveMainSearchKeyDown}
                    />
                    <Kbd keys={["/"]} className="kbd-hint" />
                </div>
                <div className="archive-filter-row">
                    <ArchiveMultiSelectDropdown
                        ref={tagsDropdownRef}
                        variant="tags"
                        options={tagsOptions}
                        selected={selectedTags}
                        onChange={setSelectedTags}
                        label="Tags"
                        shortcutTooltipKeys={["mod", "shift", "G"]}
                        shortcutTooltipLabel="Toggle tag filter"
                        onTabForwardFromPanelSearch={openPeoplePanelKeyboard}
                        onShiftTabBackFromPanelSearch={focusMainArchiveSearch}
                    />
                    <ArchiveMultiSelectDropdown
                        ref={peopleDropdownRef}
                        variant="people"
                        options={peopleOptions}
                        selected={selectedPeople}
                        onChange={setSelectedPeople}
                        label="People"
                        shortcutTooltipKeys={["mod", "shift", "U"]}
                        shortcutTooltipLabel="Toggle people filter"
                        onTabForwardFromPanelSearch={
                            focusPaginationOrMainSearchKeyboard
                        }
                        onShiftTabBackFromPanelSearch={openTagsPanelKeyboard}
                        onShiftTabBackFromClosedTrigger={openTagsPanelKeyboard}
                    />
                </div>
            </div>

            <div
                className={`meeting-list archive-meeting-list-shell${
                    loading ? " archive-meeting-list-shell--loading" : ""
                }`}
            >
                <div className="archive-meeting-list-column">
                    {pinnedMeetings.length > 0 ? (
                        <div
                            className="archive-results-group"
                            role="group"
                            aria-label="Pinned"
                        >
                            <h3 className="archive-results-group-heading">
                                Pinned
                            </h3>
                            {pinnedMeetings.map((meeting) =>
                                renderMeetingRow(meeting, true),
                            )}
                        </div>
                    ) : null}
                    {groupedUnpinned.map((group) => (
                        <div
                            key={group.id}
                            className="archive-results-group"
                            role="group"
                            aria-label={group.label}
                        >
                            <h3 className="archive-results-group-heading">
                                {group.label}
                            </h3>
                            {group.meetings.map((meeting) =>
                                renderMeetingRow(meeting, false),
                            )}
                        </div>
                    ))}
                    {results.length === 0 && !loading && (
                        <p className="archive-no-results">
                            No completed meetings found.
                        </p>
                    )}

                    {!loading && totalCount > 0 ? (
                        <div
                            className="archive-pagination-row"
                            role="navigation"
                            aria-label="Archive pagination"
                        >
                            <div className="archive-pagination-left">
                                <label className="archive-pagination-page-size-label">
                                    <span className="archive-pagination-muted">
                                        Results per page
                                    </span>
                                    <select
                                        ref={archivePaginationSelectRef}
                                        className="archive-pagination-select"
                                        value={pageSize}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            if (
                                                v === 5 ||
                                                v === 10 ||
                                                v === 15 ||
                                                v === 20
                                            ) {
                                                setPageSize(v);
                                                setPage(1);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Tab" && e.shiftKey) {
                                                e.preventDefault();
                                                openPeoplePanelKeyboard();
                                            }
                                        }}
                                    >
                                        {ARCHIVE_PAGE_SIZES.map((n) => (
                                            <option key={n} value={n}>
                                                {n}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <span className="archive-pagination-muted">
                                    {rangeFrom}-{rangeTo} of {totalCount}
                                </span>
                            </div>
                            <nav
                                className="archive-pagination-nav"
                                aria-label="Pages"
                            >
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm archive-pagination-step"
                                    disabled={!canGoBack}
                                    onClick={() =>
                                        setPage((p) => Math.max(1, p - 1))
                                    }
                                >
                                    Previous
                                </button>
                                {paginationSlots.map((slot, idx) =>
                                    slot === "gap" ? (
                                        <span
                                            key={`gap-${idx}`}
                                            className="archive-pagination-gap"
                                            aria-hidden
                                        >
                                            …
                                        </span>
                                    ) : (
                                        <button
                                            key={slot}
                                            type="button"
                                            aria-current={
                                                slot === page
                                                    ? "page"
                                                    : undefined
                                            }
                                            className={`btn btn-sm archive-pagination-page${slot === page ? " btn-primary archive-pagination-page--current" : " btn-secondary"}`}
                                            onClick={() => setPage(slot)}
                                        >
                                            {slot}
                                        </button>
                                    ),
                                )}
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm archive-pagination-step"
                                    disabled={!canGoForward}
                                    onClick={() =>
                                        setPage((p) =>
                                            Math.min(totalPages, p + 1),
                                        )
                                    }
                                >
                                    Next
                                </button>
                            </nav>
                        </div>
                    ) : null}
                </div>
                {loading && (
                    <>
                        <div
                            className="archive-results-loading-overlay"
                            aria-busy="true"
                        />
                        <div
                            className="archive-searching-loading-viewport"
                            aria-live="polite"
                        >
                            <div
                                className="archive-searching-loading"
                                role="status"
                            >
                                <span
                                    className="archive-searching-loading-spinner"
                                    aria-hidden
                                />
                                <span className="archive-searching-loading-text">
                                    Searching
                                </span>
                            </div>
                        </div>
                    </>
                )}
            </div>
            {renameTarget ? (
                <div
                    className="archive-rename-backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="archive-rename-title"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) {
                            setRenameTarget(null);
                            setRenameDraft("");
                        }
                    }}
                >
                    <div
                        className="archive-rename-dialog glass-card"
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <h3
                            id="archive-rename-title"
                            className="page-header-title archive-rename-title"
                        >
                            Rename meeting
                        </h3>
                        <input
                            type="text"
                            className="input archive-rename-input"
                            value={renameDraft}
                            maxLength={100}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            autoFocus
                        />
                        <div className="archive-rename-actions">
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setRenameTarget(null);
                                    setRenameDraft("");
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => void saveRenameMeeting()}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

type ArchiveMultiSelectHandle = {
    close: () => void;
    activateAndFocusSearch: () => void;
    isOpen: () => boolean;
};

type ArchiveMultiOption = {
    value: string;
    label: string;
    email?: string;
    profileImage?: string | null;
    color?: string;
};

function hueFromString(s: string) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h % 360);
}

function ArchiveMultiSelectRowAvatar({
    variant,
    profileImage,
    userId,
    label,
    color,
}: {
    variant: "tags" | "people";
    profileImage?: string | null;
    userId?: string;
    label: string;
    color?: string;
}) {
    const hue = hueFromString(label || "?");

    if (variant === "tags") {
        const ringColor = color ? `${color}cc` : `hsla(${hue}, 48%, 50%, 0.78)`;
        const bgColor = color ? `${color}22` : undefined;
        return (
            <span
                className="archive-multi-select-avatar archive-multi-select-avatar--tag-ring"
                style={{ borderColor: ringColor, background: bgColor }}
                aria-hidden
            />
        );
    }

    return (
        <UserAvatar
            name={label}
            profileImage={profileImage}
            userId={userId}
            size={16}
        />
    );
}

function ArchiveFilterStackDiscPeople({ opt }: { opt: ArchiveMultiOption }) {
    return (
        <span className="archive-filter-stack-disc" aria-hidden>
            <UserAvatar
                name={opt.label}
                profileImage={opt.profileImage}
                userId={opt.value}
                size={18}
                style={{ border: "none", borderRadius: "50%" }}
            />
        </span>
    );
}

function ArchiveFilterStack({
    variant,
    selectedOrdered,
    options,
}: {
    variant: "tags" | "people";
    selectedOrdered: string[];
    options: ArchiveMultiOption[];
}) {
    const ordered = selectedOrdered
        .map((v) => options.find((o) => o.value === v))
        .filter((x): x is ArchiveMultiOption => Boolean(x));

    if (ordered.length === 0) return null;

    const visible = ordered.slice(0, STACK_MAX_VISIBLE_DISCS);
    const overflow = ordered.length - visible.length;

    return (
        <div
            className="archive-filter-stack archive-filter-stack--in-trigger"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            {visible.map((opt, idx) => (
                <div
                    key={opt.value}
                    className={`archive-filter-stack-slot${idx > 0 ? " archive-filter-stack-slot--overlap" : ""}`}
                    style={{ zIndex: idx + 1 }}
                >
                    <ShortcutTooltip label={opt.label} position="bottom">
                        {variant === "tags" ? (
                            <span
                                className="archive-filter-stack-disc archive-filter-stack-disc--tag-fill"
                                style={{
                                    background: opt.color
                                        ? opt.color
                                        : `hsla(${hueFromString(opt.label || "?")}, 46%, 44%, 0.95)`,
                                }}
                                aria-hidden
                            />
                        ) : (
                            <ArchiveFilterStackDiscPeople opt={opt} />
                        )}
                    </ShortcutTooltip>
                </div>
            ))}
            {overflow > 0 ? (
                <div
                    className={`archive-filter-stack-slot archive-filter-stack-slot--overlap`}
                    style={{ zIndex: visible.length + 1 }}
                >
                    <span
                        className="archive-filter-stack-more"
                        aria-label={`${overflow} more selected`}
                    >
                        +{overflow}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

type ArchiveMultiSelectDropdownProps = {
    variant: "tags" | "people";
    options: ArchiveMultiOption[];
    selected: string[];
    onChange: (next: string[]) => void;
    label: string;
    shortcutTooltipKeys?: string[];
    shortcutTooltipLabel?: string;
    /** Tab from panel search: close dropdown and invoke (e.g. open next filter). */
    onTabForwardFromPanelSearch?: () => void;
    /** Shift+Tab from panel search: close dropdown and invoke (e.g. focus previous control). */
    onShiftTabBackFromPanelSearch?: () => void;
    /** Shift+Tab from trigger while closed — e.g. People trigger → Tags panel focused. */
    onShiftTabBackFromClosedTrigger?: () => void;
};

const ArchiveMultiSelectDropdown = forwardRef(
    function ArchiveMultiSelectDropdown(
        {
            variant,
            options,
            selected,
            onChange,
            label,
            shortcutTooltipKeys,
            shortcutTooltipLabel,
            onTabForwardFromPanelSearch,
            onShiftTabBackFromPanelSearch,
            onShiftTabBackFromClosedTrigger,
        }: ArchiveMultiSelectDropdownProps,
        ref: ForwardedRef<ArchiveMultiSelectHandle>,
    ) {
        const [open, setOpen] = useState(false);
        const [filterText, setFilterText] = useState("");
        const [focusPanelSearchNonce, setFocusPanelSearchNonce] = useState(0);
        const [highlightIndex, setHighlightIndex] = useState(-1);
        const rootRef = useRef<HTMLDivElement>(null);
        const panelSearchRef = useRef<HTMLInputElement>(null);
        const listRef = useRef<HTMLDivElement>(null);
        const highlightIndexRef = useRef(-1);
        const listKbdNavRef = useRef(false);

        const normalizedFilter = filterText.trim().toLowerCase();

        const filtered = useMemo(() => {
            if (!normalizedFilter) return options;
            return options.filter((o) => {
                const nm = (o.label || "").toLowerCase();
                const em = (o.email || "").toLowerCase();
                return (
                    nm.includes(normalizedFilter) ||
                    (variant === "people" && em.includes(normalizedFilter))
                );
            });
        }, [options, normalizedFilter, variant]);

        const close = useCallback(() => {
            setOpen(false);
        }, []);

        const activateAndFocusSearch = useCallback(() => {
            setOpen(true);
            setFocusPanelSearchNonce((x) => x + 1);
        }, []);

        useImperativeHandle(
            ref,
            () => ({
                close,
                activateAndFocusSearch,
                isOpen: () => open,
            }),
            [close, activateAndFocusSearch, open],
        );

        useLayoutEffect(() => {
            if (!open || focusPanelSearchNonce === 0) return;
            panelSearchRef.current?.focus();
            panelSearchRef.current?.select();
        }, [open, focusPanelSearchNonce]);

        useLayoutEffect(() => {
            highlightIndexRef.current = highlightIndex;
        }, [highlightIndex]);

        useEffect(() => {
            if (!open) return;
            if (!normalizedFilter) {
                setHighlightIndex(-1);
                return;
            }
            if (filtered.length > 0) setHighlightIndex(0);
            else setHighlightIndex(-1);
        }, [open, normalizedFilter, filtered]);

        useLayoutEffect(() => {
            if (!open || highlightIndex < 0) return;
            const el = listRef.current?.querySelector(
                `[data-archive-row-index="${highlightIndex}"]`,
            );
            el?.scrollIntoView({ block: "nearest" });
        }, [highlightIndex, open, filtered]);
        useEffect(() => {
            if (!open) setFilterText("");
        }, [open]);

        const onPanelSearchKeyDown = useCallback(
            (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Tab") {
                    const forward = !e.shiftKey && onTabForwardFromPanelSearch;
                    const backward =
                        e.shiftKey && onShiftTabBackFromPanelSearch;
                    if (forward || backward) {
                        e.preventDefault();
                        setOpen(false);
                        if (forward && onTabForwardFromPanelSearch) {
                            onTabForwardFromPanelSearch();
                        } else if (backward && onShiftTabBackFromPanelSearch) {
                            onShiftTabBackFromPanelSearch();
                        }
                        return;
                    }
                }
                if (filtered.length === 0) return;
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    listKbdNavRef.current = true;
                    listRef.current?.setAttribute("data-kbd-nav", "");
                    setHighlightIndex((i) =>
                        i < 0 ? 0 : Math.min(i + 1, filtered.length - 1),
                    );
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    listKbdNavRef.current = true;
                    listRef.current?.setAttribute("data-kbd-nav", "");
                    setHighlightIndex((i) => Math.max(-1, i - 1));
                } else if (e.key === "Enter") {
                    const i = highlightIndexRef.current;
                    if (i >= 0 && i < filtered.length) {
                        e.preventDefault();
                        const v = filtered[i].value;
                        if (selected.includes(v))
                            onChange(selected.filter((x) => x !== v));
                        else onChange([...selected, v]);
                    }
                }
            },
            [
                filtered,
                onChange,
                selected,
                onTabForwardFromPanelSearch,
                onShiftTabBackFromPanelSearch,
            ],
        );

        useEffect(() => {
            if (!open) return;
            const onDocMouse = (ev: MouseEvent) => {
                const el = rootRef.current;
                if (el && ev.target instanceof Node && !el.contains(ev.target))
                    setOpen(false);
            };
            const onKey = (ev: KeyboardEvent) => {
                if (ev.key === "Escape") setOpen(false);
            };
            document.addEventListener("mousedown", onDocMouse);
            document.addEventListener("keydown", onKey);
            return () => {
                document.removeEventListener("mousedown", onDocMouse);
                document.removeEventListener("keydown", onKey);
            };
        }, [open]);

        const toggle = (value: string) => {
            if (selected.includes(value))
                onChange(selected.filter((v) => v !== value));
            else onChange([...selected, value]);
        };

        const rowAvatarUrl = (o: ArchiveMultiOption) =>
            variant === "people" ? (o.profileImage ?? null) : null;

        const searchAria = `${label}: search options`;

        return (
            <div className="archive-multi-select" ref={rootRef}>
                <ShortcutTooltip
                    fullWidth
                    disabled={open}
                    keys={shortcutTooltipKeys}
                    label={shortcutTooltipLabel}
                    position="top"
                >
                    <div className="archive-multi-select-pill">
                        <button
                            type="button"
                            className="archive-multi-select-trigger"
                            onClick={() => {
                                if (open) {
                                    setOpen(false);
                                } else {
                                    activateAndFocusSearch();
                                }
                            }}
                            aria-expanded={open}
                            aria-haspopup="listbox"
                            aria-label={`${label} filter`}
                            onKeyDown={(e) => {
                                if (e.repeat || e.key !== "Tab") return;
                                if (!e.shiftKey && !open) {
                                    e.preventDefault();
                                    activateAndFocusSearch();
                                } else if (
                                    e.shiftKey &&
                                    !open &&
                                    onShiftTabBackFromClosedTrigger
                                ) {
                                    e.preventDefault();
                                    onShiftTabBackFromClosedTrigger();
                                }
                            }}
                        >
                            <span className="archive-multi-select-trigger-title">
                                {label}
                            </span>
                            <ArchiveFilterStack
                                variant={variant}
                                selectedOrdered={selected}
                                options={options}
                            />
                            <span
                                className="archive-multi-select-trigger-spacer"
                                aria-hidden
                            />
                            <span className="archive-multi-select-trigger-chevron">
                                <Icon
                                    icon={
                                        open ? ArrowUp01Icon : ArrowDown01Icon
                                    }
                                    size={14}
                                />
                            </span>
                        </button>
                    </div>
                </ShortcutTooltip>
                {open && (
                    <div
                        className="archive-multi-select-panel"
                        role="listbox"
                        aria-multiselectable="true"
                    >
                        <div className="archive-multi-select-search-wrap">
                            <Icon
                                icon={Search01Icon}
                                size={14}
                                className="archive-multi-select-search-icon"
                            />
                            <input
                                ref={panelSearchRef}
                                className="archive-multi-select-search"
                                placeholder="Search…"
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                onKeyDown={onPanelSearchKeyDown}
                                aria-label={searchAria}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                autoComplete="off"
                            />
                        </div>
                        <div
                            ref={listRef}
                            className="archive-multi-select-list"
                        >
                            {options.length === 0 ? (
                                <div className="archive-multi-select-empty">
                                    No options available
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="archive-multi-select-empty">
                                    No results
                                </div>
                            ) : (
                                filtered.map((opt, idx) => {
                                    const sel = selected.includes(opt.value);
                                    const kbdHi = highlightIndex === idx;
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            role="option"
                                            aria-selected={sel}
                                            data-archive-row-index={idx}
                                            className={`archive-multi-select-row archive-multi-select-row--${variant}${sel ? " is-selected" : ""}${kbdHi ? " is-keyboard-highlight" : ""}`}
                                            onMouseEnter={() => {
                                                listRef.current?.removeAttribute(
                                                    "data-kbd-nav",
                                                );
                                                listKbdNavRef.current = false;
                                                setHighlightIndex(idx);
                                            }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                toggle(opt.value);
                                            }}
                                        >
                                            <span
                                                className={`archive-multi-select-check${sel ? " is-checked" : ""}`}
                                            >
                                                <span
                                                    className="archive-multi-select-check-mark"
                                                    aria-hidden
                                                />
                                            </span>
                                            <ArchiveMultiSelectRowAvatar
                                                variant={variant}
                                                profileImage={rowAvatarUrl(opt)}
                                                userId={opt.value}
                                                label={opt.label}
                                                color={opt.color}
                                            />
                                            <span className="archive-multi-select-name">
                                                {opt.label}
                                            </span>
                                            {variant === "people" ? (
                                                <span className="archive-multi-select-email">
                                                    {opt.email ?? ""}
                                                </span>
                                            ) : null}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    },
);

ArchiveMultiSelectDropdown.displayName = "ArchiveMultiSelectDropdown";
