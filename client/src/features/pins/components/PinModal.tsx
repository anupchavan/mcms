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
                className="pin-modal-card"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="pin-modal-header">
                    <h3 className="pin-modal-title">
                        <Icon icon={PinIcon} size={16} /> Pin Resource
                    </h3>
                    <button className="btn-icon" onClick={onClose}>
                        <Icon icon={Cancel01Icon} size={16} />
                    </button>
                </div>

                <div className="pin-modal-tab-row">
                    {['url', 'pdf', 'code'].map(t => (
                        <button
                            key={t}
                            className={`chip pin-chip-btn ${type === t ? 'chip-blue' : ''}`}
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
                    className="input-field pin-modal-input"
                />

                {type !== 'code' && (
                    <input
                        className="input-field"
                        placeholder="URL..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="input-field pin-modal-input"
                    />
                )}

                {type === 'code' && (
                    <textarea
                        className="input-field pin-modal-textarea"
                        placeholder="Paste code snippet..."
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={5}
                    />
                )}

                <div className="pin-modal-meta-row">
                    {type === 'pdf' && (
                        <input
                            type="number"
                            placeholder="Page #"
                            value={pageNumber}
                            onChange={(e) => setPageNumber(e.target.value)}
                            className="input-field pin-modal-meta-input"
                        />
                    )}
                    {type === 'code' && (
                        <>
                            <input
                                type="number"
                                placeholder="Line #"
                                value={lineNumber}
                                onChange={(e) => setLineNumber(e.target.value)}
                                className="input-field pin-modal-meta-input"
                            />
                            <input
                                placeholder="Language"
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className="input-field pin-modal-meta-input"
                            />
                        </>
                    )}
                </div>

                {transcriptTimestamp && (
                    <p className="pin-modal-hint">
                        Anchored to transcript at {transcriptTimestamp}
                    </p>
                )}

                <div className="pin-modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                        {saving ? 'Saving...' : 'Pin'}
                    </button>
                </div>
            </div>
        </div>
    );
}
