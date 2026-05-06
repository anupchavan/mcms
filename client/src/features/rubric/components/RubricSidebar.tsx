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
        <div className="panel rubric-panel-mt">
            <div className="section-header collapsible-header" onClick={() => setCollapsed(c => !c)}>
                <div className="section-title-container">
                    <span className="section-title">Evaluation Rubric</span>
                </div>
                <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
            </div>

            {!collapsed && (
                <div className="rubric-panel-pad">
                    {!rubric ? (
                        showUpload ? (
                            <div>
                                <p className="rubric-hint">
                                    Paste JSON array or CSV (name, maxScore, description per line):
                                </p>
                                <textarea
                                    className="input-field"
                                    value={criteriaInput}
                                    onChange={(e) => setCriteriaInput(e.target.value)}
                                    rows={4}
                                    placeholder={'Technical Skills, 10, Coding ability\nCommunication, 10, Clarity of expression'}
                                    className="input-field rubric-textarea"
                                />
                                <div className="rubric-label-row">
                                    <button className="btn btn-sm btn-primary" onClick={handleUploadRubric} disabled={loading}>
                                        {loading ? 'Creating...' : 'Create Rubric'}
                                    </button>
                                    <button className="btn btn-sm btn-secondary" onClick={() => setShowUpload(false)}>Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <button
                                className="btn-icon rubric-upload-btn"
                                onClick={() => setShowUpload(true)}
                            >
                                <Icon icon={Add01Icon} size={12} /> Upload Rubric
                            </button>
                        )
                    ) : (
                        <div>
                            <div className="rubric-criteria-mb">
                                <p className="rubric-section-label">Criteria:</p>
                                {rubric.criteria.map((c, i) => (
                                    <div key={i} className="rubric-criterion">
                                        {c.name} <span className="rubric-muted">(max: {c.maxScore})</span>
                                    </div>
                                ))}
                            </div>

                            {participants?.length > 0 && (
                                <div className="rubric-scoring-mb">
                                    <p className="rubric-section-label">Score Participant:</p>
                                    <select
                                        className="input-field rubric-select"
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
                                        <div key={i} className="rubric-criterion-gap">
                                            <label className="rubric-criterion-label">{c.name}</label>
                                            <div className="rubric-score-row">
                                                <input
                                                    type="number"
                                                    className="input-field"
                                                    min={0} max={c.maxScore}
                                                    value={scores[i]?.score || ''}
                                                    onChange={(e) => setScores(prev => ({ ...prev, [i]: { ...prev[i], score: e.target.value } }))}
                                                    className="input-field rubric-score-input"
                                                    placeholder={`/${c.maxScore}`}
                                                />
                                                <input
                                                    className="input-field rubric-comment-input"
                                                    placeholder="Comment..."
                                                    value={scores[i]?.comment || ''}
                                                    onChange={(e) => setScores(prev => ({ ...prev, [i]: { ...prev[i], comment: e.target.value } }))}
                                                />
                                            </div>
                                        </div>
                                    ))}

                                    {selectedParticipant && (
                                        <button className="btn btn-sm btn-primary rubric-submit-mt" onClick={handleScore}>
                                            Submit Scores
                                        </button>
                                    )}
                                </div>
                            )}

                            {rubric.evaluations?.length > 0 && (
                                <div className="rubric-gap-top">
                                    <p className="rubric-section-label">
                                        Evaluations ({rubric.evaluations.length})
                                    </p>
                                    {rubric.evaluations.map((ev, i) => (
                                        <div key={i} className="rubric-criterion">
                                            {ev.participantName || ev.participantId?.name || 'Unknown'}:
                                            {' '}{ev.scores.reduce((s, sc) => s + sc.score, 0)} pts
                                        </div>
                                    ))}
                                </div>
                            )}

                            <button
                                className="btn btn-sm btn-secondary rubric-gap-top"
                                onClick={handleExportReport}
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
