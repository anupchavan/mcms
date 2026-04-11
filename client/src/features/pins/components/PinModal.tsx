import { useState } from 'react';
import Icon from '../../../shared/components/Icon';
import { Cancel01Icon, PinIcon } from '@hugeicons/core-free-icons';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

interface PinModalProps {
    meetingId: string;
    transcriptTimestamp?: string;
    onClose: () => void;
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
    onPinCreated?: () => void;
}

export default function PinModal({ meetingId, transcriptTimestamp, onClose, fetchWithAuth, onPinCreated }: PinModalProps) {
    const [type, setType] = useState('url');
    const [url, setUrl] = useState('');
    const [content, setContent] = useState('');
    const [label, setLabel] = useState('');
    const [pageNumber, setPageNumber] = useState('');
    const [lineNumber, setLineNumber] = useState('');
    const [language, setLanguage] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (type === 'url' && !url.trim()) return;
        if (type === 'code' && !content.trim()) return;
        setSaving(true);
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/pins/${meetingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    url: type !== 'code' ? url.trim() : null,
                    content: type === 'code' ? content : null,
                    label: label.trim(),
                    transcriptTimestamp,
                    metadata: {
                        pageNumber: pageNumber ? parseInt(pageNumber) : null,
                        lineNumber: lineNumber ? parseInt(lineNumber) : null,
                        language: language || null,
                    },
                }),
            });
            if (res.ok) {
                onPinCreated?.();
                onClose();
            }
        } catch (err) {
            console.error('Failed to create pin:', err);
        }
        setSaving(false);
    };

    return (
        <div className="qr-overlay" onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: '12px',
                    padding: '24px',
                    maxWidth: '420px',
                    width: '90%',
                    border: '1px solid var(--border)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                        <Icon icon={PinIcon} size={16} /> Pin Resource
                    </h3>
                    <button className="btn-icon" onClick={onClose}>
                        <Icon icon={Cancel01Icon} size={16} />
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    {['url', 'pdf', 'code'].map(t => (
                        <button
                            key={t}
                            className={`chip ${type === t ? 'chip-blue' : ''}`}
                            style={{ cursor: 'pointer', padding: '4px 12px', fontSize: '0.75rem' }}
                            onClick={() => setType(t)}
                        >
                            {t.toUpperCase()}
                        </button>
                    ))}
                </div>

                <input
                    className="input-field"
                    placeholder="Label (optional)"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    style={{ width: '100%', marginBottom: '8px', fontSize: '0.8125rem', padding: '8px 10px' }}
                />

                {type !== 'code' && (
                    <input
                        className="input-field"
                        placeholder="URL..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        style={{ width: '100%', marginBottom: '8px', fontSize: '0.8125rem', padding: '8px 10px' }}
                    />
                )}

                {type === 'code' && (
                    <textarea
                        className="input-field"
                        placeholder="Paste code snippet..."
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={5}
                        style={{ width: '100%', marginBottom: '8px', fontSize: '0.75rem', fontFamily: 'monospace', padding: '8px 10px', resize: 'vertical' }}
                    />
                )}

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    {type === 'pdf' && (
                        <input
                            className="input-field"
                            type="number"
                            placeholder="Page #"
                            value={pageNumber}
                            onChange={(e) => setPageNumber(e.target.value)}
                            style={{ flex: 1, fontSize: '0.75rem', padding: '6px 8px' }}
                        />
                    )}
                    {type === 'code' && (
                        <>
                            <input
                                className="input-field"
                                type="number"
                                placeholder="Line #"
                                value={lineNumber}
                                onChange={(e) => setLineNumber(e.target.value)}
                                style={{ flex: 1, fontSize: '0.75rem', padding: '6px 8px' }}
                            />
                            <input
                                className="input-field"
                                placeholder="Language"
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                style={{ flex: 1, fontSize: '0.75rem', padding: '6px 8px' }}
                            />
                        </>
                    )}
                </div>

                {transcriptTimestamp && (
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        Anchored to transcript at {transcriptTimestamp}
                    </p>
                )}

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Saving...' : 'Pin'}
                    </button>
                </div>
            </div>
        </div>
    );
}
