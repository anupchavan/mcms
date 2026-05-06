import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../stores/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

type AttendanceMarkPageProps = {
    meetingId: string | null;
    token: string | null;
};

type MarkState = 'loading' | 'success' | 'error';

export default function AttendanceMarkPage({ meetingId, token }: AttendanceMarkPageProps) {
    const { user, logout } = useAuth();
    const [state, setState] = useState<MarkState>('loading');
    const [message, setMessage] = useState('Checking your attendance link...');

    const canMarkAttendance = useMemo(() => Boolean(meetingId && token && user?.token), [meetingId, token, user?.token]);

    useEffect(() => {
        let isCancelled = false;

        if (!meetingId || !token) {
            setState('error');
            setMessage('This attendance link is incomplete or invalid.');
            return;
        }

        if (!user?.token) {
            setState('error');
            setMessage('Sign in to record your attendance for this meeting.');
            return;
        }

        const markAttendance = async () => {
            setState('loading');
            setMessage('Marking your attendance...');

            try {
                const res = await fetch(`${API_BASE}/attendance/${meetingId}/mark`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${user.token}`,
                    },
                    body: JSON.stringify({ token }),
                });

                const data = await res.json().catch(() => ({}));
                if (isCancelled) return;

                if (res.status === 401) {
                    logout();
                    setState('error');
                    setMessage(data.message || 'Your session expired. Please sign in again and rescan the QR code.');
                    return;
                }

                if (!res.ok) {
                    setState('error');
                    setMessage(data.message || 'Unable to mark attendance.');
                    return;
                }

                setState('success');
                setMessage(data.message || 'Attendance marked successfully!');
            } catch {
                if (isCancelled) return;
                setState('error');
                setMessage('Could not reach the server. Please try again.');
            }
        };

        void markAttendance();

        return () => {
            isCancelled = true;
        };
    }, [meetingId, token, user?.token, logout]);

    const title = state === 'success'
        ? 'Attendance Confirmed'
        : state === 'loading'
            ? 'Marking Attendance'
            : canMarkAttendance
                ? 'Attendance Failed'
                : 'Sign In Required';

    const accent =
        state === 'success'
            ? 'var(--flexoki-green-600)'
            : state === 'loading'
              ? 'var(--flexoki-yellow-600)'
              : 'var(--danger)';

    return (
        <div className="attendance-page-root">
            <div className="attendance-page-card">
                <div className="attendance-icon-circle" style={{ background: accent }}>
                    {state === 'success' ? '✓' : state === 'loading' ? '…' : '!'}
                </div>

                <h1 className="attendance-page-title">{title}</h1>
                <p className="attendance-page-sub">
                    {message}
                </p>

                {!user?.token && (
                    <p className="attendance-page-note">
                        Once you sign in, this page will automatically finish the attendance check-in.
                    </p>
                )}

                {state !== 'loading' && (
                    <button
                        className="btn btn-primary attendance-action-btn"
                        onClick={() => { window.location.href = '/'; }}
                    >
                        Open App
                    </button>
                )}
            </div>
        </div>
    );
}
