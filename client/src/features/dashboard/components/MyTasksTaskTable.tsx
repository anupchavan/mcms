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
import { UserAvatar } from "../../../shared/components/UserAvatar";
import { TaskStatusSelect } from "./ArchiveTaskTable";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001/api";

const STACK_MAX_VISIBLE_DISCS = 3;

const HOST_STATUSES = ["draft", "pending", "in-progress", "completed", "verified", "missing"];
const ASSIGNEE_STATUSES = ["pending", "in-progress", "completed"];

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
    meetingId?: string | null;
    meetingTitle?: string | null;
    meetingHostId?: string | null;
    assignedAt?: string | null;
    hostFeedback?: string | null;
}

function formatDateAssigned(dateValue: string | undefined | null): string {
    if (!dateValue) return "—";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "—";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
                    <div className="my-tasks-task-table-cell my-tasks-task-table-cell--status" role="columnheader">
                        Status
                    </div>
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

    const meetingHostId = String(task.meetingHostId || "");
    const isHost = Boolean(currentUserId) && meetingHostId === currentUserId;
    const assigneeIds = useMemo(
        () => (task.assignees || []).map((a) => String(a.id)).filter(Boolean),
        [task.assignees],
    );
    const isAssignee = Boolean(currentUserId) && assigneeIds.includes(currentUserId);
    const canEditStatus = isHost || (isAssignee && task.status !== "verified");
    const canEditTitle = isHost;

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

    const editableStatuses = isHost ? HOST_STATUSES : ASSIGNEE_STATUSES;

    const renderableAssignees = useMemo(() => {
        const raw = task.assignees || [];
        if (raw.length > 0) {
            return raw.map((a) => ({
                id: String(a.id),
                name: a.name || a.email || "User",
                profileImage: a.profileImage ?? null,
            }));
        }
        if (task.assigneeId) {
            return [
                {
                    id: String(task.assigneeId),
                    name: task.assignee || "User",
                    profileImage: null as string | null,
                },
            ];
        }
        return [];
    }, [task.assignees, task.assignee, task.assigneeId]);

    const stackVisible = renderableAssignees.slice(0, STACK_MAX_VISIBLE_DISCS);
    const stackOverflow = renderableAssignees.length - stackVisible.length;

    const meetingHref = task.meetingId ? `/archives/${encodeURIComponent(task.meetingId)}` : null;

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
                {renderableAssignees.length === 0 ? (
                    <span className="archive-task-unassigned">Unassigned</span>
                ) : (
                    <div
                        className="archive-filter-stack archive-filter-stack--task-assignee-trigger"
                        aria-label={`Assignees: ${renderableAssignees.map((a) => a.name).join(", ")}`}
                    >
                        {stackVisible.map((opt, idx) => (
                            <div
                                key={opt.id}
                                className={`archive-filter-stack-slot${idx > 0 ? " archive-filter-stack-slot--overlap" : ""}`}
                                style={{ zIndex: idx + 1 }}
                            >
                                <span className="archive-filter-stack-disc">
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
                        {stackOverflow > 0 ? (
                            <div
                                className="archive-filter-stack-slot archive-filter-stack-slot--overlap"
                                style={{ zIndex: stackVisible.length + 1 }}
                            >
                                <span className="archive-filter-stack-more">+{stackOverflow}</span>
                            </div>
                        ) : null}
                    </div>
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
        </div>
    );
}
