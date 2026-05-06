import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MyTasksTaskTable } from "../features/dashboard/components/MyTasksTaskTable";
import { MyTasksKanban } from "../features/dashboard/components/MyTasksKanban";
import type { MineOverviewTask } from "../features/dashboard/components/MyTasksTaskTable";
import useDashboardContext from "../hooks/useDashboardContext";
import Icon from "../shared/components/Icon";
import {
    Table01Icon,
    KanbanIcon,
    Archive01Icon,
    Unarchive03Icon,
    Delete01Icon,
} from "@hugeicons/core-free-icons";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import Kbd from "../shared/components/Kbd";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
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

type TasksTab = "assignedToMe" | "assignedByMe";
type ViewMode = "table" | "kanban";

const VIEW_STORAGE_KEY = "tasks-view-mode";

function readStoredView(): ViewMode {
    try {
        return localStorage.getItem(VIEW_STORAGE_KEY) === "kanban"
            ? "kanban"
            : "table";
    } catch {
        return "table";
    }
}

function formatDate(v: string | undefined | null) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return `${String(d.getDate()).padStart(2, "0")} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

export default function TasksPage() {
    const { fetchWithAuth, myTasks, refreshMyTasks } = useDashboardContext();
    const [tasksTab, setTasksTab] = useState<TasksTab>("assignedToMe");
    const [viewMode, setViewMode] = useState<ViewMode>(readStoredView);
    const [viewDropOpen, setViewDropOpen] = useState(false);
    const viewDropRef = useRef<HTMLDivElement>(null);

    // Archived panel
    const [archivedOpen, setArchivedOpen] = useState(false);
    const [archivedTasks, setArchivedTasks] = useState<MineOverviewTask[]>([]);
    const [archivedLoading, setArchivedLoading] = useState(false);

    const activeTaskItems =
        tasksTab === "assignedToMe"
            ? myTasks.assignedToMe
            : myTasks.assignedByMe;
    const activeTaskEmptyMessage =
        tasksTab === "assignedToMe"
            ? "Nothing is waiting on you — or tasks haven't synced yet."
            : "You haven't delegated tasks to others from your hosted meetings yet.";

    const changeView = (mode: ViewMode) => {
        setViewMode(mode);
        setViewDropOpen(false);
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, mode);
        } catch {
            /* ignore */
        }
    };

    // Keyboard shortcuts: t = table, k = kanban
    useKeyboardShortcuts([
        { key: "t", handler: () => changeView("table") },
        { key: "k", handler: () => changeView("kanban") },
    ]);

    // Close view dropdown on outside click / Escape
    useEffect(() => {
        if (!viewDropOpen) return;
        const onDoc = (e: MouseEvent) => {
            if (
                viewDropRef.current &&
                !viewDropRef.current.contains(e.target as Node)
            )
                setViewDropOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setViewDropOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, [viewDropOpen]);

    const loadArchived = useCallback(async () => {
        setArchivedLoading(true);
        try {
            const res = await fetchWithAuth(`${API_BASE}/tasks/mine/archived`);
            if (res.ok) setArchivedTasks(await res.json());
        } finally {
            setArchivedLoading(false);
        }
    }, [fetchWithAuth]);

    const openArchived = () => {
        setArchivedOpen(true);
        loadArchived();
    };
    const closeArchived = () => setArchivedOpen(false);

    const handleUnarchive = useCallback(
        async (taskId: string) => {
            const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ archived: false }),
            });
            if (res.ok) {
                await loadArchived();
                refreshMyTasks();
            }
        },
        [fetchWithAuth, loadArchived, refreshMyTasks],
    );

    const handleDeleteArchived = useCallback(
        async (taskId: string) => {
            if (!window.confirm("Permanently delete this task?")) return;
            const res = await fetchWithAuth(`${API_BASE}/tasks/${taskId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                await loadArchived();
                refreshMyTasks();
            }
        },
        [fetchWithAuth, loadArchived, refreshMyTasks],
    );

    const viewLabel = viewMode === "kanban" ? "Kanban" : "Table";
    const viewIcon = viewMode === "kanban" ? KanbanIcon : Table01Icon;

    return (
        <div className="page-shell">
            <header className="page-header">
                <h2 className="page-header-title">My Tasks</h2>
                <p className="page-header-description">
                    Tasks from your meetings — verify work, track deadlines, and
                    keep commitments visible.
                </p>
            </header>

            {/* Tab strip row — tabs on left, controls on right */}
            <div className="tasks-page-toolbar">
                {/* Left: tab strip (keeps the standard .page-tabs margin) */}
                <div className="tabs page-tabs tasks-tab-strip-inner">
                    <button
                        type="button"
                        className={`tab ${tasksTab === "assignedToMe" ? "active" : ""}`}
                        onClick={() => setTasksTab("assignedToMe")}
                    >
                        My tasks
                    </button>
                    <button
                        type="button"
                        className={`tab ${tasksTab === "assignedByMe" ? "active" : ""}`}
                        onClick={() => setTasksTab("assignedByMe")}
                    >
                        Delegated Tasks
                    </button>
                </div>

                {/* Right: archived button + view toggle */}
                <div className="tasks-toolbar-right">
                    <button
                        type="button"
                        className="tasks-view-toggle-trigger"
                        onClick={openArchived}
                        title="View archived tasks"
                    >
                        <Icon icon={Archive01Icon} size={14} />
                        <span>Archived</span>
                    </button>

                    {/* View mode dropdown */}
                    <div className="tasks-view-toggle" ref={viewDropRef}>
                        <button
                            type="button"
                            className="tasks-view-toggle-trigger"
                            onClick={() => setViewDropOpen((o) => !o)}
                            aria-haspopup="listbox"
                            aria-expanded={viewDropOpen}
                        >
                            <Icon icon={viewIcon} size={14} />
                            <span>{viewLabel}</span>
                            <Icon
                                icon={
                                    viewDropOpen
                                        ? ArrowUp01Icon
                                        : ArrowDown01Icon
                                }
                                size={10}
                                className="tasks-view-toggle-chevron"
                            />
                        </button>

                        {viewDropOpen && (
                            <div
                                className="tasks-view-toggle-panel"
                                role="listbox"
                            >
                                {(["table", "kanban"] as ViewMode[]).map(
                                    (mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            role="option"
                                            aria-selected={viewMode === mode}
                                            className={`tasks-view-toggle-option${viewMode === mode ? " is-selected" : ""}`}
                                            onClick={() => changeView(mode)}
                                        >
                                            <Icon
                                                icon={
                                                    mode === "table"
                                                        ? Table01Icon
                                                        : KanbanIcon
                                                }
                                                size={13}
                                            />
                                            <span>
                                                {mode === "table"
                                                    ? "Table"
                                                    : "Kanban"}
                                            </span>
                                            {viewMode === mode && (
                                                <svg
                                                    width="12"
                                                    height="12"
                                                    viewBox="0 0 12 12"
                                                    fill="none"
                                                    aria-hidden="true"
                                                    className="tasks-view-toggle-check"
                                                >
                                                    <path
                                                        d="M2 6 L5 9 L10 3"
                                                        stroke="currentColor"
                                                        strokeWidth="1.75"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                </svg>
                                            )}
                                            <Kbd
                                                keys={[
                                                    mode === "table"
                                                        ? "T"
                                                        : "K",
                                                ]}
                                                className="kbd-hint"
                                            />
                                        </button>
                                    ),
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="tasks-page-main page-body-gutter-x">
                {viewMode === "table" ? (
                    <MyTasksTaskTable
                        tasks={activeTaskItems}
                        emptyMessage={activeTaskEmptyMessage}
                        fetchWithAuth={fetchWithAuth}
                        onRefresh={refreshMyTasks}
                    />
                ) : (
                    <MyTasksKanban
                        tasks={activeTaskItems}
                        emptyMessage={activeTaskEmptyMessage}
                        fetchWithAuth={fetchWithAuth}
                        onRefresh={refreshMyTasks}
                    />
                )}
            </div>

            {/* Archived tasks overlay */}
            {archivedOpen && (
                <div
                    className="archived-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Archived Tasks"
                >
                    <div className="archived-panel">
                        <div className="archived-panel-header">
                            <div className="archived-panel-title">
                                <Icon icon={Archive01Icon} size={16} />
                                <span>Archived Tasks</span>
                            </div>
                            <button
                                type="button"
                                className="archived-panel-close"
                                onClick={closeArchived}
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="archived-panel-body">
                            {archivedLoading ? (
                                <div className="archived-panel-loading">
                                    Loading…
                                </div>
                            ) : archivedTasks.length === 0 ? (
                                <div className="archived-panel-empty">
                                    No archived tasks.
                                </div>
                            ) : (
                                <div className="archived-table" role="table">
                                    <div
                                        className="archived-table-head"
                                        role="row"
                                    >
                                        <div
                                            className="archived-table-cell archived-table-cell--title"
                                            role="columnheader"
                                        >
                                            Task
                                        </div>
                                        <div
                                            className="archived-table-cell archived-table-cell--meeting"
                                            role="columnheader"
                                        >
                                            Meeting
                                        </div>
                                        <div
                                            className="archived-table-cell archived-table-cell--date"
                                            role="columnheader"
                                        >
                                            Assigned on
                                        </div>
                                        <div
                                            className="archived-table-cell archived-table-cell--date"
                                            role="columnheader"
                                        >
                                            Completed on
                                        </div>
                                        <div
                                            className="archived-table-cell archived-table-cell--assignees"
                                            role="columnheader"
                                        >
                                            Assigned to
                                        </div>
                                        <div
                                            className="archived-table-cell archived-table-cell--actions"
                                            role="columnheader"
                                        />
                                    </div>
                                    <div className="archived-table-body">
                                        {archivedTasks.map((task) => {
                                            const meetingHref =
                                                task.meetingShortId ||
                                                task.meetingId
                                                    ? `/archives/${encodeURIComponent(task.meetingShortId || task.meetingId!)}`
                                                    : null;
                                            const assigneeNames =
                                                (task.assignees || [])
                                                    .map(
                                                        (a) =>
                                                            a.name ||
                                                            a.email ||
                                                            "User",
                                                    )
                                                    .join(", ") || "—";
                                            return (
                                                <div
                                                    key={task.id}
                                                    className="archived-table-row"
                                                    role="row"
                                                >
                                                    <div
                                                        className="archived-table-cell archived-table-cell--title"
                                                        role="cell"
                                                    >
                                                        <span className="archived-task-title">
                                                            {task.title}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className="archived-table-cell archived-table-cell--meeting"
                                                        role="cell"
                                                    >
                                                        {meetingHref ? (
                                                            <Link
                                                                to={meetingHref}
                                                                className="my-tasks-meeting-link"
                                                                onClick={
                                                                    closeArchived
                                                                }
                                                            >
                                                                {task.meetingTitle ||
                                                                    "Open archive"}
                                                            </Link>
                                                        ) : (
                                                            <span className="my-tasks-meeting-fallback">
                                                                —
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div
                                                        className="archived-table-cell archived-table-cell--date"
                                                        role="cell"
                                                    >
                                                        {formatDate(
                                                            task.assignedAt,
                                                        )}
                                                    </div>
                                                    <div
                                                        className="archived-table-cell archived-table-cell--date"
                                                        role="cell"
                                                    >
                                                        {formatDate(
                                                            task.verifiedAt,
                                                        )}
                                                    </div>
                                                    <div
                                                        className="archived-table-cell archived-table-cell--assignees"
                                                        role="cell"
                                                    >
                                                        <span className="archived-assignee-names">
                                                            {assigneeNames}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className="archived-table-cell archived-table-cell--actions"
                                                        role="cell"
                                                    >
                                                        <div className="task-row-actions">
                                                            <button
                                                                type="button"
                                                                className="task-action-btn task-action-btn--archive"
                                                                title="Unarchive task"
                                                                onClick={() =>
                                                                    handleUnarchive(
                                                                        task.id,
                                                                    )
                                                                }
                                                            >
                                                                <Icon
                                                                    icon={
                                                                        Unarchive03Icon
                                                                    }
                                                                    size={14}
                                                                />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="task-action-btn task-action-btn--delete"
                                                                title="Delete task"
                                                                onClick={() =>
                                                                    handleDeleteArchived(
                                                                        task.id,
                                                                    )
                                                                }
                                                            >
                                                                <Icon
                                                                    icon={
                                                                        Delete01Icon
                                                                    }
                                                                    size={14}
                                                                />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
