import { useState, useEffect } from 'react';
import Icon from '../../../shared/components/Icon';
import { Add01Icon, Cancel01Icon, ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

interface Participant {
    _id?: string;
    id?: string;
    name?: string;
    email?: string;
}

interface Criterion {
    name: string;
    maxScore: number;
    description?: string;
}

interface Rubric {
    criteria: Criterion[];
    evaluations?: Array<{
        participantName?: string;
        participantId?: { name?: string };
        scores: Array<{ score: number }>;
    }>;
}

interface RubricSidebarProps {
    meetingId?: string;
    participants?: Participant[];
    fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
}

export default function RubricSidebar({ meetingId, participants, fetchWithAuth }: RubricSidebarProps) {
    const [rubric, setRubric] = useState<Rubric | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showUpload, setShowUpload] = useState(false);
    const [criteriaInput, setCriteriaInput] = useState('');
    const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
    const [scores, setScores] = useState<Record<number, { score?: string; comment?: string }>>({});

    useEffect(() => {
        if (meetingId) loadRubric();
    }, [meetingId]);

    const loadRubric = async () => {
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/rubric/${meetingId}`);
            if (res.ok) {
                const data = await res.json();
                setRubric(data);
            }
        } catch (err) {
            console.error('Failed to load rubric:', err);
        }
    };

    const handleUploadRubric = async () => {
        try {
            let criteria;
            try {
                criteria = JSON.parse(criteriaInput);
            } catch {
                const lines = criteriaInput.split('\n').filter(l => l.trim());
                criteria = lines.map(line => {
                    const parts = line.split(',').map(s => s.trim());
                    return {
                        name: parts[0] || 'Criterion',
                        maxScore: parseInt(parts[1]) || 10,
                        description: parts[2] || '',
                    };
                });
            }

            if (!criteria.length) return;

            setLoading(true);
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/rubric/${meetingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ criteria }),
            });
            if (res.ok) {
                setRubric(await res.json());
                setShowUpload(false);
                setCriteriaInput('');
            }
        } catch (err) {
            console.error('Failed to create rubric:', err);
        }
        setLoading(false);
    };

    const handleScore = async () => {
        if (!selectedParticipant || !rubric) return;
        const scoreArray = Object.entries(scores).map(([idx, val]) => ({
            criterionIndex: parseInt(idx),
            score: parseInt(val.score) || 0,
            comment: val.comment || '',
            transcriptTimestamp: new Date().toISOString(),
        }));

        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/rubric/${meetingId}/evaluate`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantId: selectedParticipant._id || selectedParticipant.id,
                    participantName: selectedParticipant.name,
                    scores: scoreArray,
                }),
            });
            if (res.ok) {
                setRubric(await res.json());
                setScores({});
            }
        } catch (err) {
            console.error('Failed to submit evaluation:', err);
        }
    };

    const handleExportReport = () => {
        window.open(`${API_BASE}/rubric/${meetingId}/report?format=html`, '_blank');
    };

    if (!meetingId) return null;

    return (
        <div className="panel" style={{ marginTop: '8px' }}>
            <div className="section-header collapsible-header" onClick={() => setCollapsed(c => !c)}>
                <div className="section-title-container">
                    <span className="section-title">Evaluation Rubric</span>
                </div>
                <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
            </div>

            {!collapsed && (
                <div style={{ padding: '0.5rem 0.75rem' }}>
                    {!rubric ? (
                        showUpload ? (
                            <div>
                                <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                    Paste JSON array or CSV (name, maxScore, description per line):
                                </p>
                                <textarea
                                    className="input-field"
                                    value={criteriaInput}
                                    onChange={(e) => setCriteriaInput(e.target.value)}
                                    rows={4}
                                    placeholder={'Technical Skills, 10, Coding ability\nCommunication, 10, Clarity of expression'}
                                    style={{ width: '100%', fontSize: '0.75rem', fontFamily: 'monospace', padding: '6px 8px', resize: 'vertical' }}
                                />
                                <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                                    <button className="btn btn-sm btn-primary" onClick={handleUploadRubric} disabled={loading}>
                                        {loading ? 'Creating...' : 'Create Rubric'}
                                    </button>
                                    <button className="btn btn-sm btn-secondary" onClick={() => setShowUpload(false)}>Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <button
                                className="btn-icon"
                                style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}
                                onClick={() => setShowUpload(true)}
                            >
                                <Icon icon={Add01Icon} size={12} /> Upload Rubric
                            </button>
                        )
                    ) : (
                        <div>
                            <div style={{ marginBottom: '8px' }}>
                                <p style={{ fontSize: '0.6875rem', fontWeight: 600, marginBottom: '4px' }}>Criteria:</p>
                                {rubric.criteria.map((c, i) => (
                                    <div key={i} style={{ fontSize: '0.75rem', marginBottom: '2px' }}>
                                        {c.name} <span style={{ color: 'var(--text-muted)' }}>(max: {c.maxScore})</span>
                                    </div>
                                ))}
                            </div>

                            {participants?.length > 0 && (
                                <div style={{ marginBottom: '8px' }}>
                                    <p style={{ fontSize: '0.6875rem', fontWeight: 600, marginBottom: '4px' }}>Score Participant:</p>
                                    <select
                                        className="input-field"
                                        style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px', marginBottom: '6px' }}
                                        value={selectedParticipant?._id || selectedParticipant?.id || ''}
                                        onChange={(e) => {
                                            const p = participants.find(p => (p._id || p.id) === e.target.value);
                                            setSelectedParticipant(p || null);
                                            setScores({});
                                        }}
                                    >
                                        <option value="">Select participant...</option>
                                        {participants.map(p => (
                                            <option key={p._id || p.id} value={p._id || p.id}>
                                                {p.name || p.email}
                                            </option>
                                        ))}
                                    </select>

                                    {selectedParticipant && rubric.criteria.map((c, i) => (
                                        <div key={i} style={{ marginBottom: '6px' }}>
                                            <label style={{ fontSize: '0.6875rem', fontWeight: 500 }}>{c.name}</label>
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <input
                                                    type="number"
                                                    className="input-field"
                                                    min={0} max={c.maxScore}
                                                    value={scores[i]?.score || ''}
                                                    onChange={(e) => setScores(prev => ({ ...prev, [i]: { ...prev[i], score: e.target.value } }))}
                                                    style={{ width: '50px', fontSize: '0.75rem', padding: '3px 6px' }}
                                                    placeholder={`/${c.maxScore}`}
                                                />
                                                <input
                                                    className="input-field"
                                                    placeholder="Comment..."
                                                    value={scores[i]?.comment || ''}
                                                    onChange={(e) => setScores(prev => ({ ...prev, [i]: { ...prev[i], comment: e.target.value } }))}
                                                    style={{ flex: 1, fontSize: '0.6875rem', padding: '3px 6px' }}
                                                />
                                            </div>
                                        </div>
                                    ))}

                                    {selectedParticipant && (
                                        <button className="btn btn-sm btn-primary" onClick={handleScore} style={{ marginTop: '4px' }}>
                                            Submit Scores
                                        </button>
                                    )}
                                </div>
                            )}

                            {rubric.evaluations?.length > 0 && (
                                <div style={{ marginTop: '8px' }}>
                                    <p style={{ fontSize: '0.6875rem', fontWeight: 600, marginBottom: '4px' }}>
                                        Evaluations ({rubric.evaluations.length})
                                    </p>
                                    {rubric.evaluations.map((ev, i) => (
                                        <div key={i} style={{ fontSize: '0.75rem', marginBottom: '2px' }}>
                                            {ev.participantName || ev.participantId?.name || 'Unknown'}:
                                            {' '}{ev.scores.reduce((s, sc) => s + sc.score, 0)} pts
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button
                                className="btn btn-sm btn-secondary"
                                onClick={handleExportReport}
                                style={{ marginTop: '8px' }}
                            >
                                Export Report
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
