import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import ShortcutTooltip from './ShortcutTooltip';
import {
    CheckmarkCircle01Icon, Clock01Icon, AlertCircleIcon,
    ArrowRight01Icon,
    FlashIcon, Add01Icon, Delete02Icon, SparklesIcon, PencilEdit02Icon,
    Video01Icon,
} from '@hugeicons/core-free-icons';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

const categoryChips = {
    'Technical': 'chip-blue',
    'Administrative': 'chip-purple',
    'Decision': 'chip-amber',
    'Follow-up': 'chip-cyan',
};

const statusConfig = {
    'completed': { icon: CheckmarkCircle01Icon, color: 'var(--accent-emerald)', label: 'Completed' },
    'in-progress': { icon: Clock01Icon, color: 'var(--accent-amber)', label: 'In Progress' },
    'pending': { icon: AlertCircleIcon, color: 'var(--text-muted)', label: 'Pending' },
    'draft': { icon: AlertCircleIcon, color: 'var(--text-tertiary)', label: 'Draft' },
    'missing': { icon: AlertCircleIcon, color: 'var(--accent-red)', label: 'Missing' },
};

const CATEGORIES = ['Technical', 'Administrative', 'Decision', 'Follow-up'];
const STATUSES = ['draft', 'pending', 'in-progress', 'completed', 'missing'];

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
    source?: string;
    meetingTitle?: string;
}

interface ActionItemsProps {
    items: ActionItem[];
    meetingId?: string;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onRefresh?: () => void;
    addActionItemTrigger?: number;
    onAddTriggered?: () => void;
    participants?: any[];
}

export default function ActionItems({ items, meetingId, fetchWithAuth, onRefresh, addActionItemTrigger, onAddTriggered, participants }: ActionItemsProps) {
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
        if (addActionItemTrigger && addActionItemTrigger > 0) {
            setAdding(true);
            onAddTriggered?.();
        }
    }, [addActionItemTrigger, onAddTriggered]);

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

    const handleStatusChange = async (itemId: string, newStatus: string) => {
        try {
            await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            onRefresh?.();
        } catch (err) {
            console.error('Failed to update status:', err);
        }
    };

    const handleUpdate = async (itemId: string) => {
        if (!editData || !editData.title?.trim()) return;
        try {
            await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editData),
            });
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

    return (
        <div className="action-items-section">
            <div className="section-header">
                <div className="section-title-container">
                    <Icon icon={FlashIcon} size={14} />
                    <span className="section-title">Action Items</span>
                    <span className="chip chip-blue">{items.length}</span>
                </div>
            </div>

            <div className="action-items-body">
                <div className="action-items-list">
                    {items.map((item, index) => {
                        const status = statusConfig[item.status] || statusConfig.pending;
                        const isEditing = editingId === (item.id || item._id);

                        if (isEditing && editData) {
                            return (
                                <div key={item.id || item._id || index} className="action-item-card glass-card animate-in" style={{ animationDelay: `${index * 0.06}s` }}>
                                    <input className="input-field" value={editData.title || ''} onChange={e => handleUpdateField('title', e.target.value)} style={{ marginBottom: '4px' }} placeholder="Title" />
                                    <div className="inline-form-row">
                                        <select className="input-field" value={editData.category || 'Technical'} onChange={e => handleUpdateField('category', e.target.value)}>
                                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <select className="input-field" value={editData.status || 'pending'} onChange={e => handleUpdateField('status', e.target.value)}>
                                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                    <div className="inline-form-row" style={{ marginTop: '4px', marginBottom: '4px' }}>
                                        {participants && participants.length > 0 ? (
                                            <select
                                                className="input-field"
                                                value={editData.assigneeId || ''}
                                                onChange={e => {
                                                    const p = participants.find(part => (part._id || part.id) === e.target.value);
                                                    if (p) {
                                                        setEditData(prev => prev ? { ...prev, assigneeId: p._id || p.id, assignee: p.name } : null);
                                                    }
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
                                    <span style={{ fontSize: '0.65rem', color: status.color, opacity: 0.8, textTransform: 'uppercase', fontWeight: 600, marginRight: '4px' }}>
                                        {item.status}
                                    </span>
                                    <span className="ai-card-title">{item.title}</span>
                                    {item.source === 'ai-extracted' && (
                                        <span className="chip chip-purple" style={{ fontSize: '0.5625rem', padding: '1px 5px' }}>
                                            <Icon icon={SparklesIcon} size={8} /> AI
                                        </span>
                                    )}
                                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
                                        <button
                                            className="btn-icon btn-icon-sm"
                                            style={{ fontSize: '0.5rem' }}
                                            onClick={() => {
                                                const statuses = STATUSES;
                                                const currentIndex = statuses.indexOf(item.status);
                                                const nextStatus = statuses[(currentIndex + 1) % statuses.length];
                                                handleStatusChange(item.id || item._id!, nextStatus);
                                            }}
                                            title="Cycle status"
                                        >
                                            <Icon icon={Clock01Icon} size={10} />
                                        </button>
                                        <button
                                            className="btn-icon btn-icon-sm"
                                            onClick={() => startEditing(item)}
                                            title="Edit item"
                                        >
                                            <Icon icon={PencilEdit02Icon} size={10} />
                                        </button>
                                        {meetingId && (
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
                                    <span className="ai-card-assignee" title={item.assignee}>
                                        <Icon icon={ArrowRight01Icon} size={10} />
                                        {item.assignee}
                                    </span>
                                    {item.meetingTitle && (
                                        <span className="ai-card-meta-item" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100px' }} title={item.meetingTitle}>
                                            <Icon icon={Video01Icon} size={10} />
                                            {item.meetingTitle}
                                        </span>
                                    )}
                                    {item.deadline && (
                                        <span className="ai-card-deadline">
                                            <Icon icon={Clock01Icon} size={10} />
                                            {formatDeadlineDisplay(item.deadline)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {adding ? (
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
                        meetingId && (
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
    );
}
