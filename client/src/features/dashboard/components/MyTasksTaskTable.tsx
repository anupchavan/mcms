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
import { TaskStatusSelect, TaskAssigneePicker, TaskCategorySelect, CATEGORY_TEXT_COLOR } from "./ArchiveTaskTable";
import { UserAvatar } from "../../../shared/components/UserAvatar";
import Icon from "../../../shared/components/Icon";
import { Archive01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import type { ArchiveParticipant } from "./archiveHelpers";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const HOST_STATUSES = ["draft", "pending", "in-progress", "completed", "verified", "missing"];
const ASSIGNEE_STATUSES = ["pending", "in-progress", "completed"];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


function formatDeadline(v: string): string {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return `${String(d.getDate()).padStart(2, "0")} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

/** Shape returned by `GET /tasks/mine/overview` after `processItem`. */
export interface MineOverviewTask {
    id: string;
    title: string;
    status: string;
    assignees?: Array<{
        id: string;
        name?: string | null;
        email?: string | null;
        profileImage?: string | null;
    }>;
    assignee?: string;
    assigneeId?: string;
    category?: string | null;
    deadline?: string | null;
    meetingId?: string | null;
    meetingShortId?: string | null;
    meetingTitle?: string | null;
    meetingHostId?: string | null;
    assignedAt?: string | null;
    verifiedAt?: string | null;
    hostFeedback?: string | null;
    archived?: boolean;
    archivedAt?: string | null;
}

/** DD MMM YYYY — e.g. "05 May 2026" */
function formatDateAssigned(dateValue: string | undefined | null): string {
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

interface MyTasksTaskTableProps {
    tasks: MineOverviewTask[];
    emptyMessage: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
}

export function MyTasksTaskTable({ tasks, emptyMessage, fetchWithAuth, onRefresh }: MyTasksTaskTableProps) {
    const [feedbackModal, setFeedbackModal] = useState<TaskFeedbackModalState | null>(null);

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

    return (
        <>
            <div className="my-tasks-task-table" role="table" aria-label="Tasks">
                <div className="my-tasks-task-table-head" role="row">
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--title" role="columnheader">
                        Task
                    </div>
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--meeting" role="columnheader">
                        Meeting
                    </div>
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--date" role="columnheader">
                        Assigned on
                    </div>
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--assignees" role="columnheader">
                        Assigned
                    </div>
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--type" role="columnheader">
                        Type
                    </div>
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--deadline" role="columnheader">
                        Deadline
                    </div>
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--status" role="columnheader">
                        Status
                    </div>
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--actions" role="columnheader" aria-label="Actions" />
                </div>
                <div className="my-tasks-task-table-body">
                    {tasks.length === 0 ? (
                        <div className="my-tasks-task-table-empty" role="status">
                            {emptyMessage}
                        </div>
                    ) : (
                        tasks.map((task) => (
                            <MyTasksTaskRow
                                key={task.id}
                                task={task}
                                fetchWithAuth={fetchWithAuth}
                                onRefresh={onRefresh}
                                openFeedbackPrompt={openFeedbackPrompt}
                            />
                        ))
                    )}
                </div>
            </div>
            <TaskFeedbackModal modal={feedbackModal} onComplete={closeFeedbackModal} />
        </>
    );
}

function MyTasksTaskRow({
    task,
    fetchWithAuth,
    onRefresh,
    openFeedbackPrompt,
}: {
    task: MineOverviewTask;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
    openFeedbackPrompt: (
        title: string,
        subtitle: string,
        placeholder: string,
        opts?: { defaultValue?: string; required?: boolean },
    ) => Promise<string | null>;
}) {
    const { user } = useAuth() || {};
    const currentUserId = String(user?.id || user?._id || "");

    const [titleDraft, setTitleDraft] = useState(task.title);
    const titleEverFocusedRef = useRef(false);
    const [savingTitle, setSavingTitle] = useState(false);

    // Participants for the assignee picker — lazily fetched the first time the row mounts
    // as a host, so the picker is ready without a click-to-load pattern.
    const [meetingParticipants, setMeetingParticipants] = useState<ArchiveParticipant[]>([]);
    const participantsFetchedRef = useRef(false);

    const meetingHostId = String(task.meetingHostId || "");
    const isHost = Boolean(currentUserId) && meetingHostId === currentUserId;
    const assigneeIds = useMemo(
        () => (task.assignees || []).map((a) => String(a.id)).filter(Boolean),
        [task.assignees],
    );
    const isAssignee = Boolean(currentUserId) && assigneeIds.includes(currentUserId);
    const canEditStatus = isHost || (isAssignee && task.status !== "verified");
    const canEditTitle = isHost;

    // Fetch participants for this meeting so the host can use the assignee picker.
    // Mirrors the allParticipants logic in ArchiveDetailView: host first (from the
    // populated hostId object), then the rest of the participants array, deduplicated.
    useEffect(() => {
        if (!isHost || !task.meetingId || participantsFetchedRef.current) return;
        participantsFetchedRef.current = true;
        (async () => {
            try {
                const res = await (fetchWithAuth || fetch)(`${API_BASE}/archive/${task.meetingId}`);
                if (!res.ok) return;
                const data = await res.json();
                const meeting = data.meeting || {};

                // Host may be a populated object on meeting.hostId
                const hostObj: ArchiveParticipant | null =
                    meeting.hostId && typeof meeting.hostId === "object"
                        ? { ...meeting.hostId, _id: String(meeting.hostId._id) }
                        : null;

                const rawParticipants: ArchiveParticipant[] = (meeting.participants || []).map(
                    (p: ArchiveParticipant) => ({ ...p, _id: String(p._id) }),
                );

                // Deduplicate: remove host from the participants list if already present
                const others = hostObj
                    ? rawParticipants.filter((p) => p._id !== hostObj._id)
                    : rawParticipants;

                setMeetingParticipants(hostObj ? [hostObj, ...others] : others);
            } catch {
                // Non-critical — picker will just show an empty list
            }
        })();
    }, [isHost, task.meetingId, fetchWithAuth]);

    useEffect(() => {
        if (!titleEverFocusedRef.current) setTitleDraft(task.title);
    }, [task.title]);

    const getHostFeedback = async (nextStatus: string): Promise<string | null | undefined> => {
        if (!isHost) return undefined;
        if (task.status === "completed" && nextStatus === "pending") {
            const response = await openFeedbackPrompt(
                "Send Back to Pending",
                `Provide a required note for ${task.assignee || "the assignee"} explaining what needs to be fixed.`,
                "Explain what needs to be corrected...",
                { defaultValue: task.hostFeedback || "", required: true },
            );
            if (response === null) return null;
            const trimmed = response.trim();
            if (!trimmed) return null;
            return trimmed;
        }
        if (task.status === "completed" && nextStatus === "verified") {
            const response = await openFeedbackPrompt(
                "Verify Task",
                `Optionally leave a note for ${task.assignee || "the assignee"} along with your verification. Leave blank to skip.`,
                "Great work! Add any optional remarks...",
                { required: false },
            );
            if (response === null) return null;
            return response.trim() || undefined;
        }
        return undefined;
    };

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

    const commitTitle = useCallback(async () => {
        const next = titleDraft.trim();
        titleEverFocusedRef.current = false;
        if (!next || next === task.title) {
            setTitleDraft(task.title);
            return;
        }
        setSavingTitle(true);
        const ok = await persistPatch({ title: next });
        if (!ok) setTitleDraft(task.title);
        setSavingTitle(false);
    }, [persistPatch, task.title, titleDraft]);

    const handleStatusChange = async (nextStatus: string) => {
        if (nextStatus === task.status) return;
        const hostFeedback = await getHostFeedback(nextStatus);
        if (hostFeedback === null) return;
        const payload: Record<string, unknown> = { status: nextStatus };
        if (typeof hostFeedback === "string") payload.hostFeedback = hostFeedback;
        await persistPatch(payload);
    };

    const handleAssigneesChange = useCallback(
        async (ids: string[]) => {
            await persistPatch({ assignees: ids });
        },
        [persistPatch],
    );

    const editableStatuses = isHost ? HOST_STATUSES : ASSIGNEE_STATUSES;

    const [deadlineDraft, setDeadlineDraft] = useState(task.deadline ? task.deadline.slice(0, 10) : "");
    useEffect(() => { setDeadlineDraft(task.deadline ? task.deadline.slice(0, 10) : ""); }, [task.deadline]);
    const commitDeadline = useCallback(async (val: string) => {
        await persistPatch({ deadline: val || null });
    }, [persistPatch]);

    // Only use task.assignees (the canonical multi-assignee list).
    // We intentionally ignore the legacy task.assigneeId / task.assignee fields here
    // to avoid showing stale or host-referencing data as if the task were assigned.
    const renderableAssignees = useMemo(() => {
        return (task.assignees || []).map((a) => ({
            id: String(a.id),
            name: a.name || a.email || "User",
            profileImage: a.profileImage ?? null,
        }));
    }, [task.assignees]);

    const meetingHref = (task.meetingShortId || task.meetingId)
        ? `/archives/${encodeURIComponent(task.meetingShortId || task.meetingId!)}` : null;

    return (
        <div className="my-tasks-task-table-row" role="row">
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--title" role="cell">
                <input
                    type="text"
                    className="archive-task-title-input"
                    value={titleDraft}
                    disabled={!canEditTitle}
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
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--meeting" role="cell">
                {meetingHref ? (
                    <Link to={meetingHref} className="my-tasks-meeting-link">
                        {task.meetingTitle || "Open archive"}
                    </Link>
                ) : (
                    <span className="my-tasks-meeting-fallback">—</span>
                )}
            </div>
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--date" role="cell">
                {formatDateAssigned(task.assignedAt)}
            </div>
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--assignees" role="cell">
                {isHost ? (
                    // Hosts get the full assignee picker — same component used in the archive page.
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
                ) : (
                    // Non-hosts see a read-only avatar stack (or "Unassigned").
                    renderableAssignees.length === 0 ? (
                        <span className="archive-task-unassigned">Unassigned</span>
                    ) : (
                        <div
                            className="archive-filter-stack archive-filter-stack--task-assignee-trigger"
                            aria-label={`Assignees: ${renderableAssignees.map((a) => a.name).join(", ")}`}
                        >
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
                            {renderableAssignees.length > 3 ? (
                                <div
                                    className="archive-filter-stack-slot archive-filter-stack-slot--overlap"
                                    style={{ zIndex: 4 }}
                                >
                                    <span className="archive-filter-stack-more">+{renderableAssignees.length - 3}</span>
                                </div>
                            ) : null}
                        </div>
                    )
                )}
            </div>
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--type" role="cell">
                {isHost ? (
                    <TaskCategorySelect
                        value={task.category || "Technical"}
                        onChange={(cat) => persistPatch({ category: cat })}
                    />
                ) : task.category ? (
                    <span style={{ fontSize: "0.8125rem", color: CATEGORY_TEXT_COLOR[task.category] || "var(--text-secondary)" }}>
                        {task.category}
                    </span>
                ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
            </div>
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--deadline" role="cell">
                {isHost ? (
                    <input
                        type="date"
                        className="input-field tasks-date-input"
                        value={deadlineDraft}
                        onChange={(e) => setDeadlineDraft(e.target.value)}
                        onBlur={(e) => commitDeadline(e.target.value)}
                        style={{ fontSize: "0.8125rem", minWidth: 0, width: "100%" }}
                    />
                ) : (
                    <span style={{ fontSize: "0.8125rem", color: task.deadline ? "var(--text-primary)" : "var(--text-muted)" }}>
                        {task.deadline ? formatDeadline(task.deadline) : "—"}
                    </span>
                )}
            </div>
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--status" role="cell">
                <TaskStatusSelect
                    value={task.status}
                    onChange={(next) => void handleStatusChange(next)}
                    disabled={!canEditStatus}
                    allowedStatuses={editableStatuses}
                />
            </div>
            <div className="my-tasks-task-table-cell my-tasks-task-table-cell--actions" role="cell">
                {isHost && (
                    <div className="task-row-actions">
                        <button
                            type="button"
                            className="task-action-btn task-action-btn--archive"
                            title="Archive task"
                            onClick={async () => {
                                await persistPatch({ archived: true });
                            }}
                        >
                            <Icon icon={Archive01Icon} size={14} />
                        </button>
                        <button
                            type="button"
                            className="task-action-btn task-action-btn--delete"
                            title="Delete task"
                            onClick={async () => {
                                if (!window.confirm("Permanently delete this task?")) return;
                                const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${task.id}`, { method: "DELETE" });
                                if (res.ok) onRefresh?.();
                                else window.alert(await readErrorMessage(res));
                            }}
                        >
                            <Icon icon={Delete01Icon} size={14} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
