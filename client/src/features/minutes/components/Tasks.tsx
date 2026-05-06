import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TaskFeedbackModal, type TaskFeedbackModalState } from "./TaskFeedbackModal";
import Icon from '../../../shared/components/Icon';
import ShortcutTooltip from '../../../shared/components/ShortcutTooltip';
import { useAuth } from '../../../stores/AuthContext';
import {
    Add01Icon, Delete02Icon,
    MessageAdd01Icon, ArrowDown01Icon, ArrowUp01Icon,
} from '@hugeicons/core-free-icons';
import { TaskStatusSelect, TaskAssigneePicker, TaskCategorySelect, STATUS_LOOKUP, CATEGORY_TEXT_COLOR } from '../../dashboard/components/ArchiveTaskTable';
import type { ArchiveParticipant } from '../../dashboard/components/archiveHelpers';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

const CATEGORIES = ['Technical', 'Administrative', 'Decision', 'Follow-up'];
const HOST_STATUSES = ['draft', 'pending', 'in-progress', 'completed', 'verified', 'missing'];
const ASSIGNEE_STATUSES = ['pending', 'in-progress', 'completed'];

function deadlineToApi(dateStr: string): string | null {
    const d = dateStr?.trim();
    return d || null;
}

function formatDateOnlyDisplay(dateValue: string | undefined): string {
    if (!dateValue) return '';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return dateValue;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

interface Task {
    id?: string;
    _id?: string;
    title: string;
    category: string;
    status: string;
    assignee?: string;
    assigneeId?: string;
    assigneeName?: string;
    assignees?: Array<{ id: string; name?: string | null; email?: string | null; profileImage?: string | null }>;
    deadline?: string;
    assignedAt?: string;
    source?: string;
    meetingTitle?: string;
    meetingHostName?: string;
    meetingHostId?: string;
    completionSubmittedAt?: string;
    verifiedAt?: string;
    hostFeedback?: string;
    agendaItemId?: string | null;
}

interface AgendaItemLink {
    id: string;
    title: string;
    duration?: number;
    status?: string;
}

interface TasksProps {
    items: Task[];
    sectionTitle?: string;
    emptyMessage?: string;
    meetingId?: string;
    meetingHostId?: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
    addTaskTrigger?: number;
    onAddTriggered?: () => void;
    participants?: any[];
    agendaItems?: AgendaItemLink[];
}

function getPreferredAgendaItemId(agendaItems: AgendaItemLink[]): string {
    if (!agendaItems.length) return '';
    const activeItem = agendaItems.find((item) => ['active', 'in-progress'].includes(String(item.status || '').toLowerCase()));
    return activeItem?.id || agendaItems[0].id || '';
}

/** Convert raw participants to ArchiveParticipant shape expected by TaskAssigneePicker */
function toArchiveParticipants(participants: any[]): ArchiveParticipant[] {
    return (participants || []).map((p) => ({
        _id: String(p._id || p.id || ''),
        name: p.name || null,
        email: p.email || null,
        profileImage: p.profileImage || null,
    }));
}

async function readErrorMessage(res: Response): Promise<string> {
    try { const data = await res.json(); return data?.message || 'Request failed'; }
    catch { return 'Request failed'; }
}

export default function Tasks({ items, sectionTitle = 'Tasks', emptyMessage = 'No tasks found.', meetingId, meetingHostId, fetchWithAuth, onRefresh, addTaskTrigger, onAddTriggered, participants, agendaItems = [] }: TasksProps) {
    const { user } = useAuth() || {};
    const currentUserId = String(user?.id || user?._id || '');
    const getItemHostId = (item: Task) => String(item.meetingHostId || meetingHostId || '');
    const isHostForItem = (item: Task) => Boolean(currentUserId) && getItemHostId(item) === currentUserId;
    const isAssigneeForItem = (item: Task) => {
        if (!currentUserId) return false;
        if (String(item.assigneeId || '') === currentUserId) return true;
        return (item.assignees || []).some((a) => String(a.id) === currentUserId);
    };
    const canEditStatus = (item: Task) => isHostForItem(item) || (isAssigneeForItem(item) && item.status !== 'verified');
    const canCreateItems = Boolean(meetingId) && Boolean(currentUserId) && String(meetingHostId || '') === currentUserId;

    const agendaLookup = useMemo(() => {
        return new Map<string, string>(agendaItems.map((item) => [item.id, item.title]));
    }, [agendaItems]);

    // ── Create form state ────────────────────────────────────────────
    const [adding, setAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newCategory, setNewCategory] = useState('Technical');
    const [newDeadlineDate, setNewDeadlineDate] = useState('');
    const [newAgendaItemId, setNewAgendaItemId] = useState('');
    const [newAssigneeIds, setNewAssigneeIds] = useState<string[]>([]);

    // ── Collapse state per card ───────────────────────────────────────
    const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set());

    const toggleCollapse = useCallback((id: string) => {
        setCollapsedCards((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const archiveParticipants = useMemo(() => toArchiveParticipants(participants || []), [participants]);

    useEffect(() => {
        if (participants && participants.length > 0) {
            if (newAssigneeIds.length === 0) {
                const first = participants[0];
                setNewAssigneeIds([String(first._id || first.id)]);
            }
        } else {
            setNewAssigneeIds([]);
        }
    }, [participants]);

    useEffect(() => {
        const hasSelectedAgenda = newAgendaItemId && agendaItems.some((item) => item.id === newAgendaItemId);
        if (!hasSelectedAgenda) {
            setNewAgendaItemId(getPreferredAgendaItemId(agendaItems));
        }
    }, [agendaItems, newAgendaItemId]);

    const groupedSections = useMemo(() => {
        if (!agendaItems.length) {
            return [{ key: '_all', title: null, items }];
        }
        const groups = agendaItems.map((agendaItem) => ({
            key: agendaItem.id,
            title: agendaItem.title,
            items: items.filter((item) => item.agendaItemId === agendaItem.id),
        })).filter((group) => group.items.length > 0);

        const unlinkedItems = items.filter((item) => !item.agendaItemId || !agendaLookup.has(String(item.agendaItemId)));
        if (unlinkedItems.length > 0) {
            // No title for unlinked items — render without a section heading
            groups.push({ key: '_unlinked', title: null, items: unlinkedItems });
        }
        return groups.length > 0 ? groups : [{ key: '_all', title: null, items }];
    }, [agendaItems, agendaLookup, items]);

    // ── Feedback modal ────────────────────────────────────────────────
    const [feedbackModal, setFeedbackModal] = useState<TaskFeedbackModalState | null>(null);

    const openFeedbackPrompt = useCallback((
        title: string,
        subtitle: string,
        placeholder: string,
        opts: { defaultValue?: string; required?: boolean } = {},
    ): Promise<string | null> => {
        return new Promise((resolve) => {
            setFeedbackModal({ title, subtitle, placeholder, required: opts.required ?? false, defaultValue: opts.defaultValue ?? '', resolve });
        });
    }, []);

    const closeFeedbackModal = useCallback((value: string | null) => {
        setFeedbackModal(prev => { prev?.resolve(value); return null; });
    }, []);

    const getHostFeedback = async (item: Task, nextStatus: string): Promise<string | null | undefined> => {
        if (!isHostForItem(item)) return undefined;
        if (item.status === 'completed' && nextStatus === 'pending') {
            const response = await openFeedbackPrompt(
                'Send Back to Pending',
                `Provide a required note for ${item.assignee || 'the assignee'} explaining what needs to be fixed.`,
                'Explain what needs to be corrected...',
                { defaultValue: item.hostFeedback || '', required: true },
            );
            if (response === null) return null;
            const trimmed = response.trim();
            if (!trimmed) return null;
            return trimmed;
        }
        if (item.status === 'completed' && nextStatus === 'verified') {
            const response = await openFeedbackPrompt(
                'Verify Task',
                `Optionally leave a note for ${item.assignee || 'the assignee'}.`,
                'Great work! Add any optional remarks...',
                { required: false },
            );
            if (response === null) return null;
            return response.trim() || undefined;
        }
        return undefined;
    };

    const handleStatusChange = async (item: Task, newStatus: string) => {
        const itemId = item.id || item._id;
        if (!itemId) return;
        const hostFeedback = await getHostFeedback(item, newStatus);
        if (hostFeedback === null) return;
        try {
            const payload: any = { status: newStatus };
            if (typeof hostFeedback === 'string') payload.hostFeedback = hostFeedback;
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) { window.alert(await readErrorMessage(res)); return; }
            onRefresh?.();
        } catch (err) { console.error('Failed to update status:', err); }
    };

    const handleAssigneeChange = async (item: Task, assigneeIds: string[]) => {
        const itemId = item.id || item._id;
        if (!itemId) return;
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignees: assigneeIds }),
            });
            if (!res.ok) { window.alert(await readErrorMessage(res)); return; }
            onRefresh?.();
        } catch (err) { console.error('Failed to update assignees:', err); }
    };

    const handleCategoryChange = async (item: Task, newCat: string) => {
        const itemId = item.id || item._id;
        if (!itemId) return;
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category: newCat }),
            });
            if (!res.ok) { window.alert(await readErrorMessage(res)); return; }
            onRefresh?.();
        } catch (err) { console.error('Failed to update category:', err); }
    };

    const handleDeadlineChange = async (item: Task, newDeadline: string) => {
        const itemId = item.id || item._id;
        if (!itemId) return;
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deadline: newDeadline || null }),
            });
            if (!res.ok) { window.alert(await readErrorMessage(res)); return; }
            onRefresh?.();
        } catch (err) { console.error('Failed to update deadline:', err); }
    };

    const handleDelete = async (itemId: string) => {
        try {
            await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, { method: 'DELETE' });
            onRefresh?.();
        } catch (err) { console.error('Failed to delete:', err); }
    };

    const handleSendFeedback = async (item: Task) => {
        const note = await openFeedbackPrompt(
            'Send Note to Assignee',
            `Send a message to ${item.assignee || 'the assignee'} about "${item.title}".`,
            'Type your note here...',
            { defaultValue: item.hostFeedback || '', required: true },
        );
        if (note === null) return;
        const trimmed = note.trim();
        if (!trimmed) return;
        const itemId = item.id || item._id;
        if (!itemId) return;
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostFeedback: trimmed }),
            });
            if (!res.ok) { window.alert(await readErrorMessage(res)); return; }
            onRefresh?.();
        } catch (err) { console.error('Failed to send feedback:', err); }
    };

    const resetFields = () => {
        setNewTitle('');
        setNewDeadlineDate('');
        setNewAgendaItemId(getPreferredAgendaItemId(agendaItems));
        if (participants && participants.length > 0) {
            setNewAssigneeIds([String(participants[0]._id || participants[0].id)]);
        } else {
            setNewAssigneeIds([]);
        }
    };

    const handleCreate = async () => {
        if (!newTitle.trim()) return;
        try {
            const body: any = {
                title: newTitle.trim(),
                category: newCategory,
                deadline: deadlineToApi(newDeadlineDate),
                agendaItemId: newAgendaItemId || null,
                assignees: newAssigneeIds,
            };
            if (newAssigneeIds.length > 0) {
                const p = (participants || []).find((pp: any) => String(pp._id || pp.id) === newAssigneeIds[0]);
                if (p) { body.assignee = p._id || p.id; body.assigneeName = p.name; }
            }
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${meetingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) { resetFields(); setAdding(false); onRefresh?.(); }
        } catch (err) { console.error('Failed to create task:', err); }
    };

    useEffect(() => {
        if (canCreateItems && addTaskTrigger && addTaskTrigger > 0) {
            setAdding(true);
            onAddTriggered?.();
        }
    }, [addTaskTrigger, canCreateItems, onAddTriggered]);

    return (
        <>
        <div className="tasks-section">
            <div className="section-header">
                <div className="section-title-container">
                    <span className="section-title">{sectionTitle}</span>
                    <span className="chip chip-blue">{items.length}</span>
                </div>
            </div>

            <div className="tasks-body">
                <div className="tasks-list">
                    {items.length === 0 && (
                        <div className="tasks-empty-state">{emptyMessage}</div>
                    )}

                    {groupedSections.map((group) => (
                        <div key={group.key} className="tasks-group">
                            {group.title && (
                                <div className="tasks-group-header">
                                    <span className="tasks-group-title">{group.title}</span>
                                    <span className="chip chip-blue chip-2xs">{group.items.length}</span>
                                </div>
                            )}
                            {group.items.map((item, index) => {
                                const itemId = item.id || item._id || '';
                                const isHost = isHostForItem(item);
                                const canStatus = canEditStatus(item);
                                const allowedStatuses = isHost ? HOST_STATUSES : ASSIGNEE_STATUSES;
                                const isCollapsed = collapsedCards.has(itemId);
                                const isAI = item.source === 'ai-extracted';

                                const currentAssigneeIds = (item.assignees && item.assignees.length > 0)
                                    ? item.assignees.map((a) => String(a.id))
                                    : item.assigneeId ? [item.assigneeId] : [];

                                const assigneeDisplayName = (item.assignees && item.assignees.length > 0)
                                    ? item.assignees.map((a) => a.name || a.email || 'User').join(', ')
                                    : item.assignee || 'Unassigned';

                                return (
                                    <div
                                        key={itemId || index}
                                        className="task-card glass-card animate-in"
                                        style={{
                                            animationDelay: `${index * 0.06}s`,
                                            position: 'relative',
                                        }}
                                    >
                                        {/* ── AI eyebrow (only when expanded) ── */}
                                        {isAI && !isCollapsed && (
                                            <div className="task-ai-eyebrow">
                                                AI Generated
                                            </div>
                                        )}

                                        {/* ── Card header: title + collapse + actions ── */}
                                        <div className="live-task-card-header" style={{ marginBottom: isCollapsed ? 0 : undefined }}>
                                            <span
                                                className="live-task-card-title"
                                                style={isCollapsed ? {
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    flex: 1,
                                                    minWidth: 0,
                                                } : { flex: 1, minWidth: 0 }}
                                            >
                                                {item.title}
                                            </span>
                                            <div className="live-task-card-actions">
                                                {isHost && item.assigneeId && !isCollapsed && (
                                                    <button className="btn-icon btn-icon-sm" onClick={() => handleSendFeedback(item)} title="Send note to assignee">
                                                        <Icon icon={MessageAdd01Icon} size={14} />
                                                    </button>
                                                )}
                                                {meetingId && isHost && !isCollapsed && (
                                                    <button className="btn-icon btn-icon-sm" onClick={() => handleDelete(itemId)} title="Delete task">
                                                        <Icon icon={Delete02Icon} size={14} />
                                                    </button>
                                                )}
                                                <button
                                                    className="btn-icon btn-icon-sm"
                                                    onClick={() => toggleCollapse(itemId)}
                                                    title={isCollapsed ? 'Expand' : 'Collapse'}
                                                >
                                                    <Icon icon={isCollapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* ── Expanded card body ── */}
                                        {!isCollapsed && (
                                            <>
                                                {/* Assigned to */}
                                                <div className="live-task-card-field">
                                                    <span className="live-task-card-label">Assigned to</span>
                                                    {isHost && archiveParticipants.length > 0 ? (
                                                        <TaskAssigneePicker
                                                            participants={archiveParticipants}
                                                            value={currentAssigneeIds}
                                                            selectedAssignees={(item.assignees || []).map(a => ({ id: a.id, name: a.name ?? null, email: a.email ?? null, profileImage: a.profileImage ?? null }))}
                                                            onChange={(ids) => handleAssigneeChange(item, ids)}
                                                        />
                                                    ) : (
                                                        <span className="live-task-card-value">{assigneeDisplayName}</span>
                                                    )}
                                                </div>

                                                {/* Type and Deadline */}
                                                <div className="live-task-card-row">
                                                    <div className="live-task-card-field">
                                                        <span className="live-task-card-label">Type</span>
                                                        {isHost ? (
                                                            <TaskCategorySelect
                                                                value={item.category || 'Technical'}
                                                                onChange={(cat) => handleCategoryChange(item, cat)}
                                                            />
                                                        ) : (
                                                            <span style={{ fontSize: '0.8125rem', color: CATEGORY_TEXT_COLOR[item.category] || 'var(--text-secondary)' }}>
                                                                {item.category || '—'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="live-task-card-field">
                                                        <span className="live-task-card-label">Deadline</span>
                                                        {isHost ? (
                                                            <input
                                                                type="date"
                                                                className="input-field tasks-date-input tasks-date-font"
                                                                defaultValue={formatDateOnlyDisplay(item.deadline)}
                                                                key={`dl-${itemId}-${item.deadline}`}
                                                                onBlur={(e) => handleDeadlineChange(item, e.target.value)}
                                                            />
                                                        ) : (
                                                            <span className="live-task-card-value">
                                                                {item.deadline ? formatDateOnlyDisplay(item.deadline) : '—'}
                                                            </span>
                                                        )}
                                                    </div>
													<div className="live-task-card-field">
                                                    <span className="live-task-card-label">Status</span>
                                                    {canStatus ? (
                                                        <TaskStatusSelect
                                                            value={item.status}
                                                            onChange={(next) => handleStatusChange(item, next)}
                                                            allowedStatuses={allowedStatuses}
                                                        />
                                                    ) : (
                                                        <span className={STATUS_LOOKUP[item.status]?.statusLabelClass || ''}>
                                                            {STATUS_LOOKUP[item.status]?.label || item.status}
                                                        </span>
                                                    )}
                                                </div>
                                                </div>




                                                {/* Host feedback */}
                                                {item.hostFeedback && (
                                                    <div className="ai-card-feedback">
                                                        <strong>Host feedback:</strong> {item.hostFeedback}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}

                    {/* ── Create form ── */}
                    {canCreateItems && adding ? (
                        <div className="glass-card inline-form-card" onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); resetFields(); } }}>
                            <input
                                className="input-field tasks-new-form-row"
                                placeholder="Task title..."
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); resetFields(); } }}
                                autoFocus
                            />
                            <div className="inline-form-row">
                                <select className="input-field tasks-select-flex" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                {archiveParticipants.length > 0 && (
                                    <TaskAssigneePicker
                                        participants={archiveParticipants}
                                        value={newAssigneeIds}
                                        selectedAssignees={newAssigneeIds.map(id => {
                                            const p = archiveParticipants.find(pp => String(pp._id) === id);
                                            return { id, name: p?.name ?? null, email: p?.email ?? null, profileImage: p?.profileImage ?? null };
                                        })}
                                        onChange={setNewAssigneeIds}
                                    />
                                )}
                            </div>
                            {agendaItems.length > 0 && (
                                <select className="input-field tasks-select-mb" value={newAgendaItemId} onChange={(e) => setNewAgendaItemId(e.target.value)}>
                                    <option value="">General / Unlinked</option>
                                    {agendaItems.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                                </select>
                            )}
                            <div className="task-deadline-block">
                                <span className="task-deadline-label">Deadline</span>
                                <input
                                    type="date"
                                    className="input-field tasks-deadline-flex"
                                    value={newDeadlineDate}
                                    onChange={(e) => setNewDeadlineDate(e.target.value)}
                                    aria-label="Deadline date"
                                />
                            </div>
                            <div className="inline-form-row tasks-new-form-gap">
                                <button className="btn btn-sm btn-primary" onClick={handleCreate} disabled={!newTitle.trim()}>Add</button>
                                <button className="btn btn-sm btn-secondary" onClick={() => { setAdding(false); resetFields(); }}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        canCreateItems && (
                            <ShortcutTooltip keys={['Shift', 'A']} position="top" fullWidth>
                                <button
                                    className="btn btn-secondary tasks-add-full-btn"
                                    onClick={() => setAdding(true)}
                                >
                                    <Icon icon={Add01Icon} size={16} /> Add Task
                                </button>
                            </ShortcutTooltip>
                        )
                    )}
                </div>
            </div>
        </div>

        <TaskFeedbackModal modal={feedbackModal} onComplete={closeFeedbackModal} />
        </>
    );
}
