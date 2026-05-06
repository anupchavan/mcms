import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../stores/AuthContext";
import { TaskFeedbackModal, type TaskFeedbackModalState } from "../../minutes/components/TaskFeedbackModal";
import { TaskAssigneePicker } from "./ArchiveTaskTable";
import { UserAvatar } from "../../../shared/components/UserAvatar";
import Icon from "../../../shared/components/Icon";
import { Archive01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import type { ArchiveParticipant } from "./archiveHelpers";
import type { MineOverviewTask } from "./MyTasksTaskTable";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
const HOST_STATUSES = ["draft", "pending", "in-progress", "completed", "verified", "missing"];
const ASSIGNEE_STATUSES = ["pending", "in-progress", "completed"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface KanbanColumnDef {
    value: string;
    label: string;
    /** CSS custom property value for text / header / badge */
    color: string;
    /** color-mix() background expression */
    bgMix: string;
}

const COLUMNS: KanbanColumnDef[] = [
    {
        value: "draft",
        label: "Draft",
        color: "var(--text-secondary)",
        bgMix: "var(--bg-elevated)",
    },
    {
        value: "pending",
        label: "Pending",
        color: "var(--flair-amber-color)",
        bgMix: "color-mix(in srgb, var(--bg-elevated) 88%, var(--flair-amber-color) 12%)",
    },
    {
        value: "in-progress",
        label: "In Progress",
        color: "var(--flair-primary-color)",
        bgMix: "color-mix(in srgb, var(--bg-elevated) 88%, var(--flair-primary-color) 12%)",
    },
    {
        value: "completed",
        label: "Awaiting Verify",
        color: "var(--flair-purple-color)",
        bgMix: "color-mix(in srgb, var(--bg-elevated) 88%, var(--flair-purple-color) 12%)",
    },
    {
        value: "verified",
        label: "Completed",
        color: "var(--flair-emerald-color)",
        bgMix: "color-mix(in srgb, var(--bg-elevated) 88%, var(--flair-emerald-color) 12%)",
    },
    {
        value: "missing",
        label: "Missing",
        color: "var(--accent-rose)",
        bgMix: "color-mix(in srgb, var(--bg-elevated) 88%, var(--accent-rose) 12%)",
    },
];

const CORE_COLUMNS = new Set(["pending", "in-progress", "completed", "verified"]);

function formatDate(dateValue: string | undefined | null): string {
    if (!dateValue) return "—";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "—";
    const day = String(date.getDate()).padStart(2, "0");
    const month = MONTH_ABBR[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
}

async function readErrorMessage(res: Response): Promise<string> {
    try {
        const data = await res.json();
        return data?.message || "Request failed";
    } catch {
        return "Request failed";
    }
}

export interface MyTasksKanbanProps {
    tasks: MineOverviewTask[];
    emptyMessage: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
}

export function MyTasksKanban({ tasks, emptyMessage, fetchWithAuth, onRefresh }: MyTasksKanbanProps) {
    const { user } = useAuth() || {};
    const currentUserId = String(user?.id || user?._id || "");

    const [feedbackModal, setFeedbackModal] = useState<TaskFeedbackModalState | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);

    const closeFeedbackModal = useCallback((value: string | null) => {
        setFeedbackModal((prev) => {
            prev?.resolve(value);
            return null;
        });
    }, []);

    const openFeedbackPrompt = useCallback(
        (
            title: string,
            subtitle: string,
            placeholder: string,
            opts: { defaultValue?: string; required?: boolean } = {},
        ): Promise<string | null> =>
            new Promise((resolve) => {
                setFeedbackModal({
                    title,
                    subtitle,
                    placeholder,
                    required: opts.required ?? false,
                    defaultValue: opts.defaultValue ?? "",
                    resolve,
                });
            }),
        [],
    );

    const tasksByStatus = useMemo(() => {
        const groups: Record<string, MineOverviewTask[]> = {};
        for (const col of COLUMNS) groups[col.value] = [];
        for (const task of tasks) {
            const key = Object.prototype.hasOwnProperty.call(groups, task.status) ? task.status : "pending";
            groups[key].push(task);
        }
        return groups;
    }, [tasks]);

    const visibleColumns = useMemo(
        () =>
            COLUMNS.filter(
                (col) => CORE_COLUMNS.has(col.value) || (tasksByStatus[col.value]?.length ?? 0) > 0,
            ),
        [tasksByStatus],
    );

    const handleDrop = useCallback(
        async (newStatus: string, taskId: string) => {
            const task = tasks.find((t) => t.id === taskId);
            if (!task || task.status === newStatus) return;

            const meetingHostId = String(task.meetingHostId || "");
            const isHost = Boolean(currentUserId) && meetingHostId === currentUserId;
            const assigneeIds = (task.assignees || []).map((a) => String(a.id));
            const isAssignee = Boolean(currentUserId) && assigneeIds.includes(currentUserId);

            // Permission: only host can move to "verified" (Completed)
            if (newStatus === "verified" && !isHost) return;

            // Assignee can only move within ASSIGNEE_STATUSES
            if (!isHost && isAssignee && !ASSIGNEE_STATUSES.includes(newStatus)) return;

            // Must be host or assignee to change status
            if (!isHost && !isAssignee) return;

            // Host feedback when sending completed → pending (reject)
            let hostFeedback: string | null | undefined = undefined;
            if (isHost && task.status === "completed" && newStatus === "pending") {
                const response = await openFeedbackPrompt(
                    "Send Back to Pending",
                    `Provide a required note for ${task.assignee || "the assignee"} explaining what needs to be fixed.`,
                    "Explain what needs to be corrected...",
                    { defaultValue: task.hostFeedback || "", required: true },
                );
                if (response === null) return;
                const trimmed = response.trim();
                if (!trimmed) return;
                hostFeedback = trimmed;
            }

            // Host feedback when verifying (completing)
            if (isHost && task.status === "completed" && newStatus === "verified") {
                const response = await openFeedbackPrompt(
                    "Mark as Completed",
                    `Optionally leave a note for ${task.assignee || "the assignee"} along with your completion. Leave blank to skip.`,
                    "Great work! Add any optional remarks...",
                    { required: false },
                );
                if (response === null) return;
                hostFeedback = response.trim() || undefined;
            }

            const patch: Record<string, unknown> = { status: newStatus };
            if (typeof hostFeedback === "string") patch.hostFeedback = hostFeedback;

            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                window.alert(await readErrorMessage(res));
                return;
            }
            onRefresh?.();
        },
        [tasks, currentUserId, fetchWithAuth, onRefresh, openFeedbackPrompt],
    );

    if (tasks.length === 0) {
        return (
            <div className="my-tasks-task-table-empty" role="status">
                {emptyMessage}
            </div>
        );
    }

    return (
        <>
            <div className="tasks-kanban">
                {visibleColumns.map((col) => (
                    <KanbanColumn
                        key={col.value}
                        column={col}
                        tasks={tasksByStatus[col.value] || []}
                        currentUserId={currentUserId}
                        fetchWithAuth={fetchWithAuth}
                        onRefresh={onRefresh}
                        openFeedbackPrompt={openFeedbackPrompt}
                        draggingId={draggingId}
                        setDraggingId={setDraggingId}
                        dropTarget={dropTarget}
                        setDropTarget={setDropTarget}
                        onDrop={handleDrop}
                    />
                ))}
            </div>
            <TaskFeedbackModal modal={feedbackModal} onComplete={closeFeedbackModal} />
        </>
    );
}

/* ─── Column ────────────────────────────────────────────────────────────────── */

function KanbanColumn({
    column,
    tasks,
    currentUserId,
    fetchWithAuth,
    onRefresh,
    openFeedbackPrompt,
    draggingId,
    setDraggingId,
    dropTarget,
    setDropTarget,
    onDrop,
}: {
    column: KanbanColumnDef;
    tasks: MineOverviewTask[];
    currentUserId: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
    openFeedbackPrompt: (
        title: string,
        subtitle: string,
        placeholder: string,
        opts?: { defaultValue?: string; required?: boolean },
    ) => Promise<string | null>;
    draggingId: string | null;
    setDraggingId: (id: string | null) => void;
    dropTarget: string | null;
    setDropTarget: (col: string | null) => void;
    onDrop: (newStatus: string, taskId: string) => void;
}) {
    const isDropTarget = dropTarget === column.value && draggingId !== null;

    return (
        <div
            className={`tasks-kanban-column${isDropTarget ? " tasks-kanban-column--drop-target" : ""}`}
            style={
                {
                    "--col-color": column.color,
                    "--col-bg": column.bgMix,
                } as React.CSSProperties
            }
            onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(column.value);
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropTarget(null);
                }
            }}
            onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                if (draggingId) onDrop(column.value, draggingId);
            }}
        >
            <div className="tasks-kanban-column-header">
                <span className="tasks-kanban-column-title">{column.label}</span>
                <span className="tasks-kanban-column-count">{tasks.length}</span>
            </div>
            <div className="tasks-kanban-column-body">
                {tasks.length === 0 ? (
                    <div className="tasks-kanban-column-empty" />
                ) : (
                    tasks.map((task) => (
                        <KanbanCard
                            key={task.id}
                            task={task}
                            currentUserId={currentUserId}
                            fetchWithAuth={fetchWithAuth}
                            onRefresh={onRefresh}
                            openFeedbackPrompt={openFeedbackPrompt}
                            isDragging={draggingId === task.id}
                            setDraggingId={setDraggingId}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

/* ─── Card ──────────────────────────────────────────────────────────────────── */

function KanbanCard({
    task,
    currentUserId,
    fetchWithAuth,
    onRefresh,
    openFeedbackPrompt,
    isDragging,
    setDraggingId,
}: {
    task: MineOverviewTask;
    currentUserId: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
    openFeedbackPrompt: (
        title: string,
        subtitle: string,
        placeholder: string,
        opts?: { defaultValue?: string; required?: boolean },
    ) => Promise<string | null>;
    isDragging: boolean;
    setDraggingId: (id: string | null) => void;
}) {
    const meetingHostId = String(task.meetingHostId || "");
    const isHost = Boolean(currentUserId) && meetingHostId === currentUserId;
    const assigneeIds = useMemo(
        () => (task.assignees || []).map((a) => String(a.id)).filter(Boolean),
        [task.assignees],
    );
    const isAssignee = Boolean(currentUserId) && assigneeIds.includes(currentUserId);
    const canDrag = isHost || (isAssignee && task.status !== "verified");

    // Participants — lazy fetch for host's assignee picker
    const [meetingParticipants, setMeetingParticipants] = useState<ArchiveParticipant[]>([]);
    const participantsFetchedRef = useRef(false);

    useEffect(() => {
        if (!isHost || !task.meetingId || participantsFetchedRef.current) return;
        participantsFetchedRef.current = true;
        (async () => {
            try {
                const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${task.meetingId}`);
                if (!res.ok) return;
                const data = await res.json();
                const meeting = data.meeting || {};
                const hostObj: ArchiveParticipant | null =
                    meeting.hostId && typeof meeting.hostId === "object"
                        ? { ...meeting.hostId, _id: String(meeting.hostId._id) }
                        : null;
                const rawParticipants: ArchiveParticipant[] = (meeting.participants || []).map(
                    (p: ArchiveParticipant) => ({ ...p, _id: String(p._id) }),
                );
                const others = hostObj
                    ? rawParticipants.filter((p) => p._id !== hostObj._id)
                    : rawParticipants;
                setMeetingParticipants(hostObj ? [hostObj, ...others] : others);
            } catch {
                // non-critical
            }
        })();
    }, [isHost, task.meetingId, fetchWithAuth]);

    const persistPatch = useCallback(
        async (patch: Record<string, unknown>) => {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${task.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                window.alert(await readErrorMessage(res));
                return false;
            }
            onRefresh?.();
            return true;
        },
        [fetchWithAuth, onRefresh, task.id],
    );

    const handleAssigneesChange = useCallback(
        (ids: string[]) => { void persistPatch({ assignees: ids }); },
        [persistPatch],
    );

    const renderableAssignees = useMemo(
        () =>
            (task.assignees || []).map((a) => ({
                id: String(a.id),
                name: a.name || a.email || "User",
                profileImage: a.profileImage ?? null,
            })),
        [task.assignees],
    );

    const meetingHref = (task.meetingShortId || task.meetingId)
        ? `/archives/${encodeURIComponent(task.meetingShortId || task.meetingId!)}` : null;

    return (
        <div
            className={`tasks-kanban-card${isDragging ? " tasks-kanban-card--dragging" : ""}${canDrag ? " tasks-kanban-card--draggable" : ""}`}
            draggable={canDrag}
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", task.id);
                setDraggingId(task.id);
            }}
            onDragEnd={() => setDraggingId(null)}
        >
            {/* Title */}
            <p className="tasks-kanban-card-title">{task.title}</p>

            {/* Meeting link */}
            {meetingHref ? (
                <Link
                    to={meetingHref}
                    className="tasks-kanban-card-meeting"
                    draggable={false}
                    onClick={(e) => e.stopPropagation()}
                >
                    {task.meetingTitle || "Open archive"}
                </Link>
            ) : (
                <span className="tasks-kanban-card-meeting tasks-kanban-card-meeting--none">—</span>
            )}

            {/* Footer: assignees + date */}
            <div className="tasks-kanban-card-footer">
                <div className="tasks-kanban-card-assignees">
                    {isHost ? (
                        <TaskAssigneePicker
                            participants={meetingParticipants}
                            value={assigneeIds}
                            selectedAssignees={(task.assignees || []).map((a) => ({
                                id: String(a.id),
                                name: a.name ?? null,
                                email: a.email ?? null,
                                profileImage: a.profileImage ?? null,
                            }))}
                            onChange={handleAssigneesChange}
                            disabled={false}
                        />
                    ) : renderableAssignees.length === 0 ? (
                        <span className="archive-task-unassigned">Unassigned</span>
                    ) : (
                        <div className="archive-filter-stack archive-filter-stack--task-assignee-trigger">
                            {renderableAssignees.slice(0, 3).map((opt, idx) => (
                                <div
                                    key={opt.id}
                                    className={`archive-filter-stack-slot${idx > 0 ? " archive-filter-stack-slot--overlap" : ""}`}
                                    style={{ zIndex: idx + 1 }}
                                >
                                    <span className="archive-filter-stack-disc" aria-hidden>
                                        <UserAvatar
                                            name={opt.name}
                                            profileImage={opt.profileImage}
                                            userId={opt.id}
                                            size={18}
                                            style={{ border: "none", borderRadius: "50%" }}
                                        />
                                    </span>
                                </div>
                            ))}
                            {renderableAssignees.length > 3 && (
                                <div
                                    className="archive-filter-stack-slot archive-filter-stack-slot--overlap my-task-stack-zidx-4"
                                >
                                    <span className="archive-filter-stack-more">+{renderableAssignees.length - 3}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <span className="tasks-kanban-card-date">{formatDate(task.assignedAt)}</span>
            </div>

            {/* Host-only action buttons */}
            {isHost && (
                <div className="tasks-kanban-card-actions">
                    <button
                        type="button"
                        className="task-action-btn task-action-btn--archive"
                        title="Archive task"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={async (e) => {
                            e.stopPropagation();
                            await persistPatch({ archived: true });
                        }}
                    >
                        <Icon icon={Archive01Icon} size={13} />
                    </button>
                    <button
                        type="button"
                        className="task-action-btn task-action-btn--delete"
                        title="Delete task"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={async (e) => {
                            e.stopPropagation();
                            if (!window.confirm("Permanently delete this task?")) return;
                            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${task.id}`, { method: "DELETE" });
                            if (res.ok) onRefresh?.();
                        }}
                    >
                        <Icon icon={Delete01Icon} size={13} />
                    </button>
                </div>
            )}
        </div>
    );
}
