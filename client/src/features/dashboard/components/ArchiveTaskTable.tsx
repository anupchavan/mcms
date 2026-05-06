import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../../shared/components/Icon";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { UserAvatar } from "../../../shared/components/UserAvatar";
import type {
    ArchiveParticipant,
    ArchiveTask,
    ArchiveTaskAssignee,
} from "./archiveHelpers";

const STACK_MAX_VISIBLE_DISCS = 3;

const CATEGORIES = ["Technical", "Administrative", "Decision", "Follow-up"];

/** Text-only colors for category labels (no chip background). */
export const CATEGORY_TEXT_COLOR: Record<string, string> = {
    Technical: "var(--color-tx-normal)",
    Administrative: "var(--color-tx-normal)",
    Decision: "var(--color-tx-normal)",
    "Follow-up": "var(--color-tx-normal)",
};

const MONTH_ABBR = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];
function formatDeadline(v: string): string {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return `${String(d.getDate()).padStart(2, "0")} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

interface StatusOption {
    value: string;
    label: string;
    /** Text-only status color (no pill background); see `.archive-task-status-label` in CSS */
    statusLabelClass: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
    {
        value: "pending",
        label: "Pending",
        statusLabelClass:
            "archive-task-status-label archive-task-status-label--pending",
    },
    {
        value: "in-progress",
        label: "In Progress",
        statusLabelClass:
            "archive-task-status-label archive-task-status-label--in-progress",
    },
    {
        value: "completed",
        label: "Awaiting Verify",
        statusLabelClass:
            "archive-task-status-label archive-task-status-label--awaiting-verify",
    },
    {
        value: "verified",
        label: "Completed",
        statusLabelClass:
            "archive-task-status-label archive-task-status-label--completed",
    },
    {
        value: "missing",
        label: "Missing",
        statusLabelClass:
            "archive-task-status-label archive-task-status-label--missing",
    },
    {
        value: "draft",
        label: "Draft",
        statusLabelClass:
            "archive-task-status-label archive-task-status-label--draft",
    },
];

export const STATUS_LOOKUP: Record<string, StatusOption> =
    STATUS_OPTIONS.reduce(
        (acc, opt) => {
            acc[opt.value] = opt;
            return acc;
        },
        {} as Record<string, StatusOption>,
    );

interface ArchiveTaskTableProps {
    tasks: ArchiveTask[];
    participants: ArchiveParticipant[];
    canEdit: boolean;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    apiBase: string;
    onTaskUpdated: (next: ArchiveTask) => void;
}

/** Notion-style task table for the archive page. Three columns: Task (editable),
 * Assigned (multi-assignee picker with stacked avatars), Status (single-select dropdown
 * without a search input). Reuses the archive multi-select dropdown styling. */
export function ArchiveTaskTable({
    tasks,
    participants,
    canEdit,
    fetchWithAuth,
    apiBase,
    onTaskUpdated,
}: ArchiveTaskTableProps) {
    return (
        <div className="archive-task-table" role="table" aria-label="Tasks">
            <div className="archive-task-table-head" role="row">
                <div
                    className="archive-task-table-cell archive-task-table-cell--title"
                    role="columnheader"
                >
                    Task
                </div>
                <div
                    className="archive-task-table-cell archive-task-table-cell--assignees"
                    role="columnheader"
                >
                    Assigned
                </div>
                <div
                    className="archive-task-table-cell archive-task-table-cell--type"
                    role="columnheader"
                >
                    Type
                </div>
                <div
                    className="archive-task-table-cell archive-task-table-cell--deadline"
                    role="columnheader"
                >
                    Deadline
                </div>
                <div
                    className="archive-task-table-cell archive-task-table-cell--status"
                    role="columnheader"
                >
                    Status
                </div>
            </div>
            <div className="archive-task-table-body">
                {tasks.map((task) => (
                    <ArchiveTaskRow
                        key={task.id}
                        task={task}
                        participants={participants}
                        canEdit={canEdit}
                        fetchWithAuth={fetchWithAuth}
                        apiBase={apiBase}
                        onTaskUpdated={onTaskUpdated}
                    />
                ))}
            </div>
        </div>
    );
}

interface ArchiveTaskRowProps {
    task: ArchiveTask;
    participants: ArchiveParticipant[];
    canEdit: boolean;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    apiBase: string;
    onTaskUpdated: (next: ArchiveTask) => void;
}

function ArchiveTaskRow({
    task,
    participants,
    canEdit,
    fetchWithAuth,
    apiBase,
    onTaskUpdated,
}: ArchiveTaskRowProps) {
    const [titleDraft, setTitleDraft] = useState(task.title);
    const titleEverFocusedRef = useRef(false);
    const [savingTitle, setSavingTitle] = useState(false);

    useEffect(() => {
        // External (server-driven) updates should reset the local draft if we're not actively editing.
        if (!titleEverFocusedRef.current) setTitleDraft(task.title);
    }, [task.title]);

    const persistTask = useCallback(
        async (
            patch: Partial<{
                title: string;
                assignees: string[];
                status: string;
                category: string;
                deadline: string | null;
            }>,
        ) => {
            const res = await (fetchWithAuth || fetch)(
                `${apiBase}/tasks/${task.id}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(patch),
                },
            );
            if (res.ok) {
                const updated = await res.json();
                onTaskUpdated({
                    ...task,
                    ...updated,
                    assignees: Array.isArray(updated.assignees)
                        ? updated.assignees
                        : task.assignees,
                });
                return true;
            }
            return false;
        },
        [apiBase, fetchWithAuth, onTaskUpdated, task],
    );

    const commitTitle = useCallback(async () => {
        const next = titleDraft.trim();
        titleEverFocusedRef.current = false;
        if (!next || next === task.title) {
            setTitleDraft(task.title);
            return;
        }
        setSavingTitle(true);
        const ok = await persistTask({ title: next });
        if (!ok) setTitleDraft(task.title);
        setSavingTitle(false);
    }, [persistTask, task.title, titleDraft]);

    const setAssignees = useCallback(
        async (ids: string[]) => {
            const enriched: ArchiveTaskAssignee[] = ids.map((id) => {
                const p = participants.find(
                    (pp) => String(pp._id) === String(id),
                );
                return {
                    id: String(id),
                    name: p?.name ?? null,
                    email: p?.email ?? null,
                    profileImage: p?.profileImage ?? null,
                };
            });
            onTaskUpdated({ ...task, assignees: enriched });
            await persistTask({ assignees: ids });
        },
        [onTaskUpdated, participants, persistTask, task],
    );

    const setStatus = useCallback(
        async (status: string) => {
            onTaskUpdated({ ...task, status });
            await persistTask({ status });
        },
        [onTaskUpdated, persistTask, task],
    );

    const setCategory = useCallback(
        async (category: string) => {
            onTaskUpdated({ ...task, category });
            await persistTask({ category });
        },
        [onTaskUpdated, persistTask, task],
    );

    const [deadlineDraft, setDeadlineDraft] = useState(
        task.deadline ? task.deadline.slice(0, 10) : "",
    );
    useEffect(() => {
        setDeadlineDraft(task.deadline ? task.deadline.slice(0, 10) : "");
    }, [task.deadline]);

    const commitDeadline = useCallback(
        async (val: string) => {
            const next = val || null;
            onTaskUpdated({ ...task, deadline: next });
            await persistTask({ deadline: next });
        },
        [onTaskUpdated, persistTask, task],
    );

    const assigneeIds = useMemo(
        () => (task.assignees || []).map((a) => String(a.id)).filter(Boolean),
        [task.assignees],
    );

    return (
        <div className="archive-task-table-row" role="row">
            <div
                className="archive-task-table-cell archive-task-table-cell--title"
                role="cell"
            >
                <input
                    type="text"
                    className="archive-task-title-input"
                    value={titleDraft}
                    disabled={!canEdit}
                    onFocus={() => {
                        titleEverFocusedRef.current = true;
                    }}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                        } else if (e.key === "Escape") {
                            setTitleDraft(task.title);
                            titleEverFocusedRef.current = false;
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    aria-label="Task title"
                />
                {savingTitle ? (
                    <span className="archive-task-saving" aria-live="polite">
                        Saving…
                    </span>
                ) : null}
            </div>
            <div
                className="archive-task-table-cell archive-task-table-cell--assignees"
                role="cell"
            >
                <TaskAssigneePicker
                    participants={participants}
                    value={assigneeIds}
                    selectedAssignees={task.assignees || []}
                    onChange={setAssignees}
                    disabled={!canEdit}
                />
            </div>
            <div
                className="archive-task-table-cell archive-task-table-cell--type"
                role="cell"
            >
                {canEdit ? (
                    <TaskCategorySelect
                        value={task.category || "Technical"}
                        onChange={setCategory}
                    />
                ) : task.category ? (
                    <span
                        style={{
                            fontSize: "0.8125rem",
                            color:
                                CATEGORY_TEXT_COLOR[task.category] ||
                                "var(--text-secondary)",
                        }}
                    >
                        {task.category}
                    </span>
                ) : (
                    <span className="archive-task-no-value">—</span>
                )}
            </div>
            <div
                className="archive-task-table-cell archive-task-table-cell--deadline"
                role="cell"
            >
                {canEdit ? (
                    <input
                        type="date"
                        className="input-field archive-task-date-input"
                        value={deadlineDraft}
                        onChange={(e) => setDeadlineDraft(e.target.value)}
                        onBlur={(e) => commitDeadline(e.target.value)}
                    />
                ) : (
                    <span className="archive-task-deadline-text">
                        {task.deadline ? formatDeadline(task.deadline) : "—"}
                    </span>
                )}
            </div>
            <div
                className="archive-task-table-cell archive-task-table-cell--status"
                role="cell"
            >
                <TaskStatusSelect
                    value={task.status}
                    onChange={setStatus}
                    disabled={!canEdit}
                />
            </div>
        </div>
    );
}

/** Multi-assignee picker. Exported so other task tables (e.g. MyTasksTaskTable) can reuse it.
 * Built from the same archive multi-select primitives as the People filter:
 * stacked avatars in the trigger, checkbox + avatar + name rows, and "Unassigned" header that clears all. */
export function TaskAssigneePicker({
    participants,
    value,
    selectedAssignees,
    onChange,
    disabled,
}: {
    participants: ArchiveParticipant[];
    value: string[];
    selectedAssignees: ArchiveTaskAssignee[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const selectedSet = useMemo(() => new Set(value.map(String)), [value]);

    /** Fall back to enrichment off the persisted assignee blobs when a user is no longer
     * in the meeting's participants array (e.g. removed mid-cycle). */
    const renderableSelected = useMemo(() => {
        return value.map((id) => {
            const p = participants.find((pp) => String(pp._id) === String(id));
            const fallback = selectedAssignees.find(
                (a) => String(a.id) === String(id),
            );
            return {
                id: String(id),
                name: p?.name ?? fallback?.name ?? "Unknown",
                profileImage: p?.profileImage ?? fallback?.profileImage ?? null,
            };
        });
    }, [participants, selectedAssignees, value]);

    const close = useCallback(() => setOpen(false), []);

    useEffect(() => {
        if (!open) return;
        const onDoc = (ev: MouseEvent) => {
            const el = rootRef.current;
            if (el && ev.target instanceof Node && !el.contains(ev.target))
                close();
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
        (id: string) => {
            if (selectedSet.has(id)) onChange(value.filter((v) => v !== id));
            else onChange([...value, id]);
        },
        [onChange, selectedSet, value],
    );

    const clearAll = useCallback(() => onChange([]), [onChange]);

    const stackVisible = renderableSelected.slice(0, STACK_MAX_VISIBLE_DISCS);
    const stackOverflow = renderableSelected.length - stackVisible.length;

    const assigneeTriggerLabel =
        renderableSelected.length === 0
            ? "Assigned: Unassigned"
            : `Assigned: ${renderableSelected.map((r) => r.name).join(", ")}`;

    return (
        <div
            className="archive-multi-select archive-multi-select--task-assignees"
            ref={rootRef}
        >
            <button
                type="button"
                className="archive-task-cell-trigger archive-task-cell-trigger--assignees"
                onClick={() => !disabled && setOpen((o) => !o)}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={assigneeTriggerLabel}
            >
                {renderableSelected.length === 0 ? (
                    <span className="archive-task-unassigned">Unassigned</span>
                ) : (
                    <div
                        className="archive-filter-stack archive-filter-stack--task-assignee-trigger"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {stackVisible.map((opt, idx) => (
                            <div
                                key={opt.id}
                                className={`archive-filter-stack-slot${idx > 0 ? " archive-filter-stack-slot--overlap" : ""}`}
                                style={{ zIndex: idx + 1 }}
                            >
                                <span
                                    className="archive-filter-stack-disc"
                                    aria-hidden
                                >
                                    <UserAvatar
                                        name={opt.name}
                                        profileImage={opt.profileImage}
                                        userId={opt.id}
                                        size={18}
                                        style={{
                                            border: "none",
                                            borderRadius: "50%",
                                        }}
                                    />
                                </span>
                            </div>
                        ))}
                        {stackOverflow > 0 ? (
                            <div
                                className="archive-filter-stack-slot archive-filter-stack-slot--overlap"
                                style={{ zIndex: stackVisible.length + 1 }}
                            >
                                <span className="archive-filter-stack-more">
                                    +{stackOverflow}
                                </span>
                            </div>
                        ) : null}
                    </div>
                )}
                {!disabled ? (
                    <span
                        className="archive-multi-select-trigger-chevron"
                        aria-hidden
                    >
                        <Icon
                            icon={open ? ArrowUp01Icon : ArrowDown01Icon}
                            size={12}
                        />
                    </span>
                ) : null}
            </button>
            {open && (
                <div
                    className="archive-multi-select-panel archive-task-cell-panel archive-task-cell-panel--assignees"
                    role="listbox"
                    aria-multiselectable="true"
                >
                    <div className="archive-multi-select-list">
                        <button
                            type="button"
                            className={`archive-multi-select-row archive-multi-select-row--transcript-speaker-all${value.length === 0 ? " is-selected" : ""}`}
                            onClick={(e) => {
                                e.preventDefault();
                                clearAll();
                            }}
                        >
                            <span className="archive-multi-select-name archive-multi-select-name--all">
                                Unassigned
                            </span>
                        </button>
                        {participants.length === 0 ? (
                            <div className="archive-multi-select-empty">
                                No participants
                            </div>
                        ) : (
                            participants.map((p) => {
                                const id = String(p._id);
                                const sel = selectedSet.has(id);
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        role="option"
                                        aria-selected={sel}
                                        className={`archive-multi-select-row archive-multi-select-row--transcript-speaker${sel ? " is-selected" : ""}`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            toggleOne(id);
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
                                        <UserAvatar
                                            name={p.name || p.email || "User"}
                                            profileImage={p.profileImage}
                                            userId={id}
                                            size={16}
                                        />
                                        <span className="archive-multi-select-name">
                                            {p.name || p.email || "User"}
                                        </span>
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

/** Category/type dropdown — colored text labels, no chip background. Portal-rendered. */
export function TaskCategorySelect({
    value,
    onChange,
    disabled,
}: {
    value: string;
    onChange: (next: string) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelPos, setPanelPos] = useState<{
        top?: number;
        bottom?: number;
        left: number;
        minWidth: number;
    } | null>(null);
    const current = value || CATEGORIES[0];
    const currentColor =
        CATEGORY_TEXT_COLOR[current] || "var(--text-secondary)";

    const PANEL_MAX_H = 240;
    const handleToggle = useCallback(() => {
        if (disabled) return;
        if (!open && rootRef.current) {
            const rect = rootRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < PANEL_MAX_H) {
                setPanelPos({
                    bottom: window.innerHeight - rect.top + 4,
                    left: rect.left,
                    minWidth: rect.width,
                });
            } else {
                setPanelPos({
                    top: rect.bottom + 4,
                    left: rect.left,
                    minWidth: rect.width,
                });
            }
        }
        setOpen((o) => !o);
    }, [disabled, open]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (ev: MouseEvent) => {
            const root = rootRef.current;
            const panel = panelRef.current;
            const t = ev.target as Node;
            if (root?.contains(t) || panel?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") setOpen(false);
        };
        const onScroll = () => setOpen(false);
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [open]);

    return (
        <div
            className="archive-multi-select archive-multi-select--task-status"
            ref={rootRef}
        >
            <button
                type="button"
                className="archive-task-cell-trigger"
                onClick={handleToggle}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span
                    style={{
                        color: currentColor,
                        fontSize: "0.8125rem",
                        fontWeight: 500,
                    }}
                >
                    {current}
                </span>
                {!disabled && (
                    <span
                        className="archive-multi-select-trigger-chevron"
                        aria-hidden
                    >
                        <Icon
                            icon={open ? ArrowUp01Icon : ArrowDown01Icon}
                            size={12}
                        />
                    </span>
                )}
            </button>
            {open &&
                panelPos &&
                createPortal(
                    <div
                        ref={panelRef}
                        className="archive-multi-select-list archive-cat-panel-portal"
                        role="listbox"
                        style={{
                            top: panelPos.top,
                            bottom: panelPos.bottom,
                            left: panelPos.left,
                            minWidth: panelPos.minWidth,
                        }}
                    >
                        {CATEGORIES.map((cat) => {
                            const sel = cat === value;
                            return (
                                <button
                                    key={cat}
                                    type="button"
                                    role="option"
                                    aria-selected={sel}
                                    className={`archive-multi-select-row archive-task-status-row${sel ? " is-selected" : ""}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        onChange(cat);
                                        setOpen(false);
                                    }}
                                >
                                    <span
                                        style={{
                                            color:
                                                CATEGORY_TEXT_COLOR[cat] ||
                                                "var(--text-secondary)",
                                            fontSize: "0.8125rem",
                                            fontWeight: 500,
                                        }}
                                    >
                                        {cat}
                                    </span>
                                </button>
                            );
                        })}
                    </div>,
                    document.body,
                )}
        </div>
    );
}

/** Status dropdown without a search input. Uses a portal so the panel escapes
 * overflow containers and CSS stacking contexts inside scrollable task lists. */
export function TaskStatusSelect({
    value,
    onChange,
    disabled,
    allowedStatuses,
}: {
    value: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    allowedStatuses?: string[];
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelPos, setPanelPos] = useState<{
        top?: number;
        bottom?: number;
        left: number;
        minWidth: number;
    } | null>(null);
    const current = STATUS_LOOKUP[value] || STATUS_OPTIONS[0];

    const dropdownOptions = useMemo(() => {
        let list =
            allowedStatuses?.length > 0
                ? STATUS_OPTIONS.filter((o) =>
                      allowedStatuses.includes(o.value),
                  )
                : STATUS_OPTIONS;
        if (!list.some((o) => o.value === value) && STATUS_LOOKUP[value]) {
            list = [STATUS_LOOKUP[value], ...list];
        }
        return list;
    }, [allowedStatuses, value]);

    const STATUS_PANEL_MAX_H = 280;
    const handleToggle = useCallback(() => {
        if (disabled) return;
        if (!open && rootRef.current) {
            const rect = rootRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < STATUS_PANEL_MAX_H) {
                setPanelPos({
                    bottom: window.innerHeight - rect.top + 4,
                    left: rect.left,
                    minWidth: rect.width,
                });
            } else {
                setPanelPos({
                    top: rect.bottom + 4,
                    left: rect.left,
                    minWidth: rect.width,
                });
            }
        }
        setOpen((o) => !o);
    }, [disabled, open]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (ev: MouseEvent) => {
            const root = rootRef.current;
            const panel = panelRef.current;
            const t = ev.target as Node;
            if (root?.contains(t) || panel?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") setOpen(false);
        };
        const onScroll = () => setOpen(false);
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [open]);

    return (
        <div
            className="archive-multi-select archive-multi-select--task-status"
            ref={rootRef}
        >
            <button
                type="button"
                className="archive-task-cell-trigger"
                onClick={handleToggle}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className={current.statusLabelClass}>
                    {current.label}
                </span>
                {!disabled ? (
                    <span
                        className="archive-multi-select-trigger-chevron"
                        aria-hidden
                    >
                        <Icon
                            icon={open ? ArrowUp01Icon : ArrowDown01Icon}
                            size={12}
                        />
                    </span>
                ) : null}
            </button>
            {open &&
                panelPos &&
                createPortal(
                    <div
                        ref={panelRef}
                        className="archive-multi-select-list archive-status-panel-portal"
                        role="listbox"
                        style={{
                            top: panelPos.top,
                            bottom: panelPos.bottom,
                            left: panelPos.left,
                            minWidth: panelPos.minWidth,
                        }}
                    >
                        {dropdownOptions.map((opt) => {
                            const sel = opt.value === value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    role="option"
                                    aria-selected={sel}
                                    className={`archive-multi-select-row archive-task-status-row${sel ? " is-selected" : ""}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        onChange(opt.value);
                                        setOpen(false);
                                    }}
                                >
                                    <span className={opt.statusLabelClass}>
                                        {opt.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>,
                    document.body,
                )}
        </div>
    );
}
