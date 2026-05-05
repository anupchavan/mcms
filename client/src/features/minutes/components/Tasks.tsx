import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TaskFeedbackModal, type TaskFeedbackModalState } from "./TaskFeedbackModal";
import Icon from '../../../shared/components/Icon';
import ShortcutTooltip from '../../../shared/components/ShortcutTooltip';
import { useAuth } from '../../../stores/AuthContext';
import {
    CheckmarkCircle01Icon, Clock01Icon, AlertCircleIcon,
    ArrowRight01Icon,
    Add01Icon, Delete02Icon, SparklesIcon, PencilEdit02Icon,
    Video01Icon, MessageAdd01Icon,
    Calendar02Icon,
} from '@hugeicons/core-free-icons';


const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

const categoryChips = {
    'Technical': 'chip-blue',
    'Administrative': 'chip-purple',
    'Decision': 'chip-amber',
    'Follow-up': 'chip-cyan',
};

const statusConfig = {
    'completed': { icon: Clock01Icon, color: 'var(--accent-amber)', label: 'Awaiting Verify' },
    'verified': { icon: CheckmarkCircle01Icon, color: 'var(--accent-emerald)', label: 'Verified' },
    'in-progress': { icon: Clock01Icon, color: 'var(--accent-amber)', label: 'In Progress' },
    'pending': { icon: AlertCircleIcon, color: 'var(--text-muted)', label: 'Pending' },
    'draft': { icon: AlertCircleIcon, color: 'var(--text-tertiary)', label: 'Draft' },
    'missing': { icon: AlertCircleIcon, color: 'var(--accent-red)', label: 'Missing' },
};

const CATEGORIES = ['Technical', 'Administrative', 'Decision', 'Follow-up'];
const HOST_STATUSES = ['draft', 'pending', 'in-progress', 'completed', 'verified', 'missing'];
const ASSIGNEE_STATUSES = ['pending', 'in-progress', 'completed'];

function deadlineToApi(dateStr: string, timeStr: string, includeTime: boolean): string | null {
    const d = dateStr?.trim();
    if (!d) return null;
    if (includeTime && timeStr?.trim()) return `${d}T${timeStr.trim()}`;
    return d;
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
    assignee?: string;      // The display name
    assigneeId?: string;    // The actual User ID (ObjectId)
    assigneeName?: string;  // Explicit display name field
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

export default function Tasks({ items, sectionTitle = 'Tasks', emptyMessage = 'No tasks found.', meetingId, meetingHostId, fetchWithAuth, onRefresh, addTaskTrigger, onAddTriggered, participants, agendaItems = [] }: TasksProps) {
    const { user } = useAuth() || {};
    const currentUserId = String(user?.id || user?._id || '');
    const getItemHostId = (item: Task) => String(item.meetingHostId || meetingHostId || '');
    const isHostForItem = (item: Task) => Boolean(currentUserId) && getItemHostId(item) === currentUserId;
    const isAssigneeForItem = (item: Task) => Boolean(currentUserId) && String(item.assigneeId || '') === currentUserId;
    const canEditStatus = (item: Task) => isHostForItem(item) || (isAssigneeForItem(item) && item.status !== 'verified');
    const canEditDetails = (item: Task) => isHostForItem(item);
    const getEditableStatuses = (item: Task) => isHostForItem(item) ? HOST_STATUSES : ASSIGNEE_STATUSES;
    const canCreateItems = Boolean(meetingId) && Boolean(currentUserId) && String(meetingHostId || '') === currentUserId;
    const agendaLookup = useMemo(() => {
        const entries: [string, string][] = agendaItems.map((item) => [item.id, item.title]);
        return new Map<string, string>(entries);
    }, [agendaItems]);
    const [adding, setAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newCategory, setNewCategory] = useState('Technical');
    const [newDeadlineDate, setNewDeadlineDate] = useState('');
    const [newDeadlineTime, setNewDeadlineTime] = useState('');
    const [newDeadlineIncludeTime, setNewDeadlineIncludeTime] = useState(false);
    const [newAssignee, setNewAssignee] = useState<{ id: string; name: string } | null>(null);
    const [newAgendaItemId, setNewAgendaItemId] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);

    useEffect(() => {
        if (participants && participants.length > 0) {
            // Only auto-select if no selection exists, or if current selection is no longer in the list
            if (!newAssignee || !participants.find(p => (p._id || p.id) === newAssignee.id)) {
                setNewAssignee({ id: participants[0]._id || participants[0].id, name: participants[0].name });
            }
        } else {
            setNewAssignee(null);
        }
    }, [participants]);
    useEffect(() => {
        const hasSelectedAgenda = newAgendaItemId && agendaItems.some((item) => item.id === newAgendaItemId);
        if (!hasSelectedAgenda) {
            setNewAgendaItemId(getPreferredAgendaItemId(agendaItems));
        }
    }, [agendaItems, newAgendaItemId]);
    const [editData, setEditData] = useState<Partial<Task> | null>(null);
    const [editingAgendaItems, setEditingAgendaItems] = useState<AgendaItemLink[] | null>(null);

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
            groups.push({ key: '_unlinked', title: 'General / Unlinked', items: unlinkedItems });
        }

        return groups.length > 0 ? groups : [{ key: '_all', title: null, items }];
    }, [agendaItems, agendaLookup, items]);

    const startEditing = (item: Task) => {
        setEditingId(item.id || item._id || null);
        // Ensure assignee is correctly setup for the update request
        setEditData({ ...item, agendaItemId: item.agendaItemId || '' });
        // If parent agenda list is not provided (e.g. tasks view), try fetching agenda for the item's meeting
        const meetingId = (item as any).meetingId || (item as any).meeting || (item as any).meeting_id || null;
        if ((!agendaItems || agendaItems.length === 0) && meetingId && fetchWithAuth) {
            setEditingAgendaItems(null);
            (fetchWithAuth || fetch)(`${API_BASE}/agenda/${meetingId}`).then(res => {
                if (!res.ok) return null;
                return res.json();
            }).then((data: any) => {
                if (Array.isArray(data)) setEditingAgendaItems(data.map((a: any) => ({ id: a.id || a._id || a._id, title: a.title })));
            }).catch(() => {});
        }
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditData(null);
    };

    const handleUpdateField = (field: keyof Task, value: any) => {
        setEditData(prev => prev ? { ...prev, [field]: value } : null);
    };
    useEffect(() => {
        if (canCreateItems && addTaskTrigger && addTaskTrigger > 0) {
            setAdding(true);
            onAddTriggered?.();
        }
    }, [addTaskTrigger, canCreateItems, onAddTriggered]);

    const resetFields = () => {
        setNewTitle('');
        setNewDeadlineDate('');
        setNewDeadlineTime('');
        setNewDeadlineIncludeTime(false);
        setNewAgendaItemId(getPreferredAgendaItemId(agendaItems));
        if (participants && participants.length > 0) {
            // Re-select first participant if possible
            setNewAssignee({ id: participants[0]._id || participants[0].id, name: participants[0].name });
        } else {
            setNewAssignee(null);
        }
    };

    const handleCreate = async () => {
        const deadline = deadlineToApi(newDeadlineDate, newDeadlineTime, newDeadlineIncludeTime);
        try {
            const body: any = { 
                title: newTitle.trim(), 
                category: newCategory, 
                deadline: deadline || null,
                agendaItemId: newAgendaItemId || null,
            };
            if (newAssignee) {
                body.assignee = newAssignee.id;
                body.assigneeName = newAssignee.name;
            }

            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${meetingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                resetFields();
                setAdding(false);
                onRefresh?.();
            }
        } catch (err) {
            console.error('Failed to create task:', err);
        }
    };

    const readErrorMessage = async (res: Response) => {
        try {
            const data = await res.json();
            return data?.message || 'Request failed';
        } catch {
            return 'Request failed';
        }
    };

    // ── Custom feedback modal state ──────────────────────────────────────────
    const [feedbackModal, setFeedbackModal] = useState<TaskFeedbackModalState | null>(null);

    const openFeedbackPrompt = useCallback((
        title: string,
        subtitle: string,
        placeholder: string,
        opts: { defaultValue?: string; required?: boolean } = {},
    ): Promise<string | null> => {
        return new Promise((resolve) => {
            setFeedbackModal({
                title, subtitle, placeholder,
                required: opts.required ?? false,
                defaultValue: opts.defaultValue ?? '',
                resolve,
            });
        });
    }, []);

    const closeFeedbackModal = useCallback((value: string | null) => {
        setFeedbackModal(prev => { prev?.resolve(value); return null; });
    }, []);

    const getHostFeedback = async (item: Task, nextStatus: string): Promise<string | null | undefined> => {
        if (!isHostForItem(item)) return undefined;
        // Rejection: host sends completed item back to pending — note is required
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
        // Verification: host can optionally add a note for the assignee
        if (item.status === 'completed' && nextStatus === 'verified') {
            const response = await openFeedbackPrompt(
                'Verify Task',
                `Optionally leave a note for ${item.assignee || 'the assignee'} along with your verification. Leave blank to skip.`,
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
            if (!res.ok) {
                window.alert(await readErrorMessage(res));
                return;
            }
            onRefresh?.();
        } catch (err) {
            console.error('Failed to update status:', err);
        }
    };

    const handleUpdate = async (itemId: string) => {
        if (!editData || !editData.title?.trim()) return;
        const currentItem = items.find(item => String(item.id || item._id) === String(itemId));
        const hostFeedback = currentItem ? await getHostFeedback(currentItem, editData.status || 'pending') : undefined;
        if (hostFeedback === null) return;
        try {
            const assigneeId = typeof editData.assigneeId === 'string' && editData.assigneeId.trim()
                ? editData.assigneeId
                : null;
            const assigneeName = assigneeId
                ? (editData.assigneeName || editData.assignee || null)
                : null;
            const payload: any = {
                title: editData.title.trim(),
                category: editData.category || 'Technical',
                status: editData.status || 'pending',
                deadline: editData.deadline || null,
                assignee: assigneeId,
                assigneeName,
                agendaItemId: editData.agendaItemId || null,
            };
            if (typeof hostFeedback === 'string') payload.hostFeedback = hostFeedback;
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                window.alert(await readErrorMessage(res));
                return;
            }
            setEditingId(null);
            setEditData(null);
            onRefresh?.();
        } catch (err) {
            console.error('Failed to update task:', err);
        }
    };

    const handleDelete = async (itemId: string) => {
        try {
            await (fetchWithAuth || fetch)(`${API_BASE}/tasks/${itemId}`, { method: 'DELETE' });
            onRefresh?.();
        } catch (err) {
            console.error('Failed to delete:', err);
        }
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
            if (!res.ok) {
                window.alert(await readErrorMessage(res));
                return;
            }
            onRefresh?.();
        } catch (err) {
            console.error('Failed to send feedback:', err);
        }
    };

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
                        <div key={group.key} style={{ marginBottom: '0.85rem' }}>
                            {group.title && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', margin: '0 0.75rem 0.5rem', color: 'var(--text-secondary)' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{group.title}</span>
                                    <span className="chip chip-blue" style={{ fontSize: '0.5625rem' }}>{group.items.length}</span>
                                </div>
                            )}
                            {group.items.map((item, index) => {
                                const status = statusConfig[item.status] || statusConfig.pending;
                                const isEditing = editingId === (item.id || item._id);
                                const allowStatusEdit = canEditStatus(item);
                                const allowDetailEdit = canEditDetails(item);

                                if (isEditing && editData) {
                                    return (
                                        <div key={item.id || item._id || index} className="task-card glass-card animate-in" style={{ animationDelay: `${index * 0.06}s` }}>
                                            <input className="input-field" value={editData.title || ''} onChange={e => handleUpdateField('title', e.target.value)} style={{ marginBottom: '4px' }} placeholder="Title" />
                                            <div className="inline-form-row">
                                                <select className="input-field" value={editData.category || 'Technical'} onChange={e => handleUpdateField('category', e.target.value)}>
                                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                                <select className="input-field" value={editData.status || 'pending'} onChange={e => handleUpdateField('status', e.target.value)}>
                                                    {HOST_STATUSES.map(s => <option key={s} value={s}>{statusConfig[s]?.label || s}</option>)}
                                                </select>
                                            </div>
                                            <div className="inline-form-row" style={{ marginTop: '4px', marginBottom: '4px' }}>
                                                {participants && participants.length > 0 ? (
                                                    <select
                                                        className="input-field"
                                                        value={editData.assigneeId || ''}
                                                        onChange={e => {
                                                            const p = participants.find(part => (part._id || part.id) === e.target.value);
                                                            setEditData(prev => prev ? {
                                                                ...prev,
                                                                assignee: p ? (p._id || p.id) : null,
                                                                assigneeId: p ? (p._id || p.id) : '',
                                                                assigneeName: p ? p.name : null,
                                                            } : null);
                                                        }}
                                                        style={{ flex: 1 }}
                                                    >
                                                        <option value="">Unassigned</option>
                                                        {participants.map(p => (
                                                            <option key={p._id || p.id} value={p._id || p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input className="input-field" placeholder="Assigned to" value={editData.assignee || ''} onChange={e => handleUpdateField('assignee', e.target.value)} style={{ flex: 1 }} />
                                                )}
                                            </div>
                                            {(agendaItems.length > 0 || (editingAgendaItems && editingAgendaItems.length > 0)) && (
                                                (() => {
                                                    const available = (agendaItems && agendaItems.length > 0) ? agendaItems : (editingAgendaItems || []);
                                                    return (
                                                        <select
                                                            className="input-field"
                                                            value={String(editData.agendaItemId || '')}
                                                            onChange={e => handleUpdateField('agendaItemId', e.target.value)}
                                                            style={{ marginBottom: '4px' }}
                                                        >
                                                            <option value="">General / Unlinked</option>
                                                            {available.map((agendaItem) => (
                                                                <option key={agendaItem.id} value={agendaItem.id}>{agendaItem.title}</option>
                                                            ))}
                                                        </select>
                                                    );
                                                })()
                                            )}
                                            <input className="input-field" placeholder="Deadline (YYYY-MM-DD)" value={editData.deadline || ''} onChange={e => handleUpdateField('deadline', e.target.value)} style={{ marginBottom: '4px' }} />
                                            <div className="inline-form-row">
                                                <button className="btn btn-sm btn-primary" onClick={() => handleUpdate(item.id || item._id!)}>Save</button>
                                                <button className="btn btn-sm btn-secondary" onClick={cancelEditing}>Cancel</button>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={item.id || item._id || index}
                                        className="task-card glass-card animate-in"
                                        style={{ animationDelay: `${index * 0.06}s` }}
                                    >
                                        <div className="ai-card-top">
                                            <Icon icon={status.icon} size={16} style={{ color: status.color, flexShrink: 0 }} />
                                            <span className="ai-card-title">{item.title}</span>
                                            {item.source === 'ai-extracted' && (
                                                <span className="chip chip-purple" style={{ fontSize: '0.5625rem', padding: '1px 5px' }}>
                                                    <Icon icon={SparklesIcon} size={8} /> AI
                                                </span>
                                            )}
                                            <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
                                                {allowDetailEdit && item.assigneeId && (
                                                    <button
                                                        className="btn-icon btn-icon-sm"
                                                        onClick={() => handleSendFeedback(item)}
                                                        title="Send note to assignee"
                                                    >
                                                        <Icon icon={MessageAdd01Icon} size={10} />
                                                    </button>
                                                )}
                                                {allowDetailEdit && (
                                                    <button
                                                        className="btn-icon btn-icon-sm"
                                                        onClick={() => startEditing(item)}
                                                        title="Edit item"
                                                    >
                                                        <Icon icon={PencilEdit02Icon} size={10} />
                                                    </button>
                                                )}
                                                {meetingId && allowDetailEdit && (
                                                    <button
                                                        className="btn-icon btn-icon-sm"
                                                        onClick={() => handleDelete(item.id || item._id)}
                                                        title="Delete"
                                                    >
                                                        <Icon icon={Delete02Icon} size={10} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="ai-card-meta">
                                            <span className={`chip ${categoryChips[item.category] || 'chip-blue'}`}>
                                                {item.category}
                                            </span>
                                            {allowStatusEdit ? (
                                                <label className="ai-status-control" title="Update status">
                                                    <span className="ai-status-label">Status</span>
                                                    <select
                                                        className={`input-field ai-status-select st-${item.status}`}
                                                        value={item.status}
                                                        onChange={(e) => {
                                                            const nextStatus = e.target.value;
                                                            if (nextStatus === item.status) return;
                                                            handleStatusChange(item, nextStatus);
                                                        }}
                                                        aria-label={`Update status for ${item.title}`}
                                                    >
                                                        {getEditableStatuses(item).map((statusKey) => {
                                                            const option = statusConfig[statusKey] || statusConfig.pending;
                                                            return (
                                                                <option key={statusKey} value={statusKey}>
                                                                    {option.label}
                                                                </option>
                                                            );
                                                        })}
                                                    </select>
                                                </label>
                                            ) : (
                                                <span className={`chip ai-status-chip st-${item.status}`}>
                                                    {status.label}
                                                </span>
                                            )}
                                            {item.meetingTitle && (
                                                <span className="ai-card-meta-item" title={`${item.meetingTitle}${item.meetingHostName ? ' — ' + item.meetingHostName : ''}`}>
                                                    <Icon icon={Video01Icon} size={10} />
                                                    <span className="ai-card-meta-label">Meeting:</span>
                                                    <span className="ai-card-meta-value">
                                                        {item.meetingTitle}
                                                        {item.meetingHostName ? (
                                                            <span style={{ marginLeft: 6, color: 'var(--text-secondary)', fontWeight: 500 }}>— {item.meetingHostName}</span>
                                                        ) : null}
                                                    </span>
                                                </span>
                                            )}
                                            {String(item.agendaItemId || '').trim() && (
                                                <span className="ai-card-meta-item" title={agendaLookup.get(String(item.agendaItemId)) || 'General / Unlinked'}>
                                                    <Icon icon={Calendar02Icon} size={10} />
                                                    <span className="ai-card-meta-label">Agenda:</span>
                                                    <span className="ai-card-meta-value">{agendaLookup.get(String(item.agendaItemId)) || 'General / Unlinked'}</span>
                                                </span>
                                            )}
                                            <span className="ai-card-meta-item" title={item.assignee || 'Unassigned'}>
                                                <Icon icon={ArrowRight01Icon} size={10} />
                                                <span className="ai-card-meta-label">Assigned to:</span>
                                                <span className="ai-card-meta-value">{item.assignee || 'Unassigned'}</span>
                                            </span>
                                            {item.assignedAt && (
                                                <span className="ai-card-meta-item">
                                                    <Icon icon={Clock01Icon} size={10} />
                                                    <span className="ai-card-meta-label">Assigned on:</span>
                                                    <span className="ai-card-meta-value">{formatDateOnlyDisplay(item.assignedAt)}</span>
                                                </span>
                                            )}
                                            {item.deadline && (
                                                <span className="ai-card-deadline ai-card-meta-item">
                                                    <Icon icon={Clock01Icon} size={10} />
                                                    <span className="ai-card-meta-label">Deadline:</span>
                                                    <span className="ai-card-meta-value">{formatDateOnlyDisplay(item.deadline)}</span>
                                                </span>
                                            )}
                                            {item.verifiedAt && (
                                                <span className="ai-card-meta-item">
                                                    <Icon icon={CheckmarkCircle01Icon} size={10} />
                                                    <span className="ai-card-meta-label">Verified:</span>
                                                    <span className="ai-card-meta-value">{formatDateOnlyDisplay(item.verifiedAt)}</span>
                                                </span>
                                            )}
                                        </div>

                                        {item.hostFeedback && (
                                            <div className="ai-card-feedback">
                                                <strong>Host feedback:</strong> {item.hostFeedback}
                                            </div>
                                        )}

                                    </div>
                                );
                            })}
                        </div>
                    ))}

                    {canCreateItems && adding ? (
                        <div className="glass-card inline-form-card" onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); resetFields(); } }}>
                            <input
                                className="input-field"
                                placeholder="Task title..."
                                value={newTitle}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
                                onKeyDown={(e: React.KeyboardEvent) => {
                                    if (e.key === 'Enter') handleCreate();
                                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); resetFields(); }
                                }}
                                autoFocus
                                style={{ marginBottom: '0.25rem' }}
                            />
                            <div className="inline-form-row">
                                <select
                                    className="input-field"
                                    value={newCategory}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewCategory(e.target.value)}
                                    style={{ flex: 1 }}
                                >
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                {participants && participants.length > 0 && (
                                    <select
                                        className="input-field"
                                        value={newAssignee?.id || ''}
                                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                            const p = participants.find(part => (part._id || part.id) === e.target.value);
                                            if (p) setNewAssignee({ id: p._id || p.id, name: p.name });
                                        }}
                                        style={{ flex: 1 }}
                                    >
                                        {participants.map(p => (
                                            <option key={p._id || p.id} value={p._id || p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                            {agendaItems.length > 0 && (
                                <select
                                    className="input-field"
                                    value={newAgendaItemId}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewAgendaItemId(e.target.value)}
                                    style={{ marginBottom: '0.25rem' }}
                                >
                                    <option value="">General / Unlinked</option>
                                    {agendaItems.map((agendaItem) => (
                                        <option key={agendaItem.id} value={agendaItem.id}>{agendaItem.title}</option>
                                    ))}
                                </select>
                            )}
                            <div className="task-deadline-block">
                                <span className="task-deadline-label">Deadline</span>
                                <div className="task-deadline-row">
                                    <input
                                        type="date"
                                        className="input-field"
                                        value={newDeadlineDate}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDeadlineDate(e.target.value)}
                                        aria-label="Deadline date"
                                    />
                                    <label className="task-time-toggle">
                                        <input
                                            type="checkbox"
                                            checked={newDeadlineIncludeTime}
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDeadlineIncludeTime(e.target.checked)}
                                        />
                                        <span>Time</span>
                                    </label>
                                    {newDeadlineIncludeTime && (
                                        <input
                                            type="time"
                                            className="input-field"
                                            value={newDeadlineTime}
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDeadlineTime(e.target.value)}
                                            aria-label="Deadline time"
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="inline-form-row" style={{ marginTop: '0.35rem' }}>
                                <button className="btn btn-sm btn-primary" onClick={handleCreate} disabled={!newTitle.trim() || !newAssignee}>Add</button>
                                <button className="btn btn-sm btn-secondary" onClick={() => { setAdding(false); resetFields(); }}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        canCreateItems && (
                            <ShortcutTooltip keys={['Shift', 'A']} position="top" fullWidth>
                                <button
                                    className="btn btn-secondary"
                                    style={{ margin: '0 var(--lk-size-sm)', width: 'calc(100% - 2 * var(--lk-size-sm))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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

        {/* ── Custom feedback modal ────────────────────────────────────── */}
        <TaskFeedbackModal modal={feedbackModal} onComplete={closeFeedbackModal} />
        </>
    );
}
