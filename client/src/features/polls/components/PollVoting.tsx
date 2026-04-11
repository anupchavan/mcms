import { useState, useEffect } from 'react';
import Icon from '../../../shared/components/Icon';
import {
    Cancel01Icon,
    Calendar02Icon,
    Tick01Icon,
    Copy01Icon,
    Link01Icon,
} from '@hugeicons/core-free-icons';
import { useAuth } from '../../../stores/AuthContext';
import { useSocket } from '../../../stores/SocketContext';

interface PollSlot {
    date: string;
    time: string;
    votes?: Array<string | { _id: string }>;
}

interface Poll {
    _id: string;
    slots: PollSlot[];
    status: string;
    resolvedSlot?: number;
    meetingTitle?: string;
    modality?: string;
    meetingUrl?: string;
}

interface PollVotingProps {
    meetingId: string;
    onClose: () => void;
}

const _raw = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const API_BASE = _raw.endsWith('/api') ? _raw : `${_raw}/api`;

export default function PollVoting({ meetingId, onClose }: PollVotingProps) {
    const { user } = useAuth();
    const { socket } = useSocket();
    const [poll, setPoll] = useState<Poll | null>(null);
    const [meetingTitle, setMeetingTitle] = useState('');
    const [modality, setModality] = useState('');
    const [meetingUrl, setMeetingUrl] = useState('');
    const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
    const [hasVoted, setHasVoted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!meetingId || !user?.token) return;
        fetch(`${API_BASE}/polls/${meetingId}`, {
            headers: { Authorization: `Bearer ${user.token}` },
        })
            .then(r => {
                if (!r.ok) throw new Error('Poll not found');
                return r.json();
            })
            .then(data => {
                setPoll(data);
                setMeetingTitle(data.meetingTitle || '');
                setModality(data.modality || '');
                setMeetingUrl(data.meetingUrl || '');

                const myVoteIdx = data.slots?.findIndex(s =>
                    s.votes?.some(v => (v._id || v).toString() === user._id.toString())
                );
                if (myVoteIdx >= 0) {
                    setSelectedSlot(myVoteIdx);
                    setHasVoted(true);
                }
            })
            .catch(() => setError('Could not load poll'));
    }, [meetingId, user]);

    useEffect(() => {
        if (!socket || !poll?._id) return;
        const handler = (data: { pollId: string; slots: PollSlot[]; status: string; resolvedSlot?: number }) => {
            if (data.pollId === poll._id) {
                setPoll(prev => prev ? {
                    ...prev,
                    slots: data.slots,
                    status: data.status,
                    resolvedSlot: data.resolvedSlot,
                } : prev);
            }
        };
        socket.on('poll_updated', handler);
        return () => { socket.off('poll_updated', handler); };
    }, [socket, poll?._id]);

    const handleVote = async () => {
        if (selectedSlot === null || !poll?._id) return;
        setSubmitting(true);
        try {
            const res = await fetch(`${API_BASE}/polls/${poll._id}/vote`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${user.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ slotIndex: selectedSlot }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.message || 'Vote failed');
            }
            const data = await res.json();
            setPoll(data.poll);
            setHasVoted(true);
            if (data.resolved && data.meeting) {
                setMeetingUrl(data.meeting?.meetingUrl || '');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(meetingUrl);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        } catch { /* ignore */ }
    };

    const totalVotes = poll?.slots?.reduce((sum, s) => sum + (s.votes?.length || 0), 0) || 0;
    const isResolved = poll?.status === 'resolved';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content poll-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{isResolved ? 'Poll Results' : 'Vote on Meeting Time'}</h2>
                    <button className="btn-icon" onClick={onClose}>
                        <Icon icon={Cancel01Icon} size={18} />
                    </button>
                </div>

                {error && !poll && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{error}</div>
                )}

                {poll && (
                    <div className="poll-body">
                        <h3 className="poll-meeting-title">{meetingTitle}</h3>

                        {isResolved && (
                            <div className="poll-resolved-banner">
                                Meeting time confirmed!
                            </div>
                        )}

                        <div className="poll-slots">
                            {poll.slots.map((slot, i) => {
                                const voteCount = slot.votes?.length || 0;
                                const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
                                const isWinner = isResolved && poll.resolvedSlot === i;
                                const isSelected = selectedSlot === i;

                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        className={`poll-slot${isSelected ? ' selected' : ''}${isWinner ? ' winner' : ''}${isResolved ? ' locked' : ''}`}
                                        onClick={() => { if (!isResolved) setSelectedSlot(i); }}
                                        disabled={isResolved}
                                    >
                                        <div className="poll-slot-bar" style={{ width: `${pct}%` }} />
                                        <div className="poll-slot-content">
                                            <div className="poll-slot-left">
                                                <div className={`poll-slot-radio${isSelected ? ' checked' : ''}`}>
                                                    {isSelected && <Icon icon={Tick01Icon} size={10} />}
                                                </div>
                                                <div className="poll-slot-info">
                                                    <span className="poll-slot-date">
                                                        {new Date(slot.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </span>
                                                    <span className="poll-slot-time">{slot.time}</span>
                                                </div>
                                            </div>
                                            <div className="poll-slot-right">
                                                <span className="poll-slot-votes">{voteCount} vote{voteCount !== 1 ? 's' : ''}</span>
                                                {(hasVoted || isResolved) && <span className="poll-slot-pct">{pct}%</span>}
                                                {isWinner && <span className="poll-slot-winner-badge">Winner</span>}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="poll-total">
                            {totalVotes} total vote{totalVotes !== 1 ? 's' : ''}
                        </div>

                        {isResolved && meetingUrl && modality !== 'Offline' && (
                            <div className="jitsi-link-card" style={{ marginTop: '1rem' }}>
                                <div className="jitsi-link-label">
                                    <Icon icon={Link01Icon} size={14} />
                                    Meeting Link
                                </div>
                                <div className="jitsi-link-row">
                                    <span className="jitsi-link-url">{meetingUrl}</span>
                                    <button className={`btn btn-sm ${linkCopied ? 'btn-success' : 'btn-secondary'}`} onClick={handleCopyLink}>
                                        <Icon icon={linkCopied ? Tick01Icon : Copy01Icon} size={14} />
                                        {linkCopied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                    {!isResolved && (
                        <button
                            className="btn btn-primary"
                            onClick={handleVote}
                            disabled={selectedSlot === null || submitting}
                        >
                            {submitting ? 'Submitting...' : hasVoted ? 'Update Vote' : 'Submit Vote'}
                        </button>
                    )}
                    <button className="btn btn-secondary" onClick={onClose}>
                        {isResolved ? 'Close' : 'Cancel'}
                    </button>
                </div>
            </div>
        </div>
    );
}
