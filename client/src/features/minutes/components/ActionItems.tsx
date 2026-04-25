import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../shared/components/Icon';
import ShortcutTooltip from '../../../shared/components/ShortcutTooltip';
import { useAuth } from '../../../stores/AuthContext';
import {
    CheckmarkCircle01Icon, Clock01Icon, AlertCircleIcon,
    ArrowRight01Icon,
    FlashIcon, Add01Icon, Delete02Icon, SparklesIcon, PencilEdit02Icon,
    Video01Icon, MessageAdd01Icon,
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

function formatDeadlineDisplay(deadline: string | undefined): string {
    if (!deadline) return '';
    if (deadline.includes('T')) {
        const [datePart, rest] = deadline.split('T');
        const hm = (rest || '').slice(0, 5);
        return hm ? `${datePart} · ${hm}` : datePart;
    }
    return deadline;
}

function formatAssignedDate(dateValue: string | undefined): string {
    if (!dateValue) return '';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return dateValue;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateTimeDisplay(dateValue: string | undefined): string {
    if (!dateValue) return '';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return dateValue;
    return date.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface ActionItem {
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
    meetingHostId?: string;
    completionSubmittedAt?: string;
    verifiedAt?: string;
    hostFeedback?: string;
}

interface ActionItemsProps {
    items: ActionItem[];
    sectionTitle?: string;
    emptyMessage?: string;
    meetingId?: string;
    meetingHostId?: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
    addActionItemTrigger?: number;
    onAddTriggered?: () => void;
    participants?: any[];
}

export default function ActionItems({ items, sectionTitle = 'Action Items', emptyMessage = 'No action items found.', meetingId, meetingHostId, fetchWithAuth, onRefresh, addActionItemTrigger, onAddTriggered, participants }: ActionItemsProps) {
    const { user } = useAuth() || {};
    const currentUserId = String(user?.id || user?._id || '');
    const getItemHostId = (item: ActionItem) => String(item.meetingHostId || meetingHostId || '');
    const isHostForItem = (item: ActionItem) => Boolean(currentUserId) && getItemHostId(item) === currentUserId;
    const isAssigneeForItem = (item: ActionItem) => Boolean(currentUserId) && String(item.assigneeId || '') === currentUserId;
    const canEditStatus = (item: ActionItem) => isHostForItem(item) || (isAssigneeForItem(item) && item.status !== 'verified');
    const canEditDetails = (item: ActionItem) => isHostForItem(item);
    const getEditableStatuses = (item: ActionItem) => isHostForItem(item) ? HOST_STATUSES : ASSIGNEE_STATUSES;
    const canCreateItems = Boolean(meetingId) && Boolean(currentUserId) && String(meetingHostId || '') === currentUserId;
    const [adding, setAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newCategory, setNewCategory] = useState('Technical');
    const [newDeadlineDate, setNewDeadlineDate] = useState('');
    const [newDeadlineTime, setNewDeadlineTime] = useState('');
    const [newDeadlineIncludeTime, setNewDeadlineIncludeTime] = useState(false);
    const [newAssignee, setNewAssignee] = useState<{ id: string; name: string } | null>(null);
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
    const [editData, setEditData] = useState<Partial<ActionItem> | null>(null);

    const startEditing = (item: ActionItem) => {
        setEditingId(item.id || item._id || null);
        // Ensure assignee is correctly setup for the update request
        setEditData({ ...item });
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditData(null);
    };

    const handleUpdateField = (field: keyof ActionItem, value: any) => {
        setEditData(prev => prev ? { ...prev, [field]: value } : null);
    };
    useEffect(() => {
        if (canCreateItems && addActionItemTrigger && addActionItemTrigger > 0) {
            setAdding(true);
            onAddTriggered?.();
        }
    }, [addActionItemTrigger, canCreateItems, onAddTriggered]);

    const resetFields = () => {
        setNewTitle('');
        setNewDeadlineDate('');
        setNewDeadlineTime('');
        setNewDeadlineIncludeTime(false);
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
                deadline: deadline || null 
            };
            if (newAssignee) {
                body.assignee = newAssignee.id;
                body.assigneeName = newAssignee.name;
            }

            const res = await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${meetingId}`, {
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
            console.error('Failed to create action item:', err);
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
    const feedbackTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [feedbackModal, setFeedbackModal] = useState<{
        title: string;
        subtitle: string;
        placeholder: string;
        required: boolean;
        defaultValue: string;
        resolve: (value: string | null) => void;
    } | null>(null);

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

    const getHostFeedback = async (item: ActionItem, nextStatus: string): Promise<string | null | undefined> => {
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
                'Verify Action Item',
                `Optionally leave a note for ${item.assignee || 'the assignee'} along with your verification. Leave blank to skip.`,
                'Great work! Add any optional remarks...',
                { required: false },
            );
            if (response === null) return null;
            return response.trim() || undefined;
        }
        return undefined;
    };

    const handleStatusChange = async (item: ActionItem, newStatus: string) => {
        const itemId = item.id || item._id;
        if (!itemId) return;
        const hostFeedback = await getHostFeedback(item, newStatus);
        if (hostFeedback === null) return;
        try {
            const payload: any = { status: newStatus };
            if (typeof hostFeedback === 'string') payload.hostFeedback = hostFeedback;
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, {
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
            };
            if (typeof hostFeedback === 'string') payload.hostFeedback = hostFeedback;
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, {
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
            console.error('Failed to update action item:', err);
        }
    };

    const handleDelete = async (itemId: string) => {
        try {
            await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, { method: 'DELETE' });
            onRefresh?.();
        } catch (err) {
            console.error('Failed to delete:', err);
        }
    };

    const handleSendFeedback = async (item: ActionItem) => {
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
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, {
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
        <div className="action-items-section">
            <div className="section-header">
                <div className="section-title-container">
                    <Icon icon={FlashIcon} size={14} />
                    <span className="section-title">{sectionTitle}</span>
                    <span className="chip chip-blue">{items.length}</span>
                </div>
            </div>

            <div className="action-items-body">
                <div className="action-items-list">
                    {items.length === 0 && (
                        <div className="action-items-empty-state">{emptyMessage}</div>
                    )}
                    {items.map((item, index) => {
                        const status = statusConfig[item.status] || statusConfig.pending;
                        const isEditing = editingId === (item.id || item._id);
                        const allowStatusEdit = canEditStatus(item);
                        const allowDetailEdit = canEditDetails(item);

                        if (isEditing && editData) {
                            return (
                                <div key={item.id || item._id || index} className="action-item-card glass-card animate-in" style={{ animationDelay: `${index * 0.06}s` }}>
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
                                            <input className="input-field" placeholder="Assignee" value={editData.assignee || ''} onChange={e => handleUpdateField('assignee', e.target.value)} style={{ flex: 1 }} />
                                        )}
                                    </div>
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
                                className="action-item-card glass-card animate-in"
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
                                    <span className="ai-card-assignee" title={item.assignee}>
                                        <Icon icon={ArrowRight01Icon} size={10} />
                                        {item.assignee}
                                    </span>
                                    {item.meetingTitle && (
                                        <span className="ai-card-meta-item" title={item.meetingTitle}>
                                            <Icon icon={Video01Icon} size={10} />
                                            <span className="ai-card-meta-label">Meeting:</span>
                                            <span className="ai-card-meta-value">{item.meetingTitle}</span>
                                        </span>
                                    )}
                                    {item.assignedAt && (
                                        <span className="ai-card-meta-item">
                                            <Icon icon={Clock01Icon} size={10} />
                                            <span className="ai-card-meta-label">Assigned:</span>
                                            <span className="ai-card-meta-value">{formatAssignedDate(item.assignedAt)}</span>
                                        </span>
                                    )}
                                    {item.completionSubmittedAt && (
                                        <span className="ai-card-meta-item">
                                            <Icon icon={Clock01Icon} size={10} />
                                            <span className="ai-card-meta-label">Submitted:</span>
                                            <span className="ai-card-meta-value">{formatDateTimeDisplay(item.completionSubmittedAt)}</span>
                                        </span>
                                    )}
                                    {item.verifiedAt && (
                                        <span className="ai-card-meta-item">
                                            <Icon icon={CheckmarkCircle01Icon} size={10} />
                                            <span className="ai-card-meta-label">Verified:</span>
                                            <span className="ai-card-meta-value">{formatDateTimeDisplay(item.verifiedAt)}</span>
                                        </span>
                                    )}
                                    {item.deadline && (
                                        <span className="ai-card-deadline ai-card-meta-item">
                                            <Icon icon={Clock01Icon} size={10} />
                                            <span className="ai-card-meta-label">Deadline:</span>
                                            <span className="ai-card-meta-value">{formatDeadlineDisplay(item.deadline)}</span>
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

                    {canCreateItems && adding ? (
                        <div className="glass-card inline-form-card" onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); resetFields(); } }}>
                            <input
                                className="input-field"
                                placeholder="Action item title..."
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
                            <div className="action-item-deadline-block">
                                <span className="action-item-deadline-label">Deadline</span>
                                <div className="action-item-deadline-row">
                                    <input
                                        type="date"
                                        className="input-field"
                                        value={newDeadlineDate}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDeadlineDate(e.target.value)}
                                        aria-label="Deadline date"
                                    />
                                    <label className="action-item-time-toggle">
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
                                    <Icon icon={Add01Icon} size={16} /> Add Action Item
                                </button>
                            </ShortcutTooltip>
                        )
                    )}
                </div>
            </div>
        </div>

        {/* ── Custom feedback modal ────────────────────────────────────── */}
        {feedbackModal && createPortal(
            <div
                className="fb-modal-overlay"
                onClick={() => closeFeedbackModal(null)}
                onKeyDown={(e) => { if (e.key === 'Escape') closeFeedbackModal(null); }}
                tabIndex={-1}
            >
                <div
                    className="fb-modal-card"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="fb-modal-header">
                        <div className="fb-modal-icon-wrap">
                            <Icon icon={MessageAdd01Icon} size={18} />
                        </div>
                        <div className="fb-modal-titles">
                            <div className="fb-modal-title">{feedbackModal.title}</div>
                            <div className="fb-modal-subtitle">{feedbackModal.subtitle}</div>
                        </div>
                    </div>

                    {/* Textarea */}
                    <div className="fb-modal-body">
                        <textarea
                            ref={feedbackTextareaRef}
                            className="fb-modal-textarea"
                            placeholder={feedbackModal.placeholder}
                            defaultValue={feedbackModal.defaultValue}
                            rows={4}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                    const val = feedbackTextareaRef.current?.value?.trim() || '';
                                    if (!feedbackModal.required || val) closeFeedbackModal(val || '');
                                }
                            }}
                        />
                        {feedbackModal.required && (
                            <div className="fb-modal-hint">* A note is required for this action</div>
                        )}
                        {!feedbackModal.required && (
                            <div className="fb-modal-hint fb-modal-hint-optional">Optional — leave blank to skip · Ctrl+Enter to send</div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="fb-modal-actions">
                        <button
                            className="btn btn-secondary"
                            type="button"
                            onClick={() => closeFeedbackModal(null)}
                        >
                            Cancel
                        </button>
                        <button
                            className="btn btn-primary"
                            type="button"
                            onClick={() => {
                                const val = feedbackTextareaRef.current?.value?.trim() || '';
                                if (feedbackModal.required && !val) {
                                    feedbackTextareaRef.current?.focus();
                                    feedbackTextareaRef.current?.classList.add('fb-shake');
                                    setTimeout(() => feedbackTextareaRef.current?.classList.remove('fb-shake'), 500);
                                    return;
                                }
                                closeFeedbackModal(val || '');
                            }}
                        >
                            <Icon icon={MessageAdd01Icon} size={14} />
                            Send Note
                        </button>
                    </div>
                </div>

                <style>{`
                    .fb-modal-overlay {
                        position: fixed; inset: 0; z-index: 9000;
                        background: rgba(0,0,0,0.55);
                        backdrop-filter: blur(6px);
                        display: flex; align-items: center; justify-content: center;
                        animation: fbOverlayIn 0.2s ease;
                    }
                    @keyframes fbOverlayIn {
                        from { opacity: 0; }
                        to   { opacity: 1; }
                    }
                    .fb-modal-card {
                        width: min(480px, calc(100vw - 2rem));
                        background: var(--bg-secondary);
                        border: 1px solid var(--border);
                        border-radius: 16px;
                        box-shadow: 0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04);
                        animation: fbCardIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
                        overflow: hidden;
                    }
                    @keyframes fbCardIn {
                        from { opacity: 0; transform: scale(0.92) translateY(12px); }
                        to   { opacity: 1; transform: scale(1) translateY(0); }
                    }
                    .fb-modal-header {
                        display: flex;
                        align-items: flex-start;
                        gap: 0.875rem;
                        padding: 1.25rem 1.375rem 1rem;
                        border-bottom: 1px solid var(--border);
                    }
                    .fb-modal-icon-wrap {
                        width: 36px; height: 36px; flex-shrink: 0;
                        border-radius: 10px;
                        background: var(--primary-muted);
                        border: 1px solid var(--primary-border);
                        color: var(--primary);
                        display: flex; align-items: center; justify-content: center;
                    }
                    .fb-modal-titles { flex: 1; min-width: 0; }
                    .fb-modal-title {
                        font-size: 0.9375rem;
                        font-weight: 600;
                        color: var(--text-primary);
                        letter-spacing: -0.016em;
                        line-height: 1.3;
                    }
                    .fb-modal-subtitle {
                        font-size: 0.75rem;
                        color: var(--text-muted);
                        margin-top: 3px;
                        line-height: 1.45;
                    }
                    .fb-modal-body {
                        padding: 1rem 1.375rem;
                    }
                    .fb-modal-textarea {
                        width: 100%;
                        min-height: 110px;
                        background: var(--bg-elevated);
                        border: 1.5px solid var(--border);
                        border-radius: 10px;
                        color: var(--text-primary);
                        font-size: 0.875rem;
                        font-family: inherit;
                        line-height: 1.6;
                        padding: 0.625rem 0.75rem;
                        resize: vertical;
                        outline: none;
                        transition: border-color 0.18s ease, box-shadow 0.18s ease;
                        box-sizing: border-box;
                    }
                    .fb-modal-textarea:focus {
                        border-color: var(--primary);
                        box-shadow: 0 0 0 3px var(--primary-muted);
                    }
                    .fb-modal-textarea.fb-shake {
                        animation: fbShake 0.4s ease;
                        border-color: var(--accent-rose);
                        box-shadow: 0 0 0 3px rgba(255,80,80,0.15);
                    }
                    @keyframes fbShake {
                        0%,100% { transform: translateX(0); }
                        20%     { transform: translateX(-6px); }
                        60%     { transform: translateX(5px); }
                        80%     { transform: translateX(-3px); }
                    }
                    .fb-modal-hint {
                        font-size: 0.6875rem;
                        color: var(--accent-rose);
                        margin-top: 6px;
                        font-weight: 500;
                    }
                    .fb-modal-hint-optional {
                        color: var(--text-muted);
                        font-weight: 400;
                    }
                    .fb-modal-actions {
                        display: flex;
                        gap: 0.5rem;
                        justify-content: flex-end;
                        padding: 0.875rem 1.375rem;
                        border-top: 1px solid var(--border);
                        background: var(--bg-elevated);
                    }
                `}</style>
            </div>,
            document.body,
        )}
        </>
    );
}
